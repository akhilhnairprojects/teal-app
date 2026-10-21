import { at, bikeStation, buildNetwork } from '../__fixtures__/network';
import { bikeSegment, pickDock, toDock } from '../bike';
import { enumerateMixed, enumerateTransit, nearbyStations } from '../candidates';
import { buildGraph, directLegs, graphFor, legSpec } from '../graph';

describe('graph', () => {
  it('collapses platforms to ordered parent stations per pattern', () => {
    const { global } = buildNetwork();
    const graph = buildGraph(global);
    const ashmont = graph.patterns.find((p) => p.id === 'Red-1-0')!;
    expect(ashmont.stations.slice(0, 3)).toEqual(['place-alfcl', 'place-harsq', 'place-cntsq']);
    expect(ashmont.stations[ashmont.stations.length - 1]).toBe('place-asmnl');
    // Direction comes from pattern order: Harvard precedes Downtown Crossing southbound.
    expect(ashmont.index['place-harsq']).toBeLessThan(ashmont.index['place-dwnxg']);
    expect(graph.patterns).toHaveLength(4 + 2 + 8);
  });

  it('marks stations shared by several patterns as transfer stations', () => {
    const graph = buildGraph(buildNetwork().global);
    for (const s of ['place-dwnxg', 'place-pktrm', 'place-jfk', 'place-kencl']) expect(graph.transferStations.has(s)).toBe(true);
    expect(graph.transferStations.has('place-asmnl')).toBe(false);
    expect(graph.transferStations.has('place-lake')).toBe(false);
  });

  it('caches one graph per global-data snapshot', () => {
    const { global } = buildNetwork();
    expect(graphFor(global)).toBe(graphFor(global));
  });

  it('builds leg specs with branch-aware headsigns and hop estimates', () => {
    const graph = buildGraph(buildNetwork().global);
    const toQuincy = legSpec(graph, 'line-Red', 0, 'place-pktrm', 'place-qnctr')!;
    expect(toQuincy.routeIds).toEqual(['Red']);
    expect(toQuincy.servingHeadsigns).toEqual(['Braintree']);
    expect(toQuincy.knownHeadsigns.sort()).toEqual(['Ashmont', 'Braintree']);
    expect(toQuincy.hops).toBe(8);
    expect(toQuincy.rideMin).toBeCloseTo(16);
    expect(legSpec(graph, 'line-Red', 1, 'place-pktrm', 'place-qnctr')).toBeNull();

    const [green] = directLegs(graph, 'place-kencl', 'place-gover');
    expect(green.lineKey).toBe('line-Green');
    expect(green.directionId).toBe(1);
    expect(green.routeIds.sort()).toEqual(['Green-B', 'Green-C', 'Green-D']);
    // Kenmore → Government Center: 6 central-subway hops at 1.8 min.
    expect(green.rideMin).toBeCloseTo(6 * 1.8);
    expect(directLegs(graph, 'place-lake', 'place-clmnl')).toEqual([]);
  });
});

describe('candidates', () => {
  it('keeps up to 4 stations within 1.2 km, nearest first', () => {
    const graph = buildGraph(buildNetwork().global);
    const near = nearbyStations(graph, at('place-dwnxg'));
    expect(near).toHaveLength(4);
    expect(near[0]).toMatchObject({ stationId: 'place-dwnxg', meters: 0 });
    expect(near.every((c) => c.meters <= 1200)).toBe(true);
    expect(near[1].walkMin).toBeCloseTo((near[1].meters * 1.3) / 80);
    expect(nearbyStations(graph, { latitude: 42.38, longitude: -71.14 })).toEqual([]);
  });

  it('enumerates the Red → Orange transfer for Harvard → Back Bay', () => {
    const graph = buildGraph(buildNetwork().global);
    const options = enumerateTransit(graph, nearbyStations(graph, at('place-harsq')), nearbyStations(graph, at('place-bbsta')));
    expect(options.length).toBeLessThanOrEqual(5);
    const viaDtx = options.find((o) => o.legs.length === 2 && o.legs[0].to === 'place-dwnxg' && o.legs[1].to === 'place-bbsta');
    expect(viaDtx).toBeDefined();
    expect(viaDtx!.legs.map((l) => l.lineKey)).toEqual(['line-Red', 'line-Orange']);
    // Pre-score = walk + ride + transfer (4 + 8/2) + ride + walk.
    expect(viaDtx!.preScore).toBeCloseTo(5 * 2 + 4 + 4 + 3 * 2);
  });

  it('prefers a direct ride and skips transfers for that station pair', () => {
    const graph = buildGraph(buildNetwork().global);
    const options = enumerateTransit(graph, [{ stationId: 'place-pktrm', meters: 0, walkMin: 0 }], [{ stationId: 'place-qnctr', meters: 0, walkMin: 0 }]);
    expect(options).toHaveLength(1);
    expect(options[0].legs).toHaveLength(1);
  });

  it('drops blocked legs before ranking', () => {
    const graph = buildGraph(buildNetwork().global);
    const options = enumerateTransit(graph, [{ stationId: 'place-pktrm', meters: 0, walkMin: 0 }], [{ stationId: 'place-qnctr', meters: 0, walkMin: 0 }], {
      isBlocked: (l) => l.lineKey === 'line-Red',
    });
    expect(options).toEqual([]);
  });

  it('finds a bike-to-station option 1–4 km out', () => {
    const graph = buildGraph(buildNetwork().global);
    const origin = { latitude: 42.38, longitude: -71.14 };
    const bikes = [bikeStation('home', 42.3803, -71.1396), bikeStation('harvard', 42.3737, -71.1185)];
    const mixed = enumerateMixed(graph, origin, at('place-pktrm'), [], nearbyStations(graph, at('place-pktrm')), bikes);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toMatchObject({ kind: 'bike+transit', station: 'place-harsq' });
    expect(mixed[0].bike.start.dock.stationId).toBe('home');
  });
});

describe('bike docks', () => {
  it('needs a rentable bike at the start and an open dock at the end', () => {
    const empty = bikeStation('a', 42.3628, -71.0858, { bikes: 0 });
    const notRenting = bikeStation('b', 42.3629, -71.0859, { renting: false });
    const ok = bikeStation('c', 42.363, -71.086, { bikes: 0, ebikes: 2 });
    const from = at('place-knncl');
    expect(pickDock([empty, notRenting], from, 500, 'start')).toEqual({ pick: null, problem: 'noStartBikes' });
    expect(pickDock([empty, notRenting, ok], from, 500, 'start').pick?.dock).toMatchObject({ stationId: 'c', bikes: 2, ebikes: 2 });
    expect(pickDock([], from, 500, 'start').problem).toBe('noStartDock');
    expect(pickDock([bikeStation('d', 42.3628, -71.0858, { docks: 0 })], from, 500, 'end').problem).toBe('noEndDocks');
  });

  it('times walk + ride + walk with the 2 min docking allowance', () => {
    const a = bikeStation('a', 42.3628, -71.0858);
    const b = bikeStation('b', 42.3567, -71.0628);
    const r = bikeSegment([a, b], { latitude: 42.3628, longitude: -71.0858 }, { latitude: 42.3567, longitude: -71.0628 }, 500, 500);
    expect(r.segment).not.toBeNull();
    expect(r.segment!.walkToMin).toBeCloseTo(0);
    expect(r.segment!.rideMin).toBeCloseTo((r.segment!.rideMeters * 1.25) / 250 + 2);
    expect(toDock(a)).toMatchObject({ stationId: 'a', bikes: 5, docks: 8, rentalUrl: 'https://example.test/dock/a' });
  });
});
