/**
 * Territory cells for the map's settled region (spec G4 layer): fetched 500 ms after the region
 * settles, for a bounding box rounded outward so small pans reuse it, and cached per
 * (month, rounded box) for 60 s. The layer publishes what it shows (loading, truncated) through a
 * tiny store so the territory page can say "Zoom in to see all territory".
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { BackendError, Result } from '@/backend/errors';

import { fetchTerritory, type TerritoryCell } from './api';
import { GRID } from './grid';

export const TERRITORY_DEBOUNCE_MS = 500;
export const TERRITORY_CACHE_MS = 60_000;
/** Bounding boxes are rounded outward to this many degrees (about 1.1 km north–south). */
export const BBOX_QUANTUM = 0.01;
const CACHE_MAX_ENTRIES = 24;

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type Bounds = { south: number; west: number; north: number; east: number };

/** The grid's extent: requests are clipped to it. */
const GRID_BOUNDS: Bounds = {
  south: GRID.lat0,
  west: GRID.lon0,
  north: GRID.lat0 + (GRID.jMax + 1) * GRID.dLat,
  east: GRID.lon0 + (GRID.iMax + 1) * GRID.dLon,
};

const roundDown = (v: number) => Math.floor(v / BBOX_QUANTUM) * BBOX_QUANTUM;
const roundUp = (v: number) => Math.ceil(v / BBOX_QUANTUM) * BBOX_QUANTUM;
const fixed = (v: number) => Number(v.toFixed(4));

/** The region's box rounded outward and clipped to the grid, or null when it misses the grid. */
export function requestBounds(region: Region): Bounds | null {
  const vals = [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta];
  if (!vals.every(Number.isFinite)) return null;
  const south = Math.max(fixed(roundDown(region.latitude - region.latitudeDelta / 2)), GRID_BOUNDS.south);
  const north = Math.min(fixed(roundUp(region.latitude + region.latitudeDelta / 2)), GRID_BOUNDS.north);
  const west = Math.max(fixed(roundDown(region.longitude - region.longitudeDelta / 2)), GRID_BOUNDS.west);
  const east = Math.min(fixed(roundUp(region.longitude + region.longitudeDelta / 2)), GRID_BOUNDS.east);
  if (!(south < north && west < east)) return null;
  return { south, west, north, east };
}

export const territoryCacheKey = (month: string, b: Bounds): string => `${month}|${b.south}|${b.west}|${b.north}|${b.east}`;

type Loaded = { cells: TerritoryCell[]; truncated: boolean };
const cache = new Map<string, { at: number; value: Loaded }>();
const inFlight = new Map<string, Promise<Result<Loaded>>>();

function cached(key: string, now: number): Loaded | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TERRITORY_CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

/** Cells for a month and box: from the 60 s cache, a request already in flight, or the server. */
export function loadTerritory(month: string, b: Bounds): Promise<Result<Loaded>> {
  const key = territoryCacheKey(month, b);
  const hit = cached(key, Date.now());
  if (hit) return Promise.resolve({ ok: true, value: hit });
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = fetchTerritory(b, month).then((r): Result<Loaded> => {
    inFlight.delete(key);
    if (!r.ok) return r;
    const value = { cells: r.value.cells, truncated: r.value.truncated };
    cache.set(key, { at: Date.now(), value });
    while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    return { ok: true, value };
  });
  inFlight.set(key, p);
  return p;
}

export type TerritoryView = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  month: string | null;
  cells: TerritoryCell[];
  truncated: boolean;
  error: BackendError | null;
};

const NO_CELLS: TerritoryCell[] = [];
const IDLE: TerritoryView = { status: 'idle', month: null, cells: NO_CELLS, truncated: false, error: null };

type Settled = { key: string; month: string; cells: TerritoryCell[]; truncated: boolean; error: BackendError | null };

/**
 * Cells for `month` around the settled `region`. A region change waits 500 ms (a newer region
 * cancels it); a fresh cache entry applies at once. Cells of the same month stay shown while the
 * next box loads; a new month starts empty. The view is derived from the last settled request.
 */
export function useTerritory(month: string, region: Region | null, o: { enabled: boolean }): TerritoryView {
  const [settled, setSettled] = useState<Settled | null>(null);
  const bounds = o.enabled && region ? requestBounds(region) : null;
  const key = bounds ? territoryCacheKey(month, bounds) : null;

  useEffect(() => {
    if (!key || !bounds) return;
    let live = true;
    const apply = (r: Result<Loaded>) => {
      if (!live) return;
      setSettled((prev) =>
        r.ok
          ? { key, month, cells: r.value.cells, truncated: r.value.truncated, error: null }
          : prev?.month === month
            ? { ...prev, key, error: r.error }
            : { key, month, cells: NO_CELLS, truncated: false, error: r.error },
      );
    };
    // A fresh cache entry resolves at once; otherwise wait for the region to stay put.
    const timer = cached(key, Date.now()) ? null : setTimeout(() => void loadTerritory(month, bounds).then(apply), TERRITORY_DEBOUNCE_MS);
    if (timer === null) void loadTerritory(month, bounds).then(apply);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
    // `bounds` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, month]);

  if (!o.enabled) return IDLE;
  if (!key) return { ...IDLE, status: 'ready', month };
  if (settled?.key === key) {
    return { status: settled.error ? 'error' : 'ready', month, cells: settled.cells, truncated: settled.truncated, error: settled.error };
  }
  const sameMonth = settled?.month === month;
  return { status: 'loading', month, cells: sameMonth ? settled.cells : NO_CELLS, truncated: sameMonth ? settled.truncated : false, error: null };
}

// --- what the map layer is showing, for the territory page ---------------------------------

export type TerritoryShown = { loading: boolean; truncated: boolean; error: BackendError | null };

const NOTHING_SHOWN: TerritoryShown = { loading: false, truncated: false, error: null };
let shown: TerritoryShown = NOTHING_SHOWN;
const listeners = new Set<() => void>();

export function setTerritoryShown(next: TerritoryShown | null): void {
  const value = next ?? NOTHING_SHOWN;
  if (value.loading === shown.loading && value.truncated === shown.truncated && value.error === shown.error) return;
  shown = value;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getShown = () => shown;

export function useTerritoryShown(): TerritoryShown {
  return useSyncExternalStore(subscribe, getShown, getShown);
}

/** Test helper. */
export function resetTerritoryForTests(): void {
  cache.clear();
  inFlight.clear();
  shown = NOTHING_SHOWN;
}
