import { MbtaApiError } from '@/mbta/api/errors';
import type { Alert, LiveDepartures, Prediction, Schedule, ScheduleSet, Vehicle } from '@/mbta/model/types';

import { at, bikeStation, buildNetwork, pred, sched, trip, type Network } from '../__fixtures__/network';
import { evaluatePlan, OUTSIDE_AREA_TEXT, planTrip, preparePlan } from '../engine';
import type { Itinerary, Place, PlannerDeps, PlanRequest, TransitLeg, WeatherSnapshot } from '../types';
import type { BikeStation } from '@/data/bluebikes';

const MIN = 60_000;
/** 2026-10-19 12:00 EDT. */
const NOW = Date.UTC(2026, 9, 19, 16, 0);

const station = (n: Network, id: string): Place => ({ name: n.stations[id].name, latLng: at(id), source: 'station', stopId: id });
const point = (name: string, latitude: number, longitude: number): Place => ({ name, latLng: { latitude, longitude }, source: 'map' });

function live(n: Network, predictions: Prediction[], vehicles: Vehicle[] = []): LiveDepartures {
  return { predictions, trips: { ...n.b.objects.trips }, vehicles: Object.fromEntries(vehicles.map((v) => [v.id, v])) };
}
const schedules = (n: Network, list: Schedule[]): ScheduleSet => ({ schedules: list, trips: { ...n.b.objects.trips } });
const EMPTY_SCHEDULES: ScheduleSet = { schedules: [], trips: {} };

type Mocks = {
  fetchPredictions: jest.Mock;
  fetchSchedulesForTrip: jest.Mock;
  fetchSchedulesWindow: jest.Mock;
  fetchBikeStations: jest.Mock;
  fetchWeather: jest.Mock;
};

function makeDeps(
  n: Network,
  o: { live?: LiveDepartures; bikes?: BikeStation[]; weather?: WeatherSnapshot | null; alerts?: Alert[]; now?: number } = {},
): PlannerDeps & Mocks {
  return {
    global: n.global,
    alerts: o.alerts ?? [],
    now: () => o.now ?? NOW,
    fetchPredictions: jest.fn(async () => o.live ?? live(n, [])),
    fetchSchedulesForTrip: jest.fn(async () => EMPTY_SCHEDULES),
    fetchSchedulesWindow: jest.fn(async () => EMPTY_SCHEDULES),
    fetchBikeStations: jest.fn(async () => o.bikes ?? []),
    fetchWeather: jest.fn(async () => o.weather ?? null),
  };
}

const request = (origin: Place, destination: Place, departAt = NOW): PlanRequest => ({ origin, destination, departAt });
const transitLegs = (i: Itinerary) => i.legs.filter((l): l is TransitLeg => l.mode === 'transit');
const firstTransit = (its: Itinerary[]) => its.find((i) => i.kind === 'transit');

