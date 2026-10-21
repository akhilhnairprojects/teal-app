// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/TripInstantDisplay.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Cutoffs from model/Prediction.kt and stop-time helpers from model/TripStopTime.kt, same commit.
import type { Alert, Prediction, RouteType, Schedule, Vehicle } from '@/mbta/model/types';
import { formatClock, formatMinutes, sameEasternMinute } from '@/mbta/time/eastern';

import { isStopSkipped } from './alerts';

export type DisplayContext = 'nearby' | 'stopDetailsUnfiltered' | 'stopDetailsFiltered' | 'tripDetails';

export type TripInstantDisplay =
  | { kind: 'overridden'; text: string; last: boolean }
  | { kind: 'hidden' }
  | { kind: 'boarding'; last: boolean }
  | { kind: 'arriving'; last: boolean }
  | { kind: 'approaching'; last: boolean }
  | { kind: 'now'; last: boolean }
  | { kind: 'time'; predictionTime: number; last: boolean; headline: boolean }
  | { kind: 'timeWithStatus'; predictionTime: number; status: string; last: boolean; headline: boolean }
  | { kind: 'timeWithSchedule'; predictionTime: number; scheduledTime: number; last: boolean; headline: boolean }
  | { kind: 'minutes'; minutes: number; last: boolean }
  | { kind: 'scheduleTime'; scheduledTime: number; last: boolean; headline: boolean }
  | { kind: 'scheduleTimeWithStatusColumn'; scheduledTime: number; status: string; last: boolean; headline: boolean }
  | { kind: 'scheduleTimeWithStatusRow'; scheduledTime: number; status: string }
  | { kind: 'scheduleMinutes'; minutes: number; last: boolean }
  | { kind: 'skipped'; scheduledTime: number | null }
  | { kind: 'cancelled'; scheduledTime: number }
  | { kind: 'shuttle'; scheduledTime: number };

export const ARRIVAL_CUTOFF_MS = 30_000,
  APPROACH_CUTOFF_MS = 60_000,
  BOARDING_CUTOFF_MS = 90_000,
  SCHEDULE_CLOCK_CUTOFF_MIN = 60;

const ROUTE_TYPE_CR: RouteType = 2;
const ROUTE_TYPE_BUS: RouteType = 3;
const ROUTE_TYPE_FERRY: RouteType = 4;

type StopTime = { arrivalTime: number | null; departureTime: number | null };

/** arrival ?? departure (TripStopTime.stopTime). */
export const stopTimeOf = (t: StopTime | null | undefined): number | null => (t ? (t.arrivalTime ?? t.departureTime) : null);

/** departure ?? arrival, for schedule-based modes (TripStopTime.departureBasedStopTime). */
const departureBasedStopTime = (t: StopTime | null | undefined): number | null =>
  t ? (t.departureTime ?? t.arrivalTime) : null;

/** Arrival unless it is already past, else departure (TripStopTime.stopTimeAfter). */
export const stopTimeAfter = (t: StopTime | null | undefined, now: number): number | null => {
  if (!t) return null;
  if (t.arrivalTime !== null && !(t.arrivalTime < now)) return t.arrivalTime;
  return t.departureTime;
};

/** Now is between arrival and departure, inclusive. */
export const hasArrivedButNotDeparted = (t: StopTime, now: number): boolean =>
  t.arrivalTime !== null && t.arrivalTime <= now && t.departureTime !== null && t.departureTime >= now;

/** Kotlin rounds half up (roundToInt); JS Math.round matches for positive and negative halves. */
const roundMinutes = (ms: number) => Math.round(ms / 60_000);

