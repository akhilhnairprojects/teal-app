// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/TripDetailsStopList.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// TripSchedulesResponse from model/response/TripSchedulesResponse.kt, same commit.
import type { GlobalData } from '@/mbta/global/globalData';
import type { Alert, LiveDepartures, Prediction, Route, Schedule, Stop, Trip, Vehicle } from '@/mbta/model/types';
import {
  alertIconName,
  anyEntityMatches,
  elevatorAlerts,
  hasNoThroughService,
  intrinsicSignificance,
  isActive,
  significanceAt,
  significanceRank,
} from '@/mbta/rules/alerts';
import { isCRCore, isShuttleRoute, resolveParentStop } from '@/mbta/rules/lineOrRoute';
import { stopTimeOf } from '@/mbta/rules/tripInstantDisplay';
import type { UpcomingFormat } from '@/mbta/rules/upcomingFormat';
import { formatUpcomingTrip, hidesSchedules, makeUpcomingTrip, type UpcomingTrip } from '@/mbta/rules/upcomingTrip';

/**
 * What we know about a trip's stops before predictions: its scheduled stop times, only its
 * ordered stop ids (e.g. an ADDED trip, from its route pattern), or nothing.
 */
export type TripSchedules = { kind: 'schedules'; schedules: Schedule[] } | { kind: 'stopIds'; stopIds: string[] } | { kind: 'unknown' };

export type Disruption = Extract<UpcomingFormat, { kind: 'disruption' }>;

export type StopListEntry = {
  stop: Stop;
  stopSequence: number;
  disruption: Disruption | null;
  schedule: Schedule | null;
  prediction: Prediction | null;
  /** The prediction's own (child) stop, which may carry the track number. */
  predictionStop: Stop | null;
  vehicle: Vehicle | null;
  /** Routes a rider can transfer to here, by sort order, without the trip's own route. */
  routes: Route[];
  elevatorAlerts: Alert[];
};

export type TripDetailsStopList = { trip: Trip; stops: StopListEntry[]; startTerminalEntry: StopListEntry | null };

export type TargetSplit = {
  firstStop: StopListEntry | null;
  collapsedStops: StopListEntry[] | null;
  targetStop: StopListEntry | null;
  followingStops: StopListEntry[];
  isTruncatedByLastAlert: boolean;
};

// --- entry helpers ----------------------------------------------------------------------

/** Track numbers only show for commuter rail at the core downtown stations (Stop.shouldShowTrackNumber). */
export function trackNumber(e: StopListEntry): string | null {
  const s = e.predictionStop;
  return s && s.vehicleType === 2 && isCRCore(s) ? s.platformCode : null;
}

/** A shuttle or suspension starting here: the trip does not run through. */
export const isTruncating = (e: StopListEntry): boolean => e.disruption !== null && hasNoThroughService(e.disruption.alert);

export const activeElevatorAlerts = (e: StopListEntry, now: number): Alert[] => e.elevatorAlerts.filter((a) => isActive(a, now));

/**
 * The time to show for an entry, or the disruption replacing it (Entry.format). A truncating
 * alert (shuttle/suspension) still shows the arrival time at its first stop.
 */
export function formatEntry(e: StopListEntry, trip: Trip, now: number, route: Route): UpcomingFormat | null {
  if (e.disruption !== null && !isTruncating(e)) return e.disruption;
  const upcoming = makeUpcomingTrip(trip, e.schedule, e.prediction, e.predictionStop, e.vehicle, e.disruption?.alert ?? null);
  const formatted = formatUpcomingTrip(upcoming, now, route.type, 'tripDetails', hidesSchedules(route), false);
  return formatted ? { kind: 'some', trips: [formatted], secondaryAlert: null } : null;
}

/** Same stop, or stops sharing a root station (Stop.equalOrFamily). */
export function equalOrFamily(stopId1: string, stopId2: string, stops: Record<string, Stop>): boolean {
  if (stopId1 === stopId2) return true;
  const s1 = stops[stopId1];
  const s2 = stops[stopId2];
  if (!s1 || !s2) return false;
  return resolveParentStop(stops, s1).id === resolveParentStop(stops, s2).id;
}

const sameEntry = (a: StopListEntry | null | undefined, b: StopListEntry | null | undefined) =>
  !!a && !!b && a.stop.id === b.stop.id && a.stopSequence === b.stopSequence;

