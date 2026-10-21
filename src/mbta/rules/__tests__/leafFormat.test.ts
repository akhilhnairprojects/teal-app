// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/RouteCardDataLeafTest.kt
// and model/LeafFormatTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// MBTA Go's TestData fixtures are replaced by the small networks in src/mbta/testing/fixtures.ts.
// LeafFormat.tileData belongs to WP2 (tileData.ts) and is not ported here.
import type { Alert, Route, RouteType, Stop } from '@/mbta/model/types';
import { createBuilder, type Builder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';
import { easternInstant } from '@/mbta/time/eastern';

import { directionFor, type Direction } from '../direction';
import { noPredictionsStatus, type LeafFormat } from '../leafFormat';
import { routeOf, type LineOrRoute } from '../lineOrRoute';
import { formatLeaf, leafAlertsDownstream, leafAlertsHere, type RouteCardContext, type RouteCardLeaf } from '../routeCardData';
import type { TripInstantDisplay } from '../tripInstantDisplay';
import type { FormattedTrip, NoTripsFormat, UpcomingFormat, WarningAlert } from '../upcomingFormat';
import type { UpcomingTrip } from '../upcomingTrip';

const MIN = 60_000;
const NOW = Date.now();
const ALL_CONTEXTS: RouteCardContext[] = ['nearby', 'stopDetailsUnfiltered', 'stopDetailsFiltered', 'favorites'];
const NOT_FILTERED: RouteCardContext[] = ['nearby', 'stopDetailsUnfiltered', 'favorites'];

function leaf(o: {
  lineOrRoute: LineOrRoute;
  stop: Stop;
  direction: Direction;
  routePatterns?: RouteCardLeaf['routePatterns'];
  stopIds?: string[];
  upcomingTrips?: UpcomingTrip[];
  alertsHere?: Alert[];
  allDataLoaded?: boolean;
  hasSchedulesToday?: boolean | Record<string, boolean>;
  subwayServiceStartTime?: number | null;
  alertsDownstream?: Alert[];
  context: RouteCardContext;
}): RouteCardLeaf {
  const patterns = o.routePatterns ?? [];
  const has = o.hasSchedulesToday ?? true;
  // Kotlin's convenience constructor: one flag per pattern, or a fake id when there are none.
  const byPattern =
    typeof has === 'boolean' ? (patterns.length ? Object.fromEntries(patterns.map((p) => [p.id, has])) : { fakeId: has }) : has;
  return {
    lineOrRoute: o.lineOrRoute,
    stop: o.stop,
    direction: o.direction,
    routePatterns: patterns,
    stopIds: o.stopIds ?? [],
    upcomingTrips: o.upcomingTrips ?? [],
    alertsHere: o.alertsHere ?? [],
    alertsDownstream: o.alertsDownstream ?? [],
    hasSchedulesToday: Object.values(byPattern).some(Boolean),
    subwayServiceStartTime: o.subwayServiceStartTime ?? null,
    allDataLoaded: o.allDataLoaded ?? true,
    context: o.context,
    hasSchedulesTodayByPattern: byPattern,
  };
}

const ft = (trip: UpcomingTrip, routeType: RouteType, format: TripInstantDisplay, lastTrip: boolean): FormattedTrip => ({
  id: trip.id,
  trip,
  routeType,
  format,
  lastTrip,
  alert: null,
});
const some = (trips: FormattedTrip[], secondaryAlert: WarningAlert | null = null): UpcomingFormat => ({ kind: 'some', trips, secondaryAlert });
const noTrips = (n: NoTripsFormat, secondaryAlert: WarningAlert | null = null): UpcomingFormat => ({ kind: 'noTrips', noTrips: n, secondaryAlert });
const disruption = (alert: Alert, iconName: string): UpcomingFormat => ({ kind: 'disruption', alert, iconName });
const single = (route: Route | null, headsign: string | null, format: UpcomingFormat): LeafFormat => ({ kind: 'single', route, headsign, format });
const branched = (rows: [Route | null, string, UpcomingFormat][], secondaryAlert: WarningAlert | null = null) => ({
  kind: 'branched',
  rows: rows.map(([route, headsign, format]) => ({ route, headsign, format })),
  secondaryAlert,
});

/** Branch row ids are random-ish (as in Kotlin, excluded from equality). */
function strip(f: LeafFormat) {
  return f.kind === 'single' ? f : { ...f, rows: f.rows.map(({ route, headsign, format }) => ({ route, headsign, format })) };
}

const fmt = (l: RouteCardLeaf, b: Builder, now = NOW) => strip(formatLeaf(l, now, b.global()));

describe('RouteCardData.Leaf.format', () => {
  it('formats as alert with no trips and major alert', () => {
    for (const type of [0, 1, 3] as RouteType[]) {
      for (const context of ALL_CONTEXTS) {
        const b = createBuilder();
        const route = b.route({ id: 'Red', type });
        const alert = b.alert({ effect: 'SUSPENSION' });
        expect(
          fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), alertsHere: [alert], context }), b),
        ).toEqual(single(null, null, disruption(alert, 'alert-large-red-suspension')));
      }
    }
  });

  it('formats as ended with no trips but schedules and secondary alert', () => {
    const b = createBuilder();
    const cases: [Route, string][] = [
      [b.route({ id: 'Red' }), 'alert-large-red-issue'],
      [b.route({ id: 'Mattapan' }), 'alert-large-mattapan-issue'],
      [b.route({ id: 'Orange' }), 'alert-large-orange-issue'],
      [b.route({ id: 'Green-B' }), 'alert-large-green-issue'],
      [b.route({ id: 'Blue' }), 'alert-large-blue-issue'],
      [b.route({ id: '741' }), 'alert-large-silver-issue'],
      [b.route({ type: 2 }), 'alert-large-commuter-issue'],
      [b.route({ type: 4 }), 'alert-large-ferry-issue'],
      [b.route({ type: 3 }), 'alert-large-bus-issue'],
      [b.route({ type: 1 }), 'alert-borderless-issue'],
    ];
    const alert = b.alert({ effect: 'SERVICE_CHANGE' });
    for (const context of ALL_CONTEXTS) {
      for (const [route, icon] of cases) {
        expect(
          fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), alertsHere: [alert], context }), b),
        ).toEqual(single(null, null, noTrips({ kind: 'serviceEndedToday' }, { iconName: icon, alertId: alert.id })));
      }
    }
  });

  it('formats as alert with trip and major alert', () => {
    for (const type of [0, 1, 3] as RouteType[]) {
      const b = createBuilder();
      const route = b.route({ id: '741', type });
      const trip = b.trip();
      const upcoming = b.upcomingTrip({ prediction: b.prediction({ trip, departureTime: NOW + MIN }) });
      const alert = b.alert({ effect: 'SUSPENSION' });
      for (const context of ALL_CONTEXTS) {
        expect(
          fmt(
            leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [upcoming], alertsHere: [alert], context }),
            b,
          ),
        ).toEqual(single(null, '', disruption(alert, 'alert-large-silver-suspension')));
      }
    }
  });

  it('formats as Some with major alert affecting only one trip', () => {
    const b = createBuilder();
    const route = b.route({ id: 'CR-Worcester', type: 2 });
    const trip = b.trip();
    const prediction = b.prediction({ trip, departureTime: NOW + 5 * MIN });
    const upcoming = b.upcomingTrip({ prediction });
    const alert = b.alert({
      effect: 'SUSPENSION',
      informedEntities: [b.entity({ activities: ['BOARD'], directionId: trip.directionId, routeId: route.id, tripId: trip.id })],
    });
    expect(
      fmt(
        leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [upcoming], alertsHere: [alert], context: 'nearby' }),
        b,
      ),
    ).toEqual(
      single(
        null,
        '',
        some([ft(upcoming, 2, { kind: 'time', predictionTime: NOW + 5 * MIN, last: true, headline: true }, true)], {
          iconName: 'alert-large-commuter-issue',
          alertId: alert.id,
        }),
      ),
    );
  });

  it('formats CR as prediction in past with status', () => {
    const b = createBuilder();
    const route = b.route({ type: 2 });
    const prediction = b.prediction({ trip: b.trip(), departureTime: NOW - 2 * MIN, status: 'foo' });
    const upcoming = b.upcomingTrip({ prediction });
    expect(
      fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [upcoming], context: 'stopDetailsFiltered' }), b),
    ).toEqual(
      single(null, '', some([ft(upcoming, 2, { kind: 'timeWithStatus', predictionTime: NOW - 2 * MIN, status: 'foo', last: true, headline: true }, true)])),
    );
  });

  it('formats CR as schedule in past with status if prediction has null time', () => {
    const b = createBuilder();
    const route = b.route({ type: 2 });
    const schedule = b.schedule({ trip: b.trip(), departureTime: NOW - 2 * MIN });
    const prediction = b.predictionFor(schedule, { departureTime: null, status: 'foo' });
    const upcoming = b.upcomingTrip({ schedule, prediction });
    expect(
      fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [upcoming], context: 'stopDetailsFiltered' }), b),
    ).toEqual(
      single(
        null,
        '',
        some([ft(upcoming, 2, { kind: 'scheduleTimeWithStatusColumn', scheduledTime: NOW - 2 * MIN, status: 'foo', last: true, headline: true }, true)]),
      ),
    );
  });

  it('preserves trip alongside secondary alert', () => {
    const b = createBuilder();
    const route = b.route({ type: 3 });
    const upcoming = b.upcomingTrip({ prediction: b.prediction({ trip: b.trip(), departureTime: NOW + MIN }) });
    const alert = b.alert({ effect: 'SERVICE_CHANGE' });
    for (const context of ALL_CONTEXTS) {
      expect(
        fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [upcoming], alertsHere: [alert], context }), b),
      ).toEqual(single(null, '', some([ft(upcoming, 3, { kind: 'minutes', minutes: 1, last: true }, true)], { iconName: 'alert-large-bus-issue', alertId: alert.id })));
    }
  });

  it('includes downstream alert as secondary alert', () => {
    const b = createBuilder();
    const route = b.route({ type: 3 });
    const upcoming = b.upcomingTrip({ prediction: b.prediction({ trip: b.trip(), departureTime: NOW + MIN }) });
    const alert = b.alert({ effect: 'SHUTTLE' });
    for (const context of ALL_CONTEXTS) {
      expect(
        fmt(
          leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [upcoming], alertsDownstream: [alert], context }),
          b,
        ),
      ).toEqual(single(null, '', some([ft(upcoming, 3, { kind: 'minutes', minutes: 1, last: true }, true)], { iconName: 'alert-large-bus-issue', alertId: alert.id })));
    }
  });

  it('formats as ended with no trips but schedules and no alert', () => {
    for (const type of [0, 1, 3] as RouteType[]) {
      const b = createBuilder();
      const route = b.route({ type });
      for (const context of ALL_CONTEXTS) {
        expect(fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), context }), b)).toEqual(
          single(null, null, noTrips({ kind: 'serviceEndedToday' })),
        );
      }
    }
  });

  it("formats as subway early morning when after 3:30 and subway service hasn't started", () => {
    const now = easternInstant(2026, 6, 18, 3, 31);
    const serviceStart = now + 10 * MIN;
    for (const type of [0, 1] as RouteType[]) {
      const b = createBuilder();
      const route = b.route({ type });
      for (const context of ALL_CONTEXTS) {
        expect(
          fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), subwayServiceStartTime: serviceStart, context }), b, now),
        ).toEqual(single(null, null, noTrips({ kind: 'subwayEarlyMorning', scheduledTime: serviceStart })));
      }
    }
  });

  it('formats as none with subway schedules but no predictions and no alert', () => {
    for (const type of [0, 1] as RouteType[]) {
      const b = createBuilder();
      const route = b.route({ type });
      const pattern = b.pattern(route, { typicality: 'typical', representativeTrip: { headsign: 'headsign' } });
      const schedule = b.schedule({ trip: b.tripFor(pattern), departureTime: NOW + 2 * MIN });
      for (const context of ALL_CONTEXTS) {
        expect(
          fmt(
            leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [b.upcomingTrip({ schedule })], context }),
            b,
          ),
        ).toEqual(single(null, 'headsign', noTrips({ kind: 'predictionsUnavailable' })));
      }
    }
  });

  it('formats branched with alert on one branch and no predictions on the other', () => {
    for (const type of [0, 1] as RouteType[]) {
      for (const context of ALL_CONTEXTS) {
        const b = createBuilder();
        const route = b.route({ type });
        const stop = b.stop({ childStopIds: ['childPlatform1', 'childPlatform2'] });
        const typicalA = b.pattern(route, { typicality: 'typical', representativeTrip: { headsign: 'A', stopIds: ['childPlatform1'] } });
        const typicalB = b.pattern(route, { typicality: 'typical', representativeTrip: { headsign: 'B', stopIds: ['childPlatform2'] } });
        const atypicalA = b.pattern(route, { typicality: 'atypical', representativeTrip: { headsign: 'A', stopIds: ['childPlatform1'] } });
        const schedule = b.schedule({ trip: b.tripFor(atypicalA), departureTime: NOW + 2 * MIN });
        const alert = b.alert({
          effect: 'SHUTTLE',
          cause: 'MAINTENANCE',
          informedEntities: [b.entity({ directionId: 0, routeId: route.id, stopId: 'childPlatform2' })],
        });
        expect(
          fmt(
            leaf({
              lineOrRoute: routeOf(route),
              stop,
              direction: directionFor(0, route),
              routePatterns: [typicalA, typicalB, atypicalA],
              stopIds: [stop.id, ...stop.childStopIds],
              upcomingTrips: [b.upcomingTrip({ schedule })],
              alertsHere: [alert],
              hasSchedulesToday: { [typicalA.id]: false, [atypicalA.id]: true, [typicalB.id]: false },
              context,
            }),
            b,
          ),
        ).toEqual(
          branched([
            [null, 'A', noTrips({ kind: 'predictionsUnavailable' })],
            [null, 'B', disruption(alert, 'alert-borderless-shuttle')],
          ]),
        );
      }
    }
  });

  it('formats as none with Silver Line schedules but no predictions and no alert', () => {
    for (const id of ['741', '742', '743', '751', '749', '746']) {
      const b = createBuilder();
      const route = b.route({ type: 3, id });
      const pattern = b.pattern(route, { typicality: 'typical', representativeTrip: { headsign: 'headsign' } });
      const schedule = b.schedule({ trip: b.tripFor(pattern), departureTime: NOW + 2 * MIN });
      expect(
        fmt(
          leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [b.upcomingTrip({ schedule })], context: 'nearby' }),
          b,
        ),
      ).toEqual(single(null, 'headsign', noTrips({ kind: 'predictionsUnavailable' })));
    }
  });

  it('formats as loading if empty trips but still loading', () => {
    for (const type of [0, 1, 2, 3, 4] as RouteType[]) {
      const b = createBuilder();
      const route = b.route({ type });
      const pattern = b.pattern(route);
      expect(
        fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), routePatterns: [pattern], allDataLoaded: false, context: 'nearby' }), b),
      ).toEqual(single(null, null, { kind: 'loading' }));
    }
  });

  it('skips trips that should be hidden', () => {
    for (const type of [0, 1, 3] as RouteType[]) {
      const b = createBuilder();
      const route = b.route({ type });
      const up1 = b.upcomingTrip({ prediction: b.prediction({ trip: b.trip(), departureTime: null }) });
      const up2 = b.upcomingTrip({ prediction: b.prediction({ trip: b.trip(), departureTime: NOW + 5 * MIN }) });
      const last = type === 3;
      expect(
        fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: [up1, up2], context: 'nearby' }), b),
      ).toEqual(single(null, '', some([ft(up2, type, { kind: 'minutes', minutes: 5, last }, last)])));
    }
  });

  it('format skips schedules on subway but keeps on non-subway', () => {
    const b = createBuilder();
    const subway = b.route({ type: 0 });
    const bus = b.route({ type: 3 });
    const up1 = b.upcomingTrip({ schedule: b.schedule({ trip: b.trip(), departureTime: NOW + 5 * MIN }) });
    const up2 = b.upcomingTrip({ prediction: b.prediction({ trip: b.trip(), departureTime: NOW + 5 * MIN }) });
    expect(fmt(leaf({ lineOrRoute: routeOf(subway), stop: b.stop(), direction: directionFor(0, subway), upcomingTrips: [up1, up2], context: 'nearby' }), b)).toEqual(
      single(null, '', some([ft(up2, 0, { kind: 'minutes', minutes: 5, last: false }, false)])),
    );
    expect(fmt(leaf({ lineOrRoute: routeOf(bus), stop: b.stop(), direction: directionFor(0, bus), upcomingTrips: [up1, up2], context: 'nearby' }), b)).toEqual(
      single(
        null,
        '',
        some([ft(up1, 3, { kind: 'scheduleMinutes', minutes: 5, last: false }, false), ft(up2, 3, { kind: 'minutes', minutes: 5, last: true }, true)]),
      ),
    );
  });

  it('format handles no schedules all day', () => {
    const b = createBuilder();
    const route = b.route({ type: 1 });
    expect(fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), hasSchedulesToday: false, context: 'nearby' }), b)).toEqual(
      single(null, null, noTrips({ kind: 'noSchedulesToday' })),
    );
  });

  describe('Red Line', () => {
    const setup = () => {
      const b = createBuilder();
      const red = redLine(b);
      const lr = routeOf(red.route);
      const pred = (minutes: number, pattern: typeof red.ashmontSouth, stop: Stop, extra: { lastTrip?: boolean } = {}) =>
        b.prediction({
          arrivalTime: NOW + minutes * MIN,
          departureTime: NOW + minutes * MIN,
          trip: b.tripFor(pattern),
          stopId: stop.id,
          ...extra,
        });
      return { b, red, lr, pred, up: (p: ReturnType<typeof pred>) => b.upcomingTrip({ prediction: p }) };
    };

    it('formats southbound as branching showing next 3 trips', () => {
      const { b, red, lr, pred, up } = setup();
      const p1 = pred(1, red.ashmontSouth, red.jfk.south1);
      const p2 = pred(2, red.braintreeSouth, red.jfk.south2);
      const p3 = pred(9, red.ashmontSouth, red.jfk.south1);
      const p4 = pred(15, red.braintreeSouth, red.jfk.south2);
      for (const context of NOT_FILTERED) {
        expect(
          fmt(
            leaf({
              lineOrRoute: lr,
              stop: red.jfk.itself,
              direction: directionFor(0, red.route),
              routePatterns: [red.ashmontSouth, red.braintreeSouth],
              stopIds: [red.jfk.south1.id, red.jfk.south2.id],
              upcomingTrips: [up(p1), up(p2), up(p3), up(p4)],
              context,
            }),
            b,
          ),
        ).toEqual(
          branched([
            [null, 'Ashmont', some([ft(up(p1), 1, { kind: 'approaching', last: false }, false)])],
            [null, 'Braintree', some([ft(up(p2), 1, { kind: 'minutes', minutes: 2, last: false }, false)])],
            [null, 'Ashmont', some([ft(up(p3), 1, { kind: 'minutes', minutes: 9, last: false }, false)])],
          ]),
        );
      }
    });

    it('formats northbound as non-branching showing next 2 trips', () => {
      const { b, red, lr, pred, up } = setup();
      const p1 = pred(3, red.ashmontNorth, red.jfk.north1);
      const p2 = pred(12, red.braintreeNorth, red.jfk.north2);
      const p3 = pred(18, red.ashmontNorth, red.jfk.north1);
      for (const context of NOT_FILTERED) {
        expect(
          fmt(
            leaf({
              lineOrRoute: lr,
              stop: red.jfk.itself,
              direction: directionFor(1, red.route),
              routePatterns: [red.ashmontNorth, red.braintreeNorth],
              stopIds: [red.jfk.north1.id, red.jfk.north2.id],
              upcomingTrips: [up(p1), up(p2), up(p3)],
              context,
            }),
            b,
          ),
        ).toEqual(
          single(
            null,
            'Alewife',
            some([ft(up(p1), 1, { kind: 'minutes', minutes: 3, last: false }, false), ft(up(p2), 1, { kind: 'minutes', minutes: 12, last: false }, false)]),
          ),
        );
      }
    });

    it('formats southbound as branching even if next trips all match', () => {
      const { b, red, lr, pred, up } = setup();
      const ps = [2, 5, 9].map((m) => pred(m, red.ashmontSouth, red.jfk.south1));
      for (const context of ALL_CONTEXTS) {
        expect(
          fmt(
            leaf({
              lineOrRoute: lr,
              stop: red.jfk.itself,
              direction: directionFor(0, red.route),
              routePatterns: [red.ashmontSouth, red.braintreeSouth],
              stopIds: [red.jfk.south1.id, red.jfk.south2.id],
              upcomingTrips: ps.map(up),
              context,
            }),
            b,
          ),
        ).toEqual(branched(ps.map((p, i) => [null, 'Ashmont', some([ft(up(p), 1, { kind: 'minutes', minutes: [2, 5, 9][i], last: false }, false)])])));
      }
    });

    const braintreeSuspension = (b: Builder, red: ReturnType<typeof redLine>) =>
      b.alert({
        effect: 'SUSPENSION',
        informedEntities: red.braintreeBranchSouth.map((stopId) => b.entity({ activities: ['BOARD'], directionId: 0, routeId: 'Red', routeType: 1, stopId })),
      });

    it('formats southbound as branching with Braintree suspended from JFK', () => {
      const { b, red, lr, pred, up } = setup();
      const p1 = pred(3, red.ashmontSouth, red.jfk.south1);
      const p2 = pred(12, red.ashmontSouth, red.jfk.south1);
      const alert = braintreeSuspension(b, red);
      for (const context of NOT_FILTERED) {
        expect(
          fmt(
            leaf({
              lineOrRoute: lr,
              stop: red.jfk.itself,
              direction: directionFor(0, red.route),
              routePatterns: [red.ashmontSouth, red.braintreeSouth],
              stopIds: [red.jfk.south1.id, red.jfk.south2.id],
              upcomingTrips: [up(p1), up(p2)],
              alertsHere: [alert],
              context,
            }),
            b,
          ),
        ).toEqual(
          branched([
            [null, 'Ashmont', some([ft(up(p1), 1, { kind: 'minutes', minutes: 3, last: false }, false)])],
            [null, 'Ashmont', some([ft(up(p2), 1, { kind: 'minutes', minutes: 12, last: false }, false)])],
            [null, 'Braintree', disruption(alert, 'alert-large-red-suspension')],
          ]),
        );
      }
    });

    it('formats southbound as branching all upcoming trips with Braintree suspension in filtered stop details', () => {
      const { b, red, lr, pred, up } = setup();
      const ps = [3, 12, 15].map((m) => pred(m, red.ashmontSouth, red.jfk.south1));
      const alert = braintreeSuspension(b, red);
      expect(
        fmt(
          leaf({
            lineOrRoute: lr,
            stop: red.jfk.itself,
            direction: directionFor(0, red.route),
            routePatterns: [red.ashmontSouth, red.braintreeSouth],
            stopIds: [red.jfk.south1.id, red.jfk.south2.id],
            upcomingTrips: ps.map(up),
            alertsHere: [alert],
            context: 'stopDetailsFiltered',
          }),
          b,
        ),
      ).toEqual(
        branched([
          ...ps.map((p, i): [null, string, UpcomingFormat] => [null, 'Ashmont', some([ft(up(p), 1, { kind: 'minutes', minutes: [3, 12, 15][i], last: false }, false)])]),
          [null, 'Braintree', disruption(alert, 'alert-large-red-suspension')],
        ]),
      );
    });

    it('formats subway last trip based on prediction last trip field', () => {
      const { b, red, lr, pred, up } = setup();
      const p1 = pred(3, red.ashmontNorth, red.jfk.north1);
      const p2 = pred(12, red.braintreeNorth, red.jfk.north2);
      const p3 = pred(18, red.ashmontNorth, red.jfk.north1, { lastTrip: true });
      expect(
        fmt(
          leaf({
            lineOrRoute: lr,
            stop: red.jfk.itself,
            direction: directionFor(1, red.route),
            routePatterns: [red.ashmontNorth, red.braintreeNorth],
            stopIds: [red.jfk.north1.id, red.jfk.north2.id],
            upcomingTrips: [up(p1), up(p2), up(p3)],
            context: 'stopDetailsFiltered',
          }),
          b,
        ),
      ).toEqual(
        single(
          null,
          'Alewife',
          some([
            ft(up(p1), 1, { kind: 'minutes', minutes: 3, last: false }, false),
            ft(up(p2), 1, { kind: 'minutes', minutes: 12, last: false }, false),
            ft(up(p3), 1, { kind: 'minutes', minutes: 18, last: true }, true),
          ]),
        ),
      );
    });

    it('formats southbound as branching if service ended on one branch', () => {
      const { b, red, lr } = setup();
      const p1 = b.prediction({ departureTime: NOW + MIN, trip: b.tripFor(red.ashmontSouth) });
      const p2 = b.prediction({ departureTime: NOW + 2 * MIN, trip: b.tripFor(red.ashmontSouth) });
      const up = (p: typeof p1) => b.upcomingTrip({ prediction: p });
      for (const context of ALL_CONTEXTS) {
        expect(
          fmt(
            leaf({
              lineOrRoute: lr,
              stop: b.stop(),
              direction: directionFor(0, red.route),
              routePatterns: [red.ashmontSouth, red.braintreeSouth],
              upcomingTrips: [up(p1), up(p2)],
              context,
            }),
            b,
          ),
        ).toEqual(
          branched([
            [null, 'Ashmont', some([ft(up(p1), 1, { kind: 'approaching', last: false }, false)])],
            [null, 'Ashmont', some([ft(up(p2), 1, { kind: 'minutes', minutes: 2, last: false }, false)])],
          ]),
        );
      }
    });

    it('formats southbound as non-branching if service ended on all branches', () => {
      const { b, red, lr } = setup();
      for (const context of ALL_CONTEXTS) {
        expect(
          fmt(leaf({ lineOrRoute: lr, stop: b.stop(), direction: directionFor(0, red.route), routePatterns: [red.ashmontSouth, red.braintreeSouth], context }), b),
        ).toEqual(single(null, null, noTrips({ kind: 'serviceEndedToday' })));
      }
    });
  });

  it('format schedule based last trip with later cancelled trips', () => {
    const b = createBuilder();
    const route = b.route({ type: 3 });
    const [t1, t2, t3, t4, t5] = [1, 2, 3, 4, 5].map(() => b.trip());
    const s1 = b.schedule({ trip: t1, departureTime: NOW + 5 * MIN });
    const p2 = b.prediction({ trip: t2, departureTime: NOW + 5 * MIN });
    const s3 = b.schedule({ trip: t3, departureTime: NOW + 30 * MIN });
    const s4 = b.schedule({ trip: t4, departureTime: NOW + 35 * MIN });
    const p4 = b.prediction({ trip: t4, scheduleRelationship: 'CANCELLED' });
    const s5 = b.schedule({ trip: t5, departureTime: NOW + 40 * MIN });
    const p5 = b.prediction({ trip: t5, scheduleRelationship: 'CANCELLED' });
    const ups = [
      b.upcomingTrip({ schedule: s1 }),
      b.upcomingTrip({ prediction: p2 }),
      b.upcomingTrip({ schedule: s3 }),
      b.upcomingTrip({ schedule: s4, prediction: p4 }),
      b.upcomingTrip({ schedule: s5, prediction: p5 }),
    ];
    expect(fmt(leaf({ lineOrRoute: routeOf(route), stop: b.stop(), direction: directionFor(0, route), upcomingTrips: ups, context: 'stopDetailsFiltered' }), b)).toEqual(
      single(
        null,
        '',
        some([
          ft(ups[0], 3, { kind: 'scheduleMinutes', minutes: 5, last: false }, false),
          ft(ups[1], 3, { kind: 'minutes', minutes: 5, last: false }, false),
          ft(ups[2], 3, { kind: 'scheduleMinutes', minutes: 30, last: true }, true),
          ft(ups[3], 3, { kind: 'cancelled', scheduledTime: s4.departureTime! }, false),
          ft(ups[4], 3, { kind: 'cancelled', scheduledTime: s5.departureTime! }, false),
        ]),
      ),
    );
  });

  describe('Green Line', () => {
    const westbound: Direction = { id: 0, name: null, destination: null };

    it('formats westbound at Boylston as branching', () => {
      const b = createBuilder();
      const gl = greenLine(b);
      const p = (m: number, k: 'b' | 'c' | 'd' | 'e') => b.prediction({ departureTime: NOW + m * MIN, trip: b.tripFor(gl.patterns[k].west) });
      const p1 = p(3, 'c');
      const p2 = p(5, 'b');
      const p3 = p(10, 'd');
      const p4 = p(15, 'e');
      const up = (x: typeof p1) => b.upcomingTrip({ prediction: x });
      for (const context of NOT_FILTERED) {
        expect(
          fmt(
            leaf({
              lineOrRoute: gl.lineOrRoute,
              stop: gl.stations['place-boyls'],
              direction: westbound,
              routePatterns: [gl.patterns.b.west, gl.patterns.c.west, gl.patterns.d.west, gl.patterns.e.west],
              upcomingTrips: [up(p1), up(p2), up(p3), up(p4)],
              context,
            }),
            b,
          ),
        ).toEqual(
          branched([
            [gl.routes.c, 'Cleveland Circle', some([ft(up(p1), 0, { kind: 'minutes', minutes: 3, last: false }, false)])],
            [gl.routes.b, 'Boston College', some([ft(up(p2), 0, { kind: 'minutes', minutes: 5, last: false }, false)])],
            [gl.routes.d, 'Riverside', some([ft(up(p3), 0, { kind: 'minutes', minutes: 10, last: false }, false)])],
          ]),
        );
      }
    });

    it('formats westbound at Reservoir as single', () => {
      const b = createBuilder();
      const gl = greenLine(b);
      const ps = [3, 5, 10, 15].map((m) => b.prediction({ departureTime: NOW + m * MIN, trip: b.tripFor(gl.patterns.d.west) }));
      const up = (x: (typeof ps)[number]) => b.upcomingTrip({ prediction: x });
      expect(
        fmt(
          leaf({
            lineOrRoute: gl.lineOrRoute,
            stop: gl.stations['place-rsmnl'],
            direction: westbound,
            routePatterns: [gl.patterns.d.west],
            upcomingTrips: ps.map(up),
            context: 'nearby',
          }),
          b,
        ),
      ).toEqual(
        single(
          gl.routes.d,
          'Riverside',
          some([ft(up(ps[0]), 0, { kind: 'minutes', minutes: 3, last: false }, false), ft(up(ps[1]), 0, { kind: 'minutes', minutes: 5, last: false }, false)]),
        ),
      );
    });

    it('formats westbound at Boylston as non-branching if disruption on all branches', () => {
      const b = createBuilder();
      const gl = greenLine(b);
      const alert = b.alert({
        effect: 'SHUTTLE',
        informedEntities: Object.values(gl.routes).map((r) =>
          b.entity({ activities: ['BOARD'], directionId: 0, routeId: r.id, routeType: 0, stopId: 'place-boyls' }),
        ),
      });
      for (const context of NOT_FILTERED) {
        expect(
          fmt(
            leaf({
              lineOrRoute: gl.lineOrRoute,
              stop: gl.stations['place-boyls'],
              direction: westbound,
              routePatterns: [gl.patterns.b.west, gl.patterns.c.west, gl.patterns.d.west, gl.patterns.e.west],
              stopIds: ['place-boyls'],
              alertsHere: [alert],
              context,
            }),
            b,
          ),
        ).toEqual(single(null, null, disruption(alert, 'alert-large-green-shuttle')));
      }
    });
  });

  it('formats suspension alert as single when there is a stop_headsign for stop', () => {
    const b = createBuilder();
    const route = b.route({ type: 4 });
    const stop1 = b.stop();
    const stop2 = b.stop();
    const stop3 = b.stop();
    const rep = b.trip({ routeId: route.id, routePatternId: 'rp1', directionId: 0, stopIds: [stop1.id, stop2.id], headsign: 'Quincy Loop' });
    const rp1 = b.pattern(route, { id: 'rp1', typicality: 'typical', representativeTripId: rep.id });
    b.trip({ routeId: route.id, routePatternId: 'rp2', directionId: 0, stopIds: [stop1.id, stop3.id], headsign: 'Quincy Loop' });
    // As in the Kotlin test, rp2 also points at the first representative trip.
    const rp2 = b.pattern(route, { id: 'rp2', typicality: 'typical', representativeTripId: rep.id });
    const alert = b.alert({
      effect: 'SUSPENSION',
      informedEntities: [b.entity({ directionId: 0, routeId: route.id, routeType: 4, stopId: stop1.id })],
    });
    const schedule = b.schedule({ tripId: rep.id, stopId: stop1.id, departureTime: NOW + 5 * MIN, stopHeadsign: 'Central Wharf' });
    for (const context of NOT_FILTERED) {
      expect(
        fmt(
          leaf({
            lineOrRoute: routeOf(route),
            stop: stop1,
            direction: directionFor(0, route),
            routePatterns: [rp1, rp2],
            stopIds: [stop1.id],
            upcomingTrips: [b.upcomingTrip({ schedule })],
            alertsHere: [alert],
            context,
          }),
          b,
        ),
      ).toEqual(single(null, null, disruption(alert, 'alert-large-ferry-suspension')));
    }
  });

  it('filters alerts by trip', () => {
    const b = createBuilder();
    const route = b.route();
    const [trip1, trip2, trip3] = [b.trip(), b.trip(), b.trip()];
    const general = b.alert({ informedEntities: [b.entity({ activities: ['BOARD'] })] });
    const t1 = b.alert({ informedEntities: [b.entity({ activities: ['BOARD'], tripId: trip1.id })] });
    const t2 = b.alert({ informedEntities: [b.entity({ activities: ['BOARD'], tripId: trip2.id })] });
    const l = leaf({
      lineOrRoute: routeOf(route),
      stop: b.stop(),
      direction: directionFor(0, route),
      alertsHere: [general, t1, t2],
      alertsDownstream: [general, t1, t2],
      context: 'stopDetailsFiltered',
    });
    expect(leafAlertsHere(l)).toEqual([general, t1, t2]);
    expect(leafAlertsHere(l, trip1.id)).toEqual([general, t1]);
    expect(leafAlertsHere(l, trip2.id)).toEqual([general, t2]);
    expect(leafAlertsHere(l, trip3.id)).toEqual([general]);
    expect(leafAlertsDownstream(l)).toEqual([general, t1, t2]);
    expect(leafAlertsDownstream(l, trip1.id)).toEqual([general, t1]);
    expect(leafAlertsDownstream(l, trip3.id)).toEqual([general]);
  });
});

