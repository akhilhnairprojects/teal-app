/**
 * Turns a leg spec into a timed transit leg [AR §3.2 steps 3–6]. Predictions come from one call
 * for every candidate station and route, grouped by trip and mapped from platforms back to parent
 * stations. A trip qualifies when it departs the boarding station at or after the earliest time
 * and reaches the alighting station at a higher stop_sequence, with neither stop skipped or
 * cancelled. Fallbacks: trip schedules for a missing alighting prediction, the hop estimate for
 * ADDED trips, and a schedule window when the boarding station has no usable prediction.
 */
import { toErrorDetail } from '@/mbta/api/errors';
import { childStopIds, parentStationId, type GlobalData } from '@/mbta/global/globalData';
import type { Alert, DirectionId, LiveDepartures, ScheduleRelationship, ScheduleSet } from '@/mbta/model/types';
import { applicableAlerts, hasNoThroughService, significanceAt, significanceRank } from '@/mbta/rules/alerts';
import { recommendCar } from '@/mbta/rules/vehicle';
import { formatServiceTime, serviceDate, serviceMinutes } from '@/mbta/time/eastern';

import { LATER_DEPARTURES, MAX_SCHEDULE_FALLBACKS, SCHEDULE_WINDOW_MIN, SCHEDULE_WINDOW_REUSE_MS, SCHEDULE_WINDOW_SLACK_MIN } from './constants';
import type { LegSpec } from './graph';
import type { PlannerDeps, PlanNotice, TransitLeg } from './types';

const MIN = 60_000;

// --- trip index -------------------------------------------------------------------------

export type StopEvent = {
  stopId: string;
  station: string;
  arr: number | null;
  dep: number | null;
  seq: number;
  rel: ScheduleRelationship;
  uncertainty: number | null;
  /** Schedules only: false when pick-up / drop-off is unavailable here. */
  pickUp: boolean;
  dropOff: boolean;
};

export type TripEvents = {
  tripId: string;
  routeId: string;
  directionId: DirectionId;
  headsign: string | null;
  vehicleId: string | null;
  added: boolean;
  stops: Record<string /* parent station */, StopEvent>;
};

const usable = (rel: ScheduleRelationship) => rel !== 'SKIPPED' && rel !== 'CANCELLED';

function put(trip: TripEvents, e: StopEvent) {
  const prev = trip.stops[e.station];
  if (!prev || e.seq < prev.seq) trip.stops[e.station] = e;
}

/** Predictions grouped by trip, keyed by parent station (non-revenue trips dropped). */
export function indexPredictions(g: GlobalData, live: LiveDepartures | null): Record<string, TripEvents> {
  const trips: Record<string, TripEvents> = {};
  for (const p of live?.predictions ?? []) {
    if (!p.revenue) continue;
    const trip = (trips[p.tripId] ??= {
      tripId: p.tripId,
      routeId: p.routeId,
      directionId: p.directionId,
      headsign: live?.trips[p.tripId]?.headsign || p.tripHeadsign || null,
      vehicleId: null,
      added: p.tripId.startsWith('ADDED'),
      stops: {},
    });
    if (p.scheduleRelationship === 'ADDED') trip.added = true;
    if (p.vehicleId) trip.vehicleId = p.vehicleId;
    put(trip, {
      stopId: p.stopId,
      station: parentStationId(g, p.stopId),
      arr: p.arrivalTime,
      dep: p.departureTime,
      seq: p.stopSequence,
      rel: p.scheduleRelationship,
      uncertainty: p.departureUncertainty,
      pickUp: true,
      dropOff: true,
    });
  }
  return trips;
}

/** Schedules grouped the same way. */
export function indexSchedules(g: GlobalData, set: ScheduleSet | null): Record<string, TripEvents> {
  const trips: Record<string, TripEvents> = {};
  for (const s of set?.schedules ?? []) {
    const t = set?.trips[s.tripId];
    const trip = (trips[s.tripId] ??= {
      tripId: s.tripId,
      routeId: s.routeId,
      directionId: t?.directionId ?? 0,
      headsign: s.stopHeadsign || t?.headsign || null,
      vehicleId: null,
      added: false,
      stops: {},
    });
    put(trip, {
      stopId: s.stopId,
      station: parentStationId(g, s.stopId),
      arr: s.arrivalTime,
      dep: s.departureTime,
      seq: s.stopSequence,
      rel: null,
      uncertainty: null,
      pickUp: s.pickUpType !== 1,
      dropOff: s.dropOffType !== 1,
    });
  }
  return trips;
}

// --- alerts -----------------------------------------------------------------------------

