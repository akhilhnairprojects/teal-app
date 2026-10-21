import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { fetchAlerts } from '@/mbta/api/endpoints';
import { toErrorDetail, type MbtaErrorDetail } from '@/mbta/api/errors';
import type { Alert } from '@/mbta/model/types';

import { POLL, STALE_AFTER_MS, useNow, type Polled } from './usePolling';

type AlertsState = { data: Alert[] | null; error: MbtaErrorDetail | null; updatedAt: number | null; refreshing: boolean };

/**
 * One app-wide alerts poller (§2.3): it runs while at least one component uses `useAlerts` and
 * the app is in the foreground, so several screens never multiply the request rate.
 */
let state: AlertsState = { data: null, error: null, updatedAt: null, refreshing: false };
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let controller: AbortController | null = null;
let appActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
let appStateSub: { remove(): void } | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<AlertsState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

async function poll(): Promise<void> {
  controller?.abort();
  const c = new AbortController();
  controller = c;
  set({ refreshing: true });
  try {
    const data = await fetchAlerts({ signal: c.signal, priority: 'background' });
    if (c.signal.aborted) return;
    set({ data, error: null, updatedAt: Date.now(), refreshing: false });
  } catch (e) {
    const detail = toErrorDetail(e);
    set(detail.kind === 'aborted' ? { refreshing: false } : { error: detail, refreshing: false });
  }
}

function startTimer() {
  if (timer || subscribers === 0 || !appActive) return;
  const due = state.updatedAt === null || Date.now() - state.updatedAt >= POLL.alertsMs;
  if (due) void poll();
  timer = setInterval(() => void poll(), POLL.alertsMs);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  controller?.abort();
  controller = null;
}

function retain() {
  subscribers++;
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (next) => {
      appActive = next === 'active';
      if (appActive) startTimer();
      else stopTimer();
    });
  }
  startTimer();
}

function release() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0) {
    stopTimer();
    appStateSub?.remove();
    appStateSub = null;
  }
}

/** Test helper. */
export function resetAlertsStore() {
  stopTimer();
  state = { data: null, error: null, updatedAt: null, refreshing: false };
  subscribers = 0;
  appStateSub?.remove();
  appStateSub = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

export function useAlerts(): Polled<Alert[]> & { byId: Record<string, Alert> } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    retain();
    return release;
  }, []);
  const now = useNow(s.data ? 5_000 : 60_000);
  const byId = useMemo(() => Object.fromEntries((s.data ?? []).map((a) => [a.id, a])), [s.data]);
  return {
    data: s.data,
    error: s.error,
    updatedAt: s.updatedAt,
    stale: s.data !== null && s.updatedAt !== null && now - s.updatedAt > STALE_AFTER_MS,
    refreshing: s.refreshing,
    refresh: poll,
    byId,
  };
}
