// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/UpcomingTripTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Display cases duplicate TripInstantDisplayTest and are covered there; join, filters, subway
// schedule hiding and last-trip handling are ported here.
import { build, createBuilder } from '@/mbta/testing/builders';

import {
  buildUpcomingTrips,
  display,
  formatUpcomingTrip,
  headsign,
  isArrivalOnly,
  isLastTripFlags,
  makeUpcomingTrip,
  upcomingRouteId,
  upcomingStopSequence,
  upcomingTime,
  withFormat,
} from '../upcomingTrip';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);

describe('UpcomingTrip display', () => {
  it('scheduled trip cancelled shows Cancelled on CR/ferry', () => {
    const t = makeUpcomingTrip(
      build.trip(),
      build.schedule({ departureTime: NOW + 15 * MIN }),
      build.prediction({ scheduleRelationship: 'CANCELLED' }),
    );
    for (const routeType of [2, 4] as const) {
      expect(display(t, NOW, routeType, 'nearby', false)).toEqual({ kind: 'cancelled', scheduledTime: NOW + 15 * MIN });
    }
  });

  it('schedule instead of prediction', () => {
    const t = makeUpcomingTrip(build.trip(), build.schedule({ departureTime: NOW + 15 * MIN }));
    expect(display(t, NOW, 1, 'nearby', true)).toEqual({ kind: 'scheduleMinutes', minutes: 15, last: true });
  });

  it('hides scheduled times on subway but not on bus (API best practice)', () => {
    const t = makeUpcomingTrip(build.trip(), build.schedule({ departureTime: NOW + 15 * MIN }));
    expect(formatUpcomingTrip(t, NOW, 1, 'nearby', true, false)).toBeNull();
    expect(formatUpcomingTrip(t, NOW, 3, 'nearby', false, false)?.format).toEqual({ kind: 'scheduleMinutes', minutes: 15, last: false });
  });
});

