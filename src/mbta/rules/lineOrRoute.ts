// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/LineOrRoute.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Grouping rules from model/Line.kt, model/Route.kt and model/response/GlobalResponse.kt, same commit.
import type { GlobalData } from '@/mbta/global/globalData';
import { isSubwayType, type Line, type Route, type RouteType, type Stop } from '@/mbta/model/types';

export type LineOrRoute = { kind: 'route'; id: string; route: Route } | { kind: 'line'; id: string; line: Line; routes: Route[] };

/** Lines shown as one card with branches (Line.groupedIds). */
export const GROUPED_LINE_IDS: readonly string[] = ['line-Green'];
export const GREEN_ROUTES: readonly string[] = ['Green-B', 'Green-C', 'Green-D', 'Green-E'];
/** Silver Line routes (MapStopRoute.silverRoutes): they hide scheduled times like subway and use the silver alert icon. */
export const SILVER_ROUTES: readonly string[] = ['741', '742', '743', '751', '749', '746'];

export const isShuttleRoute = (r: Route): boolean => r.id.startsWith('Shuttle');

/** Lines with their non-shuttle routes, in global-data order. */
export function routesByLineId(g: GlobalData): Record<string, Route[]> {
  const out: Record<string, Route[]> = {};
  for (const r of Object.values(g.routes)) {
    if (r.lineId && !isShuttleRoute(r)) (out[r.lineId] ??= []).push(r);
  }
  return out;
}

export const routeOf = (r: Route): LineOrRoute => ({ kind: 'route', id: r.id, route: r });

export const lineOf = (line: Line, routes: Route[]): LineOrRoute => ({ kind: 'line', id: line.id, line, routes });

/** The card a route belongs to: its grouped line (Green) unless it is a shuttle, else itself. */
export function lineOrRouteFor(g: GlobalData, route: Route, byLine = routesByLineId(g)): LineOrRoute {
  const line = route.lineId ? g.lines[route.lineId] : undefined;
  if (line && !isShuttleRoute(route) && GROUPED_LINE_IDS.includes(line.id)) return lineOf(line, byLine[line.id] ?? []);
  return routeOf(route);
}

/** Look up a card by id ('line-Green' or a route id). */
export function getLineOrRoute(g: GlobalData, id: string): LineOrRoute | null {
  const route = g.routes[id];
  const line = g.lines[id] ?? (route?.lineId ? g.lines[route.lineId] : undefined);
  if (line && GROUPED_LINE_IDS.includes(line.id)) return lineOf(line, routesByLineId(g)[line.id] ?? []);
  return route ? routeOf(route) : null;
}

/** The route whose sort order represents the card (lowest sort order of a line's routes). */
export function sortRoute(lr: LineOrRoute): Route {
  if (lr.kind === 'route') return lr.route;
  return lr.routes.reduce((min, r) => (r.sortOrder < min.sortOrder ? r : min), lr.routes[0]);
}

export function lineOrRouteType(lr: LineOrRoute): RouteType {
  return lr.kind === 'route' ? lr.route.type : sortRoute(lr).type;
}

export const allRoutes = (lr: LineOrRoute): Route[] => (lr.kind === 'route' ? [lr.route] : lr.routes);

export const isSubwayLineOrRoute = (lr: LineOrRoute): boolean =>
  lr.kind === 'line' ? lr.routes.some((r) => isSubwayType(r.type)) : isSubwayType(lr.route.type);

export const isShuttleLineOrRoute = (lr: LineOrRoute): boolean => lr.kind === 'route' && isShuttleRoute(lr.route);

export const containsRoute = (lr: LineOrRoute, routeId: string | null | undefined): boolean =>
  lr.kind === 'line' ? lr.routes.some((r) => r.id === routeId) : lr.id === routeId;

export const lineOrRouteName = (lr: LineOrRoute): string => (lr.kind === 'line' ? lr.line.longName : routeLabel(lr.route));

export const lineOrRouteColors = (lr: LineOrRoute): { color: string; textColor: string } =>
  lr.kind === 'line' ? { color: lr.line.color, textColor: lr.line.textColor } : { color: lr.route.color, textColor: lr.route.textColor };

/** Route.label: bus short name, CR long name with spaced slashes, else long name. */
export function routeLabel(r: Route): string {
  if (r.type === 3) return r.shortName;
  if (r.type === 2) return r.longName.replace(/\//g, ' / ');
  return r.longName;
}

/** Stop.resolveParent: the root station, or the stop itself when its parent is unknown. */
export function resolveParentStop(stops: Record<string, Stop>, stop: Stop): Stop {
  let current = stop;
  for (let guard = 0; guard < 5; guard++) {
    if (!current.parentStationId) return current;
    const parent = stops[current.parentStationId];
    if (!parent) return current;
    current = parent;
  }
  return current;
}

const CR_CORE_STATIONS: readonly string[] = ['place-north', 'place-sstat', 'place-bbsta', 'place-rugg'];

export const isCRCore = (stop: Stop): boolean =>
  CR_CORE_STATIONS.includes(stop.id) || (stop.parentStationId !== null && CR_CORE_STATIONS.includes(stop.parentStationId));
