import { readCache, writeCache } from '@/lib/cache';
import { distanceMeters, type LatLng } from '@/lib/geo';

/** Bluebikes' public GBFS feed (operated by Lyft). No key required. */
const GBFS_BASE = 'https://gbfs.lyft.com/gbfs/1.1/bos/en';

export type BikeStation = {
  id: string;
  name: string;
  location: LatLng;
  distanceMeters: number;
  capacity: number;
  /** Non-electric bikes ready to rent. */
  classicBikes: number;
  ebikes: number;
  openDocks: number;
  isRenting: boolean;
  isReturning: boolean;
  /** Link that opens the station in the Bluebikes/Lyft app, when the feed provides one. */
  rentalUrl: string | null;
  /** Epoch milliseconds of the station's last report. */
  reportedAt: number;
};

export type StationInformation = {
  data: {
    stations: {
      station_id: string;
      name: string;
      lat: number;
      lon: number;
      capacity: number;
      rental_uris?: { ios?: string; android?: string };
    }[];
  };
};

export type StationStatus = {
  last_updated: number;
  data: {
    stations: {
      station_id: string;
      num_bikes_available: number;
      num_ebikes_available?: number;
      num_docks_available: number;
      is_installed: number;
      is_renting: number;
      is_returning: number;
      last_reported: number;
    }[];
  };
};

/**
 * Join station metadata with live status, skipping uninstalled or unknown stations.
 * In this feed `num_bikes_available` counts every rentable bike, e-bikes included.
 * `distanceMeters` is measured from `origin`, or 0 when no origin is given.
 */
export function joinBikeStations(info: StationInformation, status: StationStatus, origin: LatLng | null): BikeStation[] {
  const statusById = new Map(status.data.stations.map((s) => [s.station_id, s]));
  const stations: BikeStation[] = [];
  for (const s of info.data.stations) {
    const st = statusById.get(s.station_id);
    if (!st || !st.is_installed) continue;
    const ebikes = st.num_ebikes_available ?? 0;
    const location = { latitude: s.lat, longitude: s.lon };
    stations.push({
      id: s.station_id,
      name: s.name.trim(),
      location,
      distanceMeters: origin ? distanceMeters(origin, location) : 0,
      capacity: s.capacity,
      classicBikes: Math.max(0, st.num_bikes_available - ebikes),
      ebikes,
      openDocks: st.num_docks_available,
      isRenting: st.is_renting === 1,
      isReturning: st.is_returning === 1,
      rentalUrl: s.rental_uris?.ios ?? null,
      reportedAt: st.last_reported * 1000,
    });
  }
  return stations;
}

/** The nearest installed stations to `origin`. */
export function nearestBikeStations(
  info: StationInformation,
  status: StationStatus,
  origin: LatLng,
  limit: number,
): BikeStation[] {
  return joinBikeStations(info, status, origin)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${GBFS_BASE}/${path}`, { signal });
  if (!res.ok) throw new Error(`Bluebikes request failed (${res.status})`);
  return (await res.json()) as T;
}

// Station locations rarely change; refetch them at most every 6 hours.
const INFO_TTL_MS = 6 * 60 * 60 * 1000;
let infoCache: { fetchedAt: number; value: StationInformation } | null = null;

const INFO_CACHE_KEY = 'teal.bikeinfo.v1';
const INFO_CACHE_VERSION = 1;

/** Station metadata from memory, then AsyncStorage (6 h), then the network. */
async function getStationInformation(signal?: AbortSignal): Promise<StationInformation> {
  if (infoCache && Date.now() - infoCache.fetchedAt < INFO_TTL_MS) return infoCache.value;
  const stored = await readCache<StationInformation>(INFO_CACHE_KEY, INFO_CACHE_VERSION, { ttlMs: INFO_TTL_MS });
  if (stored?.fresh) {
    infoCache = { fetchedAt: stored.fetchedAt, value: stored.value };
    return stored.value;
  }
  const value = await getJson<StationInformation>('station_information.json', signal);
  infoCache = { fetchedAt: Date.now(), value };
  await writeCache(INFO_CACHE_KEY, INFO_CACHE_VERSION, value);
  return value;
}

export async function fetchNearestBikeStations(origin: LatLng, limit = 4, signal?: AbortSignal) {
  const [info, status] = await Promise.all([
    getStationInformation(signal),
    getJson<StationStatus>('station_status.json', signal),
  ]);
  return nearestBikeStations(info, status, origin, limit);
}

/** Every installed station with live status (`distanceMeters` is 0), for the planner. */
export async function fetchBikeStations(signal?: AbortSignal): Promise<BikeStation[]> {
  const [info, status] = await Promise.all([
    getStationInformation(signal),
    getJson<StationStatus>('station_status.json', signal),
  ]);
  return joinBikeStations(info, status, null);
}
