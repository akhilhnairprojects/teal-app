/**
 * Track metrics with the same segment rules as the server's `submit_activity` (spec §2.5), so local
 * numbers match what the server stores. Parity is checked by `supabase/tests/submit.sql` against the
 * shared fixtures in `__fixtures__/tracks.ts`. Keep every rule here and in the SQL in lockstep.
 */
import { distanceMeters } from '@/lib/geo';

import type { ActivityKind, Effort, LatLng, Split, TrackPoint } from './types';

export const SEGMENT_RULES: Record<ActivityKind, { capMps: number; maxGapMs: 30_000; movingMps: number }> = {
  run: { capMps: 7.5, maxGapMs: 30_000, movingMps: 0.5 },
  bike: { capMps: 17, maxGapMs: 30_000, movingMps: 1.0 },
};

export const STANDARD_DISTANCES = [1000, 5000, 10000] as const;

/** Faster than these and the activity is flagged `implausible_effort` (1K 2:30, 5K 13:30, 10K 28:00). */
export const EFFORT_FLOOR_MS: Record<1000 | 5000 | 10000, number> = { 1000: 150_000, 5000: 810_000, 10000: 1_680_000 };

/** A run that ends within this distance of its start, after at least LOOP_MIN_M counted, is a loop. */
export const LOOP_MAX_GAP_M = 75;
export const LOOP_MIN_M = 1000;

export type TrackMetrics = {
  distanceM: number;
  excludedM: number;
  elapsedMs: number;
  movingMs: number;
  efforts: Effort[] /* runs only */;
  isLoop: boolean;
  loopGapM: number | null;
  medianDtMs: number | null;
};

const dist = (a: TrackPoint, b: TrackPoint): number =>
  distanceMeters({ latitude: a.lat, longitude: a.lon }, { latitude: b.lat, longitude: b.lon });

type SegmentPass = {
  /** ok[i]: segment (i−1, i) is counted. ok[0] is false. */
  ok: boolean[];
  /** Counted distance up to point i. */
  cum: number[];
  distanceM: number;
  excludedM: number;
  movingMs: number;
};

/**
 * Classify every segment: `dt > 30 s` is a gap (not counted); faster than the cap is a vehicle
 * (excluded); otherwise counted, and moving when at least `movingMps`. Non-increasing times count as
 * gaps here (the server rejects such a track outright).
 */
function segmentPass(points: readonly TrackPoint[], kind: ActivityKind): SegmentPass {
  const rules = SEGMENT_RULES[kind];
  const n = points.length;
  const ok = new Array<boolean>(n).fill(false);
  const cum = new Array<number>(n).fill(0);
  let distanceM = 0;
  let excludedM = 0;
  let movingMs = 0;
  for (let i = 1; i < n; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) {
      const d = dist(points[i - 1], points[i]);
      const speed = d / (dt / 1000);
      if (dt <= rules.maxGapMs && speed <= rules.capMps) {
        ok[i] = true;
        distanceM += d;
        if (speed >= rules.movingMps) movingMs += dt;
      } else if (dt <= rules.maxGapMs) {
        excludedM += d;
      }
    }
    cum[i] = distanceM;
  }
  return { ok, cum, distanceM, excludedM, movingMs };
}

/** Median of the sample intervals (Postgres percentile_cont(0.5): the mean of the middle two). */
function medianDt(points: readonly TrackPoint[]): number | null {
  if (points.length < 2) return null;
  const dts: number[] = [];
  for (let i = 1; i < points.length; i++) dts.push(points[i].t - points[i - 1].t);
  dts.sort((a, b) => a - b);
  const mid = (dts.length - 1) / 2;
  const lo = dts[Math.floor(mid)];
  const hi = dts[Math.ceil(mid)];
  return lo + (hi - lo) * (mid - Math.floor(mid));
}

/**
 * Two-pointer best effort over a classified track: for each start point s, the interpolated time at
 * which counted distance first reaches cum[s] + D, minus t[s]; the window never spans an uncounted
 * segment. Same loop as submit_activity.
 */
