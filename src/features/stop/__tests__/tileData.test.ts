// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/stopDetailsPage/TileDataTest.kt
// and the tileData cases of model/LeafFormatTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Kotlin's parametricTest runs over every route type and both last-trip values; so do these.
import type { RouteType } from '@/mbta/model/types';
import type { LeafFormat } from '@/mbta/rules/leafFormat';
import type { TripInstantDisplay } from '@/mbta/rules/tripInstantDisplay';
import type { FormattedTrip, UpcomingFormat } from '@/mbta/rules/upcomingFormat';
import { makeUpcomingTrip, type UpcomingTrip } from '@/mbta/rules/upcomingTrip';
import { createBuilder } from '@/mbta/testing/builders';

import { isTileSelected, tileDataFor, tileFromUpcoming, type TileData } from '../tileData';

const ROUTE_TYPES: RouteType[] = [0, 1, 2, 3, 4];
const BOOLS = [false, true];
const DISTANT_FUTURE = 8.64e15;
const MIN = 60_000;

const ft = (trip: UpcomingTrip, routeType: RouteType, format: TripInstantDisplay, lastTrip: boolean): FormattedTrip => ({
  id: trip.id,
  trip,
  routeType,
  format,
  lastTrip,
  alert: null,
});
const some = (t: FormattedTrip): Extract<UpcomingFormat, { kind: 'some' }> => ({ kind: 'some', trips: [t], secondaryAlert: null });
const tile = (route: TileData['route'], headsign: string | null, t: FormattedTrip): TileData => ({
  id: t.trip.id,
  route,
  headsign,
  formatted: some(t),
  upcoming: t.trip,
});
const branched = (rows: { route?: TileData['route']; headsign: string; format: UpcomingFormat }[]): LeafFormat => ({
  kind: 'branched',
  rows: rows.map((r, i) => ({ id: `${r.headsign}-${i}`, route: r.route ?? null, headsign: r.headsign, format: r.format })),
  secondaryAlert: null,
});

function eachParam(fn: (routeType: RouteType, lastTrip: boolean) => void) {
  for (const routeType of ROUTE_TYPES) for (const lastTrip of BOOLS) fn(routeType, lastTrip);
}

describe('LeafFormat.tileData', () => {
  it('Single tileData returns trips', () =>
    eachParam((routeType, lastTrip) => {
      const b = createBuilder();
      const t1 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'arriving', last: lastTrip }, lastTrip);
      const t2 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'minutes', minutes: 10, last: lastTrip }, lastTrip);
      const t3 = ft(
        makeUpcomingTrip(b.trip()),
        routeType,
        { kind: 'scheduleTime', scheduledTime: DISTANT_FUTURE, last: lastTrip, headline: false },
        lastTrip,
      );
      const format: LeafFormat = {
        kind: 'single',
        route: null,
        headsign: 'Overridden Headsign',
        format: { kind: 'some', trips: [t1, t2, t3], secondaryAlert: null },
      };
      expect(tileDataFor(format, null)).toEqual([
        tile(null, 'Overridden Headsign', t1),
        tile(null, 'Overridden Headsign', t2),
        tile(null, 'Overridden Headsign', t3),
      ]);
    }));

  it('Single tileData drops headsign if normal', () =>
    eachParam((routeType, lastTrip) => {
      const b = createBuilder();
      const t1 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'arriving', last: lastTrip }, lastTrip);
      const format: LeafFormat = { kind: 'single', route: null, headsign: 'Headsign', format: { kind: 'some', trips: [t1], secondaryAlert: null } };
      expect(tileDataFor(format, 'Headsign')).toEqual([tile(null, null, t1)]);
    }));

  it('Branched tileData returns trips', () =>
    eachParam((routeType, lastTrip) => {
      const b = createBuilder();
      const route1 = b.route({ type: routeType });
      const route2 = b.route({ type: routeType });
      const t1 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'approaching', last: lastTrip }, lastTrip);
      const t2 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'scheduleMinutes', minutes: 35, last: lastTrip }, lastTrip);
      const t3 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'now', last: lastTrip }, lastTrip);
      const format = branched([
        { route: route1, headsign: 'Headsign 1', format: some(t1) },
        { route: route2, headsign: 'Headsign 2', format: some(t2) },
        { route: route1, headsign: 'Headsign 3', format: some(t3) },
      ]);
      expect(tileDataFor(format, null)).toEqual([
        tile(route1, 'Headsign 1', t1),
        tile(route2, 'Headsign 2', t2),
        tile(route1, 'Headsign 3', t3),
      ]);
    }));

  it('Branched tileData ignores branches without trips', () =>
    eachParam((routeType, lastTrip) => {
      const b = createBuilder();
      const t1 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'approaching', last: lastTrip }, lastTrip);
      const t2 = ft(makeUpcomingTrip(b.trip()), routeType, { kind: 'scheduleMinutes', minutes: 35, last: lastTrip }, lastTrip);
      const format = branched([
        { headsign: 'Headsign 1', format: some(t1) },
        { headsign: 'Headsign 2', format: some(t2) },
        { headsign: 'Headsign 3', format: { kind: 'loading' } },
      ]);
      expect(tileDataFor(format, null)).toEqual([tile(null, 'Headsign 1', t1), tile(null, 'Headsign 2', t2)]);
    }));

  it('Single tileData empty if no trips', () => {
    const format: LeafFormat = {
      kind: 'single',
      route: null,
      headsign: null,
      format: { kind: 'noTrips', noTrips: { kind: 'noSchedulesToday' }, secondaryAlert: null },
    };
    expect(tileDataFor(format, null)).toEqual([]);
  });

  it('Branched tileData empty if no trips', () => {
    const format = branched([
      { headsign: 'Headsign 1', format: { kind: 'noTrips', noTrips: { kind: 'predictionsUnavailable' }, secondaryAlert: null } },
      { headsign: 'Headsign 2', format: { kind: 'loading' } },
    ]);
    expect(tileDataFor(format, null)).toEqual([]);
  });
});

