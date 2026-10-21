// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/Alert.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Significance order from model/AlertSignificance.kt; icon naming from model/UpcomingFormat.kt and model/MapStopRoute.kt, same commit.
import type { GlobalData } from '@/mbta/global/globalData';
import type { Alert, AlertSignificance, DirectionId, InformedEntity, Route, RoutePattern, RouteType, Trip } from '@/mbta/model/types';

import { SILVER_ROUTES } from './lineOrRoute';

const DAY_MS = 24 * 60 * 60 * 1000;

export function significanceRank(s: AlertSignificance): number {
  switch (s) {
    case 'major':
      return 4;
    case 'secondary':
      return 3;
    case 'accessibility':
      return 2;
    case 'minor':
      return 1;
    case 'none':
      return 0;
  }
}

const minSignificance = (a: AlertSignificance, b: AlertSignificance) => (significanceRank(a) <= significanceRank(b) ? a : b);

export const hasStopsSpecified = (a: Alert): boolean => a.informedEntities.every((e) => e.stopId !== null);

/** Closure effects that mean the train skips the stop (Alert.Effect.stopSkipped). */
export const isStopSkipped = (a: Alert): boolean => a.effect === 'STATION_CLOSURE' || a.effect === 'STOP_CLOSURE';

/** Shuttle or suspension: no trains run through. */
export const hasNoThroughService = (a: Alert): boolean => a.effect === 'SHUTTLE' || a.effect === 'SUSPENSION';

/** Significance from the effect alone, ignoring when the alert is active. */
export function intrinsicSignificance(a: Alert): AlertSignificance {
  switch (a.effect) {
    case 'SHUTTLE':
    case 'SUSPENSION':
      return 'major';
    case 'STATION_CLOSURE':
    case 'STOP_CLOSURE':
    case 'DOCK_CLOSURE':
    case 'DETOUR':
    case 'SNOW_ROUTE':
      return hasStopsSpecified(a) ? 'major' : 'secondary';
    case 'SERVICE_CHANGE':
      return 'secondary';
    case 'ELEVATOR_CLOSURE':
      return 'accessibility';
    case 'TRACK_CHANGE':
    case 'CANCELLATION':
      return 'minor';
    case 'DELAY':
      return (a.severity >= 3 && a.informedEntities.some((e) => e.routeType !== 3)) || a.cause === 'SINGLE_TRACKING'
        ? 'minor'
        : 'none';
    default:
      return 'none';
  }
}

/** Intrinsic significance for alerts naming this trip (cancellations are major for it), else null. */
export function tripSpecificSignificance(a: Alert, tripId: string): AlertSignificance | null {
  if (!a.informedEntities.some((e) => e.tripId === tripId)) return null;
  return a.effect === 'CANCELLATION' ? 'major' : intrinsicSignificance(a);
}

const activeAt = (p: { start: number; end: number | null }, t: number) => (p.end === null ? p.start <= t : p.start <= t && t <= p.end);

export const isActive = (a: Alert, t: number): boolean => a.activePeriods.some((p) => activeAt(p, t));

/** A period that is not active yet but starts within the next 24 h. */
export const willBeActiveSoon = (a: Alert, t: number): boolean => a.activePeriods.some((p) => p.start > t && p.start <= t + DAY_MS);

/** Every period has ended (vacuously true with no periods). */
export const allClear = (a: Alert, t: number): boolean => a.activePeriods.every((p) => p.end !== null && p.end < t);

export function currentPeriod(a: Alert, t: number) {
  return a.activePeriods.find((p) => activeAt(p, t)) ?? null;
}

export function nextPeriod(a: Alert, t: number, withinMs = DAY_MS) {
  return a.activePeriods.find((p) => p.start > t && p.start <= t + withinMs) ?? null;
}

/**
 * Significance at a moment: active (or all-clear) alerts keep their intrinsic significance,
 * ones starting within 24 h are capped at secondary, anything later is none.
 */
export function significanceAt(a: Alert, now: number): AlertSignificance {
  const max: AlertSignificance = isActive(a, now)
    ? 'major'
    : willBeActiveSoon(a, now)
      ? 'secondary'
      : allClear(a, now)
        ? 'major'
        : 'none';
  return minSignificance(intrinsicSignificance(a), max);
}

/**
 * The first major alert (at `now`) among a leaf's alerts that applies to every trip: no
 * entities, or an entity without a trip (RouteCardData.Leaf.majorAlertAffectingAllTrips).
 */
export function majorAlertAffectingAllTrips(alertsHere: readonly Alert[], now: number): Alert | null {
  return (
    alertsHere.find(
      (a) =>
        significanceRank(significanceAt(a, now)) >= significanceRank('major') &&
        (a.informedEntities.length === 0 || a.informedEntities.some((e) => e.tripId === null)),
    ) ?? null
  );
}