/**
 * Split the stops around the target stop, counting parent/child/sibling stops as equal. Matches
 * stop and sequence first, then the last copy of the stop. With no match, everything goes in
 * `followingStops`. Following stops end at the first downstream shuttle/suspension.
 */
export function splitForTarget(
  list: TripDetailsStopList,
  targetStopId: string,
  targetStopSequence: number | null,
  g: GlobalData | null,
): TargetSplit {
  const stops = g?.stops ?? {};
  const { stops: entries } = list;
  let index = entries.findIndex((e) => equalOrFamily(targetStopId, e.stop.id, stops) && e.stopSequence === targetStopSequence);
  if (index < 0) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (equalOrFamily(targetStopId, entries[i].stop.id, stops)) {
        index = i;
        break;
      }
    }
  }
  const targetIndex = index >= 0 ? index : null;

  let firstStop: StopListEntry | null = null;
  let collapsedStops = targetIndex !== null ? entries.slice(0, targetIndex) : null;
  const firstCollapsed = collapsedStops?.[0];
  if (
    firstCollapsed &&
    sameEntry(firstCollapsed, list.startTerminalEntry) &&
    (firstCollapsed.vehicle === null || firstCollapsed.vehicle.tripId !== list.trip.id)
  ) {
    collapsedStops = collapsedStops!.slice(1);
    firstStop = firstCollapsed;
  }
  const targetStop = targetIndex !== null ? entries[targetIndex] : null;
  const followingStops = targetIndex !== null ? entries.slice(targetIndex + 1) : entries;

  const truncIndex = followingStops.findIndex(isTruncating);
  const truncated = truncIndex >= 0 && truncIndex !== followingStops.length - 1;
  return {
    firstStop,
    collapsedStops,
    targetStop,
    followingStops: truncated ? followingStops.slice(0, truncIndex + 1) : followingStops,
    isTruncatedByLastAlert: truncated,
  };
}

/** The trip as seen from the target stop (TripDetailsStopList.contextualTrip). */
export function contextualTrip(
  list: TripDetailsStopList,
  filter: { stopId: string; stopSequence: number | null },
  g: GlobalData | null,
): UpcomingTrip {
  const e = splitForTarget(list, filter.stopId, filter.stopSequence, g).targetStop;
  return makeUpcomingTrip(list.trip, e?.schedule ?? null, e?.prediction ?? null, e?.predictionStop ?? null, e?.vehicle ?? null);
}

// --- building (fromPieces) --------------------------------------------------------------

type WorkingEntry = {
  stopId: string;
  stopSequence: number;
  schedule: Schedule | null;
  prediction: Prediction | null;
  vehicle: Vehicle | null;
};

type Entries = Map<number, WorkingEntry>;

const blank = (stopId: string, stopSequence: number): WorkingEntry => ({
  stopId,
  stopSequence,
  schedule: null,
  prediction: null,
  vehicle: null,
});

function putSchedule(entries: Entries, s: Schedule) {
  const existing = entries.get(s.stopSequence);
  entries.set(s.stopSequence, existing ? { ...existing, schedule: s } : { ...blank(s.stopId, s.stopSequence), schedule: s });
}

function putPrediction(entries: Entries, p: Prediction, vehicle: Vehicle | null) {
  const existing = entries.get(p.stopSequence);
  entries.set(
    p.stopSequence,
    existing ? { ...existing, prediction: p, vehicle } : { ...blank(p.stopId, p.stopSequence), prediction: p, vehicle },
  );
}

function putEmpty(entries: Entries, stopId: string, stopSequence: number) {
  if (!entries.has(stopSequence)) entries.set(stopSequence, blank(stopId, stopSequence));
}

function schedulesRouteId(s: TripSchedules | null): string | null {
  if (s?.kind !== 'schedules') return null;
  const ids = [...new Set(s.schedules.map((x) => x.routeId))];
  return ids.length === 1 ? ids[0] : null;
}

function scheduledStopIds(s: TripSchedules | null, g: GlobalData): Set<string> {
  if (!s || s.kind === 'unknown') return new Set();
  const ids = s.kind === 'schedules' ? s.schedules.map((x) => x.stopId) : s.stopIds;
  return new Set(ids.filter((id) => g.stops[id] !== undefined));
}