describe('buildUpcomingTrips (tripsFromData)', () => {
  it('matches things up', () => {
    const b = createBuilder();
    const trip1 = b.trip();
    const trip1Schedule = b.schedule({ stopId: 'stop1', tripId: trip1.id, stopSequence: 1 });
    const trip1Prediction = b.prediction({ stopId: 'stop1', tripId: trip1.id, stopSequence: 1 });
    const trip2 = b.trip();
    const trip2Schedule = b.schedule({ stopId: 'stop2', tripId: trip2.id, stopSequence: 2 });
    const trip3 = b.trip();
    const trip3Prediction = b.prediction({ stopId: 'stop3', tripId: trip3.id, stopSequence: 3 });

    const result = buildUpcomingTrips(b.global(), b.scheduleSet(), b.liveDepartures(), undefined, { now: NOW });
    expect(result).toEqual([
      makeUpcomingTrip(trip1, trip1Schedule, trip1Prediction),
      makeUpcomingTrip(trip2, trip2Schedule),
      makeUpcomingTrip(trip3, null, trip3Prediction),
    ]);
  });

  it('ignores stop sequence on cancelled trips', () => {
    const b = createBuilder();
    const trip = b.trip();
    const schedule = b.schedule({ stopId: 'stop1', tripId: trip.id, stopSequence: 1 });
    const prediction = b.prediction({ stopId: 'stop1', tripId: trip.id, stopSequence: 2, scheduleRelationship: 'CANCELLED' });
    expect(buildUpcomingTrips(b.global(), b.scheduleSet(), b.liveDepartures(), undefined, { now: NOW })).toEqual([
      makeUpcomingTrip(trip, schedule, prediction),
    ]);
  });

  it('preserves multi-route trips on each route', () => {
    const b = createBuilder();
    const route1 = b.route();
    const route2 = b.route();
    const trip = b.trip({ routeId: route1.id });
    const sched1 = b.schedule({ trip });
    const sched2 = b.schedule({ trip, routeId: route2.id });
    const pred1 = b.predictionFor(sched1);
    const pred2 = b.predictionFor(sched2);
    expect(
      buildUpcomingTrips(b.global(), b.scheduleSet([sched1, sched2]), { predictions: [pred1, pred2], trips: b.objects.trips, vehicles: {} }, undefined, {
        now: NOW,
      }),
    ).toEqual([makeUpcomingTrip(trip, sched1, pred1), makeUpcomingTrip(trip, sched2, pred2)]);
  });

  it('joins platform predictions to schedules through the parent station', () => {
    const b = createBuilder();
    const station = b.stop({ id: 'place-pktrm', locationType: 1 });
    const platformA = b.childStop(station, { id: '70075' });
    const platformB = b.childStop(station, { id: '70076' });
    const trip = b.trip();
    // Schedules may name the logical platform, predictions the physical one.
    const schedule = b.schedule({ trip, stopId: platformA.id, stopSequence: 70, departureTime: NOW + 5 * MIN });
    const prediction = b.prediction({ trip, stopId: platformB.id, stopSequence: 70, departureTime: NOW + 6 * MIN });
    const [joined] = buildUpcomingTrips(b.global(), b.scheduleSet(), b.liveDepartures(), undefined, { now: NOW });
    expect(joined.schedule).toBe(schedule);
    expect(joined.prediction).toBe(prediction);
    expect(joined.predictionStop).toBe(platformB);
  });

  it('drops schedule-only trips in the past but keeps predicted ones', () => {
    const b = createBuilder();
    const past = b.trip();
    b.schedule({ trip: past, stopId: 's', departureTime: NOW - 5 * MIN });
    const predicted = b.trip();
    const s2 = b.schedule({ trip: predicted, stopId: 's', departureTime: NOW - 5 * MIN, stopSequence: 1 });
    b.predictionFor(s2, { departureTime: NOW + MIN });
    const result = buildUpcomingTrips(b.global(), b.scheduleSet(), b.liveDepartures(), undefined, { now: NOW });
    expect(result.map((t) => t.trip.id)).toEqual([predicted.id]);
  });

  it('applies stop, route and direction filters', () => {
    const b = createBuilder();
    const station = b.stop({ id: 'station', locationType: 1 });
    const platform = b.childStop(station, { id: 'p1' });
    const t0 = b.trip({ routeId: 'Red', directionId: 0 });
    const t1 = b.trip({ routeId: 'Red', directionId: 1 });
    const t2 = b.trip({ routeId: 'Orange', directionId: 0 });
    for (const trip of [t0, t1, t2]) b.prediction({ trip, stopId: platform.id, departureTime: NOW + MIN });
    const g = b.global();
    const live = b.liveDepartures();
    expect(buildUpcomingTrips(g, null, live, { stopIds: ['station'], routeIds: ['Red'], directionId: 0 }, { now: NOW }).map((t) => t.trip.id)).toEqual([t0.id]);
    expect(buildUpcomingTrips(g, null, live, { stopIds: ['elsewhere'] }, { now: NOW })).toEqual([]);
  });

  it('attaches an alert naming the trip at this stop', () => {
    const b = createBuilder();
    const station = b.stop({ id: 'station', locationType: 1 });
    const platform = b.childStop(station);
    const trip = b.trip();
    b.schedule({ trip, stopId: platform.id, departureTime: NOW + 10 * MIN });
    const alert = b.alert({ effect: 'SHUTTLE', informedEntities: [b.entity({ tripId: trip.id, stopId: 'station' })] });
    const [t] = buildUpcomingTrips(b.global(), b.scheduleSet(), null, undefined, { now: NOW, alerts: [alert] });
    expect(t.alert).toBe(alert);
  });

  it('takes the first alert in list order and matches platform entities through the parent', () => {
    const b = createBuilder();
    const station = b.stop({ id: 'station', locationType: 1 });
    const platform = b.childStop(station);
    const trip = b.trip();
    const other = b.trip();
    b.schedule({ trip, stopId: platform.id, departureTime: NOW + 10 * MIN });
    b.schedule({ trip: other, stopId: platform.id, departureTime: NOW + 12 * MIN });
    const elsewhere = b.alert({ informedEntities: [b.entity({ tripId: trip.id, stopId: 'elsewhere' })] });
    const anyStop = b.alert({ informedEntities: [b.entity({ tripId: trip.id, stopId: null })] });
    const first = b.alert({ effect: 'SHUTTLE', informedEntities: [b.entity({ tripId: trip.id, stopId: platform.id })] });
    const second = b.alert({ effect: 'SUSPENSION', informedEntities: [b.entity({ tripId: trip.id, stopId: 'station' })] });
    const result = buildUpcomingTrips(b.global(), b.scheduleSet(), null, undefined, { now: NOW, alerts: [elsewhere, anyStop, first, second] });
    expect(result.map((t) => [t.trip.id, t.alert?.id ?? null])).toEqual([
      [trip.id, first.id],
      [other.id, null],
    ]);
  });

  it('reuses the join for the same inputs at later times, and never for earlier ones', () => {
    const b = createBuilder();
    const soon = b.trip();
    const later = b.trip();
    b.schedule({ trip: soon, stopId: 's', departureTime: NOW + 5 * MIN });
    b.schedule({ trip: later, stopId: 's', departureTime: NOW + 20 * MIN });
    const g = b.global();
    const s = b.scheduleSet();
    const ids = (now: number) => buildUpcomingTrips(g, s, null, undefined, { now }).map((t) => t.trip.id);
    expect(ids(NOW)).toEqual([soon.id, later.id]);
    expect(ids(NOW + 7 * MIN)).toEqual([later.id]);
    expect(ids(NOW + 30 * MIN)).toEqual([]);
    expect(ids(NOW)).toEqual([soon.id, later.id]);
    // A join made at a later time lacks rows that were still upcoming earlier: not reused.
    const s2 = b.scheduleSet();
    expect(buildUpcomingTrips(g, s2, null, undefined, { now: NOW + 7 * MIN }).map((t) => t.trip.id)).toEqual([later.id]);
    expect(buildUpcomingTrips(g, s2, null, undefined, { now: NOW }).map((t) => t.trip.id)).toEqual([soon.id, later.id]);
    // The returned list is a copy: changing it does not affect the next call.
    buildUpcomingTrips(g, s, null, undefined, { now: NOW }).pop();
    expect(ids(NOW)).toEqual([soon.id, later.id]);
  });
});

