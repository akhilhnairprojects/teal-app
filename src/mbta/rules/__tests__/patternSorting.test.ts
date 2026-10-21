// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/PatternSortingTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Distances are precomputed into RouteStopData.distanceMeters (null when unsorted), as Teal's
// contract carries them on the stop instead of passing a position to each comparator.
import type { LatLng, Route, RoutePattern, Stop } from '@/mbta/model/types';
import { createBuilder } from '@/mbta/testing/builders';
import { distanceMeters } from '@/lib/geo';

import { directionFor } from '../direction';
import { routeOf, type LineOrRoute } from '../lineOrRoute';
import { compareLeavesAtStop, compareRouteCards, compareStopsOnRoute } from '../patternSorting';
import type { RouteCard, RouteCardLeaf, RouteStopData } from '../routeCardData';

const MIN = 60_000;
const NOW = Date.now();
const ORIGIN: LatLng = { latitude: 0, longitude: 0 };

function setup() {
  const b = createBuilder();
  const pattern = (route: Route, directionId: 0 | 1, sortOrder: number) => b.pattern(route, { directionId, sortOrder });
  const trip = (p: RoutePattern) => b.upcomingTrip({ schedule: b.schedule({ trip: b.tripFor(p), departureTime: NOW + 4 * MIN }) });
  const leaf = (o: { lineOrRoute: LineOrRoute; stop: Stop; pattern: RoutePattern; trips?: number; alertHere?: boolean; hasSchedulesToday?: boolean }): RouteCardLeaf => {
    const trips = o.trips ?? 0;
    const has = o.hasSchedulesToday ?? trips > 0;
    return {
      lineOrRoute: o.lineOrRoute,
      stop: o.stop,
      direction: directionFor(o.pattern.directionId, o.lineOrRoute.kind === 'route' ? o.lineOrRoute.route : o.lineOrRoute.routes[0]),
      routePatterns: [o.pattern],
      stopIds: [],
      upcomingTrips: Array.from({ length: trips }, () => trip(o.pattern)),
      alertsHere: o.alertHere ? [b.alert({ effect: 'SUSPENSION' })] : [],
      alertsDownstream: [],
      hasSchedulesToday: has,
      subwayServiceStartTime: null,
      allDataLoaded: true,
      context: 'nearby',
      hasSchedulesTodayByPattern: { [o.pattern.id]: has },
    };
  };
  const stopData = (stop: Stop, lineOrRoute: LineOrRoute, leaves: RouteCardLeaf[], from: LatLng | null): RouteStopData => ({
    lineOrRoute,
    stop,
    directions: [],
    leaves,
    distanceMeters: from ? distanceMeters(from, stop) : null,
    elevatorAlerts: [],
  });
  const card = (lineOrRoute: LineOrRoute, stops: RouteStopData[]): RouteCard => ({ id: lineOrRoute.id, lineOrRoute, stops, at: NOW });
  return { b, pattern, leaf, stopData, card };
}

