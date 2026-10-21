/**
 * Typed V3 endpoints. Each parses into model types and accepts `{ signal?, priority? }` last.
 * Stop filters may mix parent stations and platforms; V3 expands parents to their children
 * [AR §2.3], and results always carry platform ids (map them back with `resolveParentId`).
 */
import {
  parseAlert,
  parsePredictionsDocument,
  parseSchedulesDocument,
  parseTrip,
  parseVehicle,
} from '@/mbta/model/parse';
import type { Alert, DirectionId, LiveDepartures, ScheduleSet, Trip, Vehicle } from '@/mbta/model/types';

import type { RequestPriority } from './budget';
import { dataList, mbtaGet, MbtaApiError, type MbtaQuery } from './client';
import { RAIL_ROUTE_TYPES } from './config';

export type CallOptions = { signal?: AbortSignal; priority?: RequestPriority };

const uniq = (ids: readonly string[]) => [...new Set(ids)].sort();

const EMPTY_LIVE: LiveDepartures = { predictions: [], trips: {}, vehicles: {} };
const EMPTY_SCHEDULES: ScheduleSet = { schedules: [], trips: {} };

export async function fetchPredictionsForStops(
  stopIds: string[],
  f: { routeIds?: string[]; directionId?: DirectionId } = {},
  o: CallOptions = {},
): Promise<LiveDepartures> {
  if (stopIds.length === 0) return EMPTY_LIVE;
  const query: MbtaQuery = {
    'filter[stop]': uniq(stopIds),
    'filter[route_type]': RAIL_ROUTE_TYPES,
    include: 'trip,vehicle',
  };
  if (f.routeIds?.length) query['filter[route]'] = uniq(f.routeIds);
  if (f.directionId !== undefined) query['filter[direction_id]'] = f.directionId;
  const res = await mbtaGet('/predictions', query, o);
  return parsePredictionsDocument(res.doc);
}

export async function fetchPredictionsForTrip(tripId: string, o: CallOptions = {}): Promise<LiveDepartures> {
  const res = await mbtaGet('/predictions', { 'filter[trip]': tripId, include: 'trip,vehicle' }, o);
  return parsePredictionsDocument(res.doc);
}

/** All of today's rail schedules at these stops, in one call. */
export async function fetchSchedulesForStops(stopIds: string[], serviceDate: string, o: CallOptions = {}): Promise<ScheduleSet> {
  if (stopIds.length === 0) return EMPTY_SCHEDULES;
  const res = await mbtaGet(
    '/schedules',
    {
      'filter[stop]': uniq(stopIds),
      'filter[date]': serviceDate,
      'filter[route_type]': RAIL_ROUTE_TYPES,
      include: 'trip',
      'fields[schedule]': 'arrival_time,departure_time,drop_off_type,pickup_type,stop_headsign,stop_sequence',
      'fields[trip]': 'headsign,direction_id',
    },
    o,
  );
  return parseSchedulesDocument(res.doc);
}

export async function fetchSchedulesForTrip(tripId: string, stopIds?: string[], o: CallOptions = {}): Promise<ScheduleSet> {
  const query: MbtaQuery = { 'filter[trip]': tripId, include: 'trip', sort: 'stop_sequence' };
  if (stopIds?.length) query['filter[stop]'] = uniq(stopIds);
  const res = await mbtaGet('/schedules', query, o);
  return parseSchedulesDocument(res.doc);
}

/**
 * Schedules in a time window. `minTime`/`maxTime` are 'HH:MM' and may exceed 24:00 for
 * after-midnight service on `date` (the service date) [AR §2.4].
 */
export async function fetchSchedulesWindow(
  q: { stopIds: string[]; routeIds: string[]; directionId: DirectionId; date: string; minTime: string; maxTime: string },
  o: CallOptions = {},
): Promise<ScheduleSet> {
  if (q.stopIds.length === 0) return EMPTY_SCHEDULES;
  const query: MbtaQuery = {
    'filter[stop]': uniq(q.stopIds),
    'filter[direction_id]': q.directionId,
    'filter[date]': q.date,
    'filter[min_time]': q.minTime,
    'filter[max_time]': q.maxTime,
    include: 'trip',
    sort: 'departure_time',
  };
  if (q.routeIds.length) query['filter[route]'] = uniq(q.routeIds);
  const res = await mbtaGet('/schedules', query, o);
  return parseSchedulesDocument(res.doc);
}

/** One trip with its ordered platform ids. */
export async function fetchTrip(tripId: string, o: CallOptions = {}): Promise<Trip> {
  const res = await mbtaGet(`/trips/${encodeURIComponent(tripId)}`, { include: 'stops', 'fields[stop]': '' }, o);
  const [resource] = dataList(res.doc);
  if (!resource) throw new MbtaApiError({ kind: 'http', status: 404 });
  return parseTrip(resource);
}

export async function fetchVehicles(q: { routeIds: string[]; directionId?: DirectionId }, o: CallOptions = {}): Promise<Vehicle[]> {
  if (q.routeIds.length === 0) return [];
  const query: MbtaQuery = { 'filter[route]': uniq(q.routeIds) };
  if (q.directionId !== undefined) query['filter[direction_id]'] = q.directionId;
  const res = await mbtaGet('/vehicles', query, o);
  return dataList(res.doc).filter((r) => r.type === 'vehicle').map(parseVehicle);
}

/** All current and upcoming rail alerts (every lifecycle). */
export async function fetchAlerts(o: CallOptions = {}): Promise<Alert[]> {
  const res = await mbtaGet('/alerts', { 'filter[route_type]': RAIL_ROUTE_TYPES }, o);
  return dataList(res.doc).filter((r) => r.type === 'alert').map(parseAlert);
}

/** One alert, or null when it no longer exists. */
export async function fetchAlert(id: string, o: CallOptions = {}): Promise<Alert | null> {
  try {
    const res = await mbtaGet(`/alerts/${encodeURIComponent(id)}`, undefined, o);
    const [resource] = dataList(res.doc);
    return resource ? parseAlert(resource) : null;
  } catch (e) {
    if (e instanceof MbtaApiError && e.detail.kind === 'http' && e.detail.status === 404) return null;
    throw e;
  }
}
