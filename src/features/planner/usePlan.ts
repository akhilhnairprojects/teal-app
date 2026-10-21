/**
 * Runs the planner for a request and refreshes it every `POLL.planMs` while the Plan screen is
 * focused. The first run prepares the plan (stations, Bluebikes, weather); refreshes only
 * re-evaluate it, which costs one MBTA predictions call.
 */
import { useEffect, useRef } from 'react';

import { fetchBikeStations } from '@/data/bluebikes';
import { fetchPredictionsForStops, fetchSchedulesForTrip, fetchSchedulesWindow } from '@/mbta/api/endpoints';
import { useGlobalData, type GlobalData } from '@/mbta/global/globalData';
import { useAlerts } from '@/mbta/live/useAlerts';
import { POLL, usePolling, type Polled } from '@/mbta/live/usePolling';
import type { Alert } from '@/mbta/model/types';
import { evaluatePlan, preparePlan, type PlanContext } from '@/planner/engine';
import type { PlannerDeps, PlanRequest, PlanResult } from '@/planner/types';
import { fetchWeather } from '@/weather/nws';

export function livePlannerDeps(global: GlobalData, alerts: Alert[] | null): PlannerDeps {
  return {
    global,
    alerts,
    now: Date.now,
    fetchPredictions: fetchPredictionsForStops,
    fetchSchedulesForTrip,
    fetchSchedulesWindow,
    fetchBikeStations: () => fetchBikeStations(),
    fetchWeather: (at) => fetchWeather(at),
  };
}

const round = (n: number) => n.toFixed(5);

export type PlanPlaces = Pick<PlanRequest, 'origin' | 'destination'>;

/** Identity of a request for polling: the two places, not the time it was made. */
export function planKey(req: PlanPlaces | null): string | null {
  if (!req) return null;
  const p = (x: PlanRequest['origin']) => `${x.stopId ?? ''}@${round(x.latLng.latitude)},${round(x.latLng.longitude)}`;
  return `plan:${p(req.origin)}>${p(req.destination)}`;
}

export function usePlan(req: PlanPlaces | null): Polled<PlanResult> & { ready: boolean } {
  const global = useGlobalData();
  const alerts = useAlerts();
  const depsRef = useRef<PlannerDeps | null>(null);
  const reqRef = useRef(req);
  // Declared before usePolling so the refs are current when its first fetch runs.
  useEffect(() => {
    depsRef.current = global.data ? livePlannerDeps(global.data, alerts.data) : null;
    reqRef.current = req;
  });
  const ctxRef = useRef<{ key: string; global: GlobalData; ctx: PlanContext } | null>(null);

  const key = global.data ? planKey(req) : null;
  const polled = usePolling<PlanResult>(
    key,
    async (signal) => {
      const deps = depsRef.current;
      const request = reqRef.current;
      if (!deps || !request || !key) throw new Error('Planner is not ready');
      let entry = ctxRef.current;
      if (!entry || entry.key !== key || entry.global !== deps.global) {
        entry = { key, global: deps.global, ctx: await preparePlan({ ...request, departAt: deps.now() }, deps, signal) };
        ctxRef.current = entry;
      }
      return evaluatePlan(entry.ctx, deps, signal);
    },
    { intervalMs: POLL.planMs, priority: 'foreground' },
  );
  return { ...polled, ready: global.data !== null };
}
