// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/PatternSorting.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import { isSubwayType } from '@/mbta/model/types';

import { majorAlertAffectingAllTrips } from './alerts';
import { sortRoute } from './lineOrRoute';
import type { RouteCard, RouteCardContext, RouteCardLeaf, RouteStopData } from './routeCardData';

/** 100 ft: stops this close sort first regardless of service. */
export const VERY_CLOSE_METERS = 30.48;

const veryCloseBucket = (meters: number | null) => (meters === null ? 0 : meters <= VERY_CLOSE_METERS ? 1 : 2);

/** 1: trips or an alert to show; 2: service ended; 3: no service today. */
export function patternServiceBucket(leaf: RouteCardLeaf, now: number): number {
  if (majorAlertAffectingAllTrips(leaf.alertsHere, now) !== null || leaf.upcomingTrips.length > 0) return 1;
  if (leaf.hasSchedulesToday) return 2;
  return 3;
}

type Key<T> = (x: T) => number;
const compareByKeys =
  <T>(...keys: Key<T>[]) =>
  (a: T, b: T): number => {
    for (const k of keys) {
      const d = k(a) - k(b);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  };

/** Leaves at one stop: service bucket, then direction id. */
export function compareLeavesAtStop(now: number) {
  return compareByKeys<RouteCardLeaf>(
    (l) => patternServiceBucket(l, now),
    (l) => l.direction.id,
  );
}

/** Stops on one card: very close, service bucket, distance (distance is 0 when unsorted). */
export function compareStopsOnRoute(now: number) {
  return compareByKeys<RouteStopData>(
    (s) => veryCloseBucket(s.distanceMeters),
    (s) => (s.leaves[0] ? patternServiceBucket(s.leaves[0], now) : 0),
    (s) => s.distanceMeters ?? 0,
  );
}

/**
 * Cards: very close (≤100 ft), service bucket, subway first (not in Favorites), distance, then
 * route sort order. Distance comes from the first stop's `distanceMeters` (null = unsorted).
 */
export function compareRouteCards(a: RouteCard, b: RouteCard, ctx: RouteCardContext): number {
  const distance = (c: RouteCard) => c.stops[0]?.distanceMeters ?? null;
  return compareByKeys<RouteCard>(
    (c) => veryCloseBucket(distance(c)),
    (c) => (c.stops[0]?.leaves[0] ? patternServiceBucket(c.stops[0].leaves[0], c.at) : 0),
    (c) => (ctx === 'favorites' ? 0 : isSubwayType(sortRoute(c.lineOrRoute).type) ? 1 : 2),
    (c) => distance(c) ?? 0,
    (c) => sortRoute(c.lineOrRoute).sortOrder,
  )(a, b);
}