// --- matching (Alert.InformedEntity.matches, Matcher.kt) --------------------------------

/** undefined = wildcard; a list = any of. An entity field of null matches anything. */
export type EntityQuery = {
  activities?: readonly string[];
  directionId?: DirectionId;
  facilityId?: readonly string[];
  routeIds?: readonly string[];
  routeType?: RouteType;
  stopIds?: readonly string[];
  tripId?: string;
};

export function entityMatches(e: InformedEntity, q: EntityQuery): boolean {
  const ok = <T>(expected: readonly T[] | T | undefined, actual: T | null) =>
    actual === null ||
    expected === undefined ||
    (Array.isArray(expected) ? (expected as readonly T[]).includes(actual) : expected === actual);
  return (
    // Like Kotlin, an entity with no activities never matches, even with a wildcard.
    e.activities.some((act) => q.activities === undefined || q.activities.includes(act)) &&
    ok(q.directionId, e.directionId) &&
    ok(q.facilityId, e.facilityId) &&
    ok(q.routeIds, e.routeId) &&
    ok(q.routeType, e.routeType) &&
    ok(q.stopIds, e.stopId) &&
    ok(q.tripId, e.tripId)
  );
}

export const anyEntityMatches = (a: Alert, q: EntityQuery): boolean => a.informedEntities.some((e) => entityMatches(e, q));

const distinct = (alerts: Alert[]): Alert[] => {
  const seen = new Set<string>();
  return alerts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
};

/**
 * Alerts matching route/direction/stop/trip on the BOARD activity (Alert.applicableAlerts),
 * without any time filtering. `routeIds: []` matches only entities with no route.
 */
export function applicableAlertsAnyTime(
  alerts: readonly Alert[],
  q: {
    routeIds?: readonly string[];
    directionId?: DirectionId | null;
    routeType?: RouteType | null;
    stopIds?: readonly string[];
    tripId?: string | null;
    activities?: readonly string[];
  },
): Alert[] {
  return distinct(
    alerts.filter((a) =>
      anyEntityMatches(a, {
        activities: q.activities ?? ['BOARD'],
        directionId: q.directionId ?? undefined,
        routeIds: q.routeIds,
        routeType: q.routeType ?? undefined,
        stopIds: q.stopIds,
        tripId: q.tripId ?? undefined,
      }),
    ),
  );
}

/**
 * `applicableAlertsAnyTime`, limited to alerts that are active at `now` or start within 24 h.
 * `routeType` is an optional extra filter (Kotlin always passes the leaf's route type).
 */
export function applicableAlerts(
  alerts: Alert[],
  q: {
    routeIds?: string[];
    directionId?: DirectionId | null;
    stopIds?: string[];
    tripId?: string | null;
    activities?: string[];
    routeType?: RouteType | null;
  },
  now: number,
): Alert[] {
  return applicableAlertsAnyTime(
    alerts.filter((a) => isActive(a, now) || willBeActiveSoon(a, now)),
    q,
  );
}

/** Elevator closures at these stops (USING_WHEELCHAIR activity). */
export function elevatorAlerts(alerts: readonly Alert[], stopIds: readonly string[]): Alert[] {
  return distinct(
    alerts.filter(
      (a) => a.effect === 'ELEVATOR_CLOSURE' && anyEntityMatches(a, { activities: ['USING_WHEELCHAIR'], stopIds }),
    ),
  );
}

/**
 * Alerts at stops after the target stop on this trip that differ from the target stop's alerts,
 * up to and including the first shuttle or suspension (Alert.downstreamAlerts). No time filter.
 */
export function downstreamAlertsAnyTime(
  alerts: readonly Alert[],
  trip: Trip,
  routeType: RouteType,
  targetStopWithChildren: readonly string[],
): Alert[] {
  const stopIds = trip.stopIds ?? [];
  const targetIndex = stopIds.findIndex((s) => targetStopWithChildren.includes(s));
  if (targetIndex < 0 || targetIndex === stopIds.length - 1) return [];

  const relevant = alerts
    .filter((a) => hasStopsSpecified(a) && significanceRank(intrinsicSignificance(a)) >= significanceRank('accessibility'))
    .filter((a) =>
      anyEntityMatches(a, {
        activities: ['EXIT', 'RIDE'],
        directionId: trip.directionId,
        routeIds: [trip.routeId],
        routeType,
      }),
    );
  const targetAlertIds = new Set(
    relevant.filter((a) => anyEntityMatches(a, { stopIds: targetStopWithChildren })).map((a) => a.id),
  );
  const tripAlerts = stopIds
    .slice(targetIndex + 1)
    .flatMap((stop) => relevant.filter((a) => anyEntityMatches(a, { stopIds: [stop] }) && !targetAlertIds.has(a.id)));
  if (tripAlerts.length === 0) return [];
  const lastIndex = tripAlerts.findIndex((a) => hasNoThroughService(a));
  return lastIndex >= 0 ? tripAlerts.slice(0, lastIndex + 1) : tripAlerts;
}

