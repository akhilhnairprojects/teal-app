import { useMemo } from 'react';

import { useNearbyPosition, type NearbyPosition } from '@/features/map/mapCenter';
import { useGlobalData } from '@/mbta/global/globalData';
import { useNow, type Polled } from '@/mbta/live/usePolling';
import { useStopLiveData } from '@/mbta/live/useStopLiveData';
import type { LiveDepartures } from '@/mbta/model/types';
import { nearbyStopIds } from '@/mbta/rules/nearbyStops';
import { routeCardsForStopList, type RouteCard } from '@/mbta/rules/routeCardData';
import type { LatLng } from '@/lib/geo';

export type NearbyCards = {
  position: NearbyPosition;
  global: ReturnType<typeof useGlobalData>;
  /** Leaf stop ids near the position; null until global data and a position exist. */
  stopIds: string[] | null;
  /** Route cards (context `nearby`); null until global data and a position exist. */
  cards: RouteCard[] | null;
  predictions: Polled<LiveDepartures>;
  now: number;
};

/** Round to ~10 m so GPS jitter and tiny pans don't recompute the stop set. */
function useRounded(p: LatLng | null): LatLng | null {
  const key = p ? `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}` : null;
  return useMemo(() => {
    if (!key) return null;
    const [latitude, longitude] = key.split(',').map(Number);
    return { latitude, longitude };
  }, [key]);
}

/**
 * Nearby route cards: stops around the user (or the panned map center) [MA §3.2], their live
 * predictions, today's schedules and alerts, grouped by MBTA Go's route-card rules [MA §3.3].
 */
export function useNearbyCards(): NearbyCards {
  const position = useNearbyPosition();
  const global = useGlobalData();
  const at = useRounded(position.status === 'ready' ? position.position : null);

  const stopIds = useMemo(() => (global.data && at ? nearbyStopIds(global.data, at) : null), [global.data, at]);
  const live = useStopLiveData(stopIds && stopIds.length ? stopIds : null);
  const now = useNow(5_000);

  const predictions = live.predictions.data;
  const cards = useMemo(
    () =>
      global.data && stopIds
        ? routeCardsForStopList({
            stopIds,
            global: global.data,
            sortByDistanceFrom: at,
            schedules: live.schedules,
            predictions,
            alerts: live.alerts,
            now,
            context: 'nearby',
          })
        : null,
    [global.data, stopIds, at, live.schedules, predictions, live.alerts, now],
  );

  return { position, global, stopIds, cards, predictions: live.predictions, now };
}
