/**
 * Destination planner: T (direct or one transfer), Bluebikes, bike + T, and walking, ranked by
 * arrival with weather, alerts and live predictions [AR §3, spec WP3].
 *
 * `preparePlan` does the one-off work (candidate stations, Bluebikes status, NWS weather);
 * `evaluatePlan` re-runs the zero-call enumeration and costs one predictions call (plus at most
 * two schedule fallbacks), so refreshing a plan reuses everything else.
 */
import type { BikeStation } from '@/data/bluebikes';
import { distanceMeters, isInBostonArea, walkMinutesDetour, type LatLng } from '@/lib/geo';
import { toErrorDetail } from '@/mbta/api/errors';
import { parentStationId } from '@/mbta/global/globalData';
import type { Alert, LiveDepartures } from '@/mbta/model/types';
import { significanceAt, significanceRank } from '@/mbta/rules/alerts';

import { bikeSegment, dockProblemText, type BikeSegment, type DockProblem } from './bike';
import {
  enumerateMixed,
  enumerateTransit,
  nearbyStations,
  stopLatLng,
  type MixedOption,
  type StationCandidate,
  type TransitOption,
} from './candidates';
import {
  BIKE_MAX_M,
  BIKE_MIN_M,
  DOCK_NEAR_PLACE_M,
  MIN_WALK_LEG_M,
  SAME_PLACE_M,
  TRANSFER_MIN_DEFAULT,
  TRANSFER_MIN_SAME_LINE,
  WALK_DETOUR,
} from './constants';
import {
  evaluateLeg,
  indexPredictions,
  legAlerts,
  newBudget,
  newScheduleCaches,
  NoticeSink,
  RATE_LIMITED_TEXT,
  windowGroups,
  type EvalEnv,
  type ScheduleCaches,
} from './evaluate';
import { graphFor, type LegSpec, type TransitGraph } from './graph';
import { rankItineraries } from './rank';
import type {
  BikeLeg,
  Itinerary,
  ItineraryKind,
  Leg,
  PlannerDeps,
  PlanNotice,
  PlanRequest,
  PlanResult,
  TransitLeg,
  WalkLeg,
  WeatherSnapshot,
} from './types';

const MIN = 60_000;

export type PlanContext = {
  request: PlanRequest;
  /** Why the request cannot be planned, if it cannot. */
  rejected: 'outsideArea' | null;
  samePlace: boolean;
  straightMeters: number;
  origins: StationCandidate[];
  destinations: StationCandidate[];
  /** null when not needed (short trips) or unavailable. */
  bikes: BikeStation[] | null;
  weather: WeatherSnapshot | null;
  notices: PlanNotice[];
  caches: ScheduleCaches;
};

export const OUTSIDE_AREA_TEXT = 'Teal plans trips around Boston only. Pick a destination near the T.';
export const SAME_PLACE_TEXT = 'You’re already there: the start and destination are the same place.';
const BIKES_UNAVAILABLE_TEXT = 'Bluebikes availability couldn’t be loaded, so bike options are hidden.';

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    throw e;
  }
}

/** Candidate stations, bikes and weather for a request (Bluebikes and NWS calls; no MBTA calls). */
export async function preparePlan(req: PlanRequest, deps: PlannerDeps, signal?: AbortSignal): Promise<PlanContext> {
  const o = req.origin.latLng;
  const d = req.destination.latLng;
  const straightMeters = distanceMeters(o, d);
  const base: PlanContext = {
    request: req,
    rejected: null,
    samePlace: false,
    straightMeters,
    origins: [],
    destinations: [],
    bikes: null,
    weather: null,
    notices: [],
    caches: newScheduleCaches(),
  };
  if (!isInBostonArea(o) || !isInBostonArea(d)) {
    return { ...base, rejected: 'outsideArea', notices: [{ kind: 'noService', severity: 'warning', text: OUTSIDE_AREA_TEXT }] };
  }
  const graph = graphFor(deps.global);
  const stationOf = (stopId?: string) => (stopId ? parentStationId(deps.global, stopId) : null);
  const sameStation = !!req.origin.stopId && stationOf(req.origin.stopId) === stationOf(req.destination.stopId);
  if (straightMeters < SAME_PLACE_M || sameStation) {
    return { ...base, samePlace: true, notices: [{ kind: 'noService', severity: 'info', text: SAME_PLACE_TEXT }] };
  }

  const notices: PlanNotice[] = [];
  const wantBikes = straightMeters >= BIKE_MIN_M;
  const [bikes, weather] = await Promise.all([
    wantBikes
      ? deps.fetchBikeStations().catch(() => {
          notices.push({ kind: 'bikeAvailability', severity: 'info', text: BIKES_UNAVAILABLE_TEXT });
          return null;
        })
      : Promise.resolve(null),
    deps.fetchWeather(o).catch(() => null),
  ]);
  throwIfAborted(signal);
  return {
    ...base,
    origins: nearbyStations(graph, o, { stationId: stationOf(req.origin.stopId) }),
    destinations: nearbyStations(graph, d, { stationId: stationOf(req.destination.stopId) }),
    bikes,
    weather,
    notices,
  };
}

