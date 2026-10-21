/** Recently visited stops (most recent first, deduped, max 10), persisted in AsyncStorage. */
import { useEffect, useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';

export const RECENTS_KEY = 'teal.recentStops.v1';
export const RECENTS_VERSION = 1;
export const MAX_RECENTS = 10;

/** Put `stopId` first, remove its older occurrence, cap the list. */
export function pushRecent(list: readonly string[], stopId: string, max = MAX_RECENTS): string[] {
  return [stopId, ...list.filter((id) => id !== stopId)].slice(0, max);
}

function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
  return out.slice(0, MAX_RECENTS);
}

type RecentState = { ready: boolean; stopIds: string[] };
let state: RecentState = { ready: false, stopIds: [] };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: RecentState) {
  state = next;
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  loading ??= (async () => {
    const hit = await readCache<unknown>(RECENTS_KEY, RECENTS_VERSION);
    set({ ready: true, stopIds: sanitize(hit?.value) });
  })();
  return loading;
}

export async function recordStopVisit(stopId: string): Promise<void> {
  await load();
  const next = pushRecent(state.stopIds, stopId);
  set({ ready: true, stopIds: next });
  await writeCache(RECENTS_KEY, RECENTS_VERSION, next);
}

/** Test helper. */
export function resetRecentsStore() {
  state = { ready: false, stopIds: [] };
  loading = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

export function useRecentStops(): { ready: boolean; stopIds: string[] } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void load();
  }, []);
  return s;
}
