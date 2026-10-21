/**
 * Destination search [AR §4]: local MBTA station names first (instant, offline), then Photon
 * typeahead, then a platform geocoder on submit. Photon or Nominatim results must show
 * `OSM_ATTRIBUTION`.
 */
import { useEffect, useState } from 'react';

import { distanceMeters, type LatLng } from '@/lib/geo';
import type { GlobalData } from '@/mbta/global/globalData';
import { matchStations } from '@/mbta/rules/search';
import type { Place } from '@/planner/types';

import { geocodeOnSubmit } from './fallback';
import { PHOTON_DEBOUNCE_MS, PHOTON_MIN_CHARS, searchPhoton } from './photon';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Matching stations as places (`stopId` set). */
export function stationPlaces(g: GlobalData | null, q: string, limit = 4): Place[] {
  if (!g) return [];
  return matchStations(g, q, limit).map((m) => ({
    name: m.stop.name,
    latLng: { latitude: m.stop.latitude, longitude: m.stop.longitude },
    source: 'station' as const,
    stopId: m.stop.id,
    subtitle: m.routeIds
      .map((id) => g.routes[id]?.longName || g.routes[id]?.shortName || id)
      .filter((n, i, all) => all.indexOf(n) === i)
      .join(' · '),
  }));
}

/** Remote places minus the ones that duplicate a station suggestion (same name, within 150 m). */
export function withoutStationDuplicates(stations: Place[], remote: Place[]): Place[] {
  const norm = (s: string) => s.toLowerCase().replace(/\bstation\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return remote.filter((r) => !stations.some((s) => norm(s.name) === norm(r.name) && distanceMeters(s.latLng, r.latLng) < 150));
}

export type Suggestions = { stations: Place[]; places: Place[]; loading: boolean; failed: boolean };

/** Station matches immediately, Photon after a 350 ms pause in typing (3+ characters). */
export function useGeocodeSuggestions(q: string, global: GlobalData | null, bias: LatLng | null): Suggestions {
  const stations = stationPlaces(global, q);
  const [remote, setRemote] = useState<{ q: string; places: Place[]; failed: boolean }>({ q: '', places: [], failed: false });
  const query = q.trim();
  const biasKey = bias ? `${bias.latitude.toFixed(2)},${bias.longitude.toFixed(2)}` : '';

  useEffect(() => {
    if (query.length < PHOTON_MIN_CHARS) return;
    const controller = new AbortController();
    const [lat, lon] = biasKey ? biasKey.split(',').map(Number) : [NaN, NaN];
    const timer = setTimeout(() => {
      searchPhoton(query, { bias: biasKey ? { latitude: lat, longitude: lon } : null, signal: controller.signal })
        .then((places) => setRemote({ q: query, places, failed: false }))
        .catch(() => {
          if (!controller.signal.aborted) setRemote({ q: query, places: [], failed: true });
        });
    }, PHOTON_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, biasKey]);

  const current = remote.q === query && query.length >= PHOTON_MIN_CHARS;
  return {
    stations,
    places: current ? withoutStationDuplicates(stations, remote.places) : [],
    loading: query.length >= PHOTON_MIN_CHARS && !current,
    failed: current && remote.failed,
  };
}

/**
 * The place for typed text when the rider submits without choosing: the best station match, then
 * the first Photon result, then the platform geocoder.
 */
export async function resolveTypedPlace(
  q: string,
  global: GlobalData | null,
  o: { bias?: LatLng | null; signal?: AbortSignal; suggestions?: Suggestions } = {},
): Promise<Place | null> {
  const query = q.trim();
  if (!query) return null;
  const station = o.suggestions?.stations[0] ?? stationPlaces(global, query, 1)[0];
  if (station) return station;
  const remote = o.suggestions?.places[0];
  if (remote) return remote;
  try {
    const [first] = await searchPhoton(query, { bias: o.bias, signal: o.signal });
    if (first) return first;
  } catch {
    // Photon down: fall through to the platform geocoder.
  }
  return geocodeOnSubmit(query, { signal: o.signal });
}

export { geocodeOnSubmit } from './fallback';
export { PHOTON_ENABLED, searchPhoton } from './photon';
