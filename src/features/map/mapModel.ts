/** Pure map data shared by the native (Apple Maps) and web (SVG) maps. */
import type { GlobalData, RailShapes } from '@/mbta/global/globalData';
import type { LatLng } from '@/lib/geo';

export type TealMapProps = {
  /** Height of the sheet covering the bottom of the map, so camera moves center on the visible area. */
  bottomInset: number;
  /** Safe-area top inset. */
  topInset: number;
};

/** Above this latitude span (zoomed out), only transfer stations are drawn. */
export const STATION_ZOOM_LIMIT = 0.12;
/** Opacity of routes outside the overlay's emphasis. */
export const DIMMED_OPACITY = 0.3;
export const SHAPE_WIDTH = 4;

/**
 * Overlay route ids may be LineOrRoute ids (`line-Green`); expand those to the line's routes and
 * drop ids global data does not know.
 */
export function expandRouteIds(g: GlobalData | null, ids: readonly string[] | undefined): string[] {
  if (!g || !ids?.length) return [];
  const out = new Set<string>();
  for (const id of ids) {
    if (g.routes[id]) {
      out.add(id);
      continue;
    }
    for (const r of Object.values(g.routes)) if (r.lineId === id) out.add(r.id);
  }
  return [...out].sort();
}

export type MapStation = {
  id: string;
  name: string;
  latLng: LatLng;
  /** Line (or route, when it has no line) ids serving the station. */
  lineIds: string[];
  /** Served by two or more lines (Green branches count as one line). */
  transfer: boolean;
  /** Color of the single serving line; null at transfer stations. */
  color: string | null;
};

/** Parent stations served by at least one pattern in global data, with their lines. */
export function mapStations(g: GlobalData): MapStation[] {
  const out: MapStation[] = [];
  for (const stop of Object.values(g.stops)) {
    if (stop.locationType !== 1) continue;
    const lines = new Map<string, string>();
    for (const leafId of [stop.id, ...stop.childStopIds]) {
      for (const patternId of g.patternIdsByStop[leafId] ?? []) {
        const route = g.routes[g.patterns[patternId]?.routeId ?? ''];
        if (!route || route.id.startsWith('Shuttle')) continue;
        const lineId = route.lineId ?? route.id;
        if (!lines.has(lineId)) lines.set(lineId, g.lines[lineId]?.color ?? route.color);
      }
    }
    if (lines.size === 0) continue;
    const lineIds = [...lines.keys()].sort();
    out.push({
      id: stop.id,
      name: stop.name,
      latLng: { latitude: stop.latitude, longitude: stop.longitude },
      lineIds,
      transfer: lineIds.length > 1,
      color: lineIds.length === 1 ? lines.get(lineIds[0])! : null,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function visibleStations(stations: MapStation[], latitudeDelta: number, focusStopId: string | null | undefined): MapStation[] {
  if (latitudeDelta <= STATION_ZOOM_LIMIT) return stations;
  return stations.filter((s) => s.transfer || s.id === focusStopId);
}

export type ShapeLine = { key: string; routeId: string; color: string; coordinates: LatLng[]; dimmed: boolean };

/** Rail shapes to draw; emphasized routes are last so they render on top. */
export function shapeLines(g: GlobalData | null, shapes: RailShapes | null, emphasis: readonly string[]): ShapeLine[] {
  if (!shapes) return [];
  const emphasized = new Set(emphasis);
  const lines: ShapeLine[] = [];
  for (const [routeId, list] of Object.entries(shapes)) {
    const route = g?.routes[routeId];
    for (const shape of list) {
      if (shape.coordinates.length < 2) continue;
      lines.push({
        key: `${routeId}:${shape.shapeId}`,
        routeId,
        color: route?.color ?? '#888888',
        coordinates: shape.coordinates,
        dimmed: emphasized.size > 0 && !emphasized.has(routeId),
      });
    }
  }
  return lines.sort((a, b) => Number(b.dimmed) - Number(a.dimmed) || a.key.localeCompare(b.key));
}

/** '#RRGGBB' plus an alpha as an rgba() color (other inputs are returned unchanged). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