/**
 * Stop sequences are not always unique. When two predictions share one, keep the one whose stop
 * is in the schedule (the only case seen so far); otherwise keep the first.
 */
function dedupeBySequence(predictions: Prediction[], schedules: TripSchedules | null, g: GlobalData): Prediction[] {
  const bySeq = new Map<number, Prediction[]>();
  for (const p of predictions) bySeq.set(p.stopSequence, [...(bySeq.get(p.stopSequence) ?? []), p]);
  const scheduled = scheduledStopIds(schedules, g);
  return [...bySeq.values()]
    .map((list) => (list.length === 1 ? list[0] : (list.find((p) => scheduled.has(p.stopId)) ?? list[0])))
    .sort((a, b) => a.stopSequence - b.stopSequence);
}

/** Only typical patterns of listed (non-shuttle) routes count as transfers. */
function routesForStop(stopId: string, g: GlobalData): Route[] {
  const out: Route[] = [];
  for (const patternId of g.patternIdsByStop[stopId] ?? []) {
    const pattern = g.patterns[patternId];
    const route = pattern ? g.routes[pattern.routeId] : undefined;
    if (route && pattern && pattern.typicality === 'typical' && !isShuttleRoute(route)) out.push(route);
  }
  return out;
}

/**
 * Routes a rider could transfer to at a stop: typical patterns at the stop's parent and all of
 * its children, by sort order, minus the current route (getTransferRoutes). Teal has no
 * connecting-stop data, so connections are limited to the station family.
 */
