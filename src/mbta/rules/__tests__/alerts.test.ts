// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/AlertTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// recurrenceRange cases are not ported (Teal shows active periods directly).
import type { AlertSignificance, RouteType } from '@/mbta/model/types';
import { build, createBuilder } from '@/mbta/testing/builders';

import {
  alertIconName,
  alertsDownstreamForPatterns,
  alertState,
  allClear,
  anyEntityMatches,
  applicableAlerts,
  applicableAlertsAnyTime,
  downstreamAlertsAnyTime,
  effectLabel,
  elevatorAlerts,
  intrinsicSignificance,
  significanceAt,
  significanceRank,
  tripSpecificSignificance,
} from '../alerts';

const MIN = 60_000;
const HOUR = 60 * MIN;

const EFFECTS = [
  'ACCESS_ISSUE',
  'ADDITIONAL_SERVICE',
  'AMBER_ALERT',
  'BIKE_ISSUE',
  'CANCELLATION',
  'DELAY',
  'DETOUR',
  'DOCK_CLOSURE',
  'DOCK_ISSUE',
  'ELEVATOR_CLOSURE',
  'ESCALATOR_CLOSURE',
  'EXTRA_SERVICE',
  'FACILITY_ISSUE',
  'MODIFIED_SERVICE',
  'NO_SERVICE',
  'NOTICE',
  'OTHER_EFFECT',
  'PARKING_CLOSURE',
  'PARKING_ISSUE',
  'POLICY_CHANGE',
  'SCHEDULE_CHANGE',
  'SERVICE_CHANGE',
  'SHUTTLE',
  'SNOW_ROUTE',
  'STATION_CLOSURE',
  'STATION_ISSUE',
  'STOP_CLOSURE',
  'STOP_MOVE',
  'STOP_MOVED',
  'STOP_SHOVELING',
  'SUMMARY',
  'SUSPENSION',
  'TRACK_CHANGE',
  'UNKNOWN_EFFECT',
];