describe('TileData', () => {
  it('id matches upcoming trip id + stopSequence', () => {
    const b = createBuilder();
    const route = b.route();
    const prediction = b.prediction({ stopSequence: 1 });
    const upcoming = makeUpcomingTrip(b.trip(), null, prediction);
    const t = tile(route, 'Headsign', ft(upcoming, route.type, { kind: 'arriving', last: false }, false));
    expect(t.id).toBe(`${upcoming.trip.id}-1`);
  });

  it('fromUpcoming keeps arriving trip', () => {
    const now = Date.now();
    const b = createBuilder();
    const route = b.route();
    const trip = b.trip({ headsign: 'Headsign' });
    const prediction = b.prediction({ trip, departureTime: now + 30_000 });
    const upcoming = b.upcomingTrip({ prediction });
    expect(tileFromUpcoming(upcoming, route, now)).toEqual(tile(route, 'Headsign', ft(upcoming, route.type, { kind: 'arriving', last: false }, false)));
  });

  it('fromUpcoming drops hidden trip', () => {
    const now = Date.now();
    const b = createBuilder();
    const route = b.route();
    const trip = b.trip();
    const prediction = b.prediction({ trip, departureTime: now - 3 * MIN });
    expect(tileFromUpcoming(b.upcomingTrip({ prediction }), route, now)).toBeNull();
  });

  it('isSelected is true when the filter matches', () => {
    const now = Date.now();
    const b = createBuilder();
    const route = b.route();
    const trip = b.trip();
    const prediction = b.prediction({ trip, departureTime: now + 5 * MIN, stopSequence: 2 });
    const t = tileFromUpcoming(b.upcomingTrip({ prediction }), route, now)!;

    expect(isTileSelected(t, null)).toBe(false);
    expect(isTileSelected(t, { tripId: 'other-trip', vehicleId: null, stopSequence: null })).toBe(false);
    expect(isTileSelected(t, { tripId: trip.id, vehicleId: null, stopSequence: 0 })).toBe(false);

    expect(isTileSelected(t, { tripId: trip.id, vehicleId: null, stopSequence: null })).toBe(true);
    expect(isTileSelected(t, { tripId: trip.id, vehicleId: null, stopSequence: prediction.stopSequence })).toBe(true);
  });
});