describe('planTrip: direct rides', () => {
  it('Downtown Crossing → Harvard is a direct northbound Red ride, direction taken from pattern order', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    trip(n, 'S1', 'Red', 0, 'Ashmont');
    const deps = makeDeps(n, {
      live: live(n, [
        pred(n, 'S1', 'place-dwnxg-R0', 70, { dep: NOW + 1 * MIN }),
        pred(n, 'N1', 'place-dwnxg-R1', 140, { arr: NOW + 3 * MIN, dep: NOW + 3 * MIN, uncertainty: 60 }),
        pred(n, 'N1', 'place-harsq-R1', 190, { arr: NOW + 15 * MIN }),
      ]),
    });
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);

    const best = plan.itineraries[0];
    expect(best.kind).toBe('transit');
    const [leg] = transitLegs(best);
    expect(leg).toMatchObject({
      routeId: 'Red',
      directionId: 1,
      tripId: 'N1',
      fromStopId: 'place-dwnxg',
      toStopId: 'place-harsq',
      boardPlatformId: 'place-dwnxg-R1',
      alightPlatformId: 'place-harsq-R1',
      departTime: NOW + 3 * MIN,
      arriveTime: NOW + 15 * MIN,
      timeSource: 'realtime',
      stopCount: 5,
      uncertaintySec: 60,
      headsign: 'Alewife',
    });
    expect(best.transfers).toBe(0);
    expect(best.tags).toContain('fastest');

    // One predictions call covering the candidate stations and routes.
    expect(deps.fetchPredictions).toHaveBeenCalledTimes(1);
    const [stopIds, filter, opts] = deps.fetchPredictions.mock.calls[0];
    expect(stopIds).toEqual(expect.arrayContaining(['place-dwnxg', 'place-harsq']));
    expect(filter.routeIds).toContain('Red');
    expect(opts.priority).toBe('foreground');
    // Walking is always offered.
    expect(plan.itineraries.some((i) => i.kind === 'walk')).toBe(true);
  });

  it('Park Street → Quincy Center picks only Braintree trips (no schedule lookups for Ashmont trains)', async () => {
    const n = buildNetwork();
    trip(n, 'A1', 'Red', 0, 'Ashmont');
    trip(n, 'B1', 'Red', 0, 'Braintree');
    const deps = makeDeps(n, {
      live: live(n, [
        pred(n, 'A1', 'place-pktrm-R0', 70, { dep: NOW + 2 * MIN }),
        pred(n, 'B1', 'place-pktrm-R0', 70, { dep: NOW + 6 * MIN }),
        pred(n, 'B1', 'place-qnctr-R0', 200, { arr: NOW + 30 * MIN }),
      ]),
    });
    const plan = await planTrip(request(station(n, 'place-pktrm'), station(n, 'place-qnctr')), deps);
    const best = firstTransit(plan.itineraries)!;
    expect(transitLegs(best).map((l) => l.tripId)).toEqual(['B1']);
    expect(best.arriveTime).toBe(NOW + 30 * MIN);
    expect(deps.fetchSchedulesForTrip).not.toHaveBeenCalledWith('A1', expect.anything(), expect.anything());
  });

  it('Kenmore → Government Center accepts any Green branch', async () => {
    const n = buildNetwork();
    trip(n, 'C1', 'Green-C', 1, 'Government Center');
    trip(n, 'B1', 'Green-B', 1, 'Government Center');
    const deps = makeDeps(n, {
      live: live(n, [
        pred(n, 'B1', 'place-kencl-G1', 100, { dep: NOW + 5 * MIN }),
        pred(n, 'B1', 'place-gover-G1', 160, { arr: NOW + 19 * MIN }),
        pred(n, 'C1', 'place-kencl-G1', 100, { dep: NOW + 2 * MIN }),
        pred(n, 'C1', 'place-gover-G1', 160, { arr: NOW + 16 * MIN }),
      ]),
    });
    const plan = await planTrip(request(station(n, 'place-kencl'), station(n, 'place-gover')), deps);
    const best = firstTransit(plan.itineraries)!;
    const [leg] = transitLegs(best);
    expect(leg).toMatchObject({ routeId: 'Green-C', tripId: 'C1', fromStopId: 'place-kencl', toStopId: 'place-gover' });
    expect(leg.laterDepartures).toEqual([NOW + 5 * MIN]);
    const routeIds: string[] = deps.fetchPredictions.mock.calls[0][1].routeIds;
    expect(routeIds).toEqual(expect.arrayContaining(['Green-B', 'Green-C', 'Green-D']));

    // With only a D train predicted, D qualifies too.
    const n2 = buildNetwork();
    trip(n2, 'D1', 'Green-D', 1, 'Government Center');
    const deps2 = makeDeps(n2, {
      live: live(n2, [pred(n2, 'D1', 'place-kencl-G1', 100, { dep: NOW + 4 * MIN }), pred(n2, 'D1', 'place-gover-G1', 160, { arr: NOW + 18 * MIN })]),
    });
    const plan2 = await planTrip(request(station(n2, 'place-kencl'), station(n2, 'place-gover')), deps2);
    expect(transitLegs(firstTransit(plan2.itineraries)!)[0]).toMatchObject({ routeId: 'Green-D', tripId: 'D1' });
  });
});

