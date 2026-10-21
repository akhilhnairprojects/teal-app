// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/TripDetailsStopListTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { Alert, Prediction, Route, Schedule, Stop, Trip, Vehicle } from '@/mbta/model/types';
import { createBuilder } from '@/mbta/testing/builders';
import { easternInstant } from '@/mbta/time/eastern';

import {
  contextualTrip,
  formatEntry,
  splitForTarget,
  tripDetailsStopListFromPieces,
  type Disruption,
  type StopListEntry,
  type TripDetailsStopList,
  type TripSchedules,
} from '../tripDetailsStopList';

const MIN = 60_000;

/** The Kotlin test DSL: stops named like 'A1' are children of 'A', created on first use. */
function harness() {
  const b = createBuilder();
  const o = b.objects;
  let currentTrip: Trip | null = null;

  function stop(id: string): Stop {
    if (o.stops[id]) return o.stops[id];
    const m = /^([A-Za-z]+)\d+$/.exec(id);
    if (m) return b.childStop(stop(m[1]), { id });
    return b.stop({ id });
  }
  const trip = (t: Partial<Trip> = {}) => (currentTrip = b.trip(t));
  const defaultTrip = (): Trip => ({ id: 'trip', routeId: '', directionId: 0, headsign: '', routePatternId: null, shapeId: null, stopIds: null });

  const schedule = (stopId: string, stopSequence: number, routeId = ''): Schedule =>
    b.schedule({ stopId: stop(stopId).id, stopSequence, routeId, ...(currentTrip ? { tripId: currentTrip.id } : {}) });
  const prediction = (stopId: string, stopSequence: number, routeId = '', time: number | null = null): Prediction =>
    b.prediction({
      stopId: stop(stopId).id,
      stopSequence,
      routeId,
      departureTime: time,
      ...(currentTrip ? { tripId: currentTrip.id, directionId: currentTrip.directionId } : {}),
    });
  const pattern = (id: string, route: Route, typicality: 'typical' | 'atypical' | 'canonical_only' = 'typical') =>
    b.pattern(route, { id, typicality });
  const alert = (effect: string, o: Partial<Alert> = {}) => b.alert({ effect, ...o });

  function entry(
    stopId: string,
    stopSequence: number,
    e: {
      disruption?: Disruption | null;
      alert?: Alert;
      schedule?: Schedule;
      prediction?: Prediction;
      vehicle?: Vehicle;
      routes?: Route[];
    } = {},
  ): StopListEntry {
    return {
      stop: stop(stopId),
      stopSequence,
      disruption: e.disruption ?? (e.alert ? { kind: 'disruption', alert: e.alert, iconName: 'alert-borderless-issue' } : null),
      schedule: e.schedule ?? null,
      prediction: e.prediction ?? null,
      predictionStop: e.prediction ? (o.stops[e.prediction.stopId] ?? null) : null,
      vehicle: e.vehicle ?? null,
      routes: e.routes ?? [],
      elevatorAlerts: [],
    };
  }

  function stopListOf(entries: StopListEntry[], x: { terminalStop?: StopListEntry; trip?: Trip } = {}): TripDetailsStopList {
    return { trip: x.trip ?? currentTrip ?? defaultTrip(), stops: entries, startTerminalEntry: x.terminalStop ?? entries[0] ?? null };
  }

  const global = (patternIdsByStop: Record<string, string[]> = {}) => b.global({ patternIdsByStop });

  function fromPieces(
    tripSchedules: TripSchedules | null,
    withPredictions: boolean,
    x: { vehicle?: Vehicle | null; patternIdsByStop?: Record<string, string[]>; trip?: Trip } = {},
  ) {
    return tripDetailsStopListFromPieces(
      x.trip ?? currentTrip ?? defaultTrip(),
      tripSchedules,
      withPredictions ? b.liveDepartures() : null,
      x.vehicle ?? null,
      Object.values(o.alerts),
      global(x.patternIdsByStop),
    );
  }

  const schedulesOf = (...s: Schedule[]): TripSchedules => ({ kind: 'schedules', schedules: s });
  const stopIdsOf = (...ids: string[]): TripSchedules => ({ kind: 'stopIds', stopIds: ids });

  return { b, o, stop, trip, schedule, prediction, pattern, alert, entry, stopListOf, global, fromPieces, schedulesOf, stopIdsOf };
}

