/** Display text for the parking screen: direction, ETA and data age. */
import { bikeMinutes, distanceMeters, formatDistance, walkMinutesDetour, type LatLng } from '@/lib/geo';
import { WALK_DETOUR } from '@/planner/constants';
import type { DockCandidate } from '@/parking/types';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Compass = (typeof COMPASS)[number];

/** Initial great-circle bearing from `a` to `b`, in degrees clockwise from north [0, 360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compassDirection(a: LatLng, b: LatLng): Compass {
  return COMPASS[Math.round(bearingDegrees(a, b) / 45) % 8];
}

/** "0.6 mi NE" from the rider to the dock, or null without a location. */
export function dockDistanceText(here: LatLng | null, dock: LatLng): string | null {
  if (!here) return null;
  const m = distanceMeters(here, dock);
  if (m < 30) return 'Here';
  return `${formatDistance(m)} ${compassDirection(here, dock)}`;
}

const walkMin = (c: DockCandidate) => Math.max(1, Math.round(walkMinutesDetour(c.walkM, WALK_DETOUR)));

/** "a 3 min walk" from the dock to the destination. */
export function walkMinutesText(c: DockCandidate): string {
  return `a ${walkMin(c)} min walk`;
}

/** "Ride ~6 min, then a 3 min walk" (ride omitted without a location). */
export function etaText(c: DockCandidate, here: LatLng | null): string {
  const walk = walkMin(c);
  if (!here) return `${walk} min walk to your destination`;
  return `Ride ~${Math.max(1, Math.round(bikeMinutes(c.rideM)))} min, then a ${walk} min walk`;
}

/** "Checked just now" / "Checked 40 s ago" / "Checked 3 min ago". */
export function checkedAgoText(lastCheckAt: number | null, now: number): string {
  if (lastCheckAt === null) return 'Checking docks…';
  const s = Math.max(0, Math.round((now - lastCheckAt) / 1000));
  if (s < 10) return 'Checked just now';
  if (s < 60) return `Checked ${s} s ago`;
  return `Checked ${Math.round(s / 60)} min ago`;
}
