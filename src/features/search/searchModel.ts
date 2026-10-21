/**
 * Search page data over cached global data: recent stops for an empty query, otherwise
 * station and route matches from `rules/search.ts`. Behavior follows MBTA Go's search view
 * (recents when empty, routes and stops when typing) [MA Search]; ranking is Teal's own.
 */
import { useEffect, useState } from 'react';

import { parentStationId, STOP_BLOCKLIST, type GlobalData } from '@/mbta/global/globalData';
import type { Stop } from '@/mbta/model/types';
import { allRoutes, type LineOrRoute } from '@/mbta/rules/lineOrRoute';
import { matchRoutes, matchStations, normalizeSearch, routeIdsAtStation, type StopMatch } from '@/mbta/rules/search';

export const SEARCH_DEBOUNCE_MS = 300;
export const STATION_LIMIT = 8;
export const ROUTE_LIMIT = 4;

export type RecentStop = { stop: Stop; routeIds: string[] };

export type SearchResults =
  | { kind: 'recents'; recents: RecentStop[] }
  | { kind: 'results'; query: string; routes: LineOrRoute[]; stations: StopMatch[] };

/** Recent stop ids resolved to their parent stations, deduped, unknown ids dropped. */
export function resolveRecents(g: GlobalData, stopIds: readonly string[]): RecentStop[] {
  const seen = new Set<string>();
  const out: RecentStop[] = [];
  for (const id of stopIds) {
    const parentId = parentStationId(g, id);
    const stop = g.stops[parentId];
    if (!stop || seen.has(parentId) || STOP_BLOCKLIST.includes(parentId)) continue;
    seen.add(parentId);
    out.push({ stop, routeIds: routeIdsAtStation(g, parentId) });
  }
  return out;
}

export function searchResults(g: GlobalData, query: string, recentStopIds: readonly string[]): SearchResults {
  if (!normalizeSearch(query)) return { kind: 'recents', recents: resolveRecents(g, recentStopIds) };
  return {
    kind: 'results',
    query: query.trim(),
    routes: matchRoutes(g, query, ROUTE_LIMIT),
    stations: matchStations(g, query, STATION_LIMIT),
  };
}

/**
 * Parent stations along a line or route, in travel order of its longest typical direction-0
 * pattern per route (branches appended after the shared trunk), for the inline route list.
 */
export function stationsOnRoute(g: GlobalData, lr: LineOrRoute): Stop[] {
  const routeIds = new Set(allRoutes(lr).map((r) => r.id));
  const patterns = Object.values(g.patterns)
    .filter((p) => routeIds.has(p.routeId) && p.directionId === 0 && (p.typicality === 'typical' || p.typicality === null))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const seen = new Set<string>();
  const out: Stop[] = [];
  for (const p of patterns) {
    for (const id of g.trips[p.representativeTripId]?.stopIds ?? []) {
      const parentId = parentStationId(g, id);
      const stop = g.stops[parentId];
      if (!stop || seen.has(parentId) || STOP_BLOCKLIST.includes(parentId)) continue;
      seen.add(parentId);
      out.push(stop);
    }
  }
  return out;
}

/** `value`, updated only after it has been stable for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
