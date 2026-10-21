export type LatLng = { latitude: number; longitude: number };

/** Park Street, used when the device location is unavailable. */
export const PARK_STREET: LatLng = { latitude: 42.35639, longitude: -71.0624 };

/** Rough reach of the T and Bluebikes around downtown Boston. */
const BOSTON_AREA_RADIUS_M = 40_000;

const EARTH_RADIUS_M = 6_371_000;
/** Typical city walking pace (~3 mph). */
const WALK_METERS_PER_MINUTE = 80;
/** Relaxed urban cycling pace used by the planner. */
const BIKE_METERS_PER_MINUTE = 250;
/** Street grids add distance over a straight line. */
const BIKE_DETOUR = 1.25;
/** Time to undock and dock a Bluebike. */
const BIKE_DOCK_MINUTES = 2;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isInBostonArea(point: LatLng): boolean {
  return distanceMeters(point, PARK_STREET) <= BOSTON_AREA_RADIUS_M;
}

/** Straight-line walking estimate; real routes are longer, so round up. */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil(meters / WALK_METERS_PER_MINUTE));
}

/** Walking minutes over a straight-line distance, inflated by a street-grid detour factor. Not rounded. */
export function walkMinutesDetour(meters: number, detour = 1.3): number {
  return (meters * detour) / WALK_METERS_PER_MINUTE;
}

/** Bluebikes ride minutes for a straight-line distance, including docking time. Not rounded. */
export function bikeMinutes(meters: number): number {
  return (meters * BIKE_DETOUR) / BIKE_METERS_PER_MINUTE + BIKE_DOCK_MINUTES;
}

export type Bounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };

/** Bounding box of a set of points, or null when there are none. */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  for (const p of points) {
    minLatitude = Math.min(minLatitude, p.latitude);
    maxLatitude = Math.max(maxLatitude, p.latitude);
    minLongitude = Math.min(minLongitude, p.longitude);
    maxLongitude = Math.max(maxLongitude, p.longitude);
  }
  return { minLatitude, maxLatitude, minLongitude, maxLongitude };
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}
