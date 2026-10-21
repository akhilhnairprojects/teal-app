/**
 * Rail route shapes for the map and planner. Only direction-0 typical patterns are fetched
 * (the line geometry is the same both ways), one `/shapes/{id}` call each at `static` priority,
 * cached for 7 days or until the set of shape ids changes.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { dataList, mbtaGet } from '@/mbta/api/client';
import { isSubwayType, type DirectionId } from '@/mbta/model/types';
import { readCache, writeCache } from '@/lib/cache';
import { decodePolyline } from '@/lib/polyline';

import { useGlobalData, type GlobalData, type RailShapes } from './globalData';

export const SHAPES_CACHE_KEY = 'teal.shapes.v1';
export const SHAPES_CACHE_VERSION = 1;
export const SHAPES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ShapeRef = { routeId: string; shapeId: string; directionId: DirectionId };

/** Shapes of direction-0 typical (or untyped) patterns on non-shuttle rail routes, deduped. */
export function railShapeRefs(global: GlobalData): ShapeRef[] {
  const seen = new Set<string>();
  const refs: ShapeRef[] = [];
  const patterns = Object.values(global.patterns).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const p of patterns) {
    const route = global.routes[p.routeId];
    if (!route || !isSubwayType(route.type) || route.id.startsWith('Shuttle')) continue;
    if (p.directionId !== 0 || (p.typicality !== null && p.typicality !== 'typical')) continue;
    const shapeId = global.trips[p.representativeTripId]?.shapeId;
    if (!shapeId || seen.has(shapeId)) continue;
    seen.add(shapeId);
    refs.push({ routeId: p.routeId, shapeId, directionId: p.directionId });
  }
  return refs;
}

const refsKey = (refs: ShapeRef[]) =>
  refs
    .map((r) => r.shapeId)
    .sort()
    .join(',');

export async function fetchRailShapes(global: GlobalData, signal?: AbortSignal): Promise<RailShapes> {
  const refs = railShapeRefs(global);
  const results = await Promise.all(
    refs.map(async (ref) => {
      const res = await mbtaGet(`/shapes/${encodeURIComponent(ref.shapeId)}`, undefined, { signal, priority: 'static' });
      const [shape] = dataList(res.doc);
      const polyline = (shape?.attributes as { polyline?: unknown } | undefined)?.polyline;
      return { ref, coordinates: typeof polyline === 'string' ? decodePolyline(polyline) : [] };
    }),
  );
  const shapes: RailShapes = {};
  for (const { ref, coordinates } of results) {
    (shapes[ref.routeId] ??= []).push({ shapeId: ref.shapeId, directionId: ref.directionId, coordinates });
  }
  return shapes;
}

type CachedShapes = { key: string; shapes: RailShapes };

let current: RailShapes | null = null;
let loadingFor: string | null = null;
const listeners = new Set<() => void>();
const publish = (s: RailShapes) => {
  current = s;
  listeners.forEach((l) => l());
};

async function loadShapes(global: GlobalData) {
  const key = refsKey(railShapeRefs(global));
  if (loadingFor === key) return;
  loadingFor = key;
  const cached = await readCache<CachedShapes>(SHAPES_CACHE_KEY, SHAPES_CACHE_VERSION, {
    ttlMs: SHAPES_TTL_MS,
    isFresh: (env) => env.value.key === key,
  });
  if (cached) publish(cached.value.shapes);
  if (cached?.fresh) return;
  try {
    const shapes = await fetchRailShapes(global);
    await writeCache<CachedShapes>(SHAPES_CACHE_KEY, SHAPES_CACHE_VERSION, { key, shapes });
    publish(shapes);
  } catch {
    // Keep any cached shapes; retry on the next global-data change.
    loadingFor = null;
  }
}

/** Rail shapes once global data is available; null until loaded. */
export function useRailShapes(): RailShapes | null {
  const { data } = useGlobalData();
  const shapes = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
  useEffect(() => {
    if (data) void loadShapes(data);
  }, [data]);
  return shapes;
}

/** Test helper. */
export function resetShapesStore() {
  current = null;
  loadingFor = null;
}
