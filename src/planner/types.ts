/**
 * Planner contracts. The engine (`planTrip`) lives in `src/planner/engine.ts`; this file holds types
 * only.
 */
import type { BikeStation } from '@/data/bluebikes';
import type { fetchPredictionsForStops, fetchSchedulesForTrip, fetchSchedulesWindow } from '@/mbta/api/endpoints';
import type { GlobalData } from '@/mbta/global/globalData';
import type { Alert, Carriage, DirectionId } from '@/mbta/model/types';
import type { CarRecommendation } from '@/mbta/rules/vehicle';
import type { LatLng } from '@/lib/geo';

export type Place = {
  name: string;
  latLng: LatLng;
  source: 'station' | 'photon' | 'apple' | 'nominatim' | 'current' | 'map';
  stopId?: string;
  subtitle?: string;
};

export type PlanRequest = { origin: Place; destination: Place; departAt: number };

export type BikeDock = {
  stationId: string;
  name: string;
  latLng: LatLng;
  bikes: number;
  ebikes: number;
  docks: number;
  rentalUrl: string | null;
};

export type WalkLeg = {
  mode: 'walk';
  from: LatLng;
  to: LatLng;
  fromName: string;
  toName: string;
  meters: number;
  startTime: number;
  endTime: number;
};

export type BikeLeg = { mode: 'bike'; fromDock: BikeDock; toDock: BikeDock; meters: number; startTime: number; endTime: number };

export type TransitLeg = {
  mode: 'transit';
  routeId: string;
  directionId: DirectionId;
  headsign: string;
  tripId: string | null;
  fromStopId: string;
  toStopId: string;
  boardPlatformId: string | null;
  alightPlatformId: string | null;
  departTime: number;
  arriveTime: number;
  timeSource: 'realtime' | 'scheduled' | 'estimated';
  stopCount: number;
  vehicleId: string | null;
  carriages: Carriage[];
  car: CarRecommendation | null;
  alerts: Alert[];
  uncertaintySec: number | null;
  laterDepartures: number[];
};

export type Leg = WalkLeg | BikeLeg | TransitLeg;

export type ItineraryKind = 'walk' | 'transit' | 'bike' | 'bike+transit' | 'transit+bike';

export type PlanNotice = {
  kind: 'weather' | 'alert' | 'bikeAvailability' | 'rateLimited' | 'scheduledOnly' | 'noService';
  severity: 'info' | 'warning';
  text: string;
  alertId?: string;
};

export type Itinerary = {
  id: string;
  kind: ItineraryKind;
  legs: Leg[];
  departTime: number;
  arriveTime: number;
  transfers: number;
  walkMeters: number;
  score: number;
  tags: ('fastest' | 'leastWalking' | 'noTransfers' | 'weatherRisk' | 'disrupted' | 'scheduled')[];
  notices: PlanNotice[];
};

export type WeatherSnapshot = {
  fetchedAt: number;
  temperatureF: number | null;
  shortForecast: string;
  precipProbability: number | null;
  windMph: number | null;
  bikeAdvisory: 'ok' | 'caution' | 'avoid';
  reason: string | null;
};

export type PlanResult = {
  request: PlanRequest;
  itineraries: Itinerary[];
  weather: WeatherSnapshot | null;
  generatedAt: number;
  notices: PlanNotice[];
};

export type PlannerDeps = {
  global: GlobalData;
  alerts: Alert[] | null;
  now: () => number;
  fetchPredictions: typeof fetchPredictionsForStops;
  fetchSchedulesForTrip: typeof fetchSchedulesForTrip;
  fetchSchedulesWindow: typeof fetchSchedulesWindow;
  fetchBikeStations: () => Promise<BikeStation[]>;
  fetchWeather: (at: LatLng) => Promise<WeatherSnapshot | null>;
};

