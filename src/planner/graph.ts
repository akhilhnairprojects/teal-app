/**
 * The rail graph the planner searches [AR §3.1]: typical/canonical patterns of the subway and
 * Mattapan, collapsed to ordered parent-station sequences with an index per station. Direction
 * comes from pattern order, never from assumptions about direction ids [AR §3.4].
 */
import { parentStationId, type GlobalData } from '@/mbta/global/globalData';
import { isSubwayType, type DirectionId, type Route, type RouteType, type Stop } from '@/mbta/model/types';

import { GREEN_SUBWAY_STATIONS, HOP_MIN } from './constants';

export type GraphPattern = {
  id: string;
  routeId: string;
  routeType: RouteType;
  directionId: DirectionId;
  /** Line id when the route belongs to one (all Green branches share 'line-Green'), else the route id. */
  lineKey: string;
  headsign: string;
  /** Ordered parent stations. */
  stations: string[];
  index: Record<string, number>;
};

/** A ride between two stations on one line and direction; any of `routeIds` qualifies. */
export type LegSpec = {
  key: string;
  lineKey: string;
  directionId: DirectionId;
  from: string;
  to: string;
  routeIds: string[];
  /** Fewest hops over the serving patterns. */
  hops: number;
  /** Hop-based ride estimate in minutes. */
  rideMin: number;
  /** Stations strictly between `from` and `to` on the shortest serving pattern. */
  between: string[];
  /** Headsigns of patterns that serve the leg, and of every pattern on its routes and direction. */
  servingHeadsigns: string[];
  knownHeadsigns: string[];
};

export type TransitGraph = {
  patterns: GraphPattern[];
  byStation: Record<string, GraphPattern[]>;
  /** Parent stations on any pattern. */
  stations: Record<string, Stop>;
  /** Stations shared by two routes, or by two patterns of one route and direction. */
  transferStations: ReadonlySet<string>;
  legCache: Map<string, LegSpec | null>;
};

export const lineKeyOf = (route: Route): string => route.lineId ?? route.id;

function plannerRoute(route: Route | undefined): route is Route {
  return !!route && isSubwayType(route.type) && !route.id.startsWith('Shuttle');
}

export function buildGraph(g: GlobalData): TransitGraph {
  const patterns: GraphPattern[] = [];
  const seen = new Set<string>();
  const ordered = Object.values(g.patterns).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  for (const p of ordered) {
    const route = g.routes[p.routeId];
    if (!plannerRoute(route)) continue;
    if (!(p.canonical || p.typicality === 'typical' || p.typicality === null)) continue;
    const trip = g.trips[p.representativeTripId];
    if (!trip?.stopIds?.length) continue;
    const stations: string[] = [];
    for (const platformId of trip.stopIds) {
      const station = parentStationId(g, platformId);
      if (stations[stations.length - 1] !== station) stations.push(station);
    }
    if (stations.length < 2) continue;
    const signature = `${p.routeId}|${p.directionId}|${stations.join(',')}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const index: Record<string, number> = {};
    stations.forEach((s, i) => {
      if (index[s] === undefined) index[s] = i;
    });
    patterns.push({
      id: p.id,
      routeId: route.id,
      routeType: route.type,
      directionId: p.directionId,
      lineKey: lineKeyOf(route),
      headsign: trip.headsign,
      stations,
      index,
    });
  }

  const byStation: Record<string, GraphPattern[]> = {};
  const stations: Record<string, Stop> = {};
  for (const p of patterns) {
    for (const s of p.stations) {
      const list = (byStation[s] ??= []);
      if (!list.includes(p)) list.push(p);
      const stop = g.stops[s];
      if (stop) stations[s] = stop;
    }
  }
  // Shared by two routes, or by two patterns of one route and direction (a branch trunk). A station
  // served by one pattern each way is not a transfer point.
  const transferStations = new Set(
    Object.keys(byStation).filter((s) => {
      const list = byStation[s];
      const routes = new Set(list.map((p) => p.routeId));
      const routeDirs = new Set(list.map((p) => `${p.routeId}|${p.directionId}`));
      return routes.size >= 2 || routeDirs.size < list.length;
    }),
  );
  return { patterns, byStation, stations, transferStations, legCache: new Map() };
}

const graphs = new WeakMap<GlobalData, TransitGraph>();

/** The graph for this global-data snapshot, built once and reused across plans and refreshes. */
export function graphFor(g: GlobalData): TransitGraph {
  let graph = graphs.get(g);
  if (!graph) {
    graph = buildGraph(g);
    graphs.set(g, graph);
  }
  return graph;
}

/** Minutes for one hop between adjacent stations. */
export function hopMinutes(p: GraphPattern, a: string, b: string): number {
  if (p.routeType === 1) return HOP_MIN.heavyRail;
  if (p.lineKey === 'line-Green' && GREEN_SUBWAY_STATIONS.has(a) && GREEN_SUBWAY_STATIONS.has(b)) return HOP_MIN.greenSubway;
  return HOP_MIN.lightRailSurface;
}

/** True when `p` serves `from` and later `to`. */
export const serves = (p: GraphPattern, from: string, to: string): boolean =>
  p.index[from] !== undefined && p.index[to] !== undefined && p.index[from] < p.index[to];

/** The leg from `from` to `to` on a line and direction, or null when no pattern serves it in order. */
export function legSpec(graph: TransitGraph, lineKey: string, directionId: DirectionId, from: string, to: string): LegSpec | null {
  const key = `${lineKey}|${directionId}|${from}|${to}`;
  const cached = graph.legCache.get(key);
  if (cached !== undefined) return cached;
  const onLine = graph.patterns.filter((p) => p.lineKey === lineKey && p.directionId === directionId);
  const serving = onLine.filter((p) => serves(p, from, to));
  let spec: LegSpec | null = null;
  if (serving.length > 0) {
    let best = serving[0];
    for (const p of serving) if (p.index[to] - p.index[from] < best.index[to] - best.index[from]) best = p;
    const i = best.index[from];
    const j = best.index[to];
    let rideMin = 0;
    for (let k = i; k < j; k++) rideMin += hopMinutes(best, best.stations[k], best.stations[k + 1]);
    const routeIds = [...new Set(serving.map((p) => p.routeId))];
    spec = {
      key,
      lineKey,
      directionId,
      from,
      to,
      routeIds,
      hops: j - i,
      rideMin,
      between: best.stations.slice(i + 1, j),
      servingHeadsigns: [...new Set(serving.map((p) => p.headsign))],
      knownHeadsigns: [...new Set(onLine.filter((p) => routeIds.includes(p.routeId)).map((p) => p.headsign))],
    };
  }
  graph.legCache.set(key, spec);
  return spec;
}

/** Every leg (one per line and direction) that rides directly from `from` to `to`. */
export function directLegs(graph: TransitGraph, from: string, to: string): LegSpec[] {
  if (from === to) return [];
  const seen = new Set<string>();
  const legs: LegSpec[] = [];
  for (const p of graph.byStation[from] ?? []) {
    if (!serves(p, from, to)) continue;
    const k = `${p.lineKey}|${p.directionId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const spec = legSpec(graph, p.lineKey, p.directionId, from, to);
    if (spec) legs.push(spec);
  }
  return legs;
}