describe('TripDetailsStopList.fromPieces', () => {
  it('test harness generates parent stops automatically', () => {
    const h = harness();
    expect(h.stop('A1').parentStationId).toBe('A');
  });

  it('returns empty list with no data', () => {
    const h = harness();
    const route = h.b.route();
    const trip = h.trip({ routeId: route.id });
    expect(h.fromPieces(null, false)).toEqual({ trip, stops: [], startTerminalEntry: null });
  });

  it('returns schedules when there are no predictions', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const s1 = h.schedule('A', 10, route.id);
    const s2 = h.schedule('B', 20, route.id);
    const s3 = h.schedule('C', 30, route.id);
    expect(h.fromPieces(h.schedulesOf(s1, s2, s3), false)).toEqual(
      h.stopListOf([h.entry('A', 10, { schedule: s1 }), h.entry('B', 20, { schedule: s2 }), h.entry('C', 30, { schedule: s3 })]),
    );
  });

  it('numbers scheduled stop ids with no predictions from 997', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const s1 = h.schedule('A', 10, route.id);
    const s2 = h.schedule('B', 20, route.id);
    const s3 = h.schedule('C', 30, route.id);
    expect(h.fromPieces(h.stopIdsOf(s1.stopId, s2.stopId, s3.stopId), false)).toEqual(
      h.stopListOf([h.entry('A', 997), h.entry('B', 998), h.entry('C', 999)]),
    );
  });

  it("doesn't include disruption on different route when no schedules or predictions", () => {
    const h = harness();
    h.b.route({ id: 'Red' });
    const trip = h.trip({ routeId: 'Red', directionId: 1, stopIds: ['A', 'B', 'C'] });
    h.stop('A');
    h.stop('B');
    h.stop('C');
    h.alert('SUSPENSION', { informedEntities: [h.b.entity({ directionId: 1, routeId: 'Silver', stopId: 'A' })] });
    expect(h.fromPieces(h.stopIdsOf('A', 'B', 'C'), false, { trip })).toEqual(
      h.stopListOf([h.entry('A', 997, { disruption: null }), h.entry('B', 998), h.entry('C', 999)]),
    );
  });

  it('returns empty list with unavailable schedules and no predictions', () => {
    const h = harness();
    const route = h.b.route();
    const trip = h.trip({ routeId: route.id });
    expect(h.fromPieces({ kind: 'unknown' }, false)).toEqual({ trip, stops: [], startTerminalEntry: null });
  });

  it('returns null while alerts are loading', () => {
    const h = harness();
    const route = h.b.route();
    const trip = h.trip({ routeId: route.id });
    expect(tripDetailsStopListFromPieces(trip, null, null, null, null, h.global())).toBeNull();
  });

  it('preserves predictions with no schedules', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    expect(h.fromPieces(null, true)).toEqual(
      h.stopListOf([h.entry('A', 10, { prediction: p1 }), h.entry('B', 20, { prediction: p2 }), h.entry('C', 30, { prediction: p3 })]),
    );
  });

  it('matches full set of predictions to full set of schedules', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const s1 = h.schedule('A', 10, route.id);
    const s2 = h.schedule('B', 20, route.id);
    const s3 = h.schedule('C', 30, route.id);
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    expect(h.fromPieces(h.schedulesOf(s1, s2, s3), true)).toEqual(
      h.stopListOf([
        h.entry('A', 10, { schedule: s1, prediction: p1 }),
        h.entry('B', 20, { schedule: s2, prediction: p2 }),
        h.entry('C', 30, { schedule: s3, prediction: p3 }),
      ]),
    );
  });

  it('aligns scheduled stop IDs with existing predictions', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    expect(h.fromPieces(h.stopIdsOf('A', 'B', 'C'), true)).toEqual(
      h.stopListOf([h.entry('A', 10, { prediction: p1 }), h.entry('B', 20, { prediction: p2 }), h.entry('C', 30, { prediction: p3 })]),
    );
  });

  it('extrapolates stop sequences before current predictions', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    h.stop('A');
    const p2 = h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    expect(h.fromPieces(h.stopIdsOf('A', 'B', 'C'), true)).toEqual(
      h.stopListOf([h.entry('A', 10), h.entry('B', 20, { prediction: p2 }), h.entry('C', 30, { prediction: p3 })]),
    );
  });

  it('extrapolates stop sequences after current predictions', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    h.stop('C');
    expect(h.fromPieces(h.stopIdsOf('A', 'B', 'C'), true)).toEqual(
      h.stopListOf([h.entry('A', 10, { prediction: p1 }), h.entry('B', 20, { prediction: p2 }), h.entry('C', 30)]),
    );
  });

  it('accepts sibling stops with full schedules', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const s1 = h.schedule('A1', 10, route.id);
    const s2 = h.schedule('B1', 20, route.id);
    const s3 = h.schedule('C1', 30, route.id);
    const p1 = h.prediction('A2', 10, route.id);
    const p2 = h.prediction('B2', 20, route.id);
    const p3 = h.prediction('C2', 30, route.id);
    expect(h.fromPieces(h.schedulesOf(s1, s2, s3), true)).toEqual(
      h.stopListOf([
        h.entry('A2', 10, { schedule: s1, prediction: p1 }),
        h.entry('B2', 20, { schedule: s2, prediction: p2 }),
        h.entry('C2', 30, { schedule: s3, prediction: p3 }),
      ]),
    );
  });

  it('accepts sibling stops with stop IDs', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    h.stop('A1');
    h.stop('B1');
    h.stop('C1');
    const p1 = h.prediction('A2', 10, route.id);
    const p2 = h.prediction('B2', 20, route.id);
    const p3 = h.prediction('C2', 30, route.id);
    expect(h.fromPieces(h.stopIdsOf('A1', 'B1', 'C1'), true)).toEqual(
      h.stopListOf([h.entry('A2', 10, { prediction: p1 }), h.entry('B2', 20, { prediction: p2 }), h.entry('C2', 30, { prediction: p3 })]),
    );
  });

  it('resolves duplicate predictions towards schedule', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    const p3a = h.prediction('C1', 30, route.id);
    const p3b = h.prediction('C2', 30, route.id);
    expect(h.fromPieces(h.stopIdsOf('A', 'B', 'C1'), true)).toEqual(
      h.stopListOf([h.entry('A', 10, { prediction: p1 }), h.entry('B', 20, { prediction: p2 }), h.entry('C1', 30, { prediction: p3a })]),
    );
    expect(h.fromPieces(h.stopIdsOf('A', 'B', 'C2'), true)).toEqual(
      h.stopListOf([h.entry('A', 10, { prediction: p1 }), h.entry('B', 20, { prediction: p2 }), h.entry('C2', 30, { prediction: p3b })]),
    );
  });

  it('can deduplicate predictions by stop sequence from real data', () => {
    const b = createBuilder();
    const route = b.route();
    const boylston = b.stop({ id: '70158', parentStationId: 'place-boyls' });
    const parkStreet = b.stop({ id: '70200', parentStationId: 'place-pktrm' });
    const govCenter = b.stop({ id: '70201', name: 'Government Center', parentStationId: 'place-gover' });
    b.stop({ id: '71199', name: 'Park Street', parentStationId: 'place-pktrm' });
    const trip = b.trip({ routeId: route.id });
    const p1 = b.prediction({
      arrivalTime: easternInstant(2024, 5, 10, 15, 31, 5),
      departureTime: easternInstant(2024, 5, 10, 15, 32, 12),
      stopSequence: 600,
      stopId: '70200',
      routeId: route.id,
      tripId: trip.id,
    });
    b.prediction({ arrivalTime: easternInstant(2024, 5, 10, 15, 31, 8), stopSequence: 600, stopId: '71199', routeId: route.id, tripId: trip.id });
    const p3 = b.prediction({ arrivalTime: easternInstant(2024, 5, 10, 15, 33, 7), stopSequence: 610, stopId: '70201', routeId: route.id, tripId: trip.id });

    const list = tripDetailsStopListFromPieces(
      trip,
      { kind: 'stopIds', stopIds: ['70158', '70200', '70201'] },
      b.liveDepartures(),
      null,
      [],
      b.global({ patternIdsByStop: {} }),
    );
    const e = (stop: Stop, seq: number, prediction: Prediction | null): StopListEntry => ({
      stop,
      stopSequence: seq,
      disruption: null,
      schedule: null,
      prediction,
      predictionStop: prediction ? b.objects.stops[prediction.stopId] : null,
      vehicle: null,
      routes: [],
      elevatorAlerts: [],
    });
    expect(list).toEqual({
      trip,
      stops: [e(boylston, 590, null), e(parkStreet, 600, p1), e(govCenter, 610, p3)],
      startTerminalEntry: e(boylston, 590, null),
    });
  });

  it('handles happy path with schedules and vehicles', () => {
    const b = createBuilder();
    const route = b.route();
    const vehicle = b.vehicle({ currentStatus: 'IN_TRANSIT_TO' });
    const outOfDate = b.vehicle({ currentStatus: 'STOPPED_AT' });
    const trip = b.trip({ routeId: route.id });
    const stops = [b.stop(), b.stop(), b.stop()];
    const schedules = stops.map((s, i) => b.schedule({ stopId: s.id, stopSequence: i + 1, routeId: route.id, tripId: trip.id }));
    const predictions = schedules.map((s) => b.predictionFor(s, { vehicleId: outOfDate.id }));
    const list = tripDetailsStopListFromPieces(trip, { kind: 'schedules', schedules }, b.liveDepartures(), vehicle, [], b.global({ patternIdsByStop: {} }));
    const entries: StopListEntry[] = stops.map((stop, i) => ({
      stop,
      stopSequence: i + 1,
      disruption: null,
      schedule: schedules[i],
      prediction: predictions[i],
      predictionStop: stop,
      vehicle,
      routes: [],
      elevatorAlerts: [],
    }));
    expect(list).toEqual({ trip, stops: entries, startTerminalEntry: entries[0] });
  });

  it('includes all transfer routes', () => {
    const h = harness();
    h.stop('A');
    h.stop('B');
    const stopC = h.stop('C');
    const [stopA1, stopA2, stopA3, stopA4, stopB1, stopC1] = ['A1', 'A2', 'A3', 'A4', 'B1', 'C1'].map(h.stop);
    const routeCurrent = h.b.route({ id: 'V' });
    const trip = h.trip({ routeId: routeCurrent.id });
    const routeW = h.b.route({ id: 'W', sortOrder: 1 });
    const routeX = h.b.route({ id: 'X', sortOrder: 2 });
    const routeY = h.b.route({ id: 'Y', sortOrder: 3 });
    const routeZ = h.b.route({ id: 'Z', sortOrder: 4 });
    // Kotlin's `isListedRoute = false`; Teal treats shuttle routes as unlisted.
    const routeExcluded = h.b.route({ id: 'Shuttle-Excluded', sortOrder: 0 });

    const current1 = h.pattern('V1', routeCurrent, 'atypical');
    const current2 = h.pattern('V2', routeCurrent);
    const w1 = h.pattern('W1', routeW);
    const w2 = h.pattern('W2', routeW, 'canonical_only');
    const x1 = h.pattern('X1', routeX);
    const y1 = h.pattern('Y1', routeY);
    const z1 = h.pattern('Z1', routeZ);
    const excluded = h.pattern('116117', routeExcluded);

    const s1 = h.schedule('A2', 10, routeCurrent.id);
    const s2 = h.schedule('B1', 20, routeCurrent.id);
    const s3 = h.schedule('C1', 30, routeCurrent.id);
    const p1 = h.prediction('A1', 10, routeCurrent.id);
    const p2 = h.prediction('B1', 20, routeCurrent.id);
    const p3 = h.prediction('C1', 30, routeCurrent.id);
    const vehicle = h.b.vehicle({ currentStatus: 'IN_TRANSIT_TO', routeId: routeCurrent.id, tripId: trip.id });

    expect(
      h.fromPieces(h.schedulesOf(s1, s2, s3), true, {
        vehicle,
        patternIdsByStop: {
          [stopA1.id]: [current1.id, w1.id],
          [stopA2.id]: [z1.id, excluded.id],
          [stopA3.id]: [x1.id],
          [stopA4.id]: [y1.id],
          [stopB1.id]: [z1.id, current2.id],
          [stopC.id]: [w2.id, y1.id, excluded.id],
          [stopC1.id]: [y1.id, current1.id, current2.id],
        },
      }),
    ).toEqual(
      h.stopListOf([
        h.entry('A1', 10, { schedule: s1, prediction: p1, vehicle, routes: [routeW, routeX, routeY, routeZ] }),
        h.entry('B1', 20, { schedule: s2, prediction: p2, vehicle, routes: [routeZ] }),
        h.entry('C1', 30, { schedule: s3, prediction: p3, vehicle, routes: [routeY] }),
      ]),
    );
  });

  it('resolves current route from available data', () => {
    const h = harness();
    const stopA = h.stop('A');
    const stopB = h.stop('B');
    const routeCurrent = h.b.route({ id: 'X' });
    const routeOther = h.b.route({ id: 'Y' });
    const pc = h.pattern('X1', routeCurrent);
    const po = h.pattern('Y1', routeOther);
    h.trip({ routeId: routeCurrent.id });
    const sched = h.schedule(stopA.id, 10, routeCurrent.id);
    const pred = h.prediction(stopB.id, 20, routeCurrent.id);

    expect(h.fromPieces(h.schedulesOf(sched), false, { patternIdsByStop: { [stopA.id]: [pc.id, po.id] } })).toEqual(
      h.stopListOf([h.entry(stopA.id, 10, { schedule: sched, routes: [routeOther] })]),
    );
    expect(h.fromPieces(null, true, { patternIdsByStop: { [stopB.id]: [pc.id, po.id] } })).toEqual(
      h.stopListOf([h.entry(stopB.id, 20, { prediction: pred, routes: [routeOther] })]),
    );
  });

  it('discards stops vehicle has passed', () => {
    const h = harness();
    const route = h.b.route();
    h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    // Kotlin builds a second trip here; the predictions stay on the first one.
    const trip = h.b.trip({ routeId: route.id });
    const vehicle = h.b.vehicle({ currentStatus: 'IN_TRANSIT_TO', currentStopSequence: 20, tripId: trip.id });
    const live = h.b.liveDepartures();
    const list = tripDetailsStopListFromPieces(trip, null, { ...live, trips: { [trip.id]: trip } }, vehicle, [], h.global());
    expect(list).toEqual(
      h.stopListOf([h.entry('B', 20, { prediction: p2, vehicle }), h.entry('C', 30, { prediction: p3, vehicle })], {
        terminalStop: h.entry('A', 10, { prediction: p1, vehicle }),
        trip,
      }),
    );
  });

  it('discards stops vehicle is currently at', () => {
    const h = harness();
    const route = h.b.route();
    const trip = h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    const vehicle = h.b.vehicle({ currentStatus: 'STOPPED_AT', currentStopSequence: 20, tripId: trip.id });
    expect(h.fromPieces(null, true, { vehicle })).toEqual(
      h.stopListOf([h.entry('C', 30, { prediction: p3, vehicle })], { terminalStop: h.entry('A', 10, { prediction: p1, vehicle }) }),
    );
  });

  it('checks trip before discarding past stops', () => {
    const h = harness();
    const route = h.b.route();
    const trip = h.trip({ routeId: route.id });
    const p1 = h.prediction('A', 10, route.id);
    const p2 = h.prediction('B', 20, route.id);
    const p3 = h.prediction('C', 30, route.id);
    const vehicle = h.b.vehicle({ currentStatus: 'IN_TRANSIT_TO', currentStopSequence: 20, tripId: 'differentTrip' });
    expect(h.fromPieces(null, true, { vehicle, trip })).toEqual(
      h.stopListOf([
        h.entry('A', 10, { prediction: p1, vehicle }),
        h.entry('B', 20, { prediction: p2, vehicle }),
        h.entry('C', 30, { prediction: p3, vehicle }),
      ]),
    );
  });

  it('keeps alerts and picks icon based on route', () => {
    const h = harness();
    h.b.route({ id: 'Red', type: 1 });
    h.trip({ routeId: 'Red' });
    const now = Date.now();
    const p1 = h.prediction('A', 10, 'Red', now + MIN);
    const p2 = h.prediction('B', 20, 'Red', now + 2 * MIN);
    const p3 = h.prediction('C', 30, 'Red', now + 3 * MIN);
    const alert = h.alert('DETOUR', { informedEntities: [h.b.entity({ activities: ['BOARD'], stopId: 'B' })] });
    expect(h.fromPieces(null, true)).toEqual(
      h.stopListOf([
        h.entry('A', 10, { prediction: p1 }),
        h.entry('B', 20, { disruption: { kind: 'disruption', alert, iconName: 'alert-large-red-issue' }, prediction: p2 }),
        h.entry('C', 30, { prediction: p3 }),
      ]),
    );
  });

  it('does not crash on multi-route trips', () => {
    const h = harness();
    const now = Date.now();
    h.b.route({ id: '1' });
    h.b.route({ id: '2' });
    h.trip({ routeId: '1' });
    const p1 = h.prediction('A', 10, '1', now + MIN);
    h.prediction('A', 10, '2', now + MIN);
    expect(h.fromPieces(null, true)).toEqual(h.stopListOf([h.entry('A', 10, { prediction: p1 })]));
  });
});