export function transferRoutes(stopId: string, currentRouteId: string | null, g: GlobalData): Route[] {
  const stop = g.stops[stopId];
  if (!stop) return [];
  const selfOrParent = stop.parentStationId === null ? stop : g.stops[stop.parentStationId];
  if (!selfOrParent) return [];
  const ids = [selfOrParent.id, ...selfOrParent.childStopIds];
  const seen = new Map<string, Route>();
  for (const id of ids) for (const r of routesForStop(id, g)) seen.set(r.id, r);
  return [...seen.values()].filter((r) => r.id !== currentRouteId).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Infer stop sequences for stop-id-only schedules by walking backwards from the last prediction
 * (ScheduleStopSequenceAligner). Unpredicted stops before and after continue the last delta.
 */
function alignStopIds(stopIds: string[], predictions: Prediction[], g: GlobalData, entries: Entries) {
  let lastStopSequence: number | null = null;
  let lastDelta: number | null = null;
  let scheduleIndex = stopIds.length - 1;
  let predictionIndex = predictions.length - 1;
  const lastPrediction = predictions[predictions.length - 1] ?? null;
  let unpredictedTrailing = 0;
  const inRange = (i: number, n: number) => i >= 0 && i < n;

  if (lastPrediction) {
    while (inRange(scheduleIndex, stopIds.length) && !equalOrFamily(stopIds[scheduleIndex], lastPrediction.stopId, g.stops)) {
      scheduleIndex--;
      unpredictedTrailing++;
    }
  }
  while (inRange(scheduleIndex, stopIds.length) && inRange(predictionIndex, predictions.length)) {
    const prediction = predictions[predictionIndex];
    if (!equalOrFamily(stopIds[scheduleIndex], prediction.stopId, g.stops)) {
      scheduleIndex--;
      continue;
    }
    lastDelta = lastStopSequence !== null ? lastStopSequence - prediction.stopSequence : null;
    lastStopSequence = prediction.stopSequence;
    scheduleIndex--;
    predictionIndex--;
  }
  let seq: number = lastStopSequence ?? 1000;
  const delta: number = lastDelta ?? 1;
  while (inRange(scheduleIndex, stopIds.length)) {
    seq -= delta;
    putEmpty(entries, stopIds[scheduleIndex], seq);
    scheduleIndex--;
  }
  if (lastPrediction && unpredictedTrailing > 0) {
    scheduleIndex = stopIds.length - unpredictedTrailing;
    seq = lastPrediction.stopSequence;
    while (inRange(scheduleIndex, stopIds.length)) {
      seq += delta;
      putEmpty(entries, stopIds[scheduleIndex], seq);
      scheduleIndex++;
    }
  }
}

/** The first major alert for this stop on this trip (no secondary-alert UI in trip details yet). */
function disruptionFor(w: WorkingEntry, fallbackTime: number | null, alerts: Alert[], route: Route, trip: Trip): Disruption | null {
  const entryTime = stopTimeOf(w.prediction ?? w.schedule) ?? fallbackTime;
  const alert = alerts.find(
    (a) =>
      (entryTime === null || isActive(a, entryTime)) &&
      anyEntityMatches(a, {
        directionId: trip.directionId,
        routeIds: [route.id],
        routeType: route.type,
        stopIds: [w.stopId],
        tripId: trip.id,
      }) &&
      significanceRank(entryTime !== null ? significanceAt(a, entryTime) : intrinsicSignificance(a)) >= significanceRank('major'),
  );
  return alert ? { kind: 'disruption', alert, iconName: alertIconName(alert, route) } : null;
}

/**
 * Join a trip's schedules (or bare stop ids), predictions, vehicle and alerts into its stop list.
 * Null while alerts are loading or the route is unknown. Stops the vehicle has already left
 * (or is stopped at) are dropped; `startTerminalEntry` keeps the first stop regardless.
 */
export function tripDetailsStopListFromPieces(
  trip: Trip,
  tripSchedules: TripSchedules | null,
  tripPredictions: LiveDepartures | null,
  vehicle: Vehicle | null,
  alerts: Alert[] | null,
  g: GlobalData,
): TripDetailsStopList | null {
  if (alerts === null) return null;
  const predictionTrips = tripPredictions ? Object.values(tripPredictions.trips) : [];
  const routeId = (predictionTrips.length === 1 ? predictionTrips[0].routeId : null) ?? schedulesRouteId(tripSchedules) ?? trip.routeId;
  const route = g.routes[routeId];
  if (!route) return null;

  const entries: Entries = new Map();
  let predictions: Prediction[] = [];
  if (tripPredictions) {
    predictions = dedupeBySequence(
      tripPredictions.predictions.filter((p) => p.routeId === routeId),
      tripSchedules,
      g,
    );
    for (const p of predictions) putPrediction(entries, p, vehicle);
  }
  if (tripSchedules?.kind === 'schedules') {
    for (const s of tripSchedules.schedules) putSchedule(entries, s);
  } else if (tripSchedules?.kind === 'stopIds') {
    alignStopIds(tripSchedules.stopIds, predictions, g, entries);
  }

  if (entries.size === 0) return { trip, stops: [], startTerminalEntry: null };

  const sorted = [...entries.values()].sort((a, b) => a.stopSequence - b.stopSequence);
  const times = sorted.map((w) => stopTimeOf(w.prediction) ?? stopTimeOf(w.schedule)).filter((t): t is number => t !== null);
  const fallbackTime = times.length ? times[times.length - 1] : null;
  const allElevatorAlerts = alerts.filter((a) => a.effect === 'ELEVATOR_CLOSURE');

  const toEntry = (w: WorkingEntry | undefined): StopListEntry | null => {
    if (!w) return null;
    const stop = g.stops[w.stopId];
    if (!stop) return null;
    const parent = resolveParentStop(g.stops, stop);
    return {
      stop,
      stopSequence: w.stopSequence,
      disruption: disruptionFor(w, fallbackTime, alerts, route, trip),
      schedule: w.schedule,
      prediction: w.prediction,
      predictionStop: w.prediction ? (g.stops[w.prediction.stopId] ?? null) : null,
      vehicle: w.vehicle,
      routes: transferRoutes(w.stopId, w.prediction?.routeId ?? w.schedule?.routeId ?? null, g),
      elevatorAlerts: elevatorAlerts(allElevatorAlerts, [parent.id, ...parent.childStopIds]),
    };
  };

  const startTerminalEntry = toEntry(sorted[0]);
  const vehicleSeq = vehicle && vehicle.tripId === trip.id ? vehicle.currentStopSequence : null;
  let drop = 0;
  if (vehicleSeq !== null) {
    while (
      drop < sorted.length &&
      (sorted[drop].stopSequence < vehicleSeq || (sorted[drop].stopSequence === vehicleSeq && vehicle!.currentStatus === 'STOPPED_AT'))
    ) {
      drop++;
    }
  }
  const stops = sorted
    .slice(drop)
    .map(toEntry)
    .filter((e): e is StopListEntry => e !== null);
  return { trip, stops, startTerminalEntry };
}
