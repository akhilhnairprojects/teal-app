/**
 * Small hand-built Red and Green Line networks for tests (stand-ins for MBTA Go's TestData).
 * Parent station ids and names follow the public GTFS ids; platform ids are synthetic
 * ('<station>-0' / '<station>-1' per direction for Red, '<station>-g0' / '-g1' for Green) except the
 * Red Line JFK platforms.
 */
import type { DirectionId, RoutePattern, Stop } from '@/mbta/model/types';

import type { Builder } from './builders';

type StationMap = Record<string, Stop>;

function station(b: Builder, stations: StationMap, id: string, name: string, lat = 42.35, lon = -71.06): Stop {
  if (!stations[id]) stations[id] = b.objects.stops[id] ?? b.stop({ id, name, locationType: 1, latitude: lat, longitude: lon });
  return stations[id];
}

/** The platform of `stationId` used in a direction (created on first use). */
function platform(b: Builder, stations: StationMap, stationId: string, dir: DirectionId, vehicleType: 0 | 1, id?: string): string {
  const parent = stations[stationId];
  // Green platforms get a 'g' so Red and Green platforms at shared stations stay distinct.
  const platformId = id ?? `${stationId}-${vehicleType === 0 ? 'g' : ''}${dir}`;
  if (!b.objects.stops[platformId]) {
    b.childStop(parent, { id: platformId, name: parent.name, latitude: parent.latitude, longitude: parent.longitude, vehicleType });
  }
  return platformId;
}

export function redLine(b: Builder) {
  const stations: StationMap = {};
  const list: [string, string, number][] = [
    ['place-alfcl', 'Alewife', 42.3954],
    ['place-harsq', 'Harvard', 42.3734],
    ['place-pktrm', 'Park Street', 42.3564],
    ['place-dwnxg', 'Downtown Crossing', 42.3555],
    ['place-andrw', 'Andrew', 42.3302],
    ['place-jfk', 'JFK/UMass', 42.3207],
    ['place-shmnl', 'Savin Hill', 42.3112],
    ['place-asmnl', 'Ashmont', 42.2846],
    ['place-nqncy', 'North Quincy', 42.2753],
    ['place-qnctr', 'Quincy Center', 42.2518],
    ['place-brntn', 'Braintree', 42.2079],
  ];
  for (const [id, name, lat] of list) station(b, stations, id, name, lat, -71.06);
  b.line({ id: 'line-Red', longName: 'Red Line', color: '#DA291C', textColor: '#FFFFFF', sortOrder: 10010 });
  const route = b.route({
    id: 'Red',
    type: 1,
    color: '#DA291C',
    textColor: '#FFFFFF',
    longName: 'Red Line',
    directionNames: ['South', 'North'],
    directionDestinations: ['Ashmont/Braintree', 'Alewife'],
    sortOrder: 10010,
    lineId: 'line-Red',
  });
  // JFK platforms carry the branch: 70085/70086 Ashmont, 70095/70096 Braintree.
  const jfk = {
    itself: stations['place-jfk'],
    south1: b.objects.stops[platform(b, stations, 'place-jfk', 0, 1, '70085')],
    south2: b.objects.stops[platform(b, stations, 'place-jfk', 0, 1, '70095')],
    north1: b.objects.stops[platform(b, stations, 'place-jfk', 1, 1, '70086')],
    north2: b.objects.stops[platform(b, stations, 'place-jfk', 1, 1, '70096')],
  };
  const trunk = ['place-alfcl', 'place-harsq', 'place-pktrm', 'place-dwnxg', 'place-andrw'];
  const ashmontBranch = ['place-shmnl', 'place-asmnl'];
  const braintreeBranch = ['place-nqncy', 'place-qnctr', 'place-brntn'];
  const south = (branch: string[], jfkPlatform: string) => [
    ...trunk.map((s) => platform(b, stations, s, 0, 1)),
    jfkPlatform,
    ...branch.map((s) => platform(b, stations, s, 0, 1)),
  ];
  const north = (branch: string[], jfkPlatform: string) => [
    ...[...branch].reverse().map((s) => platform(b, stations, s, 1, 1)),
    jfkPlatform,
    ...[...trunk].reverse().map((s) => platform(b, stations, s, 1, 1)),
  ];
  const pattern = (id: string, directionId: DirectionId, headsign: string, stopIds: string[], sortOrder: number): RoutePattern =>
    b.pattern(route, { id, directionId, typicality: 'typical', canonical: true, sortOrder, representativeTrip: { headsign, stopIds } });
  const braintreeSouth = pattern('Red-3-0', 0, 'Braintree', south(braintreeBranch, '70095'), 100100000);
  const ashmontSouth = pattern('Red-1-0', 0, 'Ashmont', south(ashmontBranch, '70085'), 100100001);
  const braintreeNorth = pattern('Red-3-1', 1, 'Alewife', north(braintreeBranch, '70096'), 100101000);
  const ashmontNorth = pattern('Red-1-1', 1, 'Alewife', north(ashmontBranch, '70086'), 100101001);
  return {
    route,
    stations,
    jfk,
    ashmontSouth,
    braintreeSouth,
    ashmontNorth,
    braintreeNorth,
    /** Braintree-branch platforms southbound, from JFK. */
    braintreeBranchSouth: ['70095', ...braintreeBranch.map((s) => `${s}-0`)],
  };
}

