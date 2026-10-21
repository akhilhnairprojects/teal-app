/**
 * V3 JSON:API resources -> model types. Every parser is total: unknown or missing values fall back
 * to null/defaults instead of throwing, so one odd record never breaks a screen.
 */
import { relId, relIds, type JsonApiDocument, type Resource } from '@/mbta/api/client';

import type {
  Alert,
  Carriage,
  DirectionId,
  InformedEntity,
  Line,
  LiveDepartures,
  LocationType,
  OccupancyStatus,
  Prediction,
  Route,
  RoutePattern,
  RouteType,
  Schedule,
  ScheduleRelationship,
  ScheduleSet,
  Stop,
  StopEventType,
  Trip,
  Typicality,
  Vehicle,
  VehicleStatus,
} from './types';

type Attrs = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;

export function parseTime(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function color(v: unknown, fallback = '000000'): string {
  const s = str(v) ?? fallback;
  return s.startsWith('#') ? s.toUpperCase() : `#${s.toUpperCase()}`;
}

const dir = (v: unknown): DirectionId => (v === 1 ? 1 : 0);
const routeType = (v: unknown): RouteType | null => (v === 0 || v === 1 || v === 2 || v === 3 || v === 4 ? v : null);
const stopEvent = (v: unknown): StopEventType => (v === 1 || v === 2 || v === 3 ? v : 0);

/** V3 encodes typicality as an integer: 0 undefined, 1 typical … 5 canonical-only. */
const TYPICALITY: Record<number, Typicality> = {
  1: 'typical',
  2: 'deviation',
  3: 'atypical',
  4: 'diversion',
  5: 'canonical_only',
};
function typicality(v: unknown): Typicality | null {
  if (typeof v === 'number') return TYPICALITY[v] ?? null;
  if (typeof v === 'string' && Object.values(TYPICALITY).includes(v as Typicality)) return v as Typicality;
  return null;
}

const SCHEDULE_RELATIONSHIPS = new Set(['ADDED', 'CANCELLED', 'NO_DATA', 'SKIPPED', 'UNSCHEDULED']);
function scheduleRelationship(v: unknown): ScheduleRelationship {
  const s = str(v)?.toUpperCase();
  return s && SCHEDULE_RELATIONSHIPS.has(s) ? (s as ScheduleRelationship) : null;
}

const VEHICLE_STATUSES = new Set(['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO']);
const OCCUPANCY = new Set([
  'EMPTY',
  'MANY_SEATS_AVAILABLE',
  'FEW_SEATS_AVAILABLE',
  'STANDING_ROOM_ONLY',
  'CRUSHED_STANDING_ROOM_ONLY',
  'FULL',
  'NOT_ACCEPTING_PASSENGERS',
  'NO_DATA_AVAILABLE',
  'NOT_BOARDABLE',
]);
function occupancy(v: unknown): OccupancyStatus | null {
  const s = str(v)?.toUpperCase();
  return s && OCCUPANCY.has(s) ? (s as OccupancyStatus) : null;
}

function pair<T>(v: unknown, map: (x: unknown) => T): [T, T] {
  const list = Array.isArray(v) ? v : [];
  return [map(list[0]), map(list[1])];
}

// --- static ---------------------------------------------------------------------------

export function parseRoute(r: Resource): Route {
  const a = r.attributes as Attrs;
  return {
    id: r.id,
    type: routeType(a.type) ?? 3,
    color: color(a.color, 'FFFFFF'),
    textColor: color(a.text_color, '000000'),
    shortName: str(a.short_name) ?? '',
    longName: str(a.long_name) ?? '',
    directionNames: pair(a.direction_names, str),
    directionDestinations: pair(a.direction_destinations, str),
    sortOrder: num(a.sort_order) ?? 0,
    lineId: relId(r, 'line'),
  };
}

export function parseLine(r: Resource): Line {
  const a = r.attributes as Attrs;
  return {
    id: r.id,
    shortName: str(a.short_name) ?? '',
    longName: str(a.long_name) ?? '',
    color: color(a.color, 'FFFFFF'),
    textColor: color(a.text_color, '000000'),
    sortOrder: num(a.sort_order) ?? 0,
  };
}

/** `childStopIds` is filled in by `linkStopFamilies` once every stop is known. */
export function parseStop(r: Resource): Stop {
  const a = r.attributes as Attrs;
  const lt = num(a.location_type);
  const wb = num(a.wheelchair_boarding);
  return {
    id: r.id,
    name: str(a.name) ?? r.id,
    latitude: num(a.latitude) ?? 0,
    longitude: num(a.longitude) ?? 0,
    locationType: (lt === 1 || lt === 2 || lt === 3 ? lt : 0) as LocationType,
    parentStationId: relId(r, 'parent_station'),
    childStopIds: relIds(r, 'child_stops'),
    platformCode: str(a.platform_code),
    platformName: str(a.platform_name),
    wheelchairBoarding: wb === 1 || wb === 2 ? wb : 0,
    vehicleType: routeType(a.vehicle_type),
  };
}

/** Populate each parent's `childStopIds` from its children's `parentStationId` (in place). */
export function linkStopFamilies(stops: Record<string, Stop>): Record<string, Stop> {
  for (const stop of Object.values(stops)) {
    if (!stop.parentStationId) continue;
    const parent = stops[stop.parentStationId];
    if (parent && !parent.childStopIds.includes(stop.id)) parent.childStopIds.push(stop.id);
  }
  return stops;
}

export function parseRoutePattern(r: Resource): RoutePattern {
  const a = r.attributes as Attrs;
  return {
    id: r.id,
    routeId: relId(r, 'route') ?? '',
    directionId: dir(a.direction_id),
    name: str(a.name) ?? '',
    typicality: typicality(a.typicality),
    canonical: bool(a.canonical),
    sortOrder: num(a.sort_order) ?? 0,
    representativeTripId: relId(r, 'representative_trip') ?? '',
  };
}

/** `stopIds` is set only when the `stops` relationship was requested (ordered platform ids). */
export function parseTrip(r: Resource): Trip {
  const a = r.attributes as Attrs;
  const hasStops = Array.isArray(r.relationships?.stops?.data);
  return {
    id: r.id,
    routeId: relId(r, 'route') ?? '',
    directionId: dir(a.direction_id),
    headsign: str(a.headsign) ?? '',
    routePatternId: relId(r, 'route_pattern'),
    shapeId: relId(r, 'shape'),
    stopIds: hasStops ? relIds(r, 'stops') : null,
  };
}

// --- realtime -------------------------------------------------------------------------

export function parsePrediction(r: Resource): Prediction {
  const a = r.attributes as Attrs;
  return {
    id: r.id,
    arrivalTime: parseTime(a.arrival_time),
    departureTime: parseTime(a.departure_time),
    departureUncertainty: num(a.departure_uncertainty),
    directionId: dir(a.direction_id),
    // V3 sends revenue as 'REVENUE' | 'NON_REVENUE' (older payloads: boolean).
    revenue: a.revenue === undefined || a.revenue === true || a.revenue === 'REVENUE',
    scheduleRelationship: scheduleRelationship(a.schedule_relationship),
    status: str(a.status),
    stopSequence: num(a.stop_sequence) ?? 0,
    lastTrip: bool(a.last_trip),
    routeId: relId(r, 'route') ?? '',
    stopId: relId(r, 'stop') ?? '',
    tripId: relId(r, 'trip') ?? '',
    vehicleId: relId(r, 'vehicle'),
    tripHeadsign: str(a.trip_headsign),
  };
}

export function parseSchedule(r: Resource): Schedule {
  const a = r.attributes as Attrs;
  return {
    id: r.id,
    arrivalTime: parseTime(a.arrival_time),
    departureTime: parseTime(a.departure_time),
    dropOffType: stopEvent(a.drop_off_type),
    pickUpType: stopEvent(a.pickup_type ?? a.pick_up_type),
    stopHeadsign: str(a.stop_headsign),
    stopSequence: num(a.stop_sequence) ?? 0,
    routeId: relId(r, 'route') ?? '',
    stopId: relId(r, 'stop') ?? '',
    tripId: relId(r, 'trip') ?? '',
  };
}

function parseCarriages(v: unknown): Carriage[] {
  if (!Array.isArray(v)) return [];
  return v.map((c: Attrs, i) => ({
    label: str(c?.label),
    sequence: num(c?.carriage_sequence) ?? i + 1,
    occupancyStatus: occupancy(c?.occupancy_status),
    occupancyPercentage: num(c?.occupancy_percentage),
  }));
}

export function parseVehicle(r: Resource): Vehicle {
  const a = r.attributes as Attrs;
  const status = str(a.current_status);
  return {
    id: r.id,
    label: str(a.label),
    latitude: num(a.latitude) ?? 0,
    longitude: num(a.longitude) ?? 0,
    bearing: num(a.bearing),
    currentStatus: (status && VEHICLE_STATUSES.has(status) ? status : 'IN_TRANSIT_TO') as VehicleStatus,
    currentStopSequence: num(a.current_stop_sequence),
    directionId: dir(a.direction_id),
    routeId: relId(r, 'route'),
    stopId: relId(r, 'stop'),
    tripId: relId(r, 'trip'),
    occupancyStatus: occupancy(a.occupancy_status),
    carriages: parseCarriages(a.carriages),
    updatedAt: parseTime(a.updated_at) ?? 0,
  };
}

function parseInformedEntity(e: Attrs): InformedEntity {
  const d = num(e.direction_id);
  return {
    activities: Array.isArray(e.activities) ? e.activities.filter((x): x is string => typeof x === 'string') : [],
    routeId: str(e.route),
    routeType: routeType(e.route_type),
    directionId: d === 0 || d === 1 ? d : null,
    stopId: str(e.stop),
    tripId: str(e.trip),
    facilityId: str(e.facility),
  };
}

export function parseAlert(r: Resource): Alert {
  const a = r.attributes as Attrs;
  const periods = Array.isArray(a.active_period) ? (a.active_period as Attrs[]) : [];
  const entities = Array.isArray(a.informed_entity) ? (a.informed_entity as Attrs[]) : [];
  return {
    id: r.id,
    effect: str(a.effect)?.toUpperCase() ?? 'UNKNOWN_EFFECT',
    cause: str(a.cause)?.toUpperCase() ?? null,
    severity: num(a.severity) ?? 0,
    header: str(a.header) ?? '',
    description: str(a.description),
    url: str(a.url),
    lifecycle: str(a.lifecycle),
    timeframe: str(a.timeframe),
    activePeriods: periods
      .map((p) => ({ start: parseTime(p?.start), end: parseTime(p?.end) }))
      .filter((p): p is { start: number; end: number | null } => p.start !== null),
    informedEntities: entities.map((e) => parseInformedEntity(e ?? {})),
    updatedAt: parseTime(a.updated_at) ?? 0,
  };
}

// --- documents ------------------------------------------------------------------------

function resources(doc: JsonApiDocument<Record<string, unknown>>): Resource[] {
  return Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
}

/** `/predictions?include=trip,vehicle` -> predictions plus their trips and vehicles. */
export function parsePredictionsDocument(doc: JsonApiDocument<Record<string, unknown>>): LiveDepartures {
  const trips: Record<string, Trip> = {};
  const vehicles: Record<string, Vehicle> = {};
  for (const r of doc.included ?? []) {
    if (r.type === 'trip') trips[r.id] = parseTrip(r);
    else if (r.type === 'vehicle') vehicles[r.id] = parseVehicle(r);
  }
  const predictions = resources(doc)
    .filter((r) => r.type === 'prediction')
    .map(parsePrediction);
  return { predictions, trips, vehicles };
}

/** `/schedules?include=trip` -> schedules plus their trips. */
export function parseSchedulesDocument(doc: JsonApiDocument<Record<string, unknown>>): ScheduleSet {
  const trips: Record<string, Trip> = {};
  for (const r of doc.included ?? []) if (r.type === 'trip') trips[r.id] = parseTrip(r);
  const schedules = resources(doc)
    .filter((r) => r.type === 'schedule')
    .map(parseSchedule);
  return { schedules, trips };
}

/** Follow `parentStationId` links to the root station; unknown ids map to themselves. */
export function resolveParentId(stops: Record<string, Stop>, stopId: string): string {
  let id = stopId;
  for (let guard = 0; guard < 5; guard++) {
    const parent = stops[id]?.parentStationId;
    if (!parent) return id;
    id = parent;
  }
  return id;
}