export function tripInstantDisplay(a: {
  prediction: Prediction | null;
  schedule: Schedule | null;
  vehicle: Vehicle | null;
  routeType: RouteType;
  now: number;
  context: DisplayContext;
  lastTrip: boolean;
  alert: Alert | null;
}): TripInstantDisplay {
  const { prediction, schedule, vehicle, routeType, now, context, lastTrip, alert } = a;
  const allowArrivalOnly = context === 'tripDetails';
  const scheduleBasedRouteType = routeType === ROUTE_TYPE_CR || routeType === ROUTE_TYPE_FERRY;
  const forceAsTime = context === 'tripDetails' || scheduleBasedRouteType;
  const isScheduledDeparture = scheduleBasedRouteType && context !== 'tripDetails';
  const timeFor = (t: StopTime | null) => (isScheduledDeparture ? departureBasedStopTime(t) : stopTimeAfter(t, now));
  const predictionTime = timeFor(prediction);
  const scheduleTime = timeFor(schedule);
  const isScheduleUpcoming = scheduleTime !== null && scheduleTime >= now;

  if (
    scheduleTime !== null &&
    isScheduleUpcoming &&
    ((routeType === ROUTE_TYPE_BUS && context === 'stopDetailsFiltered') || scheduleBasedRouteType)
  ) {
    if (prediction?.scheduleRelationship === 'CANCELLED') return { kind: 'cancelled', scheduledTime: scheduleTime };
    if (alert?.effect === 'SHUTTLE') return { kind: 'shuttle', scheduledTime: scheduleTime };
    if (alert && isStopSkipped(alert)) return { kind: 'skipped', scheduledTime: scheduleTime };
  }

  if (prediction?.status != null) {
    const status = prediction.status;
    if (routeType === ROUTE_TYPE_CR) {
      if (predictionTime !== null && context === 'stopDetailsFiltered') {
        return { kind: 'timeWithStatus', predictionTime, status, last: lastTrip, headline: isScheduledDeparture };
      }
      if (predictionTime !== null) return { kind: 'time', predictionTime, last: lastTrip, headline: isScheduledDeparture };
      if (scheduleTime !== null && (context === 'stopDetailsFiltered' || lastTrip)) {
        return { kind: 'scheduleTimeWithStatusColumn', scheduledTime: scheduleTime, status, last: lastTrip, headline: isScheduledDeparture };
      }
      if (scheduleTime !== null && scheduleTime < now) {
        return { kind: 'scheduleTimeWithStatusRow', scheduledTime: scheduleTime, status };
      }
      if (scheduleTime !== null) return { kind: 'scheduleTime', scheduledTime: scheduleTime, last: lastTrip, headline: isScheduledDeparture };
    }
    return { kind: 'overridden', text: status, last: lastTrip };
  }

  if (prediction?.scheduleRelationship === 'SKIPPED') {
    const scheduled = stopTimeOf(schedule);
    return scheduled !== null ? { kind: 'skipped', scheduledTime: scheduled } : { kind: 'hidden' };
  }

  if (prediction === null) {
    const scheduled = stopTimeAfter(schedule, now);
    if (scheduled === null || schedule === null || (schedule.departureTime === null && !allowArrivalOnly)) {
      return { kind: 'hidden' };
    }
    const minutes = roundMinutes(scheduled - now);
    if (minutes >= SCHEDULE_CLOCK_CUTOFF_MIN || forceAsTime) {
      return { kind: 'scheduleTime', scheduledTime: scheduled, last: lastTrip, headline: isScheduledDeparture };
    }
    return { kind: 'scheduleMinutes', minutes, last: lastTrip };
  }

  if (predictionTime === null || (prediction.departureTime === null && !allowArrivalOnly)) return { kind: 'hidden' };
  const timeRemaining = predictionTime - now;
  const minutes = roundMinutes(timeRemaining);

  if (forceAsTime) {
    const scheduled = stopTimeAfter(schedule, now);
    const showDelayedSchedule =
      context === 'stopDetailsFiltered' && scheduled !== null && !sameEasternMinute(scheduled, predictionTime);
    if (timeRemaining < 0) return { kind: 'hidden' };
    if (showDelayedSchedule) {
      return { kind: 'timeWithSchedule', predictionTime, scheduledTime: scheduled!, last: lastTrip, headline: isScheduledDeparture };
    }
    return { kind: 'time', predictionTime, last: lastTrip, headline: isScheduledDeparture };
  }

  // Bus boarding and arriving are too close together to be useful as separate states.
  if (routeType === ROUTE_TYPE_BUS) {
    if (timeRemaining < 0) return { kind: 'hidden' };
    if (timeRemaining <= ARRIVAL_CUTOFF_MS) return { kind: 'now', last: lastTrip };
    return { kind: 'minutes', minutes, last: lastTrip };
  }

  if (
    vehicle?.currentStatus === 'STOPPED_AT' &&
    vehicle.stopId === prediction.stopId &&
    vehicle.tripId === prediction.tripId &&
    (timeRemaining <= BOARDING_CUTOFF_MS || hasArrivedButNotDeparted(prediction, now))
  ) {
    return { kind: 'boarding', last: lastTrip };
  }
  if (timeRemaining < 0) return { kind: 'hidden' };
  if (timeRemaining <= ARRIVAL_CUTOFF_MS || hasArrivedButNotDeparted(prediction, now)) return { kind: 'arriving', last: lastTrip };
  if (timeRemaining <= APPROACH_CUTOFF_MS) return { kind: 'approaching', last: lastTrip };
  return { kind: 'minutes', minutes, last: lastTrip };
}

// --- strings (MA §3.1) -----------------------------------------------------------------

export type DepartureText = {
  primary: string;
  /** Substring of `primary` to render bold (e.g. the number in "5 min"). */
  boldPart: string | null;
  /** A struck-through scheduled time shown after `primary`. */
  struck: string | null;
  realtime: boolean;
  last: boolean;
  icon: 'bus' | 'clock' | null;
  a11y: string;
};

