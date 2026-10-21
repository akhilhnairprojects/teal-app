// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/Direction.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { GlobalData } from '@/mbta/global/globalData';
import type { DirectionId, Route, RoutePattern, Stop } from '@/mbta/model/types';

export type Direction = { id: DirectionId; name: string | null; destination: string | null };

const NORTH_STATION_DESTINATION = 'North Station & North';

/**
 * Trunk labels for branching routes, keyed by route (or line alias). Per direction, an ordered
 * list of (parent stop, label) along the typical pattern: a stop gets the label of the first
 * entry at or after it. A null label means "use the route's default destination".
 */
type CaseList = [string, string | null][];
const SPECIAL_CASES: Record<string, [CaseList | null, CaseList | null]> = {
  'line-Green': [
    [
      ['place-armnl', 'Copley & West'],
      ['place-hymnl', 'Kenmore & West'],
      ['place-prmnl', null],
      ['place-kencl', null],
    ],
    [
      ['place-boyls', 'Park St & North'],
      ['place-pktrm', 'Gov Ctr & North'],
      ['place-haecl', NORTH_STATION_DESTINATION],
      ['place-spmnl', 'Lechmere & North'],
      ['place-lech', null],
    ],
  ],
  Red: [
    [
      ['place-jfk', null],
      ['place-asmnl', 'Ashmont'],
      ['place-brntn', 'Braintree'],
    ],
    null,
  ],
};

const ID_OVERRIDES: Record<string, string> = {
  'Green-B': 'line-Green',
  'Green-C': 'line-Green',
  'Green-D': 'line-Green',
  'Green-E': 'line-Green',
};

const caseKey = (routeId: string) => ID_OVERRIDES[routeId] ?? routeId;

export function getSpecialCaseDestination(
  directionId: DirectionId,
  routeId: string,
  stopId: string | null,
  routeStopIds: string[] | null | undefined,
): string | null {
  const cases = SPECIAL_CASES[caseKey(routeId)]?.[directionId];
  if (!cases || !routeStopIds) return null;
  const stopIndex = stopId === null ? -1 : routeStopIds.indexOf(stopId);
  if (stopIndex === -1) return null;
  const match = cases.find(([caseStop]) => stopIndex <= routeStopIds.indexOf(caseStop));
  return match ? match[1] : null;
}

/** Direction(directionId, route, stop, routeStopIds, patternDestination) constructor. */
export function directionFor(
  directionId: DirectionId,
  route: Route,
  stop?: Stop | null,
  routeStopIds?: string[] | null,
  patternDestination?: string | null,
): Direction {
  return {
    id: directionId,
    name: route.directionNames[directionId] ?? '',
    destination:
      getSpecialCaseDestination(directionId, route.id, stop?.id ?? null, routeStopIds) ??
      patternDestination ??
      route.directionDestinations[directionId],
  };
}

function stopListForPattern(pattern: RoutePattern | undefined, g: GlobalData): string[] | null {
  const ids = pattern ? g.trips[pattern.representativeTripId]?.stopIds : null;
  return ids ? ids.map((id) => g.stops[id]?.parentStationId ?? id) : null;
}

function typicalStopListByDirection(patterns: RoutePattern[], g: GlobalData): Partial<Record<DirectionId, string[] | null>> {
  const out: Partial<Record<DirectionId, string[] | null>> = {};
  for (const d of [0, 1] as const) {
    const inDir = patterns.filter((p) => p.directionId === d);
    if (inDir.length) out[d] = stopListForPattern(inDir.find((p) => p.typicality === 'typical'), g);
  }
  return out;
}

export function getDirections(g: GlobalData, stop: Stop, route: Route, patterns: RoutePattern[]): Direction[] {
  if (!SPECIAL_CASES[caseKey(route.id)]) return ([0, 1] as const).map((d) => directionFor(d, route));
  const byDir = typicalStopListByDirection(patterns, g);
  return ([0, 1] as const).map((d) => directionFor(d, route, stop, byDir[d] ?? null));
}

export function getDirectionForPattern(g: GlobalData, stop: Stop, route: Route, pattern: RoutePattern): Direction {
  if (!SPECIAL_CASES[caseKey(route.id)]) return directionFor(pattern.directionId, route);
  const patternDestination = g.trips[pattern.representativeTripId]?.headsign ?? null;
  return directionFor(pattern.directionId, route, stop, stopListForPattern(pattern, g), patternDestination);
}

/** Government Center is a mid-line terminal for some Green branches: prefer the north label there. */
function govCenterSpecialCase(byDestination: Map<string | null, Direction>): Direction | null {
  const keys = [...byDestination.keys()];
  if (keys.length === 2 && keys.includes('Government Center') && keys.includes(NORTH_STATION_DESTINATION)) {
    return byDestination.get(NORTH_STATION_DESTINATION) ?? null;
  }
  return null;
}

export function getDirectionsForLine(g: GlobalData, stop: Stop, patterns: RoutePattern[]): Direction[] {
  if (patterns.length === 0) return ([0, 1] as const).map((id) => ({ id, name: '', destination: '' }));

  const routeIds: string[] = [];
  for (const p of patterns) if (!routeIds.includes(p.routeId)) routeIds.push(p.routeId);
  const directionsByRoute: Direction[][] = [];
  for (const routeId of routeIds) {
    const route = g.routes[routeId];
    if (!route) return [];
    directionsByRoute.push(
      getDirections(
        g,
        stop,
        route,
        patterns.filter((p) => p.routeId === routeId),
      ),
    );
  }

  return ([0, 1] as const).map((directionId) => {
    const byDestination = new Map<string | null, Direction>();
    for (const dirs of directionsByRoute) {
      const d = dirs[directionId];
      if (d) byDestination.set(d.destination, d);
    }
    if (byDestination.size === 1) return [...byDestination.values()][0];
    if (byDestination.size > 1) {
      const special = govCenterSpecialCase(byDestination);
      if (special) return special;
      const representative = [...byDestination.values()][0];
      return { id: directionId, name: representative.name, destination: null };
    }
    return { id: directionId, name: '', destination: '' };
  });
}

/** e.g. 'Southbound to Ashmont', 'Westbound', or just the destination. */
export function directionLabel(d: Direction): string {
  const name = d.name ? `${d.name}bound` : null;
  if (name && d.destination) return `${name} to ${d.destination}`;
  return name ?? d.destination ?? '';
}
