/**
 * Distance, duration and pace formatting, and the units preference (miles by default, decision O4).
 * Standard efforts stay labeled 1K/5K/10K whatever the units.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { readCache, writeCache } from '@/lib/cache';

export type Units = 'mi' | 'km';

export const METERS_PER_MILE = 1609.344;
const UNITS_KEY = 'teal.units.v1';
const UNITS_VERSION = 1;

let units: Units = 'mi';
let loaded = false;
const listeners = new Set<() => void>();

function setUnitsState(u: Units) {
  if (u === units) return;
  units = u;
  listeners.forEach((l) => l());
}

async function loadUnits(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const hit = await readCache<Units>(UNITS_KEY, UNITS_VERSION);
  if (hit && (hit.value === 'mi' || hit.value === 'km')) setUnitsState(hit.value);
}

export function getUnits(): Units {
  return units;
}

export function setUnits(u: Units): void {
  loaded = true;
  setUnitsState(u);
  void writeCache(UNITS_KEY, UNITS_VERSION, u);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The units preference and its setter (persisted in AsyncStorage). */
export function useUnits(): [Units, (u: Units) => void] {
  useEffect(() => {
    void loadUnits();
  }, []);
  const u = useSyncExternalStore(subscribe, getUnits, getUnits);
  return [u, setUnits];
}

/** Test helper. */
export function resetUnitsForTests(): void {
  units = 'mi';
  loaded = false;
}

/** '3.10 mi' / '5.00 km'; under 0.1 mi, feet ('250 ft') or metres ('80 m'). */
export function formatDistanceM(m: number, u: Units): string {
  const meters = Math.max(0, m);
  if (u === 'km') return meters < 100 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
  return `${miles.toFixed(2)} mi`;
}

/** '1:02:05' or '25:00' (h:mm:ss under a day; m:ss under an hour). */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** '8:05 /mi' or '5:01 /km'; '–:–– /mi' when unknown. */
export function formatPace(secPerKm: number | null, u: Units): string {
  const unit = u === 'mi' ? '/mi' : '/km';
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) return `–:–– ${unit}`;
  const sec = Math.round(u === 'mi' ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} ${unit}`;
}
