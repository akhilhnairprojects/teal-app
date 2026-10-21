import type { RailShapes } from '@/mbta/global/globalData';

import { at, buildNetwork } from '../__fixtures__/network';
import { itineraryOverlay, plannerMapOverlay, sliceShape, transitPath } from '../geometry';
import { rankItineraries, scoreOf, weatherPenaltyMin } from '../rank';
import type { Itinerary, Leg, WeatherSnapshot } from '../types';

const p = (latitude: number, longitude: number) => ({ latitude, longitude });
const MIN = 60_000;

describe('geometry', () => {
  const line = [p(42.0, -71.0), p(42.01, -71.0), p(42.02, -71.0), p(42.03, -71.0), p(42.04, -71.0)];

  it('slices a shape between the points nearest each station, in travel order', () => {
    expect(sliceShape(line, p(42.0101, -71.0001), p(42.0299, -71.0))).toEqual(line.slice(1, 4));
    expect(sliceShape(line, p(42.03, -71.0), p(42.01, -71.0))).toEqual([line[3], line[2], line[1]]);
    expect(sliceShape([], p(1, 1), p(2, 2))).toEqual([p(1, 1), p(2, 2)]);
    expect(sliceShape(line, p(42.02, -71.0), p(42.0201, -71.0))).toEqual([p(42.02, -71.0), p(42.0201, -71.0)]);
  });

  it('picks the route shape that passes both stations and falls back to a straight line', () => {
    const shapes: RailShapes = {
      Red: [
        { shapeId: 'far', directionId: 0, coordinates: [p(43, -72), p(43.1, -72)] },
        { shapeId: 'near', directionId: 0, coordinates: line },
      ],
    };
    expect(transitPath(shapes, 'Red', p(42.0, -71.0), p(42.02, -71.0))).toEqual(line.slice(0, 3));
    expect(transitPath(shapes, 'Orange', p(42.0, -71.0), p(42.02, -71.0))).toEqual([p(42.0, -71.0), p(42.02, -71.0)]);
    expect(transitPath(null, 'Red', p(42.0, -71.0), p(42.02, -71.0))).toHaveLength(2);
  });

  it('builds overlay legs and markers for an itinerary', () => {
    const { global } = buildNetwork();
    const legs: Leg[] = [
      { mode: 'walk', from: p(42.355, -71.06), to: at('place-dwnxg'), fromName: 'A', toName: 'Downtown Crossing', meters: 60, startTime: 0, endTime: 1 },
      {
        mode: 'transit',
        routeId: 'Red',
        directionId: 1,
        headsign: 'Alewife',
        tripId: 't',
        fromStopId: 'place-dwnxg',
        toStopId: 'place-harsq',
        boardPlatformId: null,
        alightPlatformId: null,
        departTime: 1,
        arriveTime: 2,
        timeSource: 'realtime',
        stopCount: 5,
        vehicleId: null,
        carriages: [],
        car: null,
        alerts: [],
        uncertaintySec: null,
        laterDepartures: [],
      },
    ];
    const itin: Itinerary = { id: 'x', kind: 'transit', legs, departTime: 0, arriveTime: 2, transfers: 0, walkMeters: 60, score: 0, tags: [], notices: [] };
    const overlay = itineraryOverlay(itin, global, null, { walk: '#555555', bike: '#0D9488' }, {
      origin: p(42.355, -71.06),
      destination: at('place-harsq'),
      originName: 'A',
      destinationName: 'Harvard',
    });
    expect(overlay.legs.map((l) => [l.mode, l.color])).toEqual([
      ['walk', '#555555'],
      ['transit', '#DA291C'],
    ]);
    expect(overlay.markers.map((m) => m.kind)).toEqual(['origin', 'destination', 'station', 'station']);
    expect(plannerMapOverlay(overlay).fitTo).toHaveLength(4);
  });
});

