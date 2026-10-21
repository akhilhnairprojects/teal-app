/**
 * A hand-built slice of the rail network for planner tests: Red (both branches), Orange from North
 * Station to Forest Hills, and the Green B/C/D/E branches west of Government Center. Parent ids
 * follow public GTFS ids and coordinates are approximate; platform ids are synthetic
 * ('<station>-R0', '-O1', '-G0', JFK '-RA0'/'-RB0' per branch).
 */
import type { BikeStation } from '@/data/bluebikes';
import type { GlobalData } from '@/mbta/global/globalData';
import type { DirectionId, Prediction, Route, Schedule, Stop } from '@/mbta/model/types';
import { createBuilder, type Builder } from '@/mbta/testing/builders';

const STATIONS: [string, string, number, number][] = [
  ['place-alfcl', 'Alewife', 42.3954, -71.1425],
  ['place-harsq', 'Harvard', 42.3734, -71.1189],
  ['place-cntsq', 'Central', 42.3653, -71.1037],
  ['place-knncl', 'Kendall/MIT', 42.3625, -71.0862],
  ['place-chmnl', 'Charles/MGH', 42.3612, -71.0706],
  ['place-pktrm', 'Park Street', 42.3564, -71.0624],
  ['place-dwnxg', 'Downtown Crossing', 42.3555, -71.0602],
  ['place-sstat', 'South Station', 42.3523, -71.0552],
  ['place-brdwy', 'Broadway', 42.3426, -71.057],
  ['place-andrw', 'Andrew', 42.3302, -71.0577],
  ['place-jfk', 'JFK/UMass', 42.3207, -71.0524],
  ['place-shmnl', 'Savin Hill', 42.3113, -71.0533],
  ['place-fldcr', 'Fields Corner', 42.3, -71.0617],
  ['place-smmnl', 'Shawmut', 42.2931, -71.0657],
  ['place-asmnl', 'Ashmont', 42.2847, -71.0645],
  ['place-nqncy', 'North Quincy', 42.2753, -71.0296],
  ['place-wlsta', 'Wollaston', 42.2665, -71.0203],
  ['place-qnctr', 'Quincy Center', 42.2518, -71.0054],
  ['place-qamnl', 'Quincy Adams', 42.2334, -71.0072],
  ['place-brntn', 'Braintree', 42.2079, -71.0011],
  ['place-north', 'North Station', 42.3656, -71.0613],
  ['place-haecl', 'Haymarket', 42.363, -71.0583],
  ['place-state', 'State', 42.3589, -71.0576],
  ['place-chncl', 'Chinatown', 42.3524, -71.0628],
  ['place-tumnl', 'Tufts Medical Center', 42.3497, -71.0639],
  ['place-bbsta', 'Back Bay', 42.3474, -71.0757],
  ['place-masta', 'Massachusetts Avenue', 42.3415, -71.0834],
  ['place-rugg', 'Ruggles', 42.3364, -71.089],
  ['place-forhl', 'Forest Hills', 42.3005, -71.1137],
  ['place-gover', 'Government Center', 42.3597, -71.0592],
  ['place-boyls', 'Boylston', 42.3529, -71.0646],
  ['place-armnl', 'Arlington', 42.3519, -71.0707],
  ['place-coecl', 'Copley', 42.35, -71.0774],
  ['place-hymnl', 'Hynes Convention Center', 42.348, -71.0877],
  ['place-kencl', 'Kenmore', 42.3489, -71.0952],
  ['place-bland', 'Blandford Street', 42.3492, -71.1],
  ['place-lake', 'Boston College', 42.3401, -71.1668],
  ['place-smary', 'Saint Mary’s Street', 42.3457, -71.1072],
  ['place-clmnl', 'Cleveland Circle', 42.3362, -71.1494],
  ['place-fenwy', 'Fenway', 42.3452, -71.1043],
  ['place-river', 'Riverside', 42.3373, -71.2524],
  ['place-prmnl', 'Prudential', 42.3456, -71.0819],
  ['place-hsmnl', 'Heath Street', 42.3283, -71.1106],
];

