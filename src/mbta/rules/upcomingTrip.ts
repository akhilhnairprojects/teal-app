// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/UpcomingTrip.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { GlobalData } from '@/mbta/global/globalData';
import { resolveParentId } from '@/mbta/model/parse';
import {
  isSubwayType,
  type Alert,
  type DirectionId,
  type LiveDepartures,
  type Prediction,
  type RouteType,
  type Schedule,
  type ScheduleSet,
  type Stop,
  type Trip,
  type Vehicle,
} from '@/mbta/model/types';

import { SILVER_ROUTES } from './lineOrRoute';
import { stopTimeOf, tripInstantDisplay, type DisplayContext, type TripInstantDisplay } from './tripInstantDisplay';
import type { FormattedTrip } from './upcomingFormat';

export type UpcomingTrip = {
  id: string;
  trip: Trip;
  schedule: Schedule | null;
  prediction: Prediction | null;
  vehicle: Vehicle | null;
  predictionStop: Stop | null;
  /** An alert naming this trip at this stop (e.g. a shuttle for one CR trip). */
  alert?: Alert | null;
};

export function makeUpcomingTrip(
  trip: Trip,
  schedule: Schedule | null = null,
  prediction: Prediction | null = null,
  predictionStop: Stop | null = null,
  vehicle: Vehicle | null = null,
  alert: Alert | null = null,
): UpcomingTrip {
  const seq = prediction?.stopSequence ?? schedule?.stopSequence;
  return { id: `${trip.id}-${seq ?? 'null'}`, trip, schedule, prediction, vehicle, predictionStop, alert };
}

const stoppingHere = (p: Prediction) => p.scheduleRelationship !== 'CANCELLED' && p.scheduleRelationship !== 'SKIPPED';

/** The displayed time: the prediction's when it stops here, else the schedule's. */
export function upcomingTime(t: UpcomingTrip): number | null {
  const p = t.prediction;
  if (p && stoppingHere(p) && !(stopTimeOf(p) === null && p.status !== null)) return stopTimeOf(p);
  return stopTimeOf(t.schedule);
}

/** prediction trip headsign, then the schedule's stop headsign, then the trip headsign. */
export function headsign(t: UpcomingTrip): string {
  return t.prediction?.tripHeadsign ?? t.schedule?.stopHeadsign ?? t.trip.headsign;
}

/** Effective route (multi-route trips are copied per route). */
export const upcomingRouteId = (t: UpcomingTrip): string => t.prediction?.routeId ?? t.schedule?.routeId ?? t.trip.routeId;

export const upcomingStopId = (t: UpcomingTrip): string | null => t.prediction?.stopId ?? t.schedule?.stopId ?? null;

export const upcomingStopSequence = (t: UpcomingTrip): number | null => t.schedule?.stopSequence ?? t.prediction?.stopSequence ?? null;

export const isCancelled = (t: UpcomingTrip): boolean =>
  stopTimeOf(t.schedule) !== null && t.prediction?.scheduleRelationship === 'CANCELLED';

export const isUpcoming = (t: UpcomingTrip): boolean => upcomingTime(t) !== null;

export const isInTheFuture = (t: UpcomingTrip, now: number): boolean => {
  const time = upcomingTime(t);
  return time !== null && time >= now;
};

export const isUpcomingWithin = (t: UpcomingTrip, cutoff: number): boolean => {
  const time = upcomingTime(t);
  return time !== null && time < cutoff;
};

export const isVehicleAtTheStop = (t: UpcomingTrip): boolean =>
  t.prediction !== null && t.vehicle !== null && t.prediction.stopId === t.vehicle.stopId;

export const doesPredictionHaveStatus = (t: UpcomingTrip): boolean => !!t.prediction?.status?.trim();

/** True if the trip only arrives here, false if it departs, null if it does neither. */
export function isArrivalOnly(t: UpcomingTrip): boolean | null {
  const hasArrival = t.schedule ? t.schedule.dropOffType !== 1 : t.prediction?.arrivalTime != null;
  const hasDeparture = t.schedule ? t.schedule.pickUpType !== 1 : t.prediction?.departureTime != null;
  if (!hasArrival && !hasDeparture) return null;
  return !hasDeparture;
}

/** At least one trip is arrival-only and none departs. */
export function allArrivalOnly(trips: UpcomingTrip[]): boolean {
  const values = new Set(trips.map(isArrivalOnly));
  return values.has(true) && !values.has(false);
}

export const compareUpcoming = (a: UpcomingTrip, b: UpcomingTrip): number => {
  const ta = upcomingTime(a);
  const tb = upcomingTime(b);
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb;
};