describe('planTrip: transfers', () => {
  it('Harvard → Back Bay transfers Red → Orange at Downtown Crossing with a 5 min allowance', async () => {
    const n = buildNetwork();
    trip(n, 'R1', 'Red', 0, 'Ashmont');
    trip(n, 'O1', 'Orange', 0, 'Forest Hills');
    trip(n, 'O2', 'Orange', 0, 'Forest Hills');
    const deps = makeDeps(n, {
      live: live(n, [
        pred(n, 'R1', 'place-harsq-R0', 20, { dep: NOW + 1 * MIN }),
        pred(n, 'R1', 'place-dwnxg-R0', 70, { arr: NOW + 12 * MIN, dep: NOW + 12 * MIN }),
        pred(n, 'O1', 'place-dwnxg-O0', 40, { dep: NOW + 14 * MIN }),
        pred(n, 'O1', 'place-bbsta-O0', 70, { arr: NOW + 19 * MIN }),
        pred(n, 'O2', 'place-dwnxg-O0', 40, { dep: NOW + 18 * MIN }),
        pred(n, 'O2', 'place-bbsta-O0', 70, { arr: NOW + 24 * MIN }),
      ]),
    });
    const plan = await planTrip(request(station(n, 'place-harsq'), station(n, 'place-bbsta')), deps);
    const best = firstTransit(plan.itineraries)!;
    const legs = transitLegs(best);
    expect(legs.map((l) => [l.routeId, l.tripId, l.fromStopId, l.toStopId])).toEqual([
      ['Red', 'R1', 'place-harsq', 'place-dwnxg'],
      ['Orange', 'O2', 'place-dwnxg', 'place-bbsta'],
    ]);
    expect(best.transfers).toBe(1);
    expect(best.arriveTime).toBe(NOW + 24 * MIN);
  });

  it('uses the 3 min same-line allowance for a Red branch transfer at JFK', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    trip(n, 'B1', 'Red', 0, 'Braintree');
    const deps = makeDeps(n, {
      live: live(n, [
        pred(n, 'N1', 'place-shmnl-R1', 20, { dep: NOW + 2 * MIN }),
        pred(n, 'N1', 'place-jfk-RA1', 30, { arr: NOW + 4 * MIN, dep: NOW + 4 * MIN }),
        pred(n, 'B1', 'place-jfk-RB0', 110, { dep: NOW + 7 * MIN }),
        pred(n, 'B1', 'place-nqncy-R0', 120, { arr: NOW + 12 * MIN }),
      ]),
    });
    const plan = await planTrip(request(station(n, 'place-shmnl'), station(n, 'place-nqncy')), deps);
    const best = firstTransit(plan.itineraries)!;
    expect(transitLegs(best).map((l) => [l.tripId, l.toStopId])).toEqual([
      ['N1', 'place-jfk'],
      ['B1', 'place-nqncy'],
    ]);
  });
});