function bestEffortFromPass(points: readonly TrackPoint[], pass: SegmentPass, distanceM: number): Effort | null {
  const { ok, cum } = pass;
  const n = points.length;
  let best: number | null = null;
  let bestStart = 0;
  let e = 1;
  for (let s = 0; s < n - 1; s++) {
    if (e <= s) e = s + 1;
    while (e < n && ok[e] && cum[e] - cum[s] < distanceM) e++;
    if (e >= n) break; // later starts reach even less far
    if (!ok[e]) continue; // blocked by a gap or a vehicle segment
    const frac = (cum[s] + distanceM - cum[e - 1]) / (cum[e] - cum[e - 1]);
    const tt = points[e - 1].t + frac * (points[e].t - points[e - 1].t);
    const dur = tt - points[s].t;
    if (best === null || dur < best) {
      best = dur;
      bestStart = points[s].t;
    }
  }
  return best === null ? null : { distanceM: distanceM as Effort['distanceM'], durationMs: Math.round(best), startOffsetMs: bestStart };
}

export function bestEffort(points: readonly TrackPoint[], kind: ActivityKind, distanceM: number): Effort | null {
  if (points.length < 2) return null;
  return bestEffortFromPass(points, segmentPass(points, kind), distanceM);
}

export function computeTrackMetrics(points: readonly TrackPoint[], kind: ActivityKind): TrackMetrics {
  const pass = segmentPass(points, kind);
  const n = points.length;
  const efforts: Effort[] = [];
  if (kind === 'run') {
    for (const d of STANDARD_DISTANCES) {
      if (pass.distanceM < d) continue;
      const e = bestEffortFromPass(points, pass, d);
      if (e) efforts.push(e);
    }
  }
  const loopGapM = n >= 2 ? dist(points[0], points[n - 1]) : null;
  return {
    distanceM: pass.distanceM,
    excludedM: pass.excludedM,
    elapsedMs: n >= 2 ? points[n - 1].t - points[0].t : 0,
    movingMs: pass.movingMs,
    efforts,
    isLoop: kind === 'run' && loopGapM !== null && loopGapM <= LOOP_MAX_GAP_M && pass.distanceM >= LOOP_MIN_M,
    loopGapM,
    medianDtMs: medianDt(points),
  };
}

/** Server flags this activity would get: `vehicle`, `implausible_effort`, `sparse`, `too_short`. */
export function expectedFlags(m: TrackMetrics): string[] {
  const flags: string[] = [];
  if (m.excludedM > 0.2 * (m.distanceM + m.excludedM)) flags.push('vehicle');
  if (m.medianDtMs !== null && m.medianDtMs > 5000) flags.push('sparse');
  if (m.distanceM < 200) flags.push('too_short');
  if (m.efforts.some((e) => e.durationMs < EFFORT_FLOOR_MS[e.distanceM])) flags.push('implausible_effort');
  return flags;
}

/**
 * Splits every `unitM` of counted distance (e.g. 1609.344 for miles). Duration is counted time
 * (gaps and vehicle segments excluded), interpolated inside the crossing segment. The last split is
 * partial when the distance is not a whole number of units.
 */
export function splits(points: readonly TrackPoint[], kind: ActivityKind, unitM: number): Split[] {
  if (points.length < 2 || !(unitM > 0)) return [];
  const pass = segmentPass(points, kind);
  const out: Split[] = [];
  let splitStartM = 0;
  let splitMs = 0;
  for (let i = 1; i < points.length; i++) {
    if (!pass.ok[i]) continue;
    const dt = points[i].t - points[i - 1].t;
    let segStart = pass.cum[i - 1];
    const segEnd = pass.cum[i];
    const segLen = segEnd - segStart;
    while (segLen > 0 && segEnd - splitStartM >= unitM) {
      const boundary = splitStartM + unitM;
      const part = (boundary - segStart) / segLen;
      splitMs += part * dt;
      out.push({ index: out.length, distanceM: unitM, durationMs: Math.round(splitMs) });
      splitStartM = boundary;
      splitMs = 0;
      segStart = boundary;
    }
    splitMs += segLen > 0 ? ((segEnd - segStart) / segLen) * dt : dt;
  }
  const rest = pass.distanceM - splitStartM;
  if (rest > 0.5) out.push({ index: out.length, distanceM: rest, durationMs: Math.round(splitMs) });
  return out;
}

/** At most `max` points, evenly decimated, always keeping the first and the last (for display). */
export function recentPath(points: readonly TrackPoint[], max: number): LatLng[] {
  const n = points.length;
  if (n === 0 || max <= 0) return [];
  const toLatLng = (p: TrackPoint): LatLng => ({ latitude: p.lat, longitude: p.lon });
  if (n <= max) return points.map(toLatLng);
  if (max === 1) return [toLatLng(points[n - 1])];
  const out: LatLng[] = [];
  for (let k = 0; k < max; k++) out.push(toLatLng(points[Math.round((k * (n - 1)) / (max - 1))]));
  return out;
}