/** Downstream alerts for a trip, using its route's type from global data, active now or within 24 h. */
export function downstreamAlerts(alerts: Alert[], trip: Trip, targetStopIds: string[], g: GlobalData, now: number): Alert[] {
  const routeType = g.routes[trip.routeId]?.type;
  if (routeType === undefined) return [];
  return downstreamAlertsAnyTime(
    alerts.filter((a) => isActive(a, now) || willBeActiveSoon(a, now)),
    trip,
    routeType,
    targetStopIds,
  );
}

// --- presentation ---------------------------------------------------------------------

/** MapStopRoute name for a route (lowercase), or null. */
export function mapStopRouteName(route: Route | null | undefined): string | null {
  if (!route) return null;
  if (route.id === 'Red') return 'red';
  if (route.id === 'Mattapan') return 'mattapan';
  if (route.id === 'Orange') return 'orange';
  if (route.id.startsWith('Green')) return 'green';
  if (route.id === 'Blue') return 'blue';
  if (SILVER_ROUTES.includes(route.id)) return 'silver';
  if (route.type === 2) return 'commuter';
  if (route.type === 4) return 'ferry';
  if (route.type === 3) return 'bus';
  return null;
}

export type StopAlertState = 'elevator' | 'shuttle' | 'suspension' | 'issue';

export function alertState(a: Alert): StopAlertState {
  switch (a.effect) {
    case 'ELEVATOR_CLOSURE':
      return 'elevator';
    case 'SHUTTLE':
      return 'shuttle';
    case 'SUSPENSION':
    case 'STATION_CLOSURE':
    case 'STOP_CLOSURE':
    case 'DOCK_CLOSURE':
      return 'suspension';
    default:
      return 'issue';
  }
}

export function iconNameFor(state: StopAlertState, route: Route | null | undefined): string {
  const mode = mapStopRouteName(route);
  return `alert-${mode ? `large-${mode}` : 'borderless'}-${state}`;
}

/** e.g. 'alert-large-red-shuttle', 'alert-borderless-issue'. The UI maps these to Ionicons. */
export function alertIconName(a: Alert, route: Route | null): string {
  return iconNameFor(alertState(a), route);
}

const EFFECT_LABELS: Record<string, string> = {
  SHUTTLE: 'Shuttle bus',
  SUSPENSION: 'Suspension',
  STATION_CLOSURE: 'Stop skipped',
  STOP_CLOSURE: 'Stop skipped',
  DOCK_CLOSURE: 'Dock closed',
  DETOUR: 'Detour',
  DELAY: 'Delay',
  ELEVATOR_CLOSURE: 'Elevator closure',
  ESCALATOR_CLOSURE: 'Escalator closure',
  SERVICE_CHANGE: 'Service change',
  SCHEDULE_CHANGE: 'Schedule change',
  TRACK_CHANGE: 'Track change',
  CANCELLATION: 'Cancellation',
  SNOW_ROUTE: 'Snow route',
  STOP_MOVE: 'Stop moved',
  STOP_MOVED: 'Stop moved',
  STATION_ISSUE: 'Station issue',
  ACCESS_ISSUE: 'Access issue',
  PARKING_CLOSURE: 'Parking closure',
  PARKING_ISSUE: 'Parking issue',
  EXTRA_SERVICE: 'Extra service',
  ADDITIONAL_SERVICE: 'Extra service',
  MODIFIED_SERVICE: 'Modified service',
  NO_SERVICE: 'No service',
  NOTICE: 'Notice',
  POLICY_CHANGE: 'Policy change',
};

export function effectLabel(effect: string): string {
  const known = EFFECT_LABELS[effect.toUpperCase()];
  if (known) return known;
  const words = effect.toLowerCase().replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Alert';
}

/**
 * Distinct downstream alerts across the representative trips of these patterns, skipping
 * canonical-only patterns (Alert.alertsDownstreamForPatterns). No time filter.
 */
export function alertsDownstreamForPatterns(
  alerts: readonly Alert[],
  patterns: readonly RoutePattern[],
  routeType: RouteType,
  targetStopWithChildren: readonly string[],
  tripsById: Record<string, Trip>,
): Alert[] {
  return distinct(
    patterns
      .filter((p) => p.typicality !== 'canonical_only')
      .flatMap((p) => {
        const trip = tripsById[p.representativeTripId];
        return trip ? downstreamAlertsAnyTime(alerts, trip, routeType, targetStopWithChildren) : [];
      }),
  );
}
