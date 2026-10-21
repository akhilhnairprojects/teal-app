/**
 * The one owner of continuous GPS (spec §1). Recorder and parking lease fixes from here; one
 * `watchPositionAsync` is shared and stopped when the last lease is released. A background source
 * (TaskManager, see backgroundTask.ts) pushes into the same listeners through `ingestFixes`, so the
 * recorder and parking code do not change when background tracking is turned on in a dev build.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { RawFix } from './types';

/** Background tracking is off: iOS Expo Go cannot run location tasks in the background [plat]. */
export const BACKGROUND_TRACKING = false as const;

export function canTrackInBackground(): boolean {
  if (!BACKGROUND_TRACKING) return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

export type HubMode = 'foreground' | 'background';
export type HubError = 'permissionDenied' | 'servicesOff' | 'unavailable';
export type HubLease = { ok: true; mode: HubMode; release: () => void } | { ok: false; error: HubError };
type Precision = 'fitness' | 'navigation';

type Lease = { owner: string; listener: (fix: RawFix) => void; precision: Precision };

const leases = new Map<number, Lease>();
let nextLeaseId = 1;
let watch: { remove(): void } | null = null;
let watchPrecision: Precision | null = null;
let starting: Promise<void> | null = null;

/** Convert an expo-location object to a RawFix; iOS reports an invalid speed as −1. */
export function toRawFix(loc: Location.LocationObject): RawFix {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  return {
    latitude,
    longitude,
    accuracy: typeof accuracy === 'number' && accuracy >= 0 ? accuracy : null,
    speed: typeof speed === 'number' && speed >= 0 ? speed : null,
    timestamp: loc.timestamp,
  };
}

/** Deliver fixes to every lease holder (the foreground watch and the background task both call this). */
export function ingestFixes(fixes: readonly RawFix[]): void {
  for (const fix of fixes) for (const l of [...leases.values()]) l.listener(fix);
}

const wanted = (): Precision | null => {
  if (leases.size === 0) return null;
  return [...leases.values()].some((l) => l.precision === 'fitness') ? 'fitness' : 'navigation';
};

function stopWatch() {
  watch?.remove();
  watch = null;
  watchPrecision = null;
}

async function ensureWatch(): Promise<void> {
  const precision = wanted();
  if (precision === null) {
    stopWatch();
    return;
  }
  if (watch && watchPrecision === precision) return;
  stopWatch();
  const sub = await Location.watchPositionAsync(
    {
      accuracy: precision === 'fitness' ? Location.Accuracy.BestForNavigation : Location.Accuracy.High,
      timeInterval: 1000,
      distanceInterval: 0,
    },
    (loc) => ingestFixes([toRawFix(loc)]),
  );
  // Released while starting: stop right away.
  if (wanted() === null) {
    sub.remove();
    return;
  }
  watch = sub;
  watchPrecision = precision;
}

async function serialEnsure(): Promise<void> {
  while (starting) await starting;
  starting = ensureWatch().finally(() => {
    starting = null;
  });
  await starting;
}

/**
 * Lease fixes for `owner`. Asks for foreground permission in context (the caller is starting a
 * recording or parking session). Fixes arrive about once per second while the app is foreground.
 */
export async function acquireFixes(owner: string, listener: (fix: RawFix) => void, o: { precision: Precision }): Promise<HubLease> {
  if (Platform.OS === 'web') return { ok: false, error: 'unavailable' };
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, error: 'permissionDenied' };
    if (!(await Location.hasServicesEnabledAsync())) return { ok: false, error: 'servicesOff' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  const id = nextLeaseId++;
  leases.set(id, { owner, listener, precision: o.precision });
  try {
    await serialEnsure();
  } catch {
    leases.delete(id);
    void serialEnsure().catch(() => {});
    return { ok: false, error: 'unavailable' };
  }
  let released = false;
  return {
    ok: true,
    mode: canTrackInBackground() ? 'background' : 'foreground',
    release: () => {
      if (released) return;
      released = true;
      leases.delete(id);
      void serialEnsure().catch(() => {});
    },
  };
}

/** Owners currently holding a lease (for tests and diagnostics). */
export function activeLeaseOwners(): string[] {
  return [...leases.values()].map((l) => l.owner);
}

/** Test helper. */
export function resetLocationHub(): void {
  leases.clear();
  stopWatch();
  starting = null;
}
