// Key semantics from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/Favorite.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
/**
 * Favorited (line-or-route, stop, direction) triples, persisted in AsyncStorage. Key semantics
 * follow MBTA Go's RouteStopDirection (Favorite.kt): equality is by all three fields, and Green
 * Line favorites use the 'line-Green' id. Teal has no notification settings.
 */
import { useMemo, useSyncExternalStore, useEffect } from 'react';

import { readCache, writeCache } from '@/lib/cache';

import { rsdKey, type RouteStopDirection } from './rsd';

export { rsdKey, parseRsdKey, type RouteStopDirection } from './rsd';

export const FAVORITES_KEY = 'teal.favorites.v1';
export const FAVORITES_VERSION = 1;

/** Parse persisted favorites, dropping malformed entries and duplicates (first wins). */
export function deserializeFavorites(raw: unknown): RouteStopDirection[] {
  if (!Array.isArray(raw)) return [];
  const out: RouteStopDirection[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue;
    const { routeId, stopId, directionId } = x as Record<string, unknown>;
    if (typeof routeId !== 'string' || !routeId || typeof stopId !== 'string' || !stopId) continue;
    if (directionId !== 0 && directionId !== 1) continue;
    const rsd: RouteStopDirection = { routeId, stopId, directionId };
    const key = rsdKey(rsd);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rsd);
  }
  return out;
}

export const serializeFavorites = (list: RouteStopDirection[]): RouteStopDirection[] =>
  list.map(({ routeId, stopId, directionId }) => ({ routeId, stopId, directionId }));

/** Add if absent, remove if present. Returns a new list. */
export function toggleFavorite(list: RouteStopDirection[], r: RouteStopDirection): RouteStopDirection[] {
  const key = rsdKey(r);
  return list.some((f) => rsdKey(f) === key) ? list.filter((f) => rsdKey(f) !== key) : [...list, { ...r }];
}

type FavState = { ready: boolean; favorites: RouteStopDirection[] };
let state: FavState = { ready: false, favorites: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: FavState) {
  state = next;
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  loading ??= (async () => {
    const hit = await readCache<unknown>(FAVORITES_KEY, FAVORITES_VERSION);
    set({ ready: true, favorites: deserializeFavorites(hit?.value) });
  })();
  return loading;
}

async function save(list: RouteStopDirection[]) {
  set({ ready: true, favorites: list });
  await writeCache(FAVORITES_KEY, FAVORITES_VERSION, serializeFavorites(list));
}

export async function toggleFavoriteStored(r: RouteStopDirection): Promise<void> {
  await load();
  await save(toggleFavorite(state.favorites, r));
}

export async function removeFavoriteStored(r: RouteStopDirection): Promise<void> {
  await load();
  const key = rsdKey(r);
  await save(state.favorites.filter((f) => rsdKey(f) !== key));
}

/** Test helper. */
export function resetFavoritesStore() {
  state = { ready: false, favorites: [] };
  loading = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

export function useFavorites(): {
  ready: boolean;
  favorites: RouteStopDirection[];
  keys: ReadonlySet<string>;
  isFavorite(r: RouteStopDirection): boolean;
  toggle(r: RouteStopDirection): Promise<void>;
  remove(r: RouteStopDirection): Promise<void>;
} {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void load();
  }, []);
  const keys = useMemo(() => new Set(s.favorites.map(rsdKey)), [s.favorites]);
  return {
    ready: s.ready,
    favorites: s.favorites,
    keys,
    isFavorite: (r) => keys.has(rsdKey(r)),
    toggle: toggleFavoriteStored,
    remove: removeFavoriteStored,
  };
}