describe('TripDetailsStopList.splitForTarget', () => {
  const split = (s: Partial<ReturnType<typeof splitForTarget>>) => ({
    firstStop: null,
    collapsedStops: null,
    targetStop: null,
    followingStops: [],
    isTruncatedByLastAlert: false,
    ...s,
  });

  it('distinguishes duplicate stop IDs by stop sequence', () => {
    const h = harness();
    const list = h.stopListOf([h.entry('A', 10), h.entry('B', 20), h.entry('C', 30), h.entry('A', 40)]);
    expect(splitForTarget(list, 'A', 10, h.global())).toEqual(
      split({ collapsedStops: [], targetStop: h.entry('A', 10), followingStops: [h.entry('B', 20), h.entry('C', 30), h.entry('A', 40)] }),
    );
    expect(splitForTarget(list, 'A', 40, h.global())).toEqual(
      split({ firstStop: h.entry('A', 10), collapsedStops: [h.entry('B', 20), h.entry('C', 30)], targetStop: h.entry('A', 40), followingStops: [] }),
    );
  });

  it('uses last copy if stop sequence not found', () => {
    const h = harness();
    const list = h.stopListOf([h.entry('A', 996), h.entry('C', 997), h.entry('A', 998), h.entry('B', 999)]);
    expect(splitForTarget(list, 'A', 3, h.global())).toEqual(
      split({ firstStop: h.entry('A', 996), collapsedStops: [h.entry('C', 997)], targetStop: h.entry('A', 998), followingStops: [h.entry('B', 999)] }),
    );
  });

  it('accepts siblings', () => {
    const h = harness();
    const list = h.stopListOf([h.entry('A1', 10), h.entry('B1', 20), h.entry('C1', 30)]);
    h.stop('B2');
    expect(splitForTarget(list, 'B2', 20, h.global())).toEqual(
      split({ firstStop: h.entry('A1', 10), collapsedStops: [], targetStop: h.entry('B1', 20), followingStops: [h.entry('C1', 30)] }),
    );
  });

  it('removes first stop from collapsed when no vehicle exists', () => {
    const h = harness();
    const list = h.stopListOf([h.entry('A', 10), h.entry('B', 20), h.entry('C', 30), h.entry('D', 40)]);
    expect(splitForTarget(list, 'C', 30, h.global())).toEqual(
      split({ firstStop: h.entry('A', 10), collapsedStops: [h.entry('B', 20)], targetStop: h.entry('C', 30), followingStops: [h.entry('D', 40)] }),
    );
  });

  it('removes first stop from collapsed when vehicle trip is different', () => {
    const h = harness();
    h.trip();
    const vehicle = h.b.vehicle({ currentStatus: 'STOPPED_AT', currentStopSequence: 20, tripId: 'different' });
    const e = (id: string, seq: number) => h.entry(id, seq, { vehicle });
    const list = h.stopListOf([e('A', 10), e('B', 20), e('C', 30), e('D', 40)]);
    expect(splitForTarget(list, 'C', 30, h.global())).toEqual(
      split({ firstStop: e('A', 10), collapsedStops: [e('B', 20)], targetStop: e('C', 30), followingStops: [e('D', 40)] }),
    );
  });

  it('keeps first stop collapsed when the vehicle is on this trip', () => {
    const h = harness();
    const trip = h.trip();
    const vehicle = h.b.vehicle({ currentStatus: 'IN_TRANSIT_TO', tripId: trip.id });
    const e = (id: string, seq: number) => h.entry(id, seq, { vehicle });
    const list = h.stopListOf([e('A', 10), e('B', 20), e('C', 30)]);
    expect(splitForTarget(list, 'C', 30, h.global())).toEqual(
      split({ collapsedStops: [e('A', 10), e('B', 20)], targetStop: e('C', 30), followingStops: [] }),
    );
  });

  it('dumps everything into followingStops if target not found', () => {
    const h = harness();
    const list = h.stopListOf([h.entry('A', 10), h.entry('B', 20), h.entry('C', 30)]);
    h.stop('D');
    expect(splitForTarget(list, 'D', 40, h.global())).toEqual(split({ followingStops: list.stops }));
  });

  it('truncates for shuttles but not stop closures', () => {
    const h = harness();
    const closure = h.alert('STATION_CLOSURE');
    const shuttle = h.alert('SHUTTLE');
    const a = h.entry('A', 10);
    const b = h.entry('B', 20, { alert: closure });
    const c = h.entry('C', 30, { alert: shuttle });
    const d = h.entry('D', 40, { alert: shuttle });
    const list = h.stopListOf([a, b, c, d]);
    expect(splitForTarget(list, 'A', 10, h.global())).toEqual(
      split({ collapsedStops: [], targetStop: a, followingStops: [b, c], isTruncatedByLastAlert: true }),
    );
  });

  it('truncates downstream but ignores upstream', () => {
    const h = harness();
    const shuttle = h.alert('SHUTTLE');
    const a = h.entry('A', 10);
    const b = h.entry('B', 20, { alert: shuttle });
    const c = h.entry('C', 30, { alert: shuttle });
    const d = h.entry('D', 40);
    const e = h.entry('E', 50);
    const list = h.stopListOf([a, b, c, d, e]);
    expect(splitForTarget(list, 'A', 10, h.global())).toEqual(
      split({ collapsedStops: [], targetStop: a, followingStops: [b], isTruncatedByLastAlert: true }),
    );
    expect(splitForTarget(list, 'D', 40, h.global())).toEqual(
      split({ firstStop: a, collapsedStops: [b, c], targetStop: d, followingStops: [e] }),
    );
  });
});

