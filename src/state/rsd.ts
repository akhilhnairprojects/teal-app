// RouteStopDirection ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/Favorite.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { DirectionId } from '@/mbta/model/types';

/** A favorited (line-or-route, parent stop, direction). Port of MBTA Go's RouteStopDirection. */
export type RouteStopDirection = { routeId: string /* LineOrRoute id, e.g. 'line-Green' */; stopId: string /* parent */; directionId: DirectionId };

export const rsdKey = (r: RouteStopDirection) => `${r.routeId}|${r.stopId}|${r.directionId}`;

/** Inverse of `rsdKey`; null for malformed keys. */
export function parseRsdKey(key: string): RouteStopDirection | null {
  const parts = key.split('|');
  if (parts.length !== 3 || !parts[0] || !parts[1] || (parts[2] !== '0' && parts[2] !== '1')) return null;
  return { routeId: parts[0], stopId: parts[1], directionId: parts[2] === '1' ? 1 : 0 };
}
