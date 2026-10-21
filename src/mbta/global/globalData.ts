/**
 * Static rail data (routes, lines, stops, route patterns, representative trips), fetched in three
 * calls, cached in AsyncStorage for 24 h or until the service date changes, and shared app-wide
 * through a tiny external store (stale-while-revalidate).
 */
import { useEffect, useSyncExternalStore } from 'react';

import { dataList, mbtaGet, type Resource } from '@/mbta/api/client';
import { RAIL_ROUTE_TYPES } from '@/mbta/api/config';
import { toErrorDetail } from '@/mbta/api/errors';
import {
  linkStopFamilies,
  parseLine,
  parseRoute,
  parseRoutePattern,
  parseStop,
  parseTrip,
  resolveParentId,
} from '@/mbta/model/parse';
import type { DirectionId, Line, Route, RoutePattern, Stop, Trip } from '@/mbta/model/types';
import { serviceDate as serviceDateOf } from '@/mbta/time/eastern';
import { readCache, writeCache } from '@/lib/cache';
import type { LatLng } from '@/lib/geo';

export type GlobalData = {
  version: 1;
  fetchedAt: number;
  serviceDate: string;
  routes: Record<string, Route>;
  lines: Record<string, Line>;
  stops: Record<string, Stop>;
  /** Representative trips, with `stopIds` set. */
  patterns: Record<string, RoutePattern>;
  trips: Record<string, Trip>;
  /** Leaf platform id -> pattern ids. */
  patternIdsByStop: Record<string, string[]>;
};

export type RailShapes = Record<string /* routeId */, { shapeId: string; directionId: DirectionId; coordinates: LatLng[] }[]>;

export const STOP_BLOCKLIST: readonly string[] = ['place-symcl'];

export const GLOBAL_CACHE_KEY = 'teal.global.v1';
export const GLOBAL_CACHE_VERSION = 1;
export const GLOBAL_TTL_MS = 24 * 60 * 60 * 1000;

const STOP_FIELDS = 'name,latitude,longitude,location_type,platform_code,platform_name,wheelchair_boarding,vehicle_type';

/** Build `patternIdsByStop` from each pattern's representative trip (patterns in sort order). */
export function indexPatternsByStop(patterns: Record<string, RoutePattern>, trips: Record<string, Trip>): Record<string, string[]> {
  const byStop: Record<string, string[]> = {};
  const ordered = Object.values(patterns).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  for (const p of ordered) {
    for (const stopId of trips[p.representativeTripId]?.stopIds ?? []) {
      const list = (byStop[stopId] ??= []);
      if (!list.includes(p.id)) list.push(p.id);
    }
  }
  return byStop;
}

/** Assemble `GlobalData` from the three V3 responses (pure; unit-tested with fixtures). */
export function assembleGlobalData(
  input: {
    routes: { data: Resource[]; included?: Resource[] };
    patterns: { data: Resource[]; included?: Resource[] };
    stops: { data: Resource[]; included?: Resource[] };
    /** Two-step fallback: `/trips?filter[id]&include=stops` results, when patterns lacked stops. */
    trips?: Resource[];
  },
  now: number,
): GlobalData {
  const routes: Record<string, Route> = {};
  const lines: Record<string, Line> = {};
  const stops: Record<string, Stop> = {};
  const patterns: Record<string, RoutePattern> = {};
  const trips: Record<string, Trip> = {};

  for (const r of [...input.routes.data, ...(input.routes.included ?? []), ...(input.patterns.included ?? [])]) {
    if (r.type === 'route') routes[r.id] = parseRoute(r);
    else if (r.type === 'line') lines[r.id] = parseLine(r);
  }
  for (const r of [...input.stops.data, ...(input.stops.included ?? [])]) {
    if (r.type === 'stop') stops[r.id] = parseStop(r);
  }
  linkStopFamilies(stops);
  for (const r of input.patterns.data) {
    if (r.type !== 'route_pattern') continue;
    const p = parseRoutePattern(r);
    if (routes[p.routeId]) patterns[p.id] = p;
  }
  for (const r of [...(input.patterns.included ?? []), ...(input.trips ?? [])]) {
    if (r.type !== 'trip') continue;
    const t = parseTrip(r);
    // Prefer a version that carries the ordered stop list.
    if (!trips[t.id] || (t.stopIds && !trips[t.id].stopIds)) trips[t.id] = t;
  }
  return {
    version: 1,
    fetchedAt: now,
    serviceDate: serviceDateOf(now),
    routes,
    lines,
    stops,
    patterns,
    trips,
    patternIdsByStop: indexPatternsByStop(patterns, trips),
  };
}