describe('TripDetailsStopList.contextualTrip', () => {
  it('distinguishes duplicate stop IDs by stop sequence', () => {
    const h = harness();
    const trip = h.trip({ routeId: 'route' });
    const t10 = h.entry('A', 10, { schedule: h.schedule('A', 10, 'route'), prediction: h.prediction('A', 10, 'route') });
    const t40 = h.entry('A', 40, { schedule: h.schedule('A', 40, 'route'), prediction: h.prediction('A', 40, 'route') });
    const list = h.stopListOf([t10, h.entry('B', 20), h.entry('C', 30), t40]);
    for (const [t, seq] of [
      [t10, 10],
      [t40, 40],
    ] as const) {
      const ut = contextualTrip(list, { stopId: 'A', stopSequence: seq }, h.global());
      expect(ut).toEqual(expect.objectContaining({ trip, schedule: t.schedule, prediction: t.prediction, predictionStop: t.predictionStop, vehicle: null }));
      expect(ut.id).toBe(`${trip.id}-${seq}`);
    }
  });

  it('uses last copy if stop sequence not found', () => {
    const h = harness();
    const trip = h.trip({ routeId: 'route' });
    const target = h.entry('A', 998, { schedule: h.schedule('A', 998, 'route'), prediction: h.prediction('A', 998, 'route') });
    const list = h.stopListOf([h.entry('A', 996), h.entry('C', 997), target, h.entry('B', 999)]);
    expect(contextualTrip(list, { stopId: 'A', stopSequence: 3 }, h.global())).toEqual(
      expect.objectContaining({ trip, schedule: target.schedule, prediction: target.prediction }),
    );
  });

  it('accepts siblings', () => {
    const h = harness();
    const trip = h.trip({ routeId: 'route' });
    const target = h.entry('B1', 20, { schedule: h.schedule('B1', 20, 'route'), prediction: h.prediction('B1', 20, 'route') });
    const list = h.stopListOf([h.entry('A1', 10), target, h.entry('C1', 30)]);
    h.stop('B2');
    expect(contextualTrip(list, { stopId: 'B2', stopSequence: 20 }, h.global())).toEqual(
      expect.objectContaining({ trip, schedule: target.schedule, prediction: target.prediction }),
    );
  });
});

