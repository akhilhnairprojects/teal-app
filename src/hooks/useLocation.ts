import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { isInBostonArea, PARK_STREET, type LatLng } from '@/lib/geo';

export type LocationState =
  | { status: 'locating' }
  | { status: 'ready'; coords: LatLng; source: 'device' | 'fallback'; reason?: string };

/**
 * A web link with `?demo` always shows Park Street, so a shared demo works anywhere. Read once,
 * when this module loads at startup: in-app navigation drops `?demo` from the URL, and the demo
 * must stay a demo afterwards.
 */
function readDemoLink(): boolean {
  return Platform.OS === 'web' && new URLSearchParams(globalThis.location?.search).has('demo');
}
let demoLink = readDemoLink();

export const isDemoLink = (): boolean => demoLink;

/** Test helper: re-read the startup URL. */
export function resetDemoLinkForTests(): void {
  demoLink = readDemoLink();
}

/**
 * One-shot foreground location. Falls back to Park Street when permission is
 * denied, no fix is available, or the device is outside the Boston area, so the
 * app still shows useful data. Only the shell calls this; screens read the shared
 * result with `useUserLocation()` (features/map/mapCenter).
 */
export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({ status: 'locating' });

  useEffect(() => {
    let cancelled = false;
    const settle = (next: LocationState) => {
      if (!cancelled) setState(next);
    };
    const fallback = (reason: string) =>
      settle({ status: 'ready', coords: PARK_STREET, source: 'fallback', reason });
    const fromDevice = (coords: LatLng) =>
      isInBostonArea(coords)
        ? settle({ status: 'ready', coords, source: 'device' })
        : fallback('You’re outside the Boston area');

    if (isDemoLink()) {
      fallback('Demo');
      return;
    }

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return fallback('Location permission is off');
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
        if (lastKnown) fromDevice(lastKnown.coords);
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        fromDevice(current.coords);
      } catch {
        fallback('Couldn’t get your location');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