describe('PatternSorting', () => {
  it('compareLeavesAtStop', () => {
    const { b, pattern, leaf } = setup();
    const route = b.route();
    const lr = routeOf(route);
    const stop = b.stop();
    const p0 = pattern(route, 0, 0);
    const p1 = pattern(route, 1, 0);
    const alert0 = leaf({ lineOrRoute: lr, stop, pattern: p0, alertHere: true });
    const trip0 = leaf({ lineOrRoute: lr, stop, pattern: p0, trips: 1 });
    const ended0 = leaf({ lineOrRoute: lr, stop, pattern: p0, hasSchedulesToday: true });
    const none0 = leaf({ lineOrRoute: lr, stop, pattern: p0 });
    const alert1 = leaf({ lineOrRoute: lr, stop, pattern: p1, alertHere: true });
    const trip1 = leaf({ lineOrRoute: lr, stop, pattern: p1, trips: 1 });
    const ended1 = leaf({ lineOrRoute: lr, stop, pattern: p1, hasSchedulesToday: true });
    const none1 = leaf({ lineOrRoute: lr, stop, pattern: p1 });
    const cmp = compareLeavesAtStop(NOW);
    expect(cmp(alert0, trip0)).toBe(0);
    expect(cmp(alert1, trip1)).toBe(0);
    const expected = [trip0, trip1, ended0, ended1, none0, none1];
    expect([...expected].reverse().sort(cmp)).toEqual(expected);
  });

  it('compareStopsOnRoute', () => {
    const { b, pattern, leaf, stopData } = setup();
    const route = b.route();
    const lr = routeOf(route);
    const veryNear = b.stop({ latitude: 0.0001, longitude: 0.0001 });
    const near = b.stop({ latitude: 0.1, longitude: 0.1 });
    const far = b.stop({ latitude: 2, longitude: 2 });
    const mk = (stop: Stop, dir: 0 | 1, trips: number, from: LatLng | null) => stopData(stop, lr, [leaf({ lineOrRoute: lr, stop, pattern: pattern(route, dir, 0), trips })], from);
    const cmpNone = compareStopsOnRoute(NOW);
    expect(cmpNone(mk(near, 0, 1, null), mk(near, 1, 1, null))).toBe(0);
    expect(cmpNone(mk(near, 0, 1, ORIGIN), mk(near, 1, 1, ORIGIN))).toBe(0);
    expect(cmpNone(mk(near, 0, 1, null), mk(far, 0, 1, null))).toBe(0);
    const expected = [mk(veryNear, 0, 0, ORIGIN), mk(near, 0, 1, ORIGIN), mk(far, 0, 1, ORIGIN), mk(near, 0, 0, ORIGIN)];
    expect([...expected].reverse().sort(cmpNone)).toEqual(expected);
  });

  it('compareRouteCards', () => {
    const { b, pattern, leaf, stopData, card } = setup();
    const veryNear = b.stop({ latitude: 0.0001, longitude: 0.0001 });
    const near = b.stop({ latitude: 0.1, longitude: 0.1 });
    const far = b.stop({ latitude: 2, longitude: 2 });
    const mk = (service: 'yes' | 'ended' | 'no', subway: boolean, stop: Stop, sortOrder: number, from: LatLng | null = ORIGIN) => {
      const route = b.route({ type: subway ? 1 : 3, sortOrder });
      const lr = routeOf(route);
      return card(lr, [
        stopData(stop, lr, [leaf({ lineOrRoute: lr, stop, pattern: pattern(route, 0, 0), trips: service === 'yes' ? 1 : 0, hasSchedulesToday: service !== 'no' })], from),
      ]);
    };
    const c0 = mk('no', false, veryNear, 100);
    const c1 = mk('yes', true, near, 1);
    const c2 = mk('yes', true, near, 50);
    const c3 = mk('yes', true, far, 1);
    const c4 = mk('yes', false, near, 1);
    const c5 = mk('ended', true, near, 1);
    const c6 = mk('no', true, near, 1);
    expect(compareRouteCards(mk('yes', true, near, 1, null), mk('yes', true, far, 1, null), 'nearby')).toBe(0);
    const expected = [c0, c1, c2, c3, c4, c5, c6];
    expect([...expected].reverse().sort((a, b2) => compareRouteCards(a, b2, 'nearby'))).toEqual(expected);
  });

  it('compareRouteCards on favorites ignores route type', () => {
    const { b, pattern, leaf, stopData, card } = setup();
    const near = b.stop({ latitude: 0.1, longitude: 0.1 });
    const far = b.stop({ latitude: 2, longitude: 2 });
    const mk = (subway: boolean, isNear: boolean, sortOrder: number) => {
      const route = b.route({ type: subway ? 1 : 3, sortOrder });
      const lr = routeOf(route);
      const stop = isNear ? near : far;
      return card(lr, [stopData(stop, lr, [leaf({ lineOrRoute: lr, stop, pattern: pattern(route, 0, 0), trips: 1, hasSchedulesToday: true })], ORIGIN)]);
    };
    const c1 = mk(false, true, 10);
    const c2 = mk(true, false, 1);
    expect([c2, c1].sort((x, y) => compareRouteCards(x, y, 'favorites'))).toEqual([c1, c2]);
    expect([c1, c2].sort((x, y) => compareRouteCards(x, y, 'nearby'))).toEqual([c2, c1]);
  });
});
