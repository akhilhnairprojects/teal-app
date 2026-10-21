/**
 * Geocoding on explicit submit, when nothing was picked from the suggestions [AR §4]:
 * - iOS/Android: `Location.geocodeAsync` (Apple's geocoder on iOS, no key; not available on web).
 * - Web: one bounded Nominatim `jsonv2` search. The OSMF policy forbids autocomplete, caps use at
 *   1 request/s for the whole app, and requires identification and attribution: this runs only on
 *   submit, waits out the 1 s spacing, caches, and is switched off by `NOMINATIM_ENABLED`. Browsers
 *   identify the page with their default Referer; no personal data is sent.
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { isInBostonArea } from '@/lib/geo';
import { BOSTON_BBOX } from '@/planner/constants';
import type { Place } from '@/planner/types';

export const NOMINATIM_ENABLED = true;
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_MIN_INTERVAL_MS = 1000;

export function nominatimUrl(q: string): string {
  const viewbox = `${BOSTON_BBOX.west},${BOSTON_BBOX.north},${BOSTON_BBOX.east},${BOSTON_BBOX.south}`;
  return `${NOMINATIM_URL}?format=jsonv2&limit=1&bounded=1&countrycodes=us&viewbox=${viewbox}&q=${encodeURIComponent(q.trim())}`;
}

/** The first usable result of a Nominatim jsonv2 search. */
export function parseNominatim(json: unknown, query: string): Place | null {
  if (!Array.isArray(json)) return null;
  for (const r of json) {
    if (typeof r !== 'object' || r === null) continue;
    const { lat, lon, name, display_name } = r as Record<string, unknown>;
    const latLng = { latitude: Number(lat), longitude: Number(lon) };
    if (!Number.isFinite(latLng.latitude) || !Number.isFinite(latLng.longitude)) continue;
    const label = typeof name === 'string' && name.trim() ? name.trim() : query.trim();
    const subtitle = typeof display_name === 'string' ? display_name.split(',').slice(1, 3).join(',').trim() || undefined : undefined;
    return { name: label, latLng, source: 'nominatim', subtitle };
  }
  return null;
}

let lastNominatimAt = -Infinity;
const nominatimCache = new Map<string, Place | null>();

/** Test helper. */
export function resetFallbackGeocoders() {
  lastNominatimAt = -Infinity;
  nominatimCache.clear();
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function searchNominatim(q: string, o: { signal?: AbortSignal; now?: () => number } = {}): Promise<Place | null> {
  if (!NOMINATIM_ENABLED || !q.trim()) return null;
  const url = nominatimUrl(q);
  if (nominatimCache.has(url)) return nominatimCache.get(url) ?? null;
  const now = o.now ?? Date.now;
  const gap = lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - now();
  if (gap > 0) await wait(gap);
  lastNominatimAt = now();
  const res = await fetch(url, { signal: o.signal });
  if (!res.ok) throw new Error(`Nominatim request failed (${res.status})`);
  const place = parseNominatim(await res.json(), q);
  nominatimCache.set(url, place);
  return place;
}

/** Device geocoder (iOS: Apple). Returns the first result in the Boston area. */
export async function geocodeOnDevice(q: string): Promise<Place | null> {
  const results = await Location.geocodeAsync(q.trim());
  const hit = results.find((r) => isInBostonArea({ latitude: r.latitude, longitude: r.longitude }));
  return hit ? { name: q.trim(), latLng: { latitude: hit.latitude, longitude: hit.longitude }, source: 'apple' } : null;
}

/** Submit-time geocoding for the current platform; null when nothing was found or it failed. */
export async function geocodeOnSubmit(q: string, o: { signal?: AbortSignal } = {}): Promise<Place | null> {
  if (!q.trim()) return null;
  try {
    return Platform.OS === 'web' ? await searchNominatim(q, o) : await geocodeOnDevice(q);
  } catch {
    return null;
  }
}