export function display(
  t: UpcomingTrip,
  now: number,
  routeType: RouteType,
  context: DisplayContext,
  lastTrip: boolean,
): TripInstantDisplay {
  return tripInstantDisplay({
    prediction: t.prediction,
    schedule: t.schedule,
    vehicle: t.vehicle,
    routeType,
    now,
    context,
    lastTrip,
    alert: t.alert ?? null,
  });
}

/** Format one trip, or null when it should not be shown (hidden, or a schedule on subway). */
export function formatUpcomingTrip(
  t: UpcomingTrip,
  now: number,
  routeType: RouteType,
  context: DisplayContext,
  hideSchedule: boolean,
  lastTrip: boolean,
): FormattedTrip | null {
  const format = display(t, now, routeType, context, lastTrip);
  if (format.kind === 'hidden') return null;
  // API best practices call for hiding scheduled times on subway.
  if (hideSchedule && (format.kind === 'scheduleTime' || format.kind === 'scheduleMinutes')) return null;
  return { id: t.id, trip: t, routeType, format, lastTrip, alert: t.alert ?? null };
}

export const hidesSchedules = (route: { id: string; type: RouteType }): boolean =>
  isSubwayType(route.type) || SILVER_ROUTES.includes(route.id);

/**
 * Format every trip with its last-trip flag (UpcomingTrip.withFormat). On subway the flag comes
 * from `prediction.last_trip`; elsewhere it is the final trip, moved off a cancelled final trip.
 */
export function withFormat(
  trips: UpcomingTrip[],
  now: number,
  route: { id: string; type: RouteType },
  context: DisplayContext,
): { trip: UpcomingTrip; format: FormattedTrip | null }[] {
  const subway = isSubwayType(route.type);
  const hide = hidesSchedules(route);
  const lastOne = trips[trips.length - 1];
  const formatted = trips.map((t) => {
    const last = (subway && t.prediction?.lastTrip === true) || (!subway && t === lastOne);
    return { trip: t, format: formatUpcomingTrip(t, now, route.type, context, hide, last) };
  });
  const lastNonCancelled = [...formatted].reverse().find((f) => f.format?.format.kind !== 'cancelled');
  if (!formatted.some((f) => f.format?.lastTrip === true) || lastNonCancelled?.format?.lastTrip) return formatted;
  return formatted.map((f) => {
    if (f === lastNonCancelled) return { trip: f.trip, format: formatUpcomingTrip(f.trip, now, route.type, context, hide, true) };
    if (f.format?.lastTrip === true) return { trip: f.trip, format: formatUpcomingTrip(f.trip, now, route.type, context, hide, false) };
    return f;
  });
}

/**
 * Last-trip flags for display without a format pass: subway uses `prediction.last_trip`, other
 * modes flag the final non-cancelled trip.
 */
export function isLastTripFlags(trips: UpcomingTrip[], routeType: RouteType): boolean[] {
  if (isSubwayType(routeType)) return trips.map((t) => t.prediction?.lastTrip === true);
  let lastIndex = -1;
  for (let i = trips.length - 1; i >= 0; i--) {
    if (!isCancelled(trips[i])) {
      lastIndex = i;
      break;
    }
  }
  return trips.map((_, i) => i === lastIndex);
}

const NO_ALERTS: readonly Alert[] = [];

/**
 * Alerts that name a trip at a stop, keyed `tripId\u0000rootStopId`; the first alert in list order
 * wins, as with `alerts.find`. Built once per alerts list (and stop table) instead of scanning
 * every alert for every joined row.
 */
const tripStopAlertIndexes = new WeakMap<readonly Alert[], WeakMap<GlobalData['stops'], Map<string, Alert>>>();

function tripStopAlertIndex(alerts: readonly Alert[], stops: GlobalData['stops']): Map<string, Alert> {
  let byStops = tripStopAlertIndexes.get(alerts);
  if (!byStops) {
    byStops = new WeakMap();
    tripStopAlertIndexes.set(alerts, byStops);
  }
  let index = byStops.get(stops);
  if (!index) {
    index = new Map();
    for (const a of alerts) {
      for (const e of a.informedEntities) {
        if (e.tripId === null || e.stopId === null) continue;
        const key = `${e.tripId}\u0000${resolveParentId(stops, e.stopId)}`;
        if (!index.has(key)) index.set(key, a);
      }
    }
    byStops.set(stops, index);
  }
  return index;
}

const scheduleOnlyPast = (prediction: Prediction | null, schedule: Schedule | null, now: number) => {
  if (prediction && stoppingHere(prediction)) return false;
  const scheduleTime = stopTimeOf(schedule);
  return scheduleTime !== null && scheduleTime < now;
};

/**
 * The time-independent join, sorted by time, without schedule-only rows already past at `now`.
 * Rows past at `now` are past at any later time, so the result can be reused for later times.
 */