describe('planTrip: fallbacks', () => {
  it('falls back to trip schedules when the alighting prediction is missing', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    const deps = makeDeps(n, { live: live(n, [pred(n, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 3 * MIN })]) });
    deps.fetchSchedulesForTrip.mockImplementation(async (tripId: string) =>
      tripId === 'N1'
        ? schedules(n, [sched(n, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 2 * MIN }), sched(n, 'N1', 'place-harsq-R1', 190, { arr: NOW + 13 * MIN })])
        : EMPTY_SCHEDULES,
    );
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    const leg = transitLegs(firstTransit(plan.itineraries)!)[0];
    expect(deps.fetchSchedulesForTrip).toHaveBeenCalledWith('N1', ['place-dwnxg', 'place-harsq'], expect.objectContaining({ priority: 'foreground' }));
    expect(leg).toMatchObject({ tripId: 'N1', departTime: NOW + 3 * MIN, arriveTime: NOW + 14 * MIN, timeSource: 'realtime' });
  });

  it('skips a trip whose schedule shows it does not reach the alighting station', async () => {
    const n = buildNetwork();
    trip(n, 'X1', 'Red', 1, 'Harvard short turn');
    trip(n, 'N2', 'Red', 1, 'Alewife');
    const deps = makeDeps(n, {
      live: live(n, [
        pred(n, 'X1', 'place-dwnxg-R1', 140, { dep: NOW + 1 * MIN }),
        pred(n, 'N2', 'place-dwnxg-R1', 140, { dep: NOW + 6 * MIN }),
        pred(n, 'N2', 'place-harsq-R1', 190, { arr: NOW + 18 * MIN }),
      ]),
    });
    deps.fetchSchedulesForTrip.mockImplementation(async () => schedules(n, [sched(n, 'X1', 'place-dwnxg-R1', 140, { dep: NOW + MIN })]));
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    expect(transitLegs(firstTransit(plan.itineraries)!)[0].tripId).toBe('N2');
  });

  it('uses the hop estimate for an ADDED trip without calling schedules', async () => {
    const n = buildNetwork();
    trip(n, 'ADDED-1585007754', 'Red', 1, 'Alewife');
    const deps = makeDeps(n, { live: live(n, [pred(n, 'ADDED-1585007754', 'place-dwnxg-R1', 140, { dep: NOW + 2 * MIN, rel: 'ADDED' })]) });
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    const it = firstTransit(plan.itineraries)!;
    const leg = transitLegs(it)[0];
    expect(leg.tripId).toBe('ADDED-1585007754');
    expect(leg.timeSource).toBe('estimated');
    // 5 heavy-rail hops × 2 min.
    expect(leg.arriveTime).toBe(NOW + 12 * MIN);
    expect(deps.fetchSchedulesForTrip).not.toHaveBeenCalledWith('ADDED-1585007754', expect.anything(), expect.anything());
    expect(it.notices.some((x) => /estimated/i.test(x.text))).toBe(true);
  });

  it('keeps schedule-based itineraries with a rateLimited notice when predictions hit a 429', async () => {
    const n = buildNetwork();
    trip(n, 'S1', 'Red', 1, 'Alewife');
    const deps = makeDeps(n);
    deps.fetchPredictions.mockRejectedValue(new MbtaApiError({ kind: 'rateLimited', resetAt: NOW + 30_000 }));
    deps.fetchSchedulesWindow.mockImplementation(async (q: { routeIds: string[]; directionId: number }) =>
      q.routeIds.includes('Red') && q.directionId === 1
        ? schedules(n, [sched(n, 'S1', 'place-dwnxg-R1', 140, { dep: NOW + 5 * MIN }), sched(n, 'S1', 'place-harsq-R1', 190, { arr: NOW + 17 * MIN })])
        : EMPTY_SCHEDULES,
    );
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    expect(plan.notices.some((x) => x.kind === 'rateLimited')).toBe(true);
    const it = firstTransit(plan.itineraries)!;
    expect(it.tags).toContain('scheduled');
    expect(transitLegs(it)[0]).toMatchObject({ tripId: 'S1', timeSource: 'scheduled', departTime: NOW + 5 * MIN, arriveTime: NOW + 17 * MIN });
    const q = deps.fetchSchedulesWindow.mock.calls.find((c) => c[0].routeIds.includes('Red'))![0];
    expect(q).toMatchObject({ date: '2026-10-19', minTime: '12:00', directionId: 1 });
    // max_time is widened past the window by the ride estimate.
    expect(q.maxTime > '13:00').toBe(true);
  });

  it('after midnight queries the previous service date with times past 24:00 and labels results scheduled', async () => {
    const n = buildNetwork();
    const late = Date.UTC(2026, 9, 20, 4, 30); // 00:30 EDT on Oct 20
    trip(n, 'S1', 'Red', 1, 'Alewife');
    const deps = makeDeps(n, { now: late });
    deps.fetchSchedulesWindow.mockImplementation(async (q: { routeIds: string[]; directionId: number }) =>
      q.routeIds.includes('Red') && q.directionId === 1
        ? schedules(n, [sched(n, 'S1', 'place-dwnxg-R1', 140, { dep: late + 4 * MIN }), sched(n, 'S1', 'place-harsq-R1', 190, { arr: late + 16 * MIN })])
        : EMPTY_SCHEDULES,
    );
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq'), late), deps);
    const q = deps.fetchSchedulesWindow.mock.calls[0][0];
    expect(q).toMatchObject({ date: '2026-10-19', minTime: '24:30' });
    expect(plan.notices.some((x) => x.kind === 'scheduledOnly')).toBe(true);
    expect(firstTransit(plan.itineraries)!.tags).toContain('scheduled');
  });

  it('spends at most two schedule calls per evaluation', async () => {
    const n = buildNetwork();
    const ps: Prediction[] = [];
    for (const [i, s] of ['place-dwnxg-R1', 'place-pktrm-R1', 'place-state-O1', 'place-chncl-O1'].entries()) {
      trip(n, `T${i}`, s.includes('-O') ? 'Orange' : 'Red', 1, s.includes('-O') ? 'Oak Grove' : 'Alewife');
      ps.push(pred(n, `T${i}`, s, 100, { dep: NOW + (i + 3) * MIN }));
    }
    const deps = makeDeps(n, { live: live(n, ps) });
    await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    expect(deps.fetchSchedulesForTrip.mock.calls.length + deps.fetchSchedulesWindow.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('planTrip: alerts', () => {
  it('drops legs hit by a shuttle and explains why', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    const shuttle = n.b.alert({
      id: 'shuttle-1',
      effect: 'SHUTTLE',
      header: 'Shuttle buses replace Red Line service between Kendall/MIT and Harvard',
      informedEntities: [n.b.entity({ routeId: 'Red', stopId: 'place-knncl' }), n.b.entity({ routeId: 'Red', stopId: 'place-cntsq' })],
    });
    const deps = makeDeps(n, {
      alerts: [shuttle],
      live: live(n, [pred(n, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 3 * MIN }), pred(n, 'N1', 'place-harsq-R1', 190, { arr: NOW + 15 * MIN })]),
    });
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    expect(plan.itineraries.some((i) => transitLegs(i).some((l) => l.routeId === 'Red' && l.toStopId === 'place-harsq'))).toBe(false);
    expect(plan.notices).toContainEqual(expect.objectContaining({ kind: 'alert', alertId: 'shuttle-1', severity: 'warning' }));
  });

  it('keeps a delayed leg with a notice and a disrupted tag', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    const delay = n.b.alert({
      id: 'delay-1',
      effect: 'DELAY',
      severity: 5,
      header: 'Red Line delays of about 10 minutes',
      informedEntities: [n.b.entity({ routeId: 'Red', routeType: 1 })],
    });
    const deps = makeDeps(n, {
      alerts: [delay],
      live: live(n, [pred(n, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 3 * MIN }), pred(n, 'N1', 'place-harsq-R1', 190, { arr: NOW + 15 * MIN })]),
    });
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    const it = firstTransit(plan.itineraries)!;
    expect(transitLegs(it)[0].alerts.map((a) => a.id)).toEqual(['delay-1']);
    expect(it.tags).toContain('disrupted');
    expect(it.notices).toContainEqual(expect.objectContaining({ kind: 'alert', alertId: 'delay-1' }));
  });
});