describe('Alert', () => {
  it('alert status is set properly', () => {
    expect(alertState(build.alert({ effect: 'STATION_CLOSURE' }))).toBe('suspension');
    expect(alertState(build.alert({ effect: 'SHUTTLE' }))).toBe('shuttle');
    expect(alertState(build.alert({ effect: 'DETOUR' }))).toBe('issue');
    expect(alertState(build.alert({ effect: 'PARKING_ISSUE' }))).toBe('issue');
  });

  it('alert significance is set properly', () => {
    for (const effect of EFFECTS) {
      const inherentlyStopSpecific = ['DOCK_CLOSURE', 'DOCK_ISSUE', 'STATION_CLOSURE', 'STATION_ISSUE', 'STOP_CLOSURE'].includes(effect);
      for (const specifiedStops of inherentlyStopSpecific ? [true] : [false, true]) {
        const alert = build.alert({ effect, informedEntities: [build.entity({ activities: [], stopId: specifiedStops ? 'stop' : null })] });
        const expected: AlertSignificance =
          effect === 'DETOUR' || effect === 'SNOW_ROUTE'
            ? specifiedStops
              ? 'major'
              : 'secondary'
            : (
                {
                  DOCK_CLOSURE: 'major',
                  ELEVATOR_CLOSURE: 'accessibility',
                  SERVICE_CHANGE: 'secondary',
                  SHUTTLE: 'major',
                  STATION_CLOSURE: 'major',
                  STOP_CLOSURE: 'major',
                  SUSPENSION: 'major',
                  CANCELLATION: 'minor',
                  TRACK_CHANGE: 'minor',
                } as Record<string, AlertSignificance>
              )[effect] ?? 'none';
        expect([effect, specifiedStops, intrinsicSignificance(alert)]).toEqual([effect, specifiedStops, expected]);
      }
    }
  });

  it('alert significance for delay alerts', () => {
    const delay = (severity: number, routeType: RouteType | null, cause: string | null = null) =>
      build.alert({ effect: 'DELAY', severity, cause, informedEntities: routeType === null ? [] : [build.entity({ activities: [], stopId: 'stop', routeType })] });
    expect(intrinsicSignificance(delay(10, 0))).toBe('minor');
    expect(intrinsicSignificance(delay(10, 2))).toBe('minor');
    expect(intrinsicSignificance(delay(10, 4))).toBe('minor');
    expect(intrinsicSignificance(delay(1, null, 'SINGLE_TRACKING'))).toBe('minor');
    expect(intrinsicSignificance(delay(0, 0))).toBe('none');
    expect(intrinsicSignificance(delay(10, 3))).toBe('none');
  });

  it('alert significance limited for upcoming and past alerts', () => {
    const start = Date.now();
    const end = start + 2 * HOUR;
    const alert = build.alert({ effect: 'SUSPENSION', activePeriods: [{ start, end }] });
    expect(intrinsicSignificance(alert)).toBe('major');
    expect(significanceAt(alert, start - 25 * HOUR)).toBe('none');
    expect(significanceAt(alert, start - 12 * HOUR)).toBe('secondary');
    expect(significanceAt(alert, start)).toBe('major');
    expect(significanceAt(alert, end + MIN)).toBe('major');
  });

  it('ranks significance', () => {
    expect((['none', 'minor', 'accessibility', 'secondary', 'major'] as AlertSignificance[]).map(significanceRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it('cancellations are major for the named trip only', () => {
    const alert = build.alert({ effect: 'CANCELLATION', informedEntities: [build.entity({ tripId: 't1' })] });
    expect(tripSpecificSignificance(alert, 't1')).toBe('major');
    expect(tripSpecificSignificance(alert, 't2')).toBeNull();
    expect(intrinsicSignificance(alert)).toBe('minor');
  });
});

describe('applicableAlerts', () => {
  it('filters alerts to matching stops routes and directions', () => {
    const b = createBuilder();
    const route = b.route();
    const stop = b.stop();
    const e = (o: { routeId?: string; stopId?: string; directionId?: 0 | 1 | null }) =>
      b.entity({ activities: ['BOARD'], routeId: o.routeId ?? route.id, stopId: o.stopId ?? stop.id, directionId: o.directionId === undefined ? 0 : o.directionId });
    const match = b.alert({ informedEntities: [e({})] });
    const matchNoDirection = b.alert({ informedEntities: [e({ directionId: null })] });
    const otherRoute = b.alert({ informedEntities: [e({ routeId: 'other_route' })] });
    const otherStop = b.alert({ informedEntities: [e({ stopId: 'other_stop' })] });
    const otherDirection = b.alert({ informedEntities: [e({ directionId: 1 })] });
    expect(
      applicableAlertsAnyTime([match, matchNoDirection, otherRoute, otherStop, otherDirection], {
        directionId: 0,
        routeIds: [route.id],
        routeType: route.type,
        stopIds: [stop.id],
      }),
    ).toEqual([match, matchNoDirection]);
  });

  it('filters applicable alerts', () => {
    const b = createBuilder();
    const stop = b.stop();
    const route = b.route({ sortOrder: 1 });
    const valid = b.alert({ effect: 'SUSPENSION', informedEntities: [b.entity({ routeId: route.id, routeType: route.type, stopId: stop.id })] });
    const invalid = b.alert({
      effect: 'SUSPENSION',
      informedEntities: [b.entity({ activities: ['EXIT', 'RIDE'], routeId: 'wrong', routeType: route.type, stopId: 'wrong' })],
    });
    expect(applicableAlertsAnyTime([valid, invalid], { directionId: 0, routeIds: [route.id], routeType: route.type, stopIds: [stop.id] })).toEqual([valid]);
  });

  it('filters out alerts without Board activity', () => {
    const b = createBuilder();
    const stop = b.stop();
    const route = b.route({ sortOrder: 1 });
    const alert = b.alert({
      effect: 'SUSPENSION',
      informedEntities: [b.entity({ activities: ['EXIT', 'RIDE'], routeId: route.id, routeType: route.type, stopId: stop.id })],
    });
    expect(applicableAlertsAnyTime([alert], { directionId: 0, routeIds: [route.id], routeType: route.type, stopIds: [stop.id] })).toEqual([]);
  });

  it('filters out alerts with non-matching route ID', () => {
    const b = createBuilder();
    const stop = b.stop();
    const route = b.route({ sortOrder: 1 });
    const alert = b.alert({ effect: 'SUSPENSION', informedEntities: [b.entity({ routeId: 'not matching', routeType: route.type, stopId: stop.id })] });
    expect(applicableAlertsAnyTime([alert], { directionId: 0, routeIds: [route.id], routeType: route.type, stopIds: [stop.id] })).toEqual([]);
  });

  it('filters out alerts with non-matching stop ID', () => {
    const b = createBuilder();
    const stop = b.stop();
    const route = b.route({ sortOrder: 1 });
    const alert = b.alert({ effect: 'SUSPENSION', informedEntities: [b.entity({ routeId: route.id, routeType: route.type, stopId: 'not matching' })] });
    expect(applicableAlertsAnyTime([alert], { directionId: 0, routeIds: [route.id], routeType: route.type, stopIds: [stop.id] })).toEqual([]);
  });

  it('filters out alerts with non-matching route type', () => {
    const b = createBuilder();
    const stop = b.stop();
    const route = b.route({ sortOrder: 1, type: 2 });
    const alert = b.alert({ effect: 'SUSPENSION', informedEntities: [b.entity({ routeType: route.type, stopId: stop.id })] });
    const otherMode = b.alert({ effect: 'SUSPENSION', informedEntities: [b.entity({ routeType: 3, stopId: stop.id })] });
    expect(applicableAlertsAnyTime([alert, otherMode], { directionId: 0, routeIds: [route.id], routeType: route.type, stopIds: [stop.id] })).toEqual([alert]);
  });

  it('filters to route only when not given set of stops', () => {
    const b = createBuilder();
    const route = b.route({ sortOrder: 1 });
    const other = b.route({ sortOrder: 1 });
    const alert = b.alert({
      effect: 'SUSPENSION',
      informedEntities: [b.entity({ activities: ['BOARD'], routeId: route.id, routeType: route.type, stopId: 'not matching' })],
    });
    const otherAlert = b.alert({
      effect: 'SUSPENSION',
      informedEntities: [b.entity({ activities: ['BOARD'], routeId: other.id, routeType: other.type, stopId: 'not matching' })],
    });
    expect(applicableAlertsAnyTime([alert, otherAlert], { directionId: 0, routeIds: [route.id], routeType: route.type })).toEqual([alert]);
  });

  it('the time-aware contract keeps active and soon-starting alerts only', () => {
    const b = createBuilder();
    const now = Date.now();
    const entity = [b.entity({ routeId: 'Red' })];
    const active = b.alert({ informedEntities: entity });
    const soon = b.alert({ informedEntities: entity, activePeriods: [{ start: now + 2 * HOUR, end: null }] });
    const later = b.alert({ informedEntities: entity, activePeriods: [{ start: now + 30 * HOUR, end: null }] });
    const ended = b.alert({ informedEntities: entity, activePeriods: [{ start: now - 3 * HOUR, end: now - HOUR }] });
    expect(applicableAlerts([active, soon, later, ended], { routeIds: ['Red'] }, now)).toEqual([active, soon]);
  });
});

describe('downstreamAlerts', () => {
  const ride = (b: ReturnType<typeof createBuilder>, effect: string, routeId: string, stopId: string, directionId: 0 | null, activities = ['RIDE']) =>
    b.alert({ effect, informedEntities: [b.entity({ activities, routeId, stopId, directionId })] });

  it('returns alerts for all downstream alerting stops', () => {
    const b = createBuilder();
    const route = b.route();
    const [target, boardStop, ride1, ride2] = [b.stop(), b.stop(), b.stop(), b.stop()];
    const alertRideTarget = ride(b, 'SERVICE_CHANGE', route.id, target.id, 0);
    const alertBoard = ride(b, 'SERVICE_CHANGE', route.id, boardStop.id, 0, ['BOARD']);
    const firstRide = ride(b, 'SERVICE_CHANGE', route.id, ride1.id, null);
    const secondRide = ride(b, 'SERVICE_CHANGE', route.id, ride2.id, null);
    const trip = b.trip({ routeId: route.id, directionId: 0, stopIds: [target.id, boardStop.id, ride1.id, ride2.id] });
    expect(downstreamAlertsAnyTime([alertRideTarget, alertBoard, firstRide, secondRide], trip, route.type, [target.id])).toEqual([firstRide, secondRide]);
  });

  it('returns alerts for all downstream alerting stops before suspension', () => {
    const b = createBuilder();
    const route = b.route();
    const [target, boardStop, s1, s2, s3] = [b.stop(), b.stop(), b.stop(), b.stop(), b.stop()];
    const alertRideTarget = ride(b, 'SERVICE_CHANGE', route.id, target.id, 0);
    const alertBoard = ride(b, 'SERVICE_CHANGE', route.id, boardStop.id, 0, ['BOARD']);
    const first = ride(b, 'SERVICE_CHANGE', route.id, s1.id, null);
    const second = ride(b, 'SUSPENSION', route.id, s2.id, null);
    const third = ride(b, 'SERVICE_CHANGE', route.id, s3.id, null);
    // As in the Kotlin test, the trip's last stop id is the third alert's id (so it never matches).
    const trip = b.trip({ routeId: route.id, directionId: 0, stopIds: [target.id, boardStop.id, s1.id, s2.id, third.id] });
    expect(downstreamAlertsAnyTime([alertRideTarget, alertBoard, first, second, third], trip, route.type, [target.id])).toEqual([first, second]);
  });

  it('returns mode-specific alert for first downstream alerting stop', () => {
    const b = createBuilder();
    const route = b.route();
    const [target, boardStop, s1, s2] = [b.stop(), b.stop(), b.stop(), b.stop()];
    const alert = b.alert({ effect: 'SERVICE_CHANGE', informedEntities: [b.entity({ activities: ['RIDE'], routeType: route.type, stopId: s1.id })] });
    const trip = b.trip({ routeId: route.id, directionId: 0, stopIds: [target.id, boardStop.id, s1.id, s2.id] });
    expect(downstreamAlertsAnyTime([alert], trip, route.type, [target.id])).toEqual([alert]);
  });

  it('excludes alerts affecting the target stop', () => {
    const b = createBuilder();
    const route = b.route();
    const [target, d1, d2] = [b.stop(), b.stop(), b.stop()];
    const all = b.alert({
      effect: 'SERVICE_CHANGE',
      informedEntities: [target, d1, d2].map((s) => b.entity({ activities: ['BOARD', 'RIDE'], routeId: route.id, stopId: s.id, directionId: 0 })),
    });
    const d2Only = ride(b, 'SERVICE_CHANGE', route.id, d2.id, 0);
    const trip = b.trip({ routeId: route.id, directionId: 0, stopIds: [target.id, d1.id, d2.id] });
    expect(downstreamAlertsAnyTime([all, d2Only], trip, route.type, [target.id])).toEqual([d2Only]);
  });

  it('ignores alert without stops specified', () => {
    const b = createBuilder();
    const route = b.route();
    const [target, next] = [b.stop(), b.stop()];
    const alert = b.alert({ effect: 'SERVICE_CHANGE', informedEntities: [b.entity({ activities: ['BOARD'], routeId: route.id })] });
    const trip = b.trip({ routeId: route.id, directionId: 0, stopIds: [target.id, next.id] });
    expect(downstreamAlertsAnyTime([alert], trip, route.type, [target.id])).toEqual([]);
  });
});

describe('elevator and downstream-by-pattern alerts', () => {
  it('elevatorAlerts matches relevant accessibility alerts', () => {
    const b = createBuilder();
    const stop = b.stop();
    const elevator = b.alert({ effect: 'ELEVATOR_CLOSURE', informedEntities: [b.entity({ activities: ['USING_WHEELCHAIR'], stopId: stop.id })] });
    const service = b.alert({ effect: 'NO_SERVICE', informedEntities: [b.entity({ activities: ['BOARD'], stopId: stop.id })] });
    expect(elevatorAlerts([service, elevator], [stop.id])).toEqual([elevator]);
  });

  it('alertsDownstreamForPatterns returns alert for downstream stop', () => {
    const b = createBuilder();
    const route = b.route();
    const [park, alewife, shawmut, ashmont, quincyAdams, braintree] = ['park', 'alewife', 'shawmut', 'ashmont', 'quincy_adams', 'braintree'].map((id) => b.stop({ id }));
    const pat = (directionId: 0 | 1, headsign: string, stops: typeof park[]) =>
      b.pattern(route, { directionId, representativeTrip: { directionId, headsign, stopIds: stops.map((s) => s.id) } });
    const ashmontRp = pat(0, 'Ashmont', [alewife, park, shawmut, ashmont]);
    const braintreeRp = pat(0, 'Braintree', [alewife, park, quincyAdams, braintree]);
    const alewifeRp = pat(1, 'Alewife', [braintree, quincyAdams, park, alewife]);
    const at = (effect: string, stopId: string, id?: string) =>
      b.alert({ id, effect, informedEntities: [b.entity({ activities: ['BOARD', 'RIDE'], routeId: route.id, stopId })] });
    const shawmutClosure = at('STATION_CLOSURE', shawmut.id);
    const ashmontShuttle = at('SHUTTLE', ashmont.id);
    const alewifeShuttle = at('SHUTTLE', alewife.id, 'alewife_alert_id');
    const parkShuttle = at('SHUTTLE', park.id, 'park_alert_id');
    const g = b.global({ patternIdsByStop: { [park.id]: [ashmontRp.id, braintreeRp.id] } });
    const alerts = [ashmontShuttle, shawmutClosure, parkShuttle, alewifeShuttle];
    expect(alertsDownstreamForPatterns(alerts, [ashmontRp, braintreeRp], route.type, [park.id], g.trips)).toEqual([shawmutClosure, ashmontShuttle]);
    expect(alertsDownstreamForPatterns(alerts, [alewifeRp], route.type, [park.id], g.trips)).toEqual([alewifeShuttle]);
  });

  it('alertsDownstreamForPatterns excludes alert for stop on canonical-only pattern', () => {
    const b = createBuilder();
    const route = b.route();
    const target = b.stop({ id: 'target' });
    const closure = b.stop({ id: 'longterm closure' });
    const still = b.stop({ id: 'still downstream' });
    const canonicalOnly = b.pattern(route, {
      directionId: 0,
      typicality: 'canonical_only',
      representativeTrip: { directionId: 0, headsign: 'Still Downstream', stopIds: [target.id, closure.id, still.id] },
    });
    const typical = b.pattern(route, { directionId: 0, representativeTrip: { directionId: 0, headsign: 'Still Downstream', stopIds: [target.id, still.id] } });
    const alert = b.alert({ id: 'alert_id', effect: 'STOP_CLOSURE', informedEntities: [b.entity({ activities: ['BOARD', 'EXIT'], routeId: route.id, stopId: closure.id })] });
    expect(alertsDownstreamForPatterns([alert], [typical, canonicalOnly], 1, [target.id], b.global().trips)).toEqual([]);
  });

  it('allClear correct for active period', () => {
    const now = Date.now();
    expect(allClear(build.alert({ activePeriods: [{ start: now - 5 * MIN, end: now + 5 * MIN }] }), now)).toBe(false);
    expect(allClear(build.alert({ activePeriods: [{ start: now - 10 * MIN, end: now - 5 * MIN }] }), now)).toBe(true);
  });

  it('anyInformedEntityMatches route', () => {
    const alert = build.alert({ informedEntities: [build.entity({ activities: ['BOARD'], routeType: 3 })] });
    expect(anyEntityMatches(alert, { routeIds: ['1'], routeType: 3 })).toBe(true);
    expect(anyEntityMatches(alert, { routeIds: ['CR'], routeType: 2 })).toBe(false);
  });
});

describe('alert presentation', () => {
  it('names icons by state and mode', () => {
    const b = createBuilder();
    expect(alertIconName(b.alert({ effect: 'SHUTTLE' }), b.route({ id: 'Red', type: 1 }))).toBe('alert-large-red-shuttle');
    expect(alertIconName(b.alert({ effect: 'ELEVATOR_CLOSURE' }), null)).toBe('alert-borderless-elevator');
    expect(alertIconName(b.alert({ effect: 'STOP_CLOSURE' }), b.route({ id: 'Green-C', type: 0 }))).toBe('alert-large-green-suspension');
  });

  it('labels effects', () => {
    expect(effectLabel('SHUTTLE')).toBe('Shuttle bus');
    expect(effectLabel('SUSPENSION')).toBe('Suspension');
    expect(effectLabel('STATION_CLOSURE')).toBe('Stop skipped');
    expect(effectLabel('DOCK_CLOSURE')).toBe('Dock closed');
    expect(effectLabel('SOMETHING_NEW')).toBe('Something new');
  });
});