const BLOCKING_EFFECTS = new Set(['SUSPENSION', 'SHUTTLE', 'STATION_CLOSURE']);
const NOTICE_EFFECTS = new Set(['DELAY', 'DETOUR']);

export type LegAlerts = { blocking: Alert[]; info: Alert[] };

/**
 * Alerts for a leg: boarding at `from`, exiting at `to`, and riding through the stations between.
 * Blocking = major (now) suspension / shuttle / station closure at the board or alight stop, or a
 * suspension / shuttle on the stations ridden through. Delays, detours and other secondary-or-worse
 * alerts are informational.
 */
export function legAlerts(g: GlobalData, spec: LegSpec, alerts: readonly Alert[] | null, now: number): LegAlerts {
  if (!alerts?.length) return { blocking: [], info: [] };
  const list = alerts as Alert[];
  const stopsOf = (station: string) => [station, ...childStopIds(g, station)];
  const q = { routeIds: spec.routeIds, directionId: spec.directionId };
  const board = applicableAlerts(list, { ...q, stopIds: stopsOf(spec.from), activities: ['BOARD'] }, now);
  const exit = applicableAlerts(list, { ...q, stopIds: stopsOf(spec.to), activities: ['EXIT'] }, now);
  const ride = spec.between.length ? applicableAlerts(list, { ...q, stopIds: spec.between.flatMap(stopsOf), activities: ['RIDE'] }, now) : [];
  const blocking: Alert[] = [];
  const info: Alert[] = [];
  const seen = new Set<string>();
  for (const [a, where] of [...board.map((a) => [a, 'end'] as const), ...exit.map((a) => [a, 'end'] as const), ...ride.map((a) => [a, 'ride'] as const)]) {
    if (seen.has(a.id)) continue;
    const sig = significanceAt(a, now);
    const blocks = sig === 'major' && BLOCKING_EFFECTS.has(a.effect) && (where === 'end' || hasNoThroughService(a));
    if (blocks) {
      seen.add(a.id);
      blocking.push(a);
    } else if (NOTICE_EFFECTS.has(a.effect) || significanceRank(sig) >= significanceRank('secondary')) {
      seen.add(a.id);
      info.push(a);
    }
  }
  return { blocking, info };
}

// --- evaluation environment -------------------------------------------------------------

/** Schedule responses kept for the life of a plan (they do not change between refreshes). */
export type ScheduleCaches = {
  trips: Map<string, Promise<ScheduleSet | null>>;
  windows: Map<string, { fetchedAt: number; result: Promise<ScheduleSet | null> }>;
};

export const newScheduleCaches = (): ScheduleCaches => ({ trips: new Map(), windows: new Map() });

export type WindowGroup = { key: string; routeIds: string[]; directionId: DirectionId; stopIds: string[]; maxRideMin: number };

/** One schedule-window query per line and direction, covering every candidate station on it. */
export function windowGroups(specs: LegSpec[]): Map<string, WindowGroup> {
  const groups = new Map<string, WindowGroup>();
  for (const s of specs) {
    const key = `${s.lineKey}|${s.directionId}`;
    const g = groups.get(key) ?? { key, routeIds: [], directionId: s.directionId, stopIds: [], maxRideMin: 0 };
    for (const r of s.routeIds) if (!g.routeIds.includes(r)) g.routeIds.push(r);
    for (const st of [s.from, s.to]) if (!g.stopIds.includes(st)) g.stopIds.push(st);
    g.maxRideMin = Math.max(g.maxRideMin, s.rideMin);
    groups.set(key, g);
  }
  return groups;
}

export class NoticeSink {
  readonly list: PlanNotice[] = [];
  add(n: PlanNotice) {
    if (!this.list.some((x) => x.kind === n.kind && x.text === n.text && x.alertId === n.alertId)) this.list.push(n);
  }
}

export const RATE_LIMITED_TEXT = 'Live times are paused by the MBTA rate limit. Showing scheduled times where possible.';

export type EvalEnv = {
  global: GlobalData;
  now: number;
  predicted: Record<string, TripEvents>;
  vehicles: LiveDepartures['vehicles'];
  deps: Pick<PlannerDeps, 'fetchSchedulesForTrip' | 'fetchSchedulesWindow'>;
  signal?: AbortSignal;
  caches: ScheduleCaches;
  /** Network schedule calls still allowed in this evaluation. */
  budget: { remaining: number };
  groups: Map<string, WindowGroup>;
  notices: NoticeSink;
};

export function newBudget(): { remaining: number } {
  return { remaining: MAX_SCHEDULE_FALLBACKS };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    throw e;
  }
}