describe('planTrip: bikes and weather', () => {
  // Kendall/MIT → Park Street (~2.1 km): bike ≈ 14 min, T arrives at +17 min.
  const kendallToPark = (o: { weather?: WeatherSnapshot | null; startBikes?: number; endDocks?: number } = {}) => {
    const n = buildNetwork();
    trip(n, 'K1', 'Red', 0, 'Ashmont');
    const deps = makeDeps(n, {
      weather: o.weather ?? null,
      bikes: [
        bikeStation('kendall', 42.3628, -71.0858, { bikes: o.startBikes ?? 5 }),
        bikeStation('park', 42.3567, -71.0628, { docks: o.endDocks ?? 8 }),
      ],
      live: live(n, [pred(n, 'K1', 'place-knncl-R0', 40, { dep: NOW + 4 * MIN }), pred(n, 'K1', 'place-pktrm-R0', 70, { arr: NOW + 17 * MIN })]),
    });
    return { n, deps, req: request(station(n, 'place-knncl'), station(n, 'place-pktrm')) };
  };
  const rain: WeatherSnapshot = {
    fetchedAt: NOW,
    temperatureF: 55,
    shortForecast: 'Rain',
    precipProbability: 70,
    windMph: 8,
    bikeAdvisory: 'avoid',
    reason: '70% chance of precipitation',
  };

  it('ranks a Bluebike first in fair weather, with docks and bike counts on the leg', async () => {
    const { deps, req } = kendallToPark();
    const plan = await planTrip(req, deps);
    expect(plan.itineraries[0].kind).toBe('bike');
    const bike = plan.itineraries[0].legs.find((l) => l.mode === 'bike')!;
    expect(bike).toMatchObject({ fromDock: { stationId: 'kendall', bikes: 5 }, toDock: { stationId: 'park', docks: 8 } });
  });

  it('rain at 70% makes biking "avoid": it ranks below the T, keeps a notice and is never hidden', async () => {
    const { deps, req } = kendallToPark({ weather: rain });
    const plan = await planTrip(req, deps);
    const kinds = plan.itineraries.map((i) => i.kind);
    expect(kinds.indexOf('transit')).toBeLessThan(kinds.indexOf('bike'));
    const bike = plan.itineraries.find((i) => i.kind === 'bike')!;
    expect(bike.tags).toContain('weatherRisk');
    expect(bike.notices).toContainEqual(expect.objectContaining({ kind: 'weather', severity: 'warning' }));
    expect(plan.weather).toBe(rain);
  });

  it('no bikes at the start dock excludes bike options with a bikeAvailability notice', async () => {
    const { deps, req } = kendallToPark({ startBikes: 0 });
    const plan = await planTrip(req, deps);
    expect(plan.itineraries.some((i) => i.kind === 'bike' || i.kind === 'bike+transit')).toBe(false);
    expect(plan.notices).toContainEqual(expect.objectContaining({ kind: 'bikeAvailability', severity: 'warning' }));
  });

  it('no open docks near the destination excludes the bike option too', async () => {
    const { deps, req } = kendallToPark({ endDocks: 0 });
    const plan = await planTrip(req, deps);
    expect(plan.itineraries.some((i) => i.kind === 'bike')).toBe(false);
    expect(plan.notices.find((x) => x.kind === 'bikeAvailability')?.text).toMatch(/open docks/);
  });

  it('offers bike + T when the origin is far from any station', async () => {
    const n = buildNetwork();
    trip(n, 'H1', 'Red', 0, 'Ashmont');
    const origin = point('Home', 42.38, -71.14); // ~1.9 km from Harvard, no station within 1.2 km
    const deps = makeDeps(n, {
      bikes: [bikeStation('home', 42.3803, -71.1396), bikeStation('harvard', 42.3737, -71.1185)],
      live: live(n, [pred(n, 'H1', 'place-harsq-R0', 20, { dep: NOW + 20 * MIN }), pred(n, 'H1', 'place-pktrm-R0', 70, { arr: NOW + 32 * MIN })]),
    });
    const plan = await planTrip(request(origin, station(n, 'place-pktrm')), deps);
    const mixed = plan.itineraries.find((i) => i.kind === 'bike+transit')!;
    expect(mixed.legs.map((l) => l.mode)).toEqual(['walk', 'bike', 'walk', 'transit']);
    expect(transitLegs(mixed)[0]).toMatchObject({ tripId: 'H1', fromStopId: 'place-harsq' });
    // No dock near Park Street: the pure bike option is explained, not shown.
    expect(plan.itineraries.some((i) => i.kind === 'bike')).toBe(false);
    expect(plan.notices.some((x) => x.kind === 'bikeAvailability')).toBe(true);
  });
});