// --- leg builders -----------------------------------------------------------------------

function walkLeg(from: LatLng, to: LatLng, fromName: string, toName: string, startTime: number): WalkLeg {
  const meters = distanceMeters(from, to);
  return { mode: 'walk', from, to, fromName, toName, meters, startTime, endTime: startTime + Math.round(walkMinutesDetour(meters, WALK_DETOUR) * MIN) };
}

/** Walk legs that end at `endTime` (leave just in time for a train). */
function walkLegEndingAt(from: LatLng, to: LatLng, fromName: string, toName: string, endTime: number): WalkLeg {
  const leg = walkLeg(from, to, fromName, toName, 0);
  return { ...leg, startTime: endTime - leg.endTime, endTime };
}

function bikeLegs(seg: BikeSegment, from: { at: LatLng; name: string }, to: { at: LatLng; name: string }, start: number): Leg[] {
  const walkTo = walkLeg(from.at, seg.start.dock.latLng, from.name, seg.start.dock.name, start);
  const rideStart = walkTo.endTime;
  const ride: BikeLeg = {
    mode: 'bike',
    fromDock: seg.start.dock,
    toDock: seg.end.dock,
    meters: seg.rideMeters,
    startTime: rideStart,
    endTime: rideStart + Math.round(seg.rideMin * MIN),
  };
  const walkFrom = walkLeg(seg.end.dock.latLng, to.at, seg.end.dock.name, to.name, ride.endTime);
  return [walkTo, ride, walkFrom];
}

const keepLeg = (l: Leg) => l.mode !== 'walk' || l.meters >= MIN_WALK_LEG_M;

function alertNotices(alerts: Alert[], now: number): PlanNotice[] {
  return alerts.map((a) => ({
    kind: 'alert' as const,
    severity: significanceRank(significanceAt(a, now)) >= significanceRank('secondary') ? ('warning' as const) : ('info' as const),
    text: a.header,
    alertId: a.id,
  }));
}

function makeItinerary(kind: ItineraryKind, rawLegs: Leg[], now: number): Itinerary {
  const legs = rawLegs.filter(keepLeg);
  const transit = legs.filter((l): l is TransitLeg => l.mode === 'transit');
  const tags: Itinerary['tags'] = [];
  const notices: PlanNotice[] = [];
  if (transit.some((l) => l.timeSource === 'scheduled')) {
    tags.push('scheduled');
    notices.push({ kind: 'scheduledOnly', severity: 'info', text: 'Scheduled times: no live prediction for this train yet.' });
  }
  if (transit.some((l) => l.timeSource === 'estimated')) {
    notices.push({ kind: 'scheduledOnly', severity: 'info', text: 'Arrival is estimated from typical run times.' });
  }
  const alerts = transit.flatMap((l) => l.alerts);
  if (alerts.length) {
    tags.push('disrupted');
    const seen = new Set<string>();
    notices.push(...alertNotices(alerts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))), now));
  }
  const first = legs[0] ?? rawLegs[0];
  const last = legs[legs.length - 1] ?? rawLegs[rawLegs.length - 1];
  const departTime = first ? (first.mode === 'transit' ? first.departTime : first.startTime) : now;
  const arriveTime = last ? (last.mode === 'transit' ? last.arriveTime : last.endTime) : now;
  const id = [
    kind,
    ...legs.map((l) => (l.mode === 'transit' ? `${l.routeId}:${l.tripId}:${l.fromStopId}-${l.toStopId}` : l.mode === 'bike' ? `bike:${l.fromDock.stationId}-${l.toDock.stationId}` : 'walk')),
  ].join('|');
  return {
    id,
    kind,
    legs,
    departTime,
    arriveTime,
    transfers: Math.max(0, transit.length - 1),
    walkMeters: legs.reduce((sum, l) => sum + (l.mode === 'walk' ? l.meters : 0), 0),
    score: 0,
    tags,
    notices,
  };
}