/** Runs a schedule call, or null when the budget is spent or the call fails (rate limits become a notice). */
async function scheduleCall(env: EvalEnv, call: () => Promise<ScheduleSet>): Promise<ScheduleSet | null> {
  if (env.budget.remaining <= 0) return null;
  env.budget.remaining--;
  try {
    return await call();
  } catch (e) {
    const d = toErrorDetail(e);
    if (d.kind === 'aborted') throw e;
    if (d.kind === 'rateLimited') env.notices.add({ kind: 'rateLimited', severity: 'warning', text: RATE_LIMITED_TEXT });
    return null;
  }
}

function tripSchedules(env: EvalEnv, tripId: string, stations: string[]): Promise<ScheduleSet | null> | null {
  const cached = env.caches.trips.get(tripId);
  if (cached) return cached;
  if (env.budget.remaining <= 0) return null;
  const p = scheduleCall(env, () => env.deps.fetchSchedulesForTrip(tripId, stations, { signal: env.signal, priority: 'foreground' }));
  env.caches.trips.set(tripId, p);
  // Failed calls are retried on a later refresh rather than cached.
  void p.then((r) => r === null && env.caches.trips.delete(tripId), () => env.caches.trips.delete(tripId));
  return p;
}

function windowSchedules(env: EvalEnv, spec: LegSpec): Promise<ScheduleSet | null> | null {
  const group = env.groups.get(`${spec.lineKey}|${spec.directionId}`);
  if (!group) return null;
  const cacheKey = `${group.key}|${group.stopIds.slice().sort().join(',')}`;
  const cached = env.caches.windows.get(cacheKey);
  if (cached && env.now - cached.fetchedAt < SCHEDULE_WINDOW_REUSE_MS) return cached.result;
  if (env.budget.remaining <= 0) return null;
  const start = serviceMinutes(env.now);
  const q = {
    stopIds: group.stopIds,
    routeIds: group.routeIds,
    directionId: group.directionId,
    date: serviceDate(env.now),
    minTime: formatServiceTime(start),
    maxTime: formatServiceTime(start + SCHEDULE_WINDOW_MIN + group.maxRideMin + SCHEDULE_WINDOW_SLACK_MIN),
  };
  const result = scheduleCall(env, () => env.deps.fetchSchedulesWindow(q, { signal: env.signal, priority: 'foreground' }));
  env.caches.windows.set(cacheKey, { fetchedAt: env.now, result });
  void result.then((r) => r === null && env.caches.windows.delete(cacheKey), () => env.caches.windows.delete(cacheKey));
  return result;
}

/** False when an unpredicted trip's headsign belongs to a pattern that does not reach the alighting station. */
export function headsignPlausible(spec: LegSpec, headsign: string | null): boolean {
  if (!headsign) return true;
  if (spec.servingHeadsigns.includes(headsign)) return true;
  return !spec.knownHeadsigns.includes(headsign);
}

/**
 * Hop-based arrival for a trip with no alighting time, starting from the latest predicted station
 * between boarding and alighting when the trip has one (so a late train is not estimated as on time).
 */
export function estimateArrival(spec: LegSpec, trip: TripEvents, board: StopEvent): number {
  const perHop = spec.hops > 0 ? spec.rideMin / spec.hops : 0;
  let best = (board.dep ?? 0) + spec.rideMin * MIN;
  spec.between.forEach((station, i) => {
    const e = trip.stops[station];
    const t = e && usable(e.rel) && e.seq > board.seq ? (e.arr ?? e.dep) : null;
    if (t !== null) best = Math.max(best, t + (spec.hops - (i + 1)) * perHop * MIN);
  });
  return best;
}

type Resolved = { trip: TripEvents; board: StopEvent; alight: StopEvent | null; arrive: number; source: TransitLeg['timeSource'] };

const boardable = (spec: LegSpec, earliest: number) => (t: TripEvents) => {
  if (!spec.routeIds.includes(t.routeId) || t.directionId !== spec.directionId) return null;
  const b = t.stops[spec.from];
  if (!b || b.dep === null || b.dep < earliest || !usable(b.rel) || !b.pickUp) return null;
  return { trip: t, board: b };
};

