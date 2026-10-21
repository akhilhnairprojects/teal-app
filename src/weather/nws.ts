/**
 * Current weather from the National Weather Service (api.weather.gov, no key): `/points/{lat},{lon}`
 * gives the `forecastHourly` URL, whose first two periods set the bike advisory. NWS asks clients
 * to identify themselves; native builds send a User-Agent with the project URL only (never personal
 * data). Browsers do not allow setting User-Agent, so web sends none. Failures return null.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { hashKey, readCache, writeCache } from '@/lib/cache';
import type { LatLng } from '@/lib/geo';
import { PROJECT_URL } from '@/mbta/api/config';
import { WEATHER_RULES } from '@/planner/constants';
import type { WeatherSnapshot } from '@/planner/types';

export const NWS_BASE = 'https://api.weather.gov';
/** Identifying contact sent to NWS: the public project page. */
export const NWS_CONTACT = PROJECT_URL;

const POINTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOURLY_TTL_MS = 10 * 60 * 1000;
const CACHE_VERSION = 1;

export type HourlyPeriod = {
  startTime: number;
  endTime: number;
  temperatureF: number | null;
  shortForecast: string;
  precipProbability: number | null;
  windMph: number | null;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** `forecastHourly` from a `/points` response, or null. */
export function parsePoints(json: unknown): string | null {
  const url = isObj(json) && isObj(json.properties) ? json.properties.forecastHourly : null;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** Highest mph figure in strings like "1 mph" or "5 to 10 mph" (km/h converted). */
export function parseWindMph(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const values = [...v.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (values.length === 0) return null;
  const max = Math.max(...values);
  return /km\/h/i.test(v) ? Math.round(max / 1.609) : max;
}

function temperatureF(p: Record<string, unknown>): number | null {
  const t = p.temperature;
  if (typeof t === 'number') return p.temperatureUnit === 'C' ? Math.round((t * 9) / 5 + 32) : t;
  // Quantitative form: { value, unitCode: 'wmoUnit:degC' | 'wmoUnit:degF' }.
  if (isObj(t)) {
    const v = num(t.value);
    if (v === null) return null;
    return typeof t.unitCode === 'string' && /degC/.test(t.unitCode) ? Math.round((v * 9) / 5 + 32) : v;
  }
  return null;
}

/** Periods of a `forecastHourly` response; malformed periods are skipped. */
export function parseHourly(json: unknown): HourlyPeriod[] {
  const periods = isObj(json) && isObj(json.properties) && Array.isArray(json.properties.periods) ? json.properties.periods : [];
  const out: HourlyPeriod[] = [];
  for (const p of periods) {
    if (!isObj(p)) continue;
    const startTime = typeof p.startTime === 'string' ? Date.parse(p.startTime) : NaN;
    const endTime = typeof p.endTime === 'string' ? Date.parse(p.endTime) : NaN;
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) continue;
    const pop = p.probabilityOfPrecipitation;
    out.push({
      startTime,
      endTime,
      temperatureF: temperatureF(p),
      shortForecast: typeof p.shortForecast === 'string' ? p.shortForecast : '',
      precipProbability: isObj(pop) ? num(pop.value) : num(pop),
      windMph: parseWindMph(p.windSpeed),
    });
  }
  return out;
}

/** Bike advisory over the next periods (spec WP3 thresholds). */
export function bikeAdvisory(periods: readonly HourlyPeriod[]): { advisory: WeatherSnapshot['bikeAdvisory']; reason: string | null } {
  const r = WEATHER_RULES;
  const precip = Math.max(-1, ...periods.map((p) => p.precipProbability ?? -1));
  const wind = Math.max(-1, ...periods.map((p) => p.windMph ?? -1));
  const temps = periods.map((p) => p.temperatureF).filter((t): t is number => t !== null);
  const severe = periods.find((p) => r.avoidPattern.test(p.shortForecast));
  if (severe) return { advisory: 'avoid', reason: severe.shortForecast };
  if (precip >= r.avoidPrecipPct) return { advisory: 'avoid', reason: `${precip}% chance of precipitation` };
  const wet = periods.find((p) => r.cautionPattern.test(p.shortForecast));
  if (precip >= r.cautionPrecipPct) return { advisory: 'caution', reason: `${precip}% chance of precipitation` };
  if (wet) return { advisory: 'caution', reason: wet.shortForecast };
  if (wind >= r.cautionWindMph) return { advisory: 'caution', reason: `Windy (${wind} mph)` };
  const cold = temps.length ? Math.min(...temps) : null;
  const hot = temps.length ? Math.max(...temps) : null;
  if (cold !== null && cold <= r.coldF) return { advisory: 'caution', reason: `Cold (${cold}°F)` };
  if (hot !== null && hot >= r.hotF) return { advisory: 'caution', reason: `Hot (${hot}°F)` };
  return { advisory: 'ok', reason: null };
}

/** Snapshot from the first two periods that have not ended yet. */
export function summarizeWeather(periods: readonly HourlyPeriod[], now: number): WeatherSnapshot | null {
  const next = periods.filter((p) => p.endTime > now).slice(0, 2);
  if (next.length === 0) return null;
  const { advisory, reason } = bikeAdvisory(next);
  const precip = next.map((p) => p.precipProbability).filter((x): x is number => x !== null);
  const wind = next.map((p) => p.windMph).filter((x): x is number => x !== null);
  return {
    fetchedAt: now,
    temperatureF: next[0].temperatureF,
    shortForecast: next[0].shortForecast,
    precipProbability: precip.length ? Math.max(...precip) : null,
    windMph: wind.length ? Math.max(...wind) : null,
    bikeAdvisory: advisory,
    reason,
  };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/geo+json' };
  if (Platform.OS !== 'web') h['User-Agent'] = `Teal/${Constants.expoConfig?.version ?? '1'} (${NWS_CONTACT})`;
  return h;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: headers(), signal });
  if (!res.ok) throw new Error(`NWS request failed (${res.status})`);
  return res.json();
}

const memory = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttlMs: number, now: number, load: () => Promise<T>): Promise<T> {
  const m = memory.get(key);
  if (m && now - m.at < ttlMs) return m.value as T;
  const stored = await readCache<T>(key, CACHE_VERSION, { ttlMs, now });
  if (stored?.fresh) {
    memory.set(key, { at: stored.fetchedAt, value: stored.value });
    return stored.value;
  }
  const value = await load();
  memory.set(key, { at: now, value });
  await writeCache(key, CACHE_VERSION, value, now);
  return value;
}

/** Test helper. */
export function resetWeatherCache() {
  memory.clear();
}

/** Weather near `at`, or null on any failure (the planner continues without it). */
export async function fetchWeather(at: LatLng, o: { signal?: AbortSignal; now?: number } = {}): Promise<WeatherSnapshot | null> {
  const now = o.now ?? Date.now();
  // Three decimals (~100 m) keeps the cache key stable; NWS accepts up to four.
  const lat = at.latitude.toFixed(3);
  const lon = at.longitude.toFixed(3);
  try {
    const hourlyUrl = await cached(`teal.nws.points.${lat},${lon}`, POINTS_TTL_MS, now, async () => {
      const url = parsePoints(await getJson(`${NWS_BASE}/points/${lat},${lon}`, o.signal));
      if (!url) throw new Error('NWS points response had no hourly forecast');
      return url;
    });
    const periods = await cached(`teal.nws.hourly.${hashKey(hourlyUrl)}`, HOURLY_TTL_MS, now, async () => parseHourly(await getJson(hourlyUrl, o.signal)));
    return summarizeWeather(periods, now);
  } catch {
    return null;
  }
}