describe('planTrip: walking and edge cases', () => {
  it('pure walk wins for 400 m and skips the Bluebikes call', async () => {
    const n = buildNetwork();
    trip(n, 'S1', 'Red', 0, 'Ashmont');
    const deps = makeDeps(n, {
      live: live(n, [pred(n, 'S1', 'place-pktrm-R0', 70, { dep: NOW + 2 * MIN }), pred(n, 'S1', 'place-dwnxg-R0', 80, { arr: NOW + 3 * MIN })]),
    });
    const plan = await planTrip(request(station(n, 'place-pktrm'), point('Somewhere', 42.3564, -71.0575)), deps);
    expect(plan.itineraries[0].kind).toBe('walk');
    expect(plan.itineraries[0].tags).toContain('fastest');
    expect(deps.fetchBikeStations).not.toHaveBeenCalled();
  });

  it('origin and destination at the same station returns a notice and no API calls', async () => {
    const n = buildNetwork();
    const deps = makeDeps(n);
    const plan = await planTrip(request(station(n, 'place-pktrm'), { ...station(n, 'place-pktrm'), stopId: 'place-pktrm-R0' }), deps);
    expect(plan.notices[0].text).toMatch(/already there/);
    expect(plan.itineraries).toHaveLength(1);
    expect(deps.fetchPredictions).not.toHaveBeenCalled();
    expect(deps.fetchWeather).not.toHaveBeenCalled();
  });

  it('rejects a destination outside the Boston area', async () => {
    const n = buildNetwork();
    const deps = makeDeps(n);
    const plan = await planTrip(request(station(n, 'place-pktrm'), point('New York', 40.7128, -74.006)), deps);
    expect(plan.itineraries).toEqual([]);
    expect(plan.notices).toEqual([expect.objectContaining({ kind: 'noService', text: OUTSIDE_AREA_TEXT })]);
    expect(deps.fetchPredictions).not.toHaveBeenCalled();
  });

  it('recommends the least crowded car from per-car data', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    const vehicle = n.b.vehicle({
      id: 'R-1',
      tripId: 'N1',
      carriages: [
        n.b.carriage({ sequence: 1, occupancyStatus: 'STANDING_ROOM_ONLY', occupancyPercentage: 80 }),
        n.b.carriage({ sequence: 2, occupancyStatus: 'MANY_SEATS_AVAILABLE', occupancyPercentage: 10 }),
        n.b.carriage({ sequence: 3, occupancyStatus: 'FEW_SEATS_AVAILABLE', occupancyPercentage: 40 }),
      ],
    });
    const deps = makeDeps(n, {
      live: live(
        n,
        [pred(n, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 3 * MIN, vehicleId: 'R-1' }), pred(n, 'N1', 'place-harsq-R1', 190, { arr: NOW + 15 * MIN })],
        [vehicle],
      ),
    });
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    const leg = transitLegs(firstTransit(plan.itineraries)!)[0];
    expect(leg.vehicleId).toBe('R-1');
    expect(leg.carriages).toHaveLength(3);
    expect(leg.car?.label).toBe('Board car 2 of 3');
  });

  it('refreshing reuses stations, bikes and weather: one predictions call per evaluation', async () => {
    const n = buildNetwork();
    trip(n, 'N1', 'Red', 1, 'Alewife');
    const deps = makeDeps(n, {
      live: live(n, [pred(n, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 3 * MIN }), pred(n, 'N1', 'place-harsq-R1', 190, { arr: NOW + 15 * MIN })]),
    });
    const ctx = await preparePlan(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    await evaluatePlan(ctx, deps);
    await evaluatePlan(ctx, deps);
    expect(deps.fetchPredictions).toHaveBeenCalledTimes(2);
    expect(deps.fetchBikeStations).toHaveBeenCalledTimes(1);
    expect(deps.fetchWeather).toHaveBeenCalledTimes(1);
  });

  it('continues without weather or bikes when those services fail', async () => {
    const n = buildNetwork();
    const deps = makeDeps(n);
    deps.fetchWeather.mockRejectedValue(new Error('down'));
    deps.fetchBikeStations.mockRejectedValue(new Error('down'));
    const plan = await planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps);
    expect(plan.weather).toBeNull();
    expect(plan.notices.some((x) => x.kind === 'bikeAvailability')).toBe(true);
    expect(plan.itineraries.some((i) => i.kind === 'walk')).toBe(true);
  });

  it('rejects with an AbortError when aborted', async () => {
    const n = buildNetwork();
    const deps = makeDeps(n);
    const controller = new AbortController();
    controller.abort();
    await expect(planTrip(request(station(n, 'place-dwnxg'), station(n, 'place-harsq')), deps, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