export const at = (id: string) => {
  const s = STATIONS.find((x) => x[0] === id);
  if (!s) throw new Error(`unknown station ${id}`);
  return { latitude: s[2], longitude: s[3] };
};

export type Network = {
  b: Builder;
  global: GlobalData;
  routes: Record<string, Route>;
  stations: Record<string, Stop>;
};

export function buildNetwork(): Network {
  const b = createBuilder('plan');
  const stations: Record<string, Stop> = {};
  for (const [id, name, latitude, longitude] of STATIONS) {
    stations[id] = b.stop({ id, name, locationType: 1, latitude, longitude });
  }
  const platform = (stationId: string, tag: string, vehicleType: 0 | 1) => {
    const id = `${stationId}-${tag}`;
    if (!b.objects.stops[id]) {
      const p = stations[stationId];
      b.childStop(p, { id, name: p.name, latitude: p.latitude, longitude: p.longitude, vehicleType });
    }
    return id;
  };

  b.line({ id: 'line-Red', longName: 'Red Line', color: '#DA291C', textColor: '#FFFFFF' });
  b.line({ id: 'line-Orange', longName: 'Orange Line', color: '#ED8B00', textColor: '#FFFFFF' });
  b.line({ id: 'line-Green', longName: 'Green Line', color: '#00843D', textColor: '#FFFFFF' });
  const route = (id: string, type: 0 | 1, lineId: string, longName: string, color: string, sortOrder: number, shortName = '') =>
    b.route({ id, type, lineId, longName, shortName, color, textColor: '#FFFFFF', sortOrder, directionNames: ['South', 'North'] });
  const routes = {
    Red: route('Red', 1, 'line-Red', 'Red Line', '#DA291C', 10010),
    Orange: route('Orange', 1, 'line-Orange', 'Orange Line', '#ED8B00', 10020),
    'Green-B': route('Green-B', 0, 'line-Green', 'Green Line B', '#00843D', 10032, 'B'),
    'Green-C': route('Green-C', 0, 'line-Green', 'Green Line C', '#00843D', 10033, 'C'),
    'Green-D': route('Green-D', 0, 'line-Green', 'Green Line D', '#00843D', 10034, 'D'),
    'Green-E': route('Green-E', 0, 'line-Green', 'Green Line E', '#00843D', 10035, 'E'),
  };
  let sort = 0;
  const pattern = (r: Route, id: string, directionId: DirectionId, headsign: string, stopIds: string[]) =>
    b.pattern(r, { id, directionId, typicality: 'typical', canonical: true, sortOrder: sort++, representativeTrip: { headsign, stopIds } });

  // Red: Alewife … JFK, then a branch.
  const trunk = ['place-alfcl', 'place-harsq', 'place-cntsq', 'place-knncl', 'place-chmnl', 'place-pktrm', 'place-dwnxg', 'place-sstat', 'place-brdwy', 'place-andrw'];
  const ashmont = ['place-shmnl', 'place-fldcr', 'place-smmnl', 'place-asmnl'];
  const braintree = ['place-nqncy', 'place-wlsta', 'place-qnctr', 'place-qamnl', 'place-brntn'];
  const redSouth = (branch: string[], jfk: string) => [...trunk.map((s) => platform(s, 'R0', 1)), platform('place-jfk', jfk + '0', 1), ...branch.map((s) => platform(s, 'R0', 1))];
  const redNorth = (branch: string[], jfk: string) =>
    [...[...branch].reverse().map((s) => platform(s, 'R1', 1)), platform('place-jfk', jfk + '1', 1), ...[...trunk].reverse().map((s) => platform(s, 'R1', 1))];
  pattern(routes.Red, 'Red-1-0', 0, 'Ashmont', redSouth(ashmont, 'RA'));
  pattern(routes.Red, 'Red-3-0', 0, 'Braintree', redSouth(braintree, 'RB'));
  pattern(routes.Red, 'Red-1-1', 1, 'Alewife', redNorth(ashmont, 'RA'));
  pattern(routes.Red, 'Red-3-1', 1, 'Alewife', redNorth(braintree, 'RB'));

  const orange = ['place-north', 'place-haecl', 'place-state', 'place-dwnxg', 'place-chncl', 'place-tumnl', 'place-bbsta', 'place-masta', 'place-rugg', 'place-forhl'];
  pattern(routes.Orange, 'Orange-3-0', 0, 'Forest Hills', orange.map((s) => platform(s, 'O0', 1)));
  pattern(routes.Orange, 'Orange-3-1', 1, 'Oak Grove', [...orange].reverse().map((s) => platform(s, 'O1', 1)));

  const core = ['place-gover', 'place-pktrm', 'place-boyls', 'place-armnl', 'place-coecl'];
  const west: Record<string, [string[], string, string]> = {
    'Green-B': [[...core, 'place-hymnl', 'place-kencl', 'place-bland', 'place-lake'], 'Boston College', '812'],
    'Green-C': [[...core, 'place-hymnl', 'place-kencl', 'place-smary', 'place-clmnl'], 'Cleveland Circle', '832'],
    'Green-D': [[...core, 'place-hymnl', 'place-kencl', 'place-fenwy', 'place-river'], 'Riverside', '855'],
    'Green-E': [[...core, 'place-prmnl', 'place-hsmnl'], 'Heath Street', '886'],
  };
  for (const [routeId, [list, headsign, num]] of Object.entries(west)) {
    const r = routes[routeId as keyof typeof routes];
    pattern(r, `${routeId}-${num}-0`, 0, headsign, list.map((s) => platform(s, 'G0', 0)));
    pattern(r, `${routeId}-${num}-1`, 1, 'Government Center', [...list].reverse().map((s) => platform(s, 'G1', 0)));
  }

  return { b, global: b.global({ serviceDate: '2026-10-19' }), routes, stations };
}