/** Arrival from the trip's schedule delta, null when the trip does not serve the leg, undefined when unknown. */
function arrivalFromSchedule(env: EvalEnv, spec: LegSpec, board: StopEvent, set: ScheduleSet, tripId: string): number | null | undefined {
  const t = indexSchedules(env.global, set)[tripId];
  if (!t) return undefined;
  const a = t.stops[spec.from];
  const b = t.stops[spec.to];
  if (!b || (a && b.seq <= a.seq) || !b.dropOff) return null;
  const bTime = b.arr ?? b.dep;
  if (bTime === null || board.dep === null) return undefined;
  const aTime = a ? (a.dep ?? a.arr) : null;
  return aTime !== null ? board.dep + (bTime - aTime) : Math.max(bTime, board.dep + MIN);
}

/** The earliest qualifying trip for `spec` leaving at or after `earliest`, or null. */
export async function evaluateLeg(spec: LegSpec, earliest: number, env: EvalEnv): Promise<TransitLeg | null> {
  const candidates = Object.values(env.predicted)
    .map(boardable(spec, earliest))
    .filter((x): x is { trip: TripEvents; board: StopEvent } => x !== null)
    .sort((a, b) => (a.board.dep ?? 0) - (b.board.dep ?? 0));

  let chosen: Resolved | null = null;
  const later: number[] = [];
  for (const { trip, board } of candidates) {
    const alight = trip.stops[spec.to];
    let resolved: Resolved | null = null;
    if (alight) {
      const at = alight.arr ?? alight.dep;
      if (alight.seq > board.seq && usable(alight.rel) && at !== null) resolved = { trip, board, alight, arrive: at, source: 'realtime' };
      else continue; // skipped, cancelled, or the wrong way
    } else if (!headsignPlausible(spec, trip.headsign)) {
      continue;
    } else if (chosen) {
      later.push(board.dep!);
      if (later.length >= LATER_DEPARTURES) break;
      continue;
    } else if (trip.added) {
      resolved = { trip, board, alight: null, arrive: estimateArrival(spec, trip, board), source: 'estimated' };
    } else {
      const pending = tripSchedules(env, trip.tripId, [spec.from, spec.to]);
      const set = pending ? await pending : null;
      throwIfAborted(env.signal);
      const fromSchedule = set ? arrivalFromSchedule(env, spec, board, set, trip.tripId) : undefined;
      if (fromSchedule === null) continue; // the schedule says this trip does not stop there
      resolved =
        fromSchedule !== undefined
          ? { trip, board, alight: null, arrive: fromSchedule, source: 'realtime' }
          : { trip, board, alight: null, arrive: estimateArrival(spec, trip, board), source: 'estimated' };
    }
    if (!chosen) chosen = resolved;
    else {
      later.push(board.dep!);
      if (later.length >= LATER_DEPARTURES) break;
    }
  }

  if (!chosen) {
    const pending = windowSchedules(env, spec);
    const set = pending ? await pending : null;
    throwIfAborted(env.signal);
    if (set) {
      const scheduled = Object.values(indexSchedules(env.global, set))
        .map(boardable(spec, earliest))
        .filter((x): x is { trip: TripEvents; board: StopEvent } => x !== null)
        .map(({ trip, board }) => {
          const alight = trip.stops[spec.to];
          const at = alight ? (alight.arr ?? alight.dep) : null;
          return alight && alight.seq > board.seq && alight.dropOff && at !== null ? { trip, board, alight, arrive: at } : null;
        })
        .filter((x): x is { trip: TripEvents; board: StopEvent; alight: StopEvent; arrive: number } => x !== null)
        .sort((a, b) => a.board.dep! - b.board.dep!);
      if (scheduled.length) {
        chosen = { ...scheduled[0], source: 'scheduled' };
        later.push(...scheduled.slice(1, 1 + LATER_DEPARTURES).map((s) => s.board.dep!));
      }
    }
  }
  if (!chosen) return null;

  const vehicle = chosen.trip.vehicleId ? env.vehicles[chosen.trip.vehicleId] : undefined;
  const carriages = vehicle?.carriages ?? [];
  return {
    mode: 'transit',
    routeId: chosen.trip.routeId,
    directionId: spec.directionId,
    headsign: chosen.trip.headsign ?? spec.servingHeadsigns[0] ?? '',
    tripId: chosen.trip.tripId,
    fromStopId: spec.from,
    toStopId: spec.to,
    boardPlatformId: chosen.board.stopId,
    alightPlatformId: chosen.alight?.stopId ?? null,
    departTime: chosen.board.dep!,
    arriveTime: Math.max(chosen.arrive, chosen.board.dep!),
    timeSource: chosen.source,
    stopCount: spec.hops,
    vehicleId: vehicle?.id ?? null,
    carriages,
    car: carriages.length >= 2 ? recommendCar(carriages) : null,
    alerts: [],
    uncertaintySec: chosen.board.uncertainty,
    laterDepartures: later,
  };
}