const minutesA11y = (m: number) => (m === 1 ? '1 minute' : m < 60 ? `${m} minutes` : formatMinutes(m).replace('hr', 'hour').replace('min', 'minutes'));

export function departureText(d: TripInstantDisplay): DepartureText {
  const base = { boldPart: null, struck: null, realtime: false, last: false, icon: null } as const;
  const lastSuffix = (last: boolean) => (last ? ', last trip' : '');
  switch (d.kind) {
    case 'hidden':
      return { ...base, primary: '', a11y: '' };
    case 'overridden':
      return { ...base, primary: d.text, realtime: true, last: d.last, a11y: `${d.text}${lastSuffix(d.last)}` };
    case 'boarding':
      return { ...base, primary: 'BRD', realtime: true, last: d.last, a11y: `Boarding now${lastSuffix(d.last)}` };
    case 'arriving':
      return { ...base, primary: 'ARR', realtime: true, last: d.last, a11y: `Arriving now${lastSuffix(d.last)}` };
    case 'now':
      return { ...base, primary: 'Now', realtime: true, last: d.last, a11y: `Arriving now${lastSuffix(d.last)}` };
    case 'approaching':
      // Deliberately "1 min"; "Approaching" is reserved for vehicle status [MA §3.1].
      return { ...base, primary: '1 min', boldPart: '1', realtime: true, last: d.last, a11y: `Arriving in 1 minute${lastSuffix(d.last)}` };
    case 'minutes': {
      const text = formatMinutes(d.minutes);
      return {
        ...base,
        primary: text,
        boldPart: d.minutes < 60 ? String(d.minutes) : null,
        realtime: true,
        last: d.last,
        a11y: `Arriving in ${minutesA11y(d.minutes)}${lastSuffix(d.last)}`,
      };
    }
    case 'time': {
      const clock = formatClock(d.predictionTime);
      return { ...base, primary: clock, boldPart: d.headline ? clock : null, realtime: true, last: d.last, a11y: `At ${clock}${lastSuffix(d.last)}` };
    }
    case 'timeWithStatus': {
      const clock = formatClock(d.predictionTime);
      return {
        ...base,
        primary: `${clock} · ${d.status}`,
        boldPart: clock,
        realtime: true,
        last: d.last,
        a11y: `At ${clock}, ${d.status}${lastSuffix(d.last)}`,
      };
    }
    case 'timeWithSchedule': {
      const clock = formatClock(d.predictionTime);
      const sched = formatClock(d.scheduledTime);
      return {
        ...base,
        primary: clock,
        boldPart: d.headline ? clock : null,
        struck: sched,
        realtime: true,
        last: d.last,
        a11y: `At ${clock}, originally ${sched}${lastSuffix(d.last)}`,
      };
    }
    case 'scheduleTime': {
      const clock = formatClock(d.scheduledTime);
      return {
        ...base,
        primary: clock,
        boldPart: d.headline ? clock : null,
        last: d.last,
        icon: d.last ? 'clock' : null,
        a11y: `Scheduled at ${clock}${lastSuffix(d.last)}`,
      };
    }
    case 'scheduleTimeWithStatusColumn': {
      const clock = formatClock(d.scheduledTime);
      return {
        ...base,
        primary: `${clock} · ${d.status}`,
        boldPart: d.headline ? clock : null,
        last: d.last,
        icon: d.last ? 'clock' : null,
        a11y: `Scheduled at ${clock}, ${d.status}${lastSuffix(d.last)}`,
      };
    }
    case 'scheduleTimeWithStatusRow': {
      const clock = formatClock(d.scheduledTime);
      return { ...base, primary: `${clock} · ${d.status}`, a11y: `Scheduled at ${clock}, ${d.status}` };
    }
    case 'scheduleMinutes':
      return {
        ...base,
        primary: formatMinutes(d.minutes),
        boldPart: d.minutes < 60 ? String(d.minutes) : null,
        last: d.last,
        icon: d.last ? 'clock' : null,
        a11y: `Scheduled in ${minutesA11y(d.minutes)}${lastSuffix(d.last)}`,
      };
    case 'skipped':
      return {
        ...base,
        primary: 'Stop skipped',
        struck: d.scheduledTime !== null ? formatClock(d.scheduledTime) : null,
        a11y: 'Stop skipped',
      };
    case 'cancelled': {
      const sched = formatClock(d.scheduledTime);
      return { ...base, primary: 'Cancelled', struck: sched, a11y: `Cancelled, was scheduled at ${sched}` };
    }
    case 'shuttle':
      return { ...base, primary: 'Shuttle', icon: 'bus', a11y: 'Shuttle bus replaces this trip' };
  }
}
