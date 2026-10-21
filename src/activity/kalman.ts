/**
 * A 2-axis constant-position Kalman filter in local metres (spec §3.3). Both axes share one scalar
 * variance because the measurement noise (GPS horizontal accuracy) is isotropic. Pure and immutable,
 * so the GPS filter can try an update and discard it when the fix turns out to be a jump.
 */

export type KalmanState = { x: number; y: number; /** Position variance, m². */ p: number; tMs: number };

/** Start from the first measurement: the estimate is the fix, its variance the fix's. */
export function kalmanInit(x: number, y: number, varianceM2: number, tMs: number): KalmanState {
  return { x, y, p: varianceM2, tMs };
}

/**
 * Predict (variance grows by `q` m²/s of elapsed time) then correct with a measurement whose variance
 * is `varianceM2` (accuracy²).
 */
export function kalmanStep(s: KalmanState, x: number, y: number, varianceM2: number, tMs: number, q: number): KalmanState {
  const dtS = Math.max(0, (tMs - s.tMs) / 1000);
  const prior = s.p + q * dtS;
  const k = prior / (prior + varianceM2);
  return { x: s.x + k * (x - s.x), y: s.y + k * (y - s.y), p: (1 - k) * prior, tMs };
}

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

/** Equirectangular projection around an origin: accurate to well under 0.1 % over a city. */
export type LocalFrame = { lat0: number; lon0: number; cosLat0: number };

export const localFrame = (lat0: number, lon0: number): LocalFrame => ({ lat0, lon0, cosLat0: Math.cos(lat0 * RAD) });

export function toLocal(f: LocalFrame, lat: number, lon: number): { x: number; y: number } {
  return { x: (lon - f.lon0) * RAD * EARTH_RADIUS_M * f.cosLat0, y: (lat - f.lat0) * RAD * EARTH_RADIUS_M };
}

export function fromLocal(f: LocalFrame, x: number, y: number): { lat: number; lon: number } {
  return { lat: f.lat0 + y / (RAD * EARTH_RADIUS_M), lon: f.lon0 + x / (RAD * EARTH_RADIUS_M * f.cosLat0) };
}
