import { useCallback } from 'react';

import { fetchVehicles } from '@/mbta/api/endpoints';
import type { DirectionId, Vehicle } from '@/mbta/model/types';
import { isVehicleStale } from '@/mbta/rules/vehicle';

import { POLL, usePolling, type Polled } from './usePolling';

/**
 * Live vehicles for the selected routes and direction (the map polls this itself), without
 * vehicles whose last update is over an hour old (Vehicle.isStale). Not focus-aware because the
 * map lives outside the screen stack; pass nulls to stop polling.
 */
export function useVehicles(routeIds: string[] | null, directionId: DirectionId | null): Polled<Vehicle[]> {
  const routesKey = routeIds?.length ? [...new Set(routeIds)].sort().join(',') : null;
  const key = routesKey ? `vehicles:${routesKey}|${directionId ?? ''}` : null;
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      fetchVehicles(
        { routeIds: routesKey ? routesKey.split(',') : [], directionId: directionId ?? undefined },
        { signal, priority: 'background' },
      ).then((vehicles) => {
        const now = Date.now();
        return vehicles.filter((v) => !isVehicleStale(v, now));
      }),
    [routesKey, directionId],
  );
  return usePolling(key, fetcher, { intervalMs: POLL.vehiclesMs, priority: 'background', focusAware: false });
}