/** Representative trip ids whose ordered stops are missing (triggers the two-step fallback). */
export function tripsMissingStops(patternsDoc: { data: Resource[]; included?: Resource[] }): string[] {
  const included = new Map((patternsDoc.included ?? []).filter((r) => r.type === 'trip').map((r) => [r.id, r]));
  const missing: string[] = [];
  for (const p of patternsDoc.data) {
    const tripId = p.relationships?.representative_trip?.data;
    if (!tripId || Array.isArray(tripId)) continue;
    const trip = included.get(tripId.id);
    if (!trip || !Array.isArray(trip.relationships?.stops?.data)) missing.push(tripId.id);
  }
  return missing;
}

export async function fetchGlobalData(signal?: AbortSignal): Promise<GlobalData> {
  const opts = { signal, priority: 'static' as const };
  const [routesRes, stopsRes] = await Promise.all([
    mbtaGet('/routes', { 'filter[type]': RAIL_ROUTE_TYPES, include: 'line' }, opts),
    mbtaGet('/stops', { 'filter[route_type]': RAIL_ROUTE_TYPES, include: 'parent_station', 'fields[stop]': STOP_FIELDS }, opts),
  ]);
  const routeIds = dataList(routesRes.doc).map((r) => r.id);
  const patternsRes = await mbtaGet(
    '/route_patterns',
    { 'filter[route]': routeIds, include: 'representative_trip.stops,route.line', 'fields[stop]': '' },
    opts,
  );
  const patternsDoc = { data: dataList(patternsRes.doc), included: patternsRes.doc.included };
  const missing = tripsMissingStops(patternsDoc);
  let fallbackTrips: Resource[] | undefined;
  if (missing.length > 0) {
    const tripsRes = await mbtaGet('/trips', { 'filter[id]': missing, include: 'stops', 'fields[stop]': '' }, opts);
    fallbackTrips = dataList(tripsRes.doc);
  }
  return assembleGlobalData(
    {
      routes: { data: dataList(routesRes.doc), included: routesRes.doc.included },
      patterns: patternsDoc,
      stops: { data: dataList(stopsRes.doc), included: stopsRes.doc.included },
      trips: fallbackTrips,
    },
    Date.now(),
  );
}

// --- lookups ----------------------------------------------------------------------------

/** The root station of a stop; the id itself if it is already a parent or unknown. */
export function parentStationId(g: GlobalData, stopId: string): string {
  return resolveParentId(g.stops, stopId);
}

export function childStopIds(g: GlobalData, parentId: string): string[] {
  return g.stops[parentId]?.childStopIds ?? [];
}

/** All parent stations (location_type 1). */
export function stationStopIds(g: GlobalData): string[] {
  return Object.values(g.stops)
    .filter((s) => s.locationType === 1)
    .map((s) => s.id);
}

export function isStopBlocklisted(stopId: string): boolean {
  return STOP_BLOCKLIST.includes(stopId);
}

// --- cache + store ----------------------------------------------------------------------

export async function loadCachedGlobalData(now = Date.now()) {
  return readCache<GlobalData>(GLOBAL_CACHE_KEY, GLOBAL_CACHE_VERSION, {
    ttlMs: GLOBAL_TTL_MS,
    now,
    isFresh: (env) => env.value.serviceDate === serviceDateOf(now),
  });
}

type GlobalState = { data: GlobalData | null; status: 'loading' | 'ready' | 'error'; error: string | null };

let state: GlobalState = { data: null, status: 'loading', error: null };
let started = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<GlobalState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

async function refetch() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fresh = await fetchGlobalData();
      await writeCache(GLOBAL_CACHE_KEY, GLOBAL_CACHE_VERSION, fresh, fresh.fetchedAt);
      setState({ data: fresh, status: 'ready', error: null });
    } catch (e) {
      const d = toErrorDetail(e);
      const message = d.kind === 'rateLimited' ? 'Live data is paused by the MBTA rate limit' : 'Couldn’t load MBTA station data';
      // Keep showing cached data if we have it.
      setState(state.data ? { error: message } : { status: 'error', error: message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Start loading (idempotent): cached data renders immediately, then refetches when stale. */
export function startGlobalData(): Promise<void> {
  if (started) return inflight ?? Promise.resolve();
  started = true;
  return (async () => {
    const cached = await loadCachedGlobalData();
    if (cached) setState({ data: cached.value, status: 'ready', error: null });
    if (!cached || !cached.fresh) await refetch();
  })();
}

export function refreshGlobalData(): Promise<void> {
  started = true;
  return refetch();
}

/** Test helper. */
export function resetGlobalDataStore() {
  state = { data: null, status: 'loading', error: null };
  started = false;
  inflight = null;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

export function useGlobalData(): { data: GlobalData | null; status: 'loading' | 'ready' | 'error'; error: string | null; refresh(): void } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void startGlobalData();
  }, []);
  return { ...s, refresh: () => void refreshGlobalData() };
}

export { fetchRailShapes, useRailShapes } from './shapes';
