// Test-fixture builder modelled on mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/ObjectCollectionBuilder.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Same defaults as the Kotlin builders so ported golden tests keep their meaning.
import type { GlobalData } from '@/mbta/global/globalData';
import type {
  Alert,
  Carriage,
  InformedEntity,
  Line,
  LiveDepartures,
  Prediction,
  Route,
  RoutePattern,
  Schedule,
  ScheduleSet,
  Stop,
  Trip,
  Vehicle,
} from '@/mbta/model/types';
import { makeUpcomingTrip, type UpcomingTrip } from '@/mbta/rules/upcomingTrip';

/** Kotlin's Instant.DISTANT_PAST stand-in: the earliest JS date. */
export const DISTANT_PAST = -8.64e15;

type TripInput = Partial<Trip>;

/** Drop keys whose value is `undefined`, so `{ id: undefined }` keeps the default id. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export type Builder = ReturnType<typeof createBuilder>;

/**
 * Build related fixtures and keep track of them, like ObjectCollectionBuilder. Every `build.x()`
 * stores the object in `objects` and returns it; `global()` assembles a `GlobalData`.
 */
export function createBuilder(namespace = 'test') {
  let seq = 0;
  const nextId = () => `${namespace}/${++seq}`;
  const objects = {
    alerts: {} as Record<string, Alert>,
    lines: {} as Record<string, Line>,
    predictions: {} as Record<string, Prediction>,
    routes: {} as Record<string, Route>,
    patterns: {} as Record<string, RoutePattern>,
    schedules: {} as Record<string, Schedule>,
    stops: {} as Record<string, Stop>,
    trips: {} as Record<string, Trip>,
    vehicles: {} as Record<string, Vehicle>,
  };

  const b = {
    objects,

    stop(o: Partial<Stop> = {}): Stop {
      const s: Stop = {
        id: nextId(),
        name: '',
        latitude: 1.2,
        longitude: 3.4,
        locationType: 0,
        parentStationId: null,
        childStopIds: [],
        platformCode: null,
        platformName: null,
        wheelchairBoarding: 0,
        vehicleType: null,
        ...defined(o),
      };
      objects.stops[s.id] = s;
      return s;
    },

    /** A child of `parent` (adds its id to `parent.childStopIds`). */
    childStop(parent: Stop, o: Partial<Stop> = {}): Stop {
      const s = b.stop({ parentStationId: parent.id, ...o });
      parent.childStopIds.push(s.id);
      return s;
    },

    line(o: Partial<Line> = {}): Line {
      const l: Line = { id: nextId(), shortName: '', longName: '', color: '#FFFFFF', textColor: '#000000', sortOrder: 0, ...defined(o) };
      objects.lines[l.id] = l;
      return l;
    },

    route(o: Partial<Route> = {}): Route {
      const r: Route = {
        id: nextId(),
        type: 0,
        color: '#FFFFFF',
        textColor: '#000000',
        shortName: '',
        longName: '',
        directionNames: ['', ''],
        directionDestinations: ['', ''],
        sortOrder: 0,
        lineId: null,
        ...defined(o),
      };
      objects.routes[r.id] = r;
      return r;
    },

    trip(o: TripInput = {}): Trip {
      const t: Trip = { id: nextId(), routeId: '', directionId: 0, headsign: '', routePatternId: null, shapeId: null, stopIds: null, ...defined(o) };
      objects.trips[t.id] = t;
      return t;
    },

    /** A trip on a pattern, copying the representative trip's headsign, shape and stops. */
    tripFor(pattern: RoutePattern, o: TripInput = {}): Trip {
      const rep = objects.trips[pattern.representativeTripId];
      return b.trip({
        directionId: pattern.directionId,
        routeId: pattern.routeId,
        routePatternId: pattern.id,
        headsign: rep?.headsign ?? '',
        shapeId: rep?.shapeId ?? null,
        stopIds: rep?.stopIds ?? null,
        ...defined(o),
      });
    },

    /**
     * A route pattern (typicality defaults to atypical, like Kotlin). Pass `representativeTrip`
     * to create its representative trip.
     */
    pattern(route: Route, o: Partial<RoutePattern> & { representativeTrip?: TripInput } = {}): RoutePattern {
      const { representativeTrip, ...rest } = defined(o);
      const p: RoutePattern = {
        id: nextId(),
        routeId: route.id,
        directionId: 0,
        name: '',
        typicality: 'atypical',
        canonical: false,
        sortOrder: 0,
        representativeTripId: '',
        ...rest,
      };
      if (representativeTrip) {
        const t = b.trip({ routeId: p.routeId, routePatternId: p.id, directionId: p.directionId, ...representativeTrip });
        p.representativeTripId = t.id;
      }
      objects.patterns[p.id] = p;
      return p;
    },

    prediction(o: Partial<Prediction> & { trip?: Trip } = {}): Prediction {
      const { trip, ...rest } = defined(o);
      const fromTrip: Partial<Prediction> = trip
        ? {
            routeId: (trip.routePatternId && objects.patterns[trip.routePatternId]?.routeId) || trip.routeId,
            tripId: trip.id,
            directionId: trip.directionId,
          }
        : {};
      const p: Prediction = {
        id: nextId(),
        arrivalTime: null,
        departureTime: null,
        departureUncertainty: null,
        directionId: 0,
        revenue: true,
        scheduleRelationship: null,
        status: null,
        stopSequence: 0,
        lastTrip: false,
        routeId: '',
        stopId: '',
        tripId: '',
        vehicleId: null,
        tripHeadsign: null,
        ...fromTrip,
        ...rest,
      };
      objects.predictions[p.id] = p;
      return p;
    },

    /** A prediction matching a schedule's route, trip, stop and sequence. */
    predictionFor(schedule: Schedule, o: Partial<Prediction> = {}): Prediction {
      return b.prediction({
        routeId: schedule.routeId,
        tripId: schedule.tripId,
        stopId: schedule.stopId,
        stopSequence: schedule.stopSequence,
        ...defined(o),
      });
    },

    /** Pick-up/drop-off types follow the times (null time = unavailable) unless given. */
    schedule(o: Partial<Schedule> & { trip?: Trip } = {}): Schedule {
      const { trip, ...rest } = defined(o);
      const fromTrip: Partial<Schedule> = trip
        ? { routeId: (trip.routePatternId && objects.patterns[trip.routePatternId]?.routeId) || trip.routeId, tripId: trip.id }
        : {};
      const arrivalTime = rest.arrivalTime ?? null;
      const departureTime = rest.departureTime ?? null;
      const s: Schedule = {
        id: nextId(),
        arrivalTime,
        departureTime,
        dropOffType: arrivalTime === null ? 1 : 0,
        pickUpType: departureTime === null ? 1 : 0,
        stopHeadsign: null,
        stopSequence: 0,
        routeId: '',
        stopId: '',
        tripId: '',
        ...fromTrip,
        ...rest,
      };
      objects.schedules[s.id] = s;
      return s;
    },

    vehicle(o: Partial<Vehicle> = {}): Vehicle {
      const v: Vehicle = {
        id: nextId(),
        label: null,
        latitude: 1.2,
        longitude: 3.4,
        bearing: 0,
        currentStatus: 'IN_TRANSIT_TO',
        currentStopSequence: null,
        directionId: 0,
        routeId: null,
        stopId: null,
        tripId: '',
        occupancyStatus: 'NO_DATA_AVAILABLE',
        carriages: [],
        updatedAt: Date.now() - 10_000,
        ...defined(o),
      };
      objects.vehicles[v.id] = v;
      return v;
    },

    carriage(o: Partial<Carriage> & { sequence: number }): Carriage {
      return { label: null, occupancyStatus: 'NO_DATA_AVAILABLE', occupancyPercentage: null, ...defined(o) };
    },

    /** An informed entity; activities default to BOARD, EXIT, RIDE like Kotlin. */
    entity(o: Partial<InformedEntity> = {}): InformedEntity {
      return {
        activities: ['BOARD', 'EXIT', 'RIDE'],
        routeId: null,
        routeType: null,
        directionId: null,
        stopId: null,
        tripId: null,
        facilityId: null,
        ...defined(o),
      };
    },

    /** An alert active since the distant past unless `activePeriods` is given. */
    alert(o: Partial<Alert> = {}): Alert {
      const a: Alert = {
        id: nextId(),
        effect: 'UNKNOWN_EFFECT',
        cause: null,
        severity: 0,
        header: '',
        description: null,
        url: null,
        lifecycle: 'NEW',
        timeframe: null,
        activePeriods: [{ start: DISTANT_PAST, end: null }],
        informedEntities: [],
        updatedAt: 0,
        ...defined(o),
      };
      objects.alerts[a.id] = a;
      return a;
    },

    upcomingTrip(o: { schedule?: Schedule | null; prediction?: Prediction | null; predictionStop?: Stop | null; vehicle?: Vehicle | null; alert?: Alert | null }): UpcomingTrip {
      const tripId = o.prediction?.tripId ?? o.schedule?.tripId;
      const trip = tripId ? objects.trips[tripId] : undefined;
      if (!trip) throw new Error(`builders.upcomingTrip: unknown trip ${tripId}`);
      return makeUpcomingTrip(
        trip,
        o.schedule ?? null,
        o.prediction ?? null,
        o.predictionStop ?? (o.prediction ? (objects.stops[o.prediction.stopId] ?? null) : null),
        o.vehicle ?? null,
        o.alert ?? null,
      );
    },

    /**
     * GlobalData of everything built so far. `patternIdsByStop` defaults to each pattern's
     * representative-trip stops, in pattern creation order (as GlobalResponse(objects) does).
     */
    global(o: { patternIdsByStop?: Record<string, string[]>; now?: number; serviceDate?: string } = {}): GlobalData {
      let byStop = o.patternIdsByStop;
      if (!byStop) {
        byStop = {};
        for (const p of Object.values(objects.patterns)) {
          for (const stopId of objects.trips[p.representativeTripId]?.stopIds ?? []) (byStop[stopId] ??= []).push(p.id);
        }
      }
      return {
        version: 1,
        fetchedAt: o.now ?? 0,
        serviceDate: o.serviceDate ?? '2026-01-01',
        routes: { ...objects.routes },
        lines: { ...objects.lines },
        stops: { ...objects.stops },
        patterns: { ...objects.patterns },
        trips: { ...objects.trips },
        patternIdsByStop: byStop,
      };
    },

    scheduleSet(schedules: Schedule[] = Object.values(objects.schedules)): ScheduleSet {
      return { schedules, trips: { ...objects.trips } };
    },

    liveDepartures(predictions: Prediction[] = Object.values(objects.predictions)): LiveDepartures {
      return { predictions, trips: { ...objects.trips }, vehicles: { ...objects.vehicles } };
    },
  };
  return b;
}

/** A shared builder for one-off objects (ObjectCollectionBuilder.Single). */
export const build = createBuilder('Single');