describe('rank', () => {
  const bikeLeg: Leg = {
    mode: 'bike',
    fromDock: { stationId: 'a', name: 'A', latLng: p(0, 0), bikes: 1, ebikes: 0, docks: 1, rentalUrl: null },
    toDock: { stationId: 'b', name: 'B', latLng: p(0, 0), bikes: 1, ebikes: 0, docks: 1, rentalUrl: null },
    meters: 1000,
    startTime: 0,
    endTime: 1,
  };
  const walk: Leg = { mode: 'walk', from: p(0, 0), to: p(0, 0), fromName: '', toName: '', meters: 900, startTime: 0, endTime: 1 };
  const ride = (tripId: string): Leg => ({
    mode: 'transit',
    routeId: 'Red',
    directionId: 0,
    headsign: '',
    tripId,
    fromStopId: 'a',
    toStopId: 'b',
    boardPlatformId: null,
    alightPlatformId: null,
    departTime: 0,
    arriveTime: 1,
    timeSource: 'realtime',
    stopCount: 1,
    vehicleId: null,
    carriages: [],
    car: null,
    alerts: [],
    uncertaintySec: null,
    laterDepartures: [],
  });
  const mk = (id: string, kind: Itinerary['kind'], arriveMin: number, o: Partial<Itinerary> = {}): Itinerary => ({
    id,
    kind,
    legs: kind === 'bike' ? [bikeLeg] : kind === 'transit' ? [walk, ride(id)] : [walk],
    departTime: 0,
    arriveTime: arriveMin * MIN,
    transfers: 0,
    walkMeters: kind === 'bike' ? 0 : 900,
    score: 0,
    tags: [],
    notices: [],
    ...o,
  });
  const weather = (bikeAdvisory: WeatherSnapshot['bikeAdvisory']): WeatherSnapshot => ({
    fetchedAt: 0,
    temperatureF: 50,
    shortForecast: 'Light Rain',
    precipProbability: 40,
    windMph: 5,
    bikeAdvisory,
    reason: '40% chance of precipitation',
  });

  it('scores arrival + weather penalty for bike legs + 1 min per transfer', () => {
    const bike = mk('b', 'bike', 10);
    expect(weatherPenaltyMin(bike, weather('caution'))).toBe(5);
    expect(weatherPenaltyMin(bike, weather('avoid'))).toBe(15);
    expect(weatherPenaltyMin(mk('w', 'walk', 10), weather('avoid'))).toBe(0);
    expect(scoreOf(mk('t', 'transit', 10, { transfers: 2 }), null)).toBe(12 * MIN);
  });

  it('adds a caution notice without hiding the bike', () => {
    const ranked = rankItineraries([mk('b', 'bike', 10), mk('t', 'transit', 13)], weather('caution'));
    expect(ranked.map((i) => i.id)).toEqual(['t', 'b']);
    expect(ranked[1].notices[0]).toMatchObject({ kind: 'weather', severity: 'info' });
    expect(ranked[1].tags).not.toContain('weatherRisk');
  });

  it('tags fastest, least walking and no transfers, and dedupes', () => {
    const ranked = rankItineraries(
      [mk('t1', 'transit', 20, { transfers: 1, walkMeters: 100 }), mk('t2', 'transit', 22), mk('w', 'walk', 40), mk('t1', 'transit', 21, { transfers: 1, walkMeters: 100 })],
      null,
    );
    expect(ranked.map((i) => i.id)).toEqual(['t1', 't2', 'w']);
    expect(ranked[0].tags).toEqual(expect.arrayContaining(['fastest', 'leastWalking']));
    expect(ranked[1].tags).toContain('noTransfers');
  });

  it('always keeps the best walk and bike even when transit fills the list', () => {
    const many = Array.from({ length: 8 }, (_, i) => mk(`t${i}`, 'transit', 10 + i));
    const ranked = rankItineraries([...many, mk('w', 'walk', 90), mk('b', 'bike', 60)], null);
    expect(ranked).toHaveLength(6);
    expect(ranked.map((i) => i.kind)).toEqual(expect.arrayContaining(['walk', 'bike']));
  });
});
