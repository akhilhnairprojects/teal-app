import type { StopFilter } from '@/features/shell/routes';
import { parentStationId, type GlobalData } from '@/mbta/global/globalData';
import { getLineOrRoute } from '@/mbta/rules/lineOrRoute';
import type { RouteCard, RouteCardLeaf, RouteStopData } from '@/mbta/rules/routeCardData';
import type { RouteStopDirection } from '@/state/rsd';

// The filter's route params are built and parsed by `features/shell/routes.ts`.

/**
 * Normalize a filter against global data: a branch id such as 'Green-B' becomes its card id
 * ('line-Green'). Null for unknown routes.
 */
export function normalizeFilter(g: GlobalData, f: StopFilter | null): StopFilter | null {
  if (!f) return null;
  const lr = getLineOrRoute(g, f.routeId);
  return lr ? { routeId: lr.id, directionId: f.directionId } : null;
}

/** The favorite key for a filtered stop page: card id, parent station, direction. */
export function favoriteFor(g: GlobalData, stopId: string, f: StopFilter): RouteStopDirection | null {
  const n = normalizeFilter(g, f);
  return n ? { routeId: n.routeId, stopId: parentStationId(g, stopId), directionId: n.directionId } : null;
}

/** The card, stop and leaf a filter selects from stop-details route cards. */
export function selectFiltered(
  cards: RouteCard[] | null,
  f: StopFilter | null,
): { card: RouteCard; stopData: RouteStopData; leaf: RouteCardLeaf | null } | null {
  if (!cards || !f) return null;
  const card = cards.find((c) => c.id === f.routeId);
  const stopData = card?.stops[0];
  if (!card || !stopData) return null;
  return { card, stopData, leaf: stopData.leaves.find((l) => l.direction.id === f.directionId) ?? null };
}

/** Stop ids for a stop page: the parent plus its platforms (route cards group them by parent). */
export function stopPageStopIds(g: GlobalData, stopId: string): { parentId: string; allIds: string[]; liveIds: string[] } | null {
  const parentId = parentStationId(g, stopId);
  const parent = g.stops[parentId];
  if (!parent) return null;
  const children = parent.childStopIds.filter((id) => g.stops[id]?.locationType === 0);
  return { parentId, allIds: [parentId, ...children], liveIds: children.length ? children : [parentId] };
}
