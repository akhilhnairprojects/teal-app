/**
 * Favorites list data: favorited (line-or-route, stop, direction) triples rendered through the
 * shared route-card pipeline with the `favorites` context, which keeps the service bucket but
 * drops distance sorting and the subway-first bucket [MA §1].
 */
import { childStopIds, type GlobalData } from '@/mbta/global/globalData';
import type { Alert, LiveDepartures, ScheduleSet } from '@/mbta/model/types';
import { directionLabel } from '@/mbta/rules/direction';
import { allRoutes, getLineOrRoute, type LineOrRoute } from '@/mbta/rules/lineOrRoute';
import { leafRsdKey, routeCardsForStaticStopList, routeCardsForStopList, type RouteCard } from '@/mbta/rules/routeCardData';
import { rsdKey, type RouteStopDirection } from '@/state/rsd';

/** Parent stations of the favorites plus their platforms, for the live-data query. */
export function favoriteStopIds(g: GlobalData, favorites: readonly RouteStopDirection[]): string[] {
  const out = new Set<string>();
  for (const f of favorites) {
    if (!g.stops[f.stopId]) continue;
    out.add(f.stopId);
    for (const id of childStopIds(g, f.stopId)) out.add(id);
  }
  return [...out].sort();
}

/** Route ids behind the favorites ('line-Green' expands to its branches), for the live-data filter. */
export function favoriteRouteIds(g: GlobalData, favorites: readonly RouteStopDirection[]): string[] {
  const out = new Set<string>();
  for (const f of favorites) {
    const lr = getLineOrRoute(g, f.routeId);
    if (lr) for (const r of allRoutes(lr)) out.add(r.id);
  }
  return [...out].sort();
}

/** Route cards for the favorites, in Favorites order. Null while global data is missing. */
export function favoriteRouteCards(i: {
  global: GlobalData | null;
  favorites: readonly RouteStopDirection[];
  keys: ReadonlySet<string>;
  schedules: ScheduleSet | null;
  predictions: LiveDepartures | null;
  alerts: Alert[] | null;
  now: number;
}): RouteCard[] | null {
  if (!i.global) return null;
  if (i.favorites.length === 0) return [];
  return routeCardsForStopList({
    stopIds: favoriteStopIds(i.global, i.favorites),
    global: i.global,
    sortByDistanceFrom: null,
    schedules: i.schedules,
    predictions: i.predictions,
    alerts: i.alerts,
    now: i.now,
    context: 'favorites',
    favorites: i.keys,
  });
}

export type FavoriteRow = {
  key: string;
  favorite: RouteStopDirection;
  lineOrRoute: LineOrRoute | null;
  stopName: string | null;
  directionText: string | null;
  /** False when global data no longer has this route serving this stop in this direction. */
  served: boolean;
};

/**
 * One row per stored favorite (in stored order) for edit mode, marking favorites whose stop,
 * route or direction is gone from global data as not served.
 */
export function favoriteRows(g: GlobalData, favorites: readonly RouteStopDirection[], now: number): FavoriteRow[] {
  const keys = new Set(favorites.map(rsdKey));
  const leaves = new Map<string, { direction: string }>();
  const cards = routeCardsForStaticStopList({ stopIds: favoriteStopIds(g, favorites), global: g, context: 'favorites', now, favorites: keys });
  for (const card of cards) {
    for (const stop of card.stops) for (const leaf of stop.leaves) leaves.set(leafRsdKey(leaf), { direction: directionLabel(leaf.direction) });
  }
  return favorites.map((favorite) => {
    const key = rsdKey(favorite);
    const leaf = leaves.get(key);
    return {
      key,
      favorite,
      lineOrRoute: getLineOrRoute(g, favorite.routeId),
      stopName: g.stops[favorite.stopId]?.name ?? null,
      directionText: leaf?.direction || null,
      served: leaf !== undefined,
    };
  });
}