export function greenLine(b: Builder) {
  const stations: StationMap = {};
  const names: Record<string, string> = {
    'place-mdftf': 'Medford/Tufts',
    'place-mgngl': 'Magoun Square',
    'place-unsqu': 'Union Square',
    'place-lech': 'Lechmere',
    'place-spmnl': 'Science Park/West End',
    'place-north': 'North Station',
    'place-haecl': 'Haymarket',
    'place-gover': 'Government Center',
    'place-pktrm': 'Park Street',
    'place-boyls': 'Boylston',
    'place-armnl': 'Arlington',
    'place-coecl': 'Copley',
    'place-hymnl': 'Hynes Convention Center',
    'place-kencl': 'Kenmore',
    'place-sougr': 'South Street',
    'place-lake': 'Boston College',
    'place-smary': 'Saint Mary’s Street',
    'place-clmnl': 'Cleveland Circle',
    'place-fenwy': 'Fenway',
    'place-rsmnl': 'Reservoir',
    'place-river': 'Riverside',
    'place-prmnl': 'Prudential',
    'place-symcl': 'Symphony',
    'place-bckhl': 'Back of the Hill',
    'place-hsmnl': 'Heath Street',
  };
  for (const [id, name] of Object.entries(names)) station(b, stations, id, name);
  const line = b.line({ id: 'line-Green', longName: 'Green Line', shortName: '', color: '#00843D', textColor: '#FFFFFF', sortOrder: 10032 });
  const mk = (letter: string, sortOrder: number, destinations: [string, string]) =>
    b.route({
      id: `Green-${letter}`,
      type: 0,
      color: '#00843D',
      textColor: '#FFFFFF',
      shortName: letter,
      longName: `Green Line ${letter}`,
      directionNames: ['West', 'East'],
      directionDestinations: destinations,
      sortOrder,
      lineId: 'line-Green',
    });
  const routes = {
    b: mk('B', 10032, ['Boston College', 'Government Center']),
    c: mk('C', 10033, ['Cleveland Circle', 'Government Center']),
    d: mk('D', 10034, ['Riverside', 'Union Square']),
    e: mk('E', 10035, ['Heath Street', 'Medford/Tufts']),
  };
  const core = ['place-gover', 'place-pktrm', 'place-boyls', 'place-armnl', 'place-coecl'];
  const north = ['place-lech', 'place-spmnl', 'place-north', 'place-haecl'];
  const westStations = {
    b: [...core, 'place-hymnl', 'place-kencl', 'place-sougr', 'place-lake'],
    c: [...core, 'place-hymnl', 'place-kencl', 'place-smary', 'place-clmnl'],
    d: ['place-unsqu', ...north, ...core, 'place-hymnl', 'place-kencl', 'place-fenwy', 'place-rsmnl', 'place-river'],
    e: ['place-mdftf', 'place-mgngl', ...north, ...core, 'place-prmnl', 'place-symcl', 'place-bckhl', 'place-hsmnl'],
  };
  const westHeadsign = { b: 'Boston College', c: 'Cleveland Circle', d: 'Riverside', e: 'Heath Street' };
  const eastHeadsign = { b: 'Government Center', c: 'Government Center', d: 'Union Square', e: 'Medford/Tufts' };
  const ids = { b: ['812', 10032], c: ['832', 10033], d: ['855', 10034], e: ['886', 10035] } as const;
  const patterns = {} as Record<'b' | 'c' | 'd' | 'e', { west: RoutePattern; east: RoutePattern }>;
  for (const k of ['b', 'c', 'd', 'e'] as const) {
    const [num, sort] = ids[k];
    const west = westStations[k].map((s) => platform(b, stations, s, 0, 0));
    const east = [...westStations[k]].reverse().map((s) => platform(b, stations, s, 1, 0));
    patterns[k] = {
      west: b.pattern(routes[k], {
        id: `Green-${k.toUpperCase()}-${num}-0`,
        directionId: 0,
        typicality: 'typical',
        canonical: true,
        sortOrder: sort * 10000,
        representativeTrip: { headsign: westHeadsign[k], stopIds: west },
      }),
      east: b.pattern(routes[k], {
        id: `Green-${k.toUpperCase()}-${num}-1`,
        directionId: 1,
        typicality: 'typical',
        canonical: true,
        sortOrder: sort * 10000 + 1,
        representativeTrip: { headsign: eastHeadsign[k], stopIds: east },
      }),
    };
  }
  return { line, routes, stations, patterns, lineOrRoute: { kind: 'line' as const, id: line.id, line, routes: Object.values(routes) } };
}