describe('TripDetailsStopList.Entry.format', () => {
  it('displays prediction', () => {
    const h = harness();
    const route = h.b.route({ type: 1 });
    const trip = h.trip({ routeId: route.id });
    const now = Date.now();
    const pred = h.prediction('A', 10, '', now);
    const f = formatEntry(h.entry('A', 10, { prediction: pred }), trip, now, route);
    expect(f).toEqual({
      kind: 'some',
      secondaryAlert: null,
      trips: [expect.objectContaining({ routeType: 1, lastTrip: false, format: { kind: 'time', predictionTime: now, last: false, headline: false } })],
    });
  });

  it('takes non-truncating disruption over prediction', () => {
    const h = harness();
    const route = h.b.route({ type: 1 });
    const trip = h.trip({ routeId: route.id });
    const now = Date.now();
    const closure = h.alert('STATION_CLOSURE');
    const e = h.entry('A', 10, { alert: closure, prediction: h.prediction('A', 10, '', now) });
    expect(formatEntry(e, trip, now, route)).toEqual(e.disruption);
  });

  it('takes prediction over truncating disruption', () => {
    const h = harness();
    const route = h.b.route({ type: 1 });
    const trip = h.trip({ routeId: route.id });
    const now = Date.now();
    const shuttle = h.alert('SHUTTLE');
    const pred = h.prediction('A', 10, '', now);
    const f = formatEntry(h.entry('A', 10, { alert: shuttle, prediction: pred }), trip, now, route);
    expect(f).toEqual({
      kind: 'some',
      secondaryAlert: null,
      trips: [
        expect.objectContaining({
          alert: shuttle,
          format: { kind: 'time', predictionTime: now, last: false, headline: false },
          trip: expect.objectContaining({ prediction: pred, alert: shuttle }),
        }),
      ],
    });
  });
});
