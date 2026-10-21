/** Rider-facing text for planner results (pure, unit-tested). */
import { formatDistance, walkMinutesDetour } from '@/lib/geo';
import type { GlobalData } from '@/mbta/global/globalData';
import { formatClock, formatMinutes } from '@/mbta/time/eastern';
import type { BikeDock, Itinerary, ItineraryKind, Leg, TransitLeg, WeatherSnapshot } from '@/planner/types';

const MIN = 60_000;

export const minutesBetween = (a: number, b: number): number => Math.max(0, Math.round((b - a) / MIN));

export function kindLabel(kind: ItineraryKind): string {
  switch (kind) {
    case 'walk':
      return 'Walk';
    case 'transit':
      return 'T';
    case 'bike':
      return 'Bluebike';
    case 'bike+transit':
      return 'Bike + T';
    case 'transit+bike':
      return 'T + bike';
  }
}

export function tagLabel(tag: Itinerary['tags'][number]): string {
  switch (tag) {
    case 'fastest':
      return 'Fastest';
    case 'leastWalking':
      return 'Least walking';
    case 'noTransfers':
      return 'No transfers';
    case 'weatherRisk':
      return 'Weather';
    case 'disrupted':
      return 'Service alert';
    case 'scheduled':
      return 'Scheduled';
  }
}

/** '25 min' door to door, counted from now when the trip starts right away. */
export function durationText(i: Itinerary, now: number): string {
  return formatMinutes(minutesBetween(Math.min(now, i.departTime), i.arriveTime));
}

/** 'Leave now' / 'Leave in 4 min' / 'Leave at 8:05 PM'. */
export function leaveText(departTime: number, now: number): string {
  const mins = minutesBetween(now, departTime);
  if (mins <= 0) return 'Leave now';
  if (mins < 60) return `Leave in ${mins} min`;
  return `Leave at ${formatClock(departTime)}`;
}

export function routeName(g: GlobalData | null, routeId: string): string {
  const r = g?.routes[routeId];
  return r ? r.longName || r.shortName || r.id : routeId;
}

export const stationName = (g: GlobalData | null, id: string): string => g?.stops[id]?.name ?? id;

export function walkText(meters: number): string {
  return `${formatMinutes(Math.max(1, Math.round(walkMinutesDetour(meters))))} · ${formatDistance(meters)}`;
}

export function legTitle(leg: Leg, g: GlobalData | null): string {
  if (leg.mode === 'walk') return `Walk to ${leg.toName}`;
  if (leg.mode === 'bike') return `Ride a Bluebike to ${leg.toDock.name}`;
  return leg.headsign ? `${routeName(g, leg.routeId)} toward ${leg.headsign}` : routeName(g, leg.routeId);
}

export function dockBikesText(d: BikeDock): string {
  const bikes = `${d.bikes} ${d.bikes === 1 ? 'bike' : 'bikes'}`;
  return d.ebikes > 0 ? `${bikes} (${d.ebikes} e-bike${d.ebikes === 1 ? '' : 's'})` : bikes;
}

export const dockParkingText = (d: BikeDock): string => `${d.docks} open ${d.docks === 1 ? 'dock' : 'docks'} to park`;

/** 'in 3 min' / 'now' for a departure. */
export function departsIn(t: number, now: number): string {
  const mins = minutesBetween(now, t);
  return mins <= 0 ? 'now' : `in ${formatMinutes(mins)}`;
}

export function transitTimeText(leg: TransitLeg): string {
  const prefix = leg.timeSource === 'scheduled' ? 'Scheduled ' : leg.timeSource === 'estimated' ? 'About ' : '';
  return `${prefix}${formatClock(leg.departTime)} → ${formatClock(leg.arriveTime)}`;
}

/** Wider-than-usual prediction uncertainty (seconds) worth mentioning. */
export function uncertaintyText(sec: number | null): string | null {
  if (sec === null || sec <= 60) return null;
  return `Departure time may shift by about ${formatMinutes(Math.round(sec / 60))}`;
}

/** Compact summary of the modes, e.g. 'Walk · Red Line · Orange Line'. */
export function modeSummary(i: Itinerary, g: GlobalData | null): string {
  const parts = i.legs
    .filter((l) => l.mode !== 'walk' || i.legs.length === 1)
    .map((l) => (l.mode === 'walk' ? 'Walk' : l.mode === 'bike' ? 'Bluebike' : routeName(g, l.routeId)));
  return parts.join(' · ');
}

export function weatherText(w: WeatherSnapshot): string {
  const temp = w.temperatureF !== null ? `${Math.round(w.temperatureF)}°F` : null;
  const pop = w.precipProbability !== null && w.precipProbability > 0 ? `${w.precipProbability}% precip` : null;
  return [temp, w.shortForecast || null, pop].filter(Boolean).join(' · ');
}

export function bikeAdvisoryText(w: WeatherSnapshot): string {
  if (w.bikeAdvisory === 'avoid') return `Not great for biking${w.reason ? `: ${w.reason}` : ''}`;
  if (w.bikeAdvisory === 'caution') return `Bike with care${w.reason ? `: ${w.reason}` : ''}`;
  return 'Good biking weather';
}