describe('UpcomingTrip fields', () => {
  it('time uses schedule time if there is no prediction', () => {
    const trip = build.trip();
    const normal = build.schedule({ arrivalTime: NOW + 2 * MIN, departureTime: NOW + 5 * MIN });
    const arrivalOnly = build.schedule({ arrivalTime: NOW + 3 * MIN });
    const departureOnly = build.schedule({ departureTime: NOW + 4 * MIN });
    expect(upcomingTime(makeUpcomingTrip(trip, normal))).toBe(normal.arrivalTime);
    expect(upcomingTime(makeUpcomingTrip(trip, arrivalOnly))).toBe(arrivalOnly.arrivalTime);
    expect(upcomingTime(makeUpcomingTrip(trip, departureOnly))).toBe(departureOnly.departureTime);
  });

  it('time uses prediction time whether there is a schedule or not', () => {
    const trip = build.trip();
    const schedule = build.schedule({ arrivalTime: NOW + 2 * MIN, departureTime: NOW + 5 * MIN });
    const normal = build.prediction({ arrivalTime: NOW + 2.5 * MIN, departureTime: NOW + 4.5 * MIN });
    const arrivalOnly = build.prediction({ arrivalTime: NOW + 1.8 * MIN });
    const departureOnly = build.prediction({ departureTime: NOW + 4.2 * MIN });
    for (const p of [normal, arrivalOnly, departureOnly]) {
      const expected = p.arrivalTime ?? p.departureTime;
      expect(upcomingTime(makeUpcomingTrip(trip, null, p))).toBe(expected);
      expect(upcomingTime(makeUpcomingTrip(trip, schedule, p))).toBe(expected);
    }
  });

  it('time falls back to schedule if prediction is skipped or cancelled', () => {
    const trip = build.trip();
    const schedule = build.schedule({ arrivalTime: NOW + 2 * MIN, departureTime: NOW + 5 * MIN });
    for (const rel of ['SKIPPED', 'CANCELLED'] as const) {
      expect(upcomingTime(makeUpcomingTrip(trip, schedule, build.prediction({ scheduleRelationship: rel })))).toBe(schedule.arrivalTime);
    }
  });

  it('isArrivalOnly handles schedule without prediction', () => {
    const trip = build.trip();
    expect(isArrivalOnly(makeUpcomingTrip(trip, build.schedule({ arrivalTime: NOW })))).toBe(true);
    expect(isArrivalOnly(makeUpcomingTrip(trip, build.schedule({ arrivalTime: NOW, departureTime: NOW })))).toBe(false);
    expect(isArrivalOnly(makeUpcomingTrip(trip, build.schedule()))).toBeNull();
  });

  it('isArrivalOnly handles prediction without schedule', () => {
    const trip = build.trip();
    expect(isArrivalOnly(makeUpcomingTrip(trip, null, build.prediction({ arrivalTime: NOW })))).toBe(true);
    expect(isArrivalOnly(makeUpcomingTrip(trip, null, build.prediction()))).toBeNull();
    expect(isArrivalOnly(makeUpcomingTrip(trip, null, build.prediction({ departureTime: NOW })))).toBe(false);
  });

  it('isArrivalOnly handles schedule alongside prediction (schedule wins)', () => {
    const trip = build.trip();
    const sArr = build.schedule({ arrivalTime: NOW });
    const sNormal = build.schedule({ departureTime: NOW });
    const sNeither = build.schedule();
    const pArr = build.prediction({ arrivalTime: NOW });
    const pNormal = build.prediction({ departureTime: NOW });
    const pNeither = build.prediction();
    for (const p of [pArr, pNormal, pNeither]) {
      expect(isArrivalOnly(makeUpcomingTrip(trip, sArr, p))).toBe(true);
      expect(isArrivalOnly(makeUpcomingTrip(trip, sNormal, p))).toBe(false);
      expect(isArrivalOnly(makeUpcomingTrip(trip, sNeither, p))).toBeNull();
    }
  });

  it('stopSequence prefers the schedule, then the prediction, else null', () => {
    const trip = build.trip();
    const s1 = build.schedule({ stopSequence: 1 });
    const s2 = build.schedule({ stopSequence: 2 });
    const p1 = build.prediction({ stopSequence: 1 });
    const p2 = build.prediction({ stopSequence: 2 });
    expect(upcomingStopSequence(makeUpcomingTrip(trip, s1, p1))).toBe(1);
    expect(upcomingStopSequence(makeUpcomingTrip(trip, s1, p2))).toBe(1);
    expect(upcomingStopSequence(makeUpcomingTrip(trip, s2, p1))).toBe(2);
    expect(upcomingStopSequence(makeUpcomingTrip(trip, build.schedule({ stopSequence: 90 })))).toBe(90);
    expect(upcomingStopSequence(makeUpcomingTrip(trip, null, build.prediction({ stopSequence: 120 })))).toBe(120);
    expect(upcomingStopSequence(makeUpcomingTrip(trip))).toBeNull();
  });

  it('tripHeadsign overrides stopHeadsign, which overrides the trip headsign', () => {
    const trip = build.trip({ headsign: 'Trip Headsign' });
    const schedule = build.schedule({ stopHeadsign: 'Stop Headsign' });
    expect(headsign(makeUpcomingTrip(trip, schedule, build.prediction({ tripHeadsign: 'Prediction Headsign' })))).toBe('Prediction Headsign');
    expect(headsign(makeUpcomingTrip(trip, schedule))).toBe('Stop Headsign');
    expect(headsign(makeUpcomingTrip(trip))).toBe('Trip Headsign');
  });

  it('routeId prioritizes prediction then schedule then trip', () => {
    const trip = build.trip({ routeId: 'route3' });
    const schedule = build.schedule({ routeId: 'route2' });
    const prediction = build.prediction({ routeId: 'route1' });
    expect(upcomingRouteId(makeUpcomingTrip(trip))).toBe('route3');
    expect(upcomingRouteId(makeUpcomingTrip(trip, null, prediction))).toBe('route1');
    expect(upcomingRouteId(makeUpcomingTrip(trip, schedule))).toBe('route2');
    expect(upcomingRouteId(makeUpcomingTrip(trip, schedule, prediction))).toBe('route1');
  });
});