/** A trip known to the predictions/schedules response (for headsigns). */
export function trip(n: Network, id: string, routeId: string, directionId: DirectionId, headsign: string) {
  return n.b.trip({ id, routeId, directionId, headsign });
}

/** A prediction at a platform. Times are epoch ms; pass null to omit one. */
export function pred(
  n: Network,
  tripId: string,
  stopId: string,
  stopSequence: number,
  t: { arr?: number | null; dep?: number | null; rel?: Prediction['scheduleRelationship']; vehicleId?: string; uncertainty?: number },
): Prediction {
  const tr = n.b.objects.trips[tripId];
  return n.b.prediction({
    tripId,
    routeId: tr.routeId,
    directionId: tr.directionId,
    stopId,
    stopSequence,
    arrivalTime: t.arr ?? null,
    departureTime: t.dep ?? null,
    scheduleRelationship: t.rel ?? null,
    vehicleId: t.vehicleId ?? null,
    departureUncertainty: t.uncertainty ?? null,
  });
}

export function sched(n: Network, tripId: string, stopId: string, stopSequence: number, t: { arr?: number | null; dep?: number | null }): Schedule {
  const tr = n.b.objects.trips[tripId];
  return n.b.schedule({ tripId, routeId: tr.routeId, stopId, stopSequence, arrivalTime: t.arr ?? null, departureTime: t.dep ?? null });
}

export function bikeStation(id: string, latitude: number, longitude: number, o: { bikes?: number; ebikes?: number; docks?: number; renting?: boolean; returning?: boolean } = {}): BikeStation {
  return {
    id,
    name: `Dock ${id}`,
    location: { latitude, longitude },
    distanceMeters: 0,
    capacity: 15,
    classicBikes: o.bikes ?? 5,
    ebikes: o.ebikes ?? 0,
    openDocks: o.docks ?? 8,
    isRenting: o.renting ?? true,
    isReturning: o.returning ?? true,
    rentalUrl: `https://example.test/dock/${id}`,
    reportedAt: 0,
  };
}
