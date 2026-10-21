import { useCallback, useEffect, useMemo, useState } from 'react';

import type { TripPageParams } from '@/features/shell/routes';
import { fetchPredictionsForTrip, fetchSchedulesForTrip, fetchTrip } from '@/mbta/api/endpoints';
import { MbtaApiError } from '@/mbta/api/errors';
import { useGlobalData, type GlobalData } from '@/mbta/global/globalData';
import { useAlerts } from '@/mbta/live/useAlerts';
import { DROP_PREDICTIONS_AFTER_MS, POLL, usePolling, type Polled } from '@/mbta/live/usePolling';
import type { Alert, LiveDepartures, Route, Trip, Vehicle } from '@/mbta/model/types';

import { tripDetailsStopListFromPieces, type TripDetailsStopList, type TripSchedules } from './tripDetailsStopList';

const NO_ALERTS: Alert[] = [];

type StaticTrip = { trip: Trip | null; schedules: TripSchedules; notFound: boolean };

/** Per-session cache of the trip's static pieces (schedules or stop ids), keyed by trip id. */
const staticCache = new Map<string, Promise<StaticTrip>>();
const STATIC_CACHE_MAX = 20;

/**
 * The trip's schedules; when it has none (e.g. an ADDED trip), its stop ids from `/trips` or from
 * its route pattern's representative trip. At most two calls per trip per session.
 */
export function loadStaticTrip(tripId: string, g: GlobalData | null): Promise<StaticTrip> {
  const hit = staticCache.get(tripId);
  if (hit) return hit;
  const p = (async (): Promise<StaticTrip> => {
    const set = await fetchSchedulesForTrip(tripId, undefined, { priority: 'background' });
    const fromSchedules = set.trips[tripId] ?? null;
    if (set.schedules.length > 0) return { trip: fromSchedules, schedules: { kind: 'schedules', schedules: set.schedules }, notFound: false };
    let trip: Trip | null = fromSchedules;
    try {
      trip = await fetchTrip(tripId, { priority: 'background' });
    } catch (e) {
      if (e instanceof MbtaApiError && e.detail.kind === 'http' && e.detail.status === 404) {
        return { trip: null, schedules: { kind: 'unknown' }, notFound: true };
      }
      throw e;
    }
    const patternTrip = trip.routePatternId && g ? g.trips[g.patterns[trip.routePatternId]?.representativeTripId ?? ''] : undefined;
    const stopIds = trip.stopIds?.length ? trip.stopIds : (patternTrip?.stopIds ?? null);
    return { trip, schedules: stopIds?.length ? { kind: 'stopIds', stopIds } : { kind: 'unknown' }, notFound: false };
  })();
  staticCache.set(tripId, p);
  // A failed load is not cached, so a retry fetches again.
  p.catch(() => {
    if (staticCache.get(tripId) === p) staticCache.delete(tripId);
  });
  if (staticCache.size > STATIC_CACHE_MAX) staticCache.delete(staticCache.keys().next().value!);
  return p;
}

/** Test helper. */
export function clearTripCache() {
  staticCache.clear();
}

/** The vehicle for the page: the requested one, else the one assigned in the predictions. */
export function pickVehicle(live: LiveDepartures | null, vehicleId: string | null): Vehicle | null {
  if (!live) return null;
  if (vehicleId && live.vehicles[vehicleId]) return live.vehicles[vehicleId];
  const assigned = live.predictions.find((p) => p.vehicleId && live.vehicles[p.vehicleId]);
  return assigned ? live.vehicles[assigned.vehicleId!] : null;
}

export type TripDetails = {
  global: GlobalData | null;
  trip: Trip | null;
  route: Route | null;
  list: TripDetailsStopList | null;
  vehicle: Vehicle | null;
  predictions: Polled<LiveDepartures>;
  status: 'loading' | 'ready' | 'notFound' | 'error';
  /** Load the trip's schedules again (after a failure) and refresh its predictions. */
  retry(): void;
};

/**
 * Everything the trip page needs: predictions polled at the trip rate (focus-aware), the trip's
 * schedules once, the shared alerts, and the joined stop list.
 */
export function useTripDetails(p: TripPageParams | null): TripDetails {
  const { data: global } = useGlobalData();
  const tripId = p?.tripId ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchPredictionsForTrip(tripId ?? '', { signal, priority: 'foreground' }),
    [tripId],
  );
  const predictions = usePolling(tripId ? `trip:${tripId}` : null, fetcher, {
    intervalMs: POLL.tripMs,
    priority: 'foreground',
    dropAfterMs: DROP_PREDICTIONS_AFTER_MS,
  });

  const [statics, setStatics] = useState<{ tripId: string; value: StaticTrip | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const hasGlobal = global !== null;
  useEffect(() => {
    if (!tripId || !hasGlobal) return;
    let live = true;
    loadStaticTrip(tripId, global)
      .then((value) => live && setStatics({ tripId, value, failed: false }))
      .catch(() => live && setStatics({ tripId, value: null, failed: true }));
    return () => {
      live = false;
    };
    // `global` only seeds the pattern fallback; re-running on every global refresh is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, hasGlobal, attempt]);
  const st = statics?.tripId === tripId ? statics : null;

  const alerts = useAlerts();
  const alertList = alerts.data ?? (alerts.error ? NO_ALERTS : null);

  const live = predictions.data;
  const trip = (tripId && (live?.trips[tripId] ?? st?.value?.trip)) || null;
  const vehicle = pickVehicle(live, p?.vehicleId ?? null);
  const route = trip && global ? (global.routes[trip.routeId] ?? null) : null;
  const predictionsSettled = live !== null || predictions.error !== null;

  const list = useMemo(() => {
    if (!trip || !global || !predictionsSettled || !st) return null;
    return tripDetailsStopListFromPieces(trip, st.value?.schedules ?? null, live, vehicle, alertList, global);
  }, [trip, global, predictionsSettled, st, live, vehicle, alertList]);

  const noLiveTrip = live !== null && live.predictions.length === 0;
  let status: TripDetails['status'] = 'loading';
  if (list) status = 'ready';
  else if (st?.value?.notFound && (noLiveTrip || predictions.error)) status = 'notFound';
  else if (st && !trip && (noLiveTrip || predictions.error)) status = st.failed ? 'error' : 'notFound';
  else if (global && trip && !route) status = 'notFound';

  const refreshPredictions = predictions.refresh;
  const retry = useCallback(() => {
    setStatics(null);
    setAttempt((n) => n + 1);
    void refreshPredictions();
  }, [refreshPredictions]);

  return { global, trip, route, list, vehicle, predictions, status, retry };
}
