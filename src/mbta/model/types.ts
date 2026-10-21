/**
 * Shared MBTA domain model. All times are epoch ms. Field shapes follow the V3 API, normalised
 * to camelCase; parsing lives in `parse.ts`.
 */

export type RouteType = 0 | 1 | 2 | 3 | 4; // light rail, heavy rail, CR, bus, ferry
export type DirectionId = 0 | 1;

export type Route = {
  id: string;
  type: RouteType;
  /** '#RRGGBB' */
  color: string;
  /** '#RRGGBB' */
  textColor: string;
  shortName: string;
  longName: string;
  directionNames: [string | null, string | null];
  directionDestinations: [string | null, string | null];
  sortOrder: number;
  lineId: string | null;
};

export type Line = { id: string; shortName: string; longName: string; color: string; textColor: string; sortOrder: number };

export type LocationType = 0 | 1 | 2 | 3;

export type Stop = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  locationType: LocationType;
  parentStationId: string | null;
  childStopIds: string[];
  platformCode: string | null;
  platformName: string | null;
  wheelchairBoarding: 0 | 1 | 2;
  vehicleType: RouteType | null;
};

export type Typicality = 'typical' | 'deviation' | 'atypical' | 'diversion' | 'canonical_only';

export type RoutePattern = {
  id: string;
  routeId: string;
  directionId: DirectionId;
  name: string;
  typicality: Typicality | null;
  canonical: boolean;
  sortOrder: number;
  representativeTripId: string;
};

export type Trip = {
  id: string;
  routeId: string;
  directionId: DirectionId;
  headsign: string;
  routePatternId: string | null;
  shapeId: string | null;
  /** Ordered platform ids when known. */
  stopIds: string[] | null;
};

export type ScheduleRelationship = 'ADDED' | 'CANCELLED' | 'NO_DATA' | 'SKIPPED' | 'UNSCHEDULED' | null;

export type Prediction = {
  id: string;
  arrivalTime: number | null;
  departureTime: number | null;
  departureUncertainty: number | null;
  directionId: DirectionId;
  revenue: boolean;
  scheduleRelationship: ScheduleRelationship;
  status: string | null;
  stopSequence: number;
  lastTrip: boolean;
  routeId: string;
  stopId: string;
  tripId: string;
  vehicleId: string | null;
  /** V3 `trip_headsign` override for this stop, when the feed sets one. */
  tripHeadsign?: string | null;
};

/** GTFS pickup/drop-off type: 0 regular, 1 unavailable, 2 call agency, 3 coordinate with driver. */
export type StopEventType = 0 | 1 | 2 | 3;

export type Schedule = {
  id: string;
  arrivalTime: number | null;
  departureTime: number | null;
  dropOffType: StopEventType;
  pickUpType: StopEventType;
  stopHeadsign: string | null;
  stopSequence: number;
  routeId: string;
  stopId: string;
  tripId: string;
};

export type VehicleStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';

export type OccupancyStatus =
  | 'EMPTY'
  | 'MANY_SEATS_AVAILABLE'
  | 'FEW_SEATS_AVAILABLE'
  | 'STANDING_ROOM_ONLY'
  | 'CRUSHED_STANDING_ROOM_ONLY'
  | 'FULL'
  | 'NOT_ACCEPTING_PASSENGERS'
  | 'NO_DATA_AVAILABLE'
  | 'NOT_BOARDABLE';

export type Carriage = {
  label: string | null;
  sequence: number;
  occupancyStatus: OccupancyStatus | null;
  occupancyPercentage: number | null;
};

export type Vehicle = {
  id: string;
  label: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  currentStatus: VehicleStatus;
  currentStopSequence: number | null;
  directionId: DirectionId;
  routeId: string | null;
  stopId: string | null;
  tripId: string | null;
  occupancyStatus: OccupancyStatus | null;
  carriages: Carriage[];
  updatedAt: number;
};

export type LiveDepartures = { predictions: Prediction[]; trips: Record<string, Trip>; vehicles: Record<string, Vehicle> };
export type ScheduleSet = { schedules: Schedule[]; trips: Record<string, Trip> };

export type AlertSignificance = 'major' | 'secondary' | 'accessibility' | 'minor' | 'none';

export type InformedEntity = {
  /** V3 activity names, e.g. 'BOARD', 'EXIT', 'RIDE', 'USING_WHEELCHAIR'. */
  activities: string[];
  routeId: string | null;
  routeType: RouteType | null;
  directionId: DirectionId | null;
  stopId: string | null;
  tripId: string | null;
  facilityId: string | null;
};

export type Alert = {
  id: string;
  /** V3 effect, e.g. 'SHUTTLE', 'SUSPENSION', 'STATION_CLOSURE'. */
  effect: string;
  /** V3 cause, e.g. 'SINGLE_TRACKING'. */
  cause: string | null;
  severity: number;
  header: string;
  description: string | null;
  url: string | null;
  lifecycle: string | null;
  timeframe: string | null;
  activePeriods: { start: number; end: number | null }[];
  informedEntities: InformedEntity[];
  updatedAt: number;
};

export type LatLng = import('@/lib/geo').LatLng;

export const isSubwayType = (t: RouteType | null | undefined): boolean => t === 0 || t === 1;
