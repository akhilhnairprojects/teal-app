/**
 * Photon (photon.komoot.io, OpenStreetMap data) typeahead [AR §4]: biased to the rider's position,
 * bounded to Greater Boston, five results, cached in memory. Photon asks clients to "be fair", so
 * callers debounce and require three characters, and `PHOTON_ENABLED` switches it off entirely.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { LatLng } from '@/lib/geo';
import { PROJECT_URL } from '@/mbta/api/config';
import { BOSTON_BBOX } from '@/planner/constants';
import type { Place } from '@/planner/types';

export const PHOTON_ENABLED = true;
export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const PHOTON_MIN_CHARS = 3;
export const PHOTON_DEBOUNCE_MS = 350;
const LIMIT = 5;

export const inBostonBox = (p: LatLng): boolean =>
  p.longitude >= BOSTON_BBOX.west && p.longitude <= BOSTON_BBOX.east && p.latitude >= BOSTON_BBOX.south && p.latitude <= BOSTON_BBOX.north;

export function photonUrl(q: string, bias?: LatLng | null): string {
  const params = [
    `q=${encodeURIComponent(q.trim())}`,
    `limit=${LIMIT}`,
    'lang=en',
    `bbox=${BOSTON_BBOX.west},${BOSTON_BBOX.south},${BOSTON_BBOX.east},${BOSTON_BBOX.north}`,
  ];
  if (bias) params.push(`lat=${bias.latitude.toFixed(4)}`, `lon=${bias.longitude.toFixed(4)}`);
  return `${PHOTON_URL}?${params.join('&')}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Places from a Photon GeoJSON FeatureCollection, inside the Boston box, deduped. */
export function parsePhoton(json: unknown): Place[] {
  const features = typeof json === 'object' && json !== null && Array.isArray((json as { features?: unknown }).features)
    ? ((json as { features: unknown[] }).features)
    : [];
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    if (typeof f !== 'object' || f === null) continue;
    const coords = (f as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') continue;
    const latLng = { latitude: coords[1], longitude: coords[0] };
    if (!inBostonBox(latLng)) continue;
    const p = ((f as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>;
    const street = [str(p.housenumber), str(p.street)].filter(Boolean).join(' ') || null;
    const name = str(p.name) ?? street;
    if (!name) continue;
    const area = str(p.district) ?? str(p.locality) ?? str(p.city);
    const subtitle = [name === street ? null : street, area, area === str(p.city) ? null : str(p.city)].filter(Boolean).join(', ') || undefined;
    const key = `${name}|${latLng.latitude.toFixed(4)},${latLng.longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, latLng, source: 'photon', subtitle });
  }
  return out;
}

const cache = new Map<string, Place[]>();

/** Test helper. */
export function resetPhotonCache() {
  cache.clear();
}

function headers(): Record<string, string> | undefined {
  // Browsers forbid setting User-Agent; native identifies the app by its public project URL only.
  return Platform.OS === 'web' ? undefined : { 'User-Agent': `Teal/${Constants.expoConfig?.version ?? '1'} (${PROJECT_URL})` };
}

/** Photon suggestions for `q` (empty when disabled or too short). Throws on network errors. */
export async function searchPhoton(q: string, o: { bias?: LatLng | null; signal?: AbortSignal } = {}): Promise<Place[]> {
  const query = q.trim();
  if (!PHOTON_ENABLED || query.length < PHOTON_MIN_CHARS) return [];
  // Round the bias so nearby positions share cache entries.
  const bias = o.bias ? { latitude: Number(o.bias.latitude.toFixed(2)), longitude: Number(o.bias.longitude.toFixed(2)) } : null;
  const url = photonUrl(query, bias);
  const hit = cache.get(url);
  if (hit) return hit;
  const res = await fetch(url, { headers: headers(), signal: o.signal });
  if (!res.ok) throw new Error(`Photon request failed (${res.status})`);
  const places = parsePhoton(await res.json());
  cache.set(url, places);
  return places;
}