describe('LeafFormat.noPredictionsStatus', () => {
  const trip = (): FormattedTrip => {
    const b = createBuilder();
    return ft({ id: 'x', trip: b.trip(), schedule: null, prediction: null, vehicle: null, predictionStop: null }, 1, { kind: 'minutes', minutes: 15, last: false }, false);
  };
  const rows = (...r: [string, UpcomingFormat][]): LeafFormat => ({
    kind: 'branched',
    rows: r.map(([headsign, format], i) => ({ id: String(i), route: null, headsign, format })),
    secondaryAlert: null,
  });

  it('single returns status if no predictions', () => {
    for (const n of [{ kind: 'predictionsUnavailable' }, { kind: 'serviceEndedToday' }, { kind: 'noSchedulesToday' }] as NoTripsFormat[]) {
      expect(noPredictionsStatus(single(null, null, noTrips(n)))).toEqual(n);
    }
  });

  it('branched returns the first status if no predictions', () => {
    expect(
      noPredictionsStatus(
        rows(['Headsign 2', { kind: 'loading' }], ['Headsign 1', noTrips({ kind: 'serviceEndedToday' })], ['Headsign 2', noTrips({ kind: 'predictionsUnavailable' })]),
      ),
    ).toEqual({ kind: 'serviceEndedToday' });
  });

  it('single returns null if predictions', () => {
    expect(noPredictionsStatus(single(null, null, some([trip()])))).toBeNull();
  });

  it('branched returns null if any predictions', () => {
    expect(
      noPredictionsStatus(rows(['Headsign 1', { kind: 'loading' }], ['Headsign 2', noTrips({ kind: 'noSchedulesToday' })], ['Headsign 3', some([trip()])])),
    ).toBeNull();
  });
});
