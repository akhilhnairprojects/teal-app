/** Shared activity types (spec §4). Distances in metres, times in ms. */
import type { LatLng } from '@/lib/geo';

export type { LatLng };

export type ActivityKind = 'run' | 'bike';

/** One fix as delivered by expo-location, before filtering. `speed` is the Doppler speed in m/s. */
export type RawFix = { latitude: number; longitude: number; accuracy: number | null; speed: number | null; timestamp: number };

/** A filtered, smoothed point: `t` is integer ms since the start; lat/lon are rounded to 6 dp. */
export type TrackPoint = { t: number; lat: number; lon: number };

export type LiveStats = {
  elapsedMs: number;
  movingMs: number;
  distanceM: number;
  excludedM: number;
  currentPaceSecPerKm: number | null;
  avgPaceSecPerKm: number | null;
  autoPaused: boolean;
  gpsQuality: 'good' | 'fair' | 'poor' | 'none';
  vehicleSuspected: boolean;
};

export type Effort = { distanceM: 1000 | 5000 | 10000; durationMs: number; startOffsetMs: number };

export type Split = { index: number; distanceM: number; durationMs: number };

/** Round to 6 decimal places (the precision uploaded to the server). */
export const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
