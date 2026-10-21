import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { RequestPriority } from '@/mbta/api/budget';
import { HAS_API_KEY } from '@/mbta/api/client';
import { toErrorDetail, type MbtaErrorDetail } from '@/mbta/api/errors';

export type Polled<T> = {
  data: T | null;
  error: MbtaErrorDetail | null;
  updatedAt: number | null;
  /** More than 2 min since the last successful update, while holding data [MA §2.2]. */
  stale: boolean;
  refreshing: boolean;
  refresh(): Promise<void>;
};

/** Poll intervals per stream (§2.3), slower without an API key. */
export const POLL: { stopPredictionsMs: number; alertsMs: number; vehiclesMs: number; tripMs: number; planMs: number } = HAS_API_KEY
  ? { stopPredictionsMs: 10_000, alertsMs: 60_000, vehiclesMs: 10_000, tripMs: 10_000, planMs: 30_000 }
  : { stopPredictionsMs: 30_000, alertsMs: 120_000, vehiclesMs: 30_000, tripMs: 30_000, planMs: 60_000 };

export const STALE_AFTER_MS = 2 * 60_000;
/** Predictions older than this are discarded entirely [MA §2.2]. */
export const DROP_PREDICTIONS_AFTER_MS = 10 * 60_000;

/** Re-render on an interval so countdowns stay current between fetches. */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Whether the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => setActive(next === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Screen focus that degrades to "focused" outside a navigator (tests, the map shell).
 * `useIsFocused` throws before using any stateful hook when no navigation object exists, and that
 * outcome is fixed for a component's lifetime, so hook order stays stable.
 */
function useFocusedOrTrue(): boolean {
  try {
    return useIsFocused();
  } catch {
    return true;
  }
}

type State<T> = { key: string | null; data: T | null; error: MbtaErrorDetail | null; updatedAt: number | null; refreshing: boolean };

/**
 * Last successful result per key, shared by every `usePolling` instance. Tab switches and pops
 * remount screens; the new instance shows this data at once and waits out the rest of the
 * interval instead of spending another request (the keyless budget is 20 calls/min).
 */
const POLL_CACHE_MAX = 16;
const pollCache = new Map<string, { data: unknown; updatedAt: number }>();

function cached<T>(key: string | null): { data: T; updatedAt: number } | null {
  const hit = key === null ? undefined : pollCache.get(key);
  return hit ? { data: hit.data as T, updatedAt: hit.updatedAt } : null;
}

function remember(key: string, data: unknown, updatedAt: number) {
  pollCache.delete(key); // re-insert so the Map's order is least recently updated first
  pollCache.set(key, { data, updatedAt });
  if (pollCache.size > POLL_CACHE_MAX) pollCache.delete(pollCache.keys().next().value!);
}

/** Test helper. */
export function clearPollCache() {
  pollCache.clear();
}

/** State for a key, seeded from the shared cache. */
function initialState<T>(key: string | null): State<T> {
  const hit = cached<T>(key);
  return { key, data: hit?.data ?? null, error: null, updatedAt: hit?.updatedAt ?? null, refreshing: false };
}

/**
 * Fetch `fetcher` every `intervalMs` while `key` is non-null, the app is foregrounded and (when
 * `focusAware`, the default) the screen is focused. The first fetch is immediate unless the shared
 * cache holds a result for the key younger than `intervalMs`; that result is shown meanwhile. A new
 * key shows that key's cached data (or none). Errors keep the last data. `dropAfterMs` discards
 * data that has not refreshed for that long.
 */
export function usePolling<T>(
  key: string | null,
  fetcher: (s: AbortSignal) => Promise<T>,
  o: { intervalMs: number; priority?: RequestPriority; focusAware?: boolean; dropAfterMs?: number },
): Polled<T> {
  const focused = useFocusedOrTrue();
  const appActive = useAppActive();
  const active = key !== null && appActive && (o.focusAware === false || focused);

  const [state, setState] = useState<State<T>>(() => initialState<T>(key));
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const controllerRef = useRef<AbortController | null>(null);
  const keyRef = useRef(key);

  // A different key means a different query: start over from that key's cached result.
  if (state.key !== key) {
    setState(initialState<T>(key));
  }

  const run = useCallback(async () => {
    const runKey = keyRef.current;
    if (runKey === null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((s) => (s.key === runKey ? { ...s, refreshing: true } : s));
    try {
      const data = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return;
      const updatedAt = Date.now();
      remember(runKey, data, updatedAt);
      setState((s) => (s.key === runKey ? { ...s, data, error: null, updatedAt, refreshing: false } : s));
    } catch (e) {
      const detail = toErrorDetail(e);
      if (detail.kind === 'aborted' || controller.signal.aborted) {
        setState((s) => (s.key === runKey ? { ...s, refreshing: false } : s));
        return;
      }
      setState((s) => (s.key === runKey ? { ...s, error: detail, refreshing: false } : s));
    }
  }, []);

  useEffect(() => {
    keyRef.current = key;
    if (!active) return;
    // Fresh shared data (another instance, or this screen before a remount) defers the first fetch.
    const last = cached(key)?.updatedAt ?? null;
    const wait = last === null ? 0 : Math.max(0, o.intervalMs - (Date.now() - last));
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      void run();
      interval = setInterval(() => void run(), o.intervalMs);
    };
    const timeout = wait > 0 ? setTimeout(start, wait) : null;
    if (wait === 0) start();
    return () => {
      if (timeout !== null) clearTimeout(timeout);
      if (interval !== null) clearInterval(interval);
      controllerRef.current?.abort();
    };
  }, [active, key, o.intervalMs, run]);

  const current = state.key === key ? state : initialState<T>(key);
  // Tick every 5 s while holding data so `stale` and the drop rule update [MA §2.2].
  const now = useNow(current.data !== null ? 5_000 : 60_000);
  const age = current.updatedAt !== null ? now - current.updatedAt : null;
  const dropped = o.dropAfterMs !== undefined && age !== null && age > o.dropAfterMs;

  return {
    data: dropped ? null : current.data,
    error: current.error,
    updatedAt: current.updatedAt,
    stale: current.data !== null && age !== null && age > STALE_AFTER_MS,
    refreshing: current.refreshing,
    refresh: run,
  };
}