function joinUpcomingTrips(g: GlobalData, s: ScheduleSet | null, p: LiveDepartures | null, alerts: readonly Alert[], now: number): UpcomingTrip[] {
  const stops = g.stops;
  const schedules = s?.schedules ?? [];
  const predictions = p?.predictions ?? [];
  const trips: Record<string, Trip> = { ...(s?.trips ?? {}), ...(p?.trips ?? {}) };
  const vehicles = p?.vehicles ?? {};

  const cancelledTrips = new Set(predictions.filter((x) => x.scheduleRelationship === 'CANCELLED').map((x) => x.tripId));
  const keyOf = (x: { routeId: string; tripId: string; stopId: string; stopSequence: number }) =>
    `${x.routeId}\u0000${x.tripId}\u0000${resolveParentId(stops, x.stopId)}\u0000${cancelledTrips.has(x.tripId) ? '' : x.stopSequence}`;

  const schedulesMap = new Map<string, Schedule>();
  for (const x of schedules) schedulesMap.set(keyOf(x), x);
  const predictionsMap = new Map<string, Prediction>();
  for (const x of predictions) predictionsMap.set(keyOf(x), x);
  const keys = new Set([...schedulesMap.keys(), ...predictionsMap.keys()]);

  const alertIndex = alerts.length ? tripStopAlertIndex(alerts, stops) : null;
  const result: UpcomingTrip[] = [];
  for (const key of keys) {
    const prediction = predictionsMap.get(key) ?? null;
    const schedule = schedulesMap.get(key) ?? null;
    // Most of a day's schedules are behind us: skip them before any further work.
    if (scheduleOnlyPast(prediction, schedule, now)) continue;
    const [, tripId, rootStopId] = key.split('\u0000');
    const trip = trips[tripId];
    if (!trip) continue;
    result.push(
      makeUpcomingTrip(
        trip,
        schedule,
        prediction,
        prediction ? (stops[prediction.stopId] ?? null) : null,
        prediction?.vehicleId ? (vehicles[prediction.vehicleId] ?? null) : null,
        alertIndex?.get(`${tripId}\u0000${rootStopId}`) ?? null,
      ),
    );
  }
  return result.sort(compareUpcoming);
}

/**
 * Recent joins by input identity. Screens re-render every 5–10 s with the same schedules,
 * predictions and alerts objects; only the past-row filter depends on the clock.
 */
type JoinMemo = { g: GlobalData; s: ScheduleSet | null; p: LiveDepartures | null; alerts: readonly Alert[]; joinedAt: number; trips: UpcomingTrip[] };
const JOIN_MEMO_MAX = 4;
const joinMemo: JoinMemo[] = [];

function memoizedJoin(g: GlobalData, s: ScheduleSet | null, p: LiveDepartures | null, alerts: readonly Alert[], now: number): UpcomingTrip[] {
  const i = joinMemo.findIndex((m) => m.g === g && m.s === s && m.p === p && m.alerts === alerts && m.joinedAt <= now);
  if (i >= 0) {
    const [hit] = joinMemo.splice(i, 1);
    joinMemo.unshift(hit);
    return hit.trips;
  }
  const trips = joinUpcomingTrips(g, s, p, alerts, now);
  joinMemo.unshift({ g, s, p, alerts, joinedAt: now, trips });
  joinMemo.length = Math.min(joinMemo.length, JOIN_MEMO_MAX);
  return trips;
}

/**
 * Join schedules and predictions into upcoming trips (UpcomingTrip.tripsFromData). Matches on
 * (route, trip, parent stop, stop sequence), ignoring the sequence for trips with any cancelled
 * prediction; drops schedule-only trips whose time is before `now`. Sorted by time.
 */
export function buildUpcomingTrips(
  g: GlobalData,
  s: ScheduleSet | null,
  p: LiveDepartures | null,
  filter?: { stopIds?: string[]; routeIds?: string[]; directionId?: DirectionId },
  opts: { now?: number; alerts?: Alert[] | null } = {},
): UpcomingTrip[] {
  const now = opts.now ?? Date.now();
  const stops = g.stops;
  return memoizedJoin(g, s, p, opts.alerts ?? NO_ALERTS, now)
    .filter((t) => !scheduleOnlyPast(t.prediction, t.schedule, now))
    .filter((t) => {
      if (!filter) return true;
      if (filter.routeIds && !filter.routeIds.includes(upcomingRouteId(t))) return false;
      if (filter.directionId !== undefined && t.trip.directionId !== filter.directionId) return false;
      if (filter.stopIds) {
        const stopId = upcomingStopId(t);
        if (stopId === null) return false;
        if (!filter.stopIds.includes(stopId) && !filter.stopIds.includes(resolveParentId(stops, stopId))) return false;
      }
      return true;
    });
}