describe('last trip (UpcomingTrip.withFormat)', () => {
  it('subway uses prediction.last_trip', () => {
    const trip = build.trip();
    const a = makeUpcomingTrip(trip, null, build.prediction({ departureTime: NOW + 5 * MIN, lastTrip: false, stopSequence: 1 }));
    const b2 = makeUpcomingTrip(trip, null, build.prediction({ departureTime: NOW + 9 * MIN, lastTrip: true, stopSequence: 2 }));
    expect(withFormat([a, b2], NOW, { id: 'Red', type: 1 }, 'nearby').map((f) => f.format?.lastTrip)).toEqual([false, true]);
    expect(isLastTripFlags([a, b2], 1)).toEqual([false, true]);
  });

  it('non-subway flags the final trip, moved off a cancelled final trip', () => {
    const b = createBuilder();
    const trip1 = b.trip();
    const trip2 = b.trip();
    const s1 = b.schedule({ trip: trip1, departureTime: NOW + 5 * MIN });
    const s2 = b.schedule({ trip: trip2, departureTime: NOW + 20 * MIN });
    const t1 = makeUpcomingTrip(trip1, s1, b.predictionFor(s1, { departureTime: NOW + 5 * MIN }));
    const t2 = makeUpcomingTrip(trip2, s2, b.predictionFor(s2, { scheduleRelationship: 'CANCELLED' }));
    const formatted = withFormat([t1, t2], NOW, { id: 'CR-Fitchburg', type: 2 }, 'stopDetailsFiltered');
    expect(formatted.map((f) => f.format?.lastTrip)).toEqual([true, false]);
    expect(formatted[1].format?.format.kind).toBe('cancelled');
    expect(isLastTripFlags([t1, t2], 2)).toEqual([true, false]);
  });
});