// --- evaluation -------------------------------------------------------------------------

const transferMinutes = (a: LegSpec, b: LegSpec) => (a.lineKey === b.lineKey ? TRANSFER_MIN_SAME_LINE : TRANSFER_MIN_DEFAULT);

/** Enumerate and time every option once (one predictions call), then rank. */
export async function evaluatePlan(ctx: PlanContext, deps: PlannerDeps, signal?: AbortSignal): Promise<PlanResult> {
  const now = deps.now();
  const req = ctx.request;
  const result = (itineraries: Itinerary[], notices: PlanNotice[]): PlanResult => ({
    request: req,
    itineraries,
    weather: ctx.weather,
    generatedAt: now,
    notices,
  });
  if (ctx.rejected) return result([], ctx.notices);
  const O = { at: req.origin.latLng, name: req.origin.name };
  const D = { at: req.destination.latLng, name: req.destination.name };
  if (ctx.samePlace) return result([makeItinerary('walk', [walkLeg(O.at, D.at, O.name, D.name, now)], now)], ctx.notices);

  const g = deps.global;
  const graph: TransitGraph = graphFor(g);
  const notices = new NoticeSink();
  ctx.notices.forEach((n) => notices.add(n));
  const stationName = (id: string) => g.stops[id]?.name ?? id;
  const stationAt = (id: string) => stopLatLng(graph.stations[id] ?? g.stops[id]);

  // Legs blocked by a shuttle, suspension or closure are dropped up front and explained once.
  const alertMemo = new Map<string, ReturnType<typeof legAlerts>>();
  const alertsFor = (spec: LegSpec) => {
    let a = alertMemo.get(spec.key);
    if (!a) {
      a = legAlerts(g, spec, deps.alerts, now);
      alertMemo.set(spec.key, a);
    }
    return a;
  };
  const isBlocked = (spec: LegSpec) => {
    const { blocking } = alertsFor(spec);
    for (const a of blocking) notices.add({ kind: 'alert', severity: 'warning', text: a.header, alertId: a.id });
    return blocking.length > 0;
  };

  const transit: TransitOption[] = enumerateTransit(graph, ctx.origins, ctx.destinations, { isBlocked });
  const mixed: MixedOption[] = ctx.bikes ? enumerateMixed(graph, O.at, D.at, ctx.origins, ctx.destinations, ctx.bikes, { isBlocked }) : [];

  const itineraries: Itinerary[] = [makeItinerary('walk', [walkLeg(O.at, D.at, O.name, D.name, now)], now)];

  // Pure bike.
  let bikeProblem: DockProblem | null = null;
  if (ctx.bikes && ctx.straightMeters >= BIKE_MIN_M && ctx.straightMeters <= BIKE_MAX_M) {
    const r = bikeSegment(ctx.bikes, O.at, D.at, DOCK_NEAR_PLACE_M, DOCK_NEAR_PLACE_M);
    if (r.segment) itineraries.push(makeItinerary('bike', bikeLegs(r.segment, O, D, now), now));
    else bikeProblem = r.problem;
  }
  if (bikeProblem) {
    const warn = bikeProblem === 'noStartBikes' || bikeProblem === 'noEndDocks';
    notices.add({ kind: 'bikeAvailability', severity: warn ? 'warning' : 'info', text: dockProblemText(bikeProblem) });
  }

  // One predictions call for every station and route in play.
  const specs: LegSpec[] = [...transit.flatMap((t) => t.legs), ...mixed.map((m) => m.leg)];
  let live: LiveDepartures | null = null;
  let predictionsFailed = false;
  if (specs.length) {
    const stopIds = [...new Set(specs.flatMap((s) => [s.from, s.to]))];
    const routeIds = [...new Set(specs.flatMap((s) => s.routeIds))];
    try {
      live = await deps.fetchPredictions(stopIds, { routeIds }, { signal, priority: 'foreground' });
    } catch (e) {
      const detail = toErrorDetail(e);
      if (detail.kind === 'aborted') throw e;
      predictionsFailed = true;
      notices.add(
        detail.kind === 'rateLimited'
          ? { kind: 'rateLimited', severity: 'warning', text: RATE_LIMITED_TEXT }
          : { kind: 'noService', severity: 'warning', text: 'Couldn’t reach the MBTA for live times. Showing scheduled times where possible.' },
      );
    }
    throwIfAborted(signal);
  }

  const env: EvalEnv = {
    global: g,
    now,
    predicted: indexPredictions(g, live),
    vehicles: live?.vehicles ?? {},
    deps,
    signal,
    caches: ctx.caches,
    budget: newBudget(),
    groups: windowGroups(specs),
    notices,
  };
  const timed = async (spec: LegSpec, earliest: number) => {
    const leg = await evaluateLeg(spec, earliest, env);
    return leg ? { ...leg, alerts: alertsFor(spec).info } : null;
  };

  let transitFound = 0;
  for (const opt of transit) {
    const [s1, s2] = opt.legs;
    const access = stationAt(opt.access.stationId);
    const egress = stationAt(opt.egress.stationId);
    const t1 = await timed(s1, now + opt.access.walkMin * MIN);
    if (!t1) continue;
    const t2 = s2 ? await timed(s2, t1.arriveTime + transferMinutes(s1, s2) * MIN) : null;
    if (s2 && !t2) continue;
    const ride = t2 ? [t1, t2] : [t1];
    const last = ride[ride.length - 1];
    itineraries.push(
      makeItinerary(
        'transit',
        [
          walkLegEndingAt(O.at, access, O.name, stationName(opt.access.stationId), t1.departTime),
          ...ride,
          walkLeg(egress, D.at, stationName(opt.egress.stationId), D.name, last.arriveTime),
        ],
        now,
      ),
    );
    transitFound++;
  }

  for (const m of mixed) {
    const station = { at: stationAt(m.station), name: stationName(m.station) };
    if (m.kind === 'bike+transit') {
      const bike = bikeLegs(m.bike, O, station, now);
      const reachStation = (bike[bike.length - 1] as WalkLeg).endTime;
      const t = await timed(m.leg, reachStation);
      if (!t) continue;
      const egress = stationAt(m.candidate.stationId);
      itineraries.push(makeItinerary('bike+transit', [...bike, t, walkLeg(egress, D.at, stationName(m.candidate.stationId), D.name, t.arriveTime)], now));
    } else {
      const t = await timed(m.leg, now + m.candidate.walkMin * MIN);
      if (!t) continue;
      const access = stationAt(m.candidate.stationId);
      itineraries.push(
        makeItinerary(
          'transit+bike',
          [walkLegEndingAt(O.at, access, O.name, stationName(m.candidate.stationId), t.departTime), t, ...bikeLegs(m.bike, station, D, t.arriveTime)],
          now,
        ),
      );
    }
  }

  const ranked = rankItineraries(itineraries, ctx.weather);
  const withTransit = ranked.filter((i) => i.legs.some((l) => l.mode === 'transit'));
  if (transit.length > 0 && transitFound === 0 && !predictionsFailed) {
    notices.add({ kind: 'noService', severity: 'info', text: 'No T trips found for this route right now.' });
  }
  if (withTransit.length > 0 && withTransit.every((i) => i.tags.includes('scheduled'))) {
    notices.add({ kind: 'scheduledOnly', severity: 'info', text: 'Live predictions aren’t available, so T options use scheduled times.' });
  }
  return result(ranked, notices.list);
}

/** Plan a trip from scratch (see `preparePlan` / `evaluatePlan`). */
export async function planTrip(req: PlanRequest, deps: PlannerDeps, signal?: AbortSignal): Promise<PlanResult> {
  const ctx = await preparePlan(req, deps, signal);
  return evaluatePlan(ctx, deps, signal);
}
