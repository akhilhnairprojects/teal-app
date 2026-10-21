/**
 * Deterministic GPS fixtures shared by the metrics, filter, recorder and sync tests (spec §5 G0 step 4)
 * and, for `parityTrack`, by `supabase/tests/submit.sql`, which rebuilds the same points with the same
 * closed-form expression. Change both together.
 */
import { round6, type RawFix, type TrackPoint } from '../types';

const R = 6_371_000;
const DEG = 180 / Math.PI;

/** Mulberry32: a small seeded PRNG, so "random" noise is identical on every run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples (Box–Muller) from a seeded PRNG. */
export function seededGaussian(seed: number): () => number {
  const rnd = seededRandom(seed);
  return () => {
    const u = Math.max(rnd(), 1e-12);
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Offset a point by metres north/east on a sphere (exact along a meridian). */
export function offset(lat0: number, lon0: number, northM: number, eastM: number): { lat: number; lon: number } {
  return { lat: lat0 + (northM / R) * DEG, lon: lon0 + (eastM / (R * Math.cos(lat0 / DEG))) * DEG };
}

export const ORIGIN = { lat: 42.33, lon: -71.08 };

type Leg = { headingDeg: number; meters: number; mps: number };

/**
 * Points every second along straight legs at constant speeds, starting at `t0`. Legs heading due
 * north (0°) keep an exact haversine distance per step, which the effort assertions rely on.
 */
export function legsTrack(legs: readonly Leg[], o: { lat?: number; lon?: number; t0?: number } = {}): TrackPoint[] {
  const lat0 = o.lat ?? ORIGIN.lat;
  const lon0 = o.lon ?? ORIGIN.lon;
  let north = 0;
  let east = 0;
  let t = o.t0 ?? 0;
  const pts: TrackPoint[] = [{ t, ...offset(lat0, lon0, 0, 0) }];
  for (const leg of legs) {
    const steps = Math.round(leg.meters / leg.mps);
    const h = leg.headingDeg / DEG;
    for (let k = 1; k <= steps; k++) {
      north += Math.cos(h) * leg.mps;
      east += Math.sin(h) * leg.mps;
      t += 1000;
      pts.push({ t, ...offset(lat0, lon0, north, east) });
    }
  }
  return pts;
}

/** A constant 4 m/s, 11 km run due north (1K = 250 s, 5K = 1250 s, 10K = 2500 s). */
export const constantRun = (): TrackPoint[] => legsTrack([{ headingDeg: 0, meters: 11_000, mps: 4 }]);

/** The injected car leg of `carRun`, in metres. */
export const CAR_LEG_M = 1500;

/** 3 km run, a 1.5 km car ride at 15 m/s, then 2 km more running; all due north. */
export const carRun = (): TrackPoint[] =>
  legsTrack([
    { headingDeg: 0, meters: 3000, mps: 4 },
    { headingDeg: 0, meters: CAR_LEG_M, mps: 15 },
    { headingDeg: 0, meters: 2000, mps: 4 },
  ]);

/** The gap in `gapRun`: no fixes between these times (ms). */
export const GAP = { fromT: 1_500_000, toT: 1_540_000 };

/**
 * 6 km at 4 m/s, a 40 s gap (the runner moves on 1 km while no fixes arrive), then 5.5 km at 5 m/s.
 * A 5K that spanned the gap would look absurdly fast; a correct one lies inside the second stretch.
 */
export function gapRun(): TrackPoint[] {
  const first = legsTrack([{ headingDeg: 0, meters: 6000, mps: 4 }]);
  const end = first[first.length - 1];
  const resume = offset(end.lat, end.lon, 1000, 0);
  const second = legsTrack([{ headingDeg: 0, meters: 5500, mps: 5 }], { lat: resume.lat, lon: resume.lon, t0: GAP.toT });
  return [...first, ...second];
}

/** Side of a square enclosing 1.2 km². */
export const LOOP_SIDE_M = Math.sqrt(1_200_000);

/** A closed square loop of 1.2 km² near Boston Common, run clockwise at 4 m/s. */
export const loopRun = (o: { lat?: number; lon?: number } = {}): TrackPoint[] =>
  legsTrack(
    [
      { headingDeg: 0, meters: LOOP_SIDE_M, mps: 4 },
      { headingDeg: 90, meters: LOOP_SIDE_M, mps: 4 },
      { headingDeg: 180, meters: LOOP_SIDE_M, mps: 4 },
      { headingDeg: 270, meters: LOOP_SIDE_M, mps: 4 },
    ],
    { lat: o.lat ?? 42.352, lon: o.lon ?? -71.07 },
  );

/** A figure-8 of two 500 m squares touching at the start, which is also the finish. */
export const figure8Run = (): TrackPoint[] =>
  legsTrack(
    [
      { headingDeg: 0, meters: 500, mps: 4 },
      { headingDeg: 90, meters: 500, mps: 4 },
      { headingDeg: 180, meters: 500, mps: 4 },
      { headingDeg: 270, meters: 1000, mps: 4 },
      { headingDeg: 180, meters: 500, mps: 4 },
      { headingDeg: 90, meters: 500, mps: 4 },
      { headingDeg: 0, meters: 500, mps: 4 },
    ],
    { lat: 42.36, lon: -71.09 },
  );

/**
 * The SQL parity track. Speed v_k = 15 m/s for 2000 < k ≤ 2060 (a vehicle), else 3.5 + 0.8·sin(k/37);
 * s_k = Σ v_i; lat_k = 42.30 + s_k/6 371 000·180/π rounded to 6 dp; lon −71.10; t_k = k s; points with
 * 1500 < k < 1540 are missing (a 40 s gap). submit.sql builds exactly this with generate_series.
 */
export function parityTrack(): TrackPoint[] {
  const pts: TrackPoint[] = [];
  let s = 0;
  for (let k = 0; k <= 3000; k++) {
    if (k > 0) s += k > 2000 && k <= 2060 ? 15 : 3.5 + 0.8 * Math.sin(k / 37);
    if (k > 1500 && k < 1540) continue;
    pts.push({ t: k * 1000, lat: round6(42.3 + (s / R) * DEG), lon: -71.1 });
  }
  return pts;
}

/**
 * Raw fixes from a phone lying still for 10 minutes: independent Gaussian position noise (σ 8 m per
 * axis), reported accuracy 8 m, and a Doppler speed near zero (|N(0, 0.15)| m/s).
 */
export function stationaryNoisyFixes(seed = 7, t0 = 1_800_000_000_000): RawFix[] {
  const g = seededGaussian(seed);
  const out: RawFix[] = [];
  for (let k = 0; k < 600; k++) {
    const p = offset(ORIGIN.lat, ORIGIN.lon, 8 * g(), 8 * g());
    out.push({ latitude: p.lat, longitude: p.lon, accuracy: 8, speed: Math.abs(0.15 * g()), timestamp: t0 + k * 1000 });
  }
  return out;
}

/** Clean running fixes at 4 m/s due north, one per second, accuracy 5 m. */
export function runningFixes(n: number, t0 = 1_800_000_000_000, mps = 4): RawFix[] {
  const out: RawFix[] = [];
  for (let k = 0; k < n; k++) {
    const p = offset(ORIGIN.lat, ORIGIN.lon, k * mps, 0);
    out.push({ latitude: p.lat, longitude: p.lon, accuracy: 5, speed: mps, timestamp: t0 + k * 1000 });
  }
  return out;
}
