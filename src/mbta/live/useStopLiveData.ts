import { useCallback, useEffect, useState } from 'react';

import { fetchPredictionsForStops, fetchSchedulesForStops } from '@/mbta/api/endpoints';
import type { Alert, DirectionId, LiveDepartures, ScheduleSet } from '@/mbta/model/types';
import { serviceDate } from '@/mbta/time/eastern';

import { useAlerts } from './useAlerts';
import { DROP_PREDICTIONS_AFTER_MS, POLL, useNow, usePolling, type Polled } from './usePolling';

const SCHEDULE_TTL_MS = 30 * 60_000;
/**
 * A full service day of schedules per stop set can be large downtown, so keep only today's sets
 * and at most this many, least recently used first out. Nearby pans, stop pages and Favorites
 * each use one set.
 */
export const SCHEDULE_CACHE_MAX = 8;
const scheduleCache = new Map<string, { date: string; fetchedAt: number; value: ScheduleSet }>();
const scheduleInflight = new Map<string, Promise<ScheduleSet>>();

/** Drop sets from other service dates, then the least recently used beyond the cap. */
function pruneSchedules(date: string) {
  for (const [key, entry] of scheduleCache) if (entry.date !== date) scheduleCache.delete(key);
  while (scheduleCache.size > SCHEDULE_CACHE_MAX) scheduleCache.delete(scheduleCache.keys().next().value!);
}

/**
 * Today's schedules for a stop set, cached in memory for 30 min per (stops, service date). Map
 * order is recency: a hit is re-inserted at the end.
 */
export function getSchedulesCached(stopIds: string[], date: string): Promise<ScheduleSet> {
  const key = `${date}|${[...new Set(stopIds)].sort().join(',')}`;
  const hit = scheduleCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < SCHEDULE_TTL_MS) {
    scheduleCache.delete(key);
    scheduleCache.set(key, hit);
    return Promise.resolve(hit.value);
  }
  const pending = scheduleInflight.get(key);
  if (pending) return pending;
  // No abort signal: the request is shared by every caller and is cached once it lands.
  const p = fetchSchedulesForStops(stopIds, date, { priority: 'background' })
    .then((value) => {
      scheduleCache.delete(key);
      scheduleCache.set(key, { date, fetchedAt: Date.now(), value });
      pruneSchedules(date);
      return value;
    })
    .finally(() => scheduleInflight.delete(key));
  scheduleInflight.set(key, p);
  return p;
}

/** Test helper: the cached keys, least recently used first. */
export function scheduleCacheKeys(): string[] {
  return [...scheduleCache.keys()];
}

/** Test helper. */
export function clearScheduleCache() {
  scheduleCache.clear();
  scheduleInflight.clear();
}

/**
 * Predictions (polled, focus-aware), today's schedules (once per stop set) and the shared alerts
 * for a set of stop ids. Pass leaf platform ids from global data.
 */
export function useStopLiveData(
  stopIds: string[] | null,
  f?: { routeIds?: string[]; directionId?: DirectionId },
): { predictions: Polled<LiveDepartures>; schedules: ScheduleSet | null; alerts: Alert[] | null } {
  const stopsKey = stopIds && stopIds.length ? [...new Set(stopIds)].sort().join(',') : null;
  const routesKey = f?.routeIds?.length ? [...f.routeIds].sort().join(',') : '';
  const dirKey = f?.directionId ?? '';
  const key = stopsKey ? `stop-live:${stopsKey}|${routesKey}|${dirKey}` : null;

  const fetcher = useCallback(
    (signal: AbortSignal) =>
      fetchPredictionsForStops(
        stopsKey ? stopsKey.split(',') : [],
        { routeIds: routesKey ? routesKey.split(',') : undefined, directionId: dirKey === '' ? undefined : (dirKey as DirectionId) },
        { signal, priority: 'foreground' },
      ),
    [stopsKey, routesKey, dirKey],
  );
  const predictions = usePolling(key, fetcher, {
    intervalMs: POLL.stopPredictionsMs,
    priority: 'foreground',
    dropAfterMs: DROP_PREDICTIONS_AFTER_MS,
  });

  const [schedules, setSchedules] = useState<{ key: string; value: ScheduleSet } | null>(null);
  // Re-evaluated each minute so the schedule set rolls over at the 03:00 service-day boundary.
  const date = serviceDate(useNow(60_000));
  useEffect(() => {
    if (!stopsKey) return;
    const controller = new AbortController();
    const schedKey = `${date}|${stopsKey}`;
    getSchedulesCached(stopsKey.split(','), date)
      .then((value) => {
        if (!controller.signal.aborted) setSchedules({ key: schedKey, value });
      })
      .catch(() => {
        // Schedules are an enhancement (no-service and first-train messages); predictions still render.
      });
    return () => controller.abort();
  }, [stopsKey, date]);

  const alerts = useAlerts();
  return {
    predictions,
    schedules: schedules && stopsKey && schedules.key === `${date}|${stopsKey}` ? schedules.value : null,
    alerts: alerts.data,
  };
}
