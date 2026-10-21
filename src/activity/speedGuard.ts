/**
 * Too-fast guard for leaderboards and territory. Moving faster than the activity allows, sustained
 * for `sustainMs`, earns a warning; keeping it up for another `graceMs` (counted only while still too
 * fast) voids the activity: it is deleted and never counted. Short bursts (a sprint finish, a GPS
 * spike) don't trip it because the speed has to stay over the limit.
 *
 * Two forms share the thresholds:
 * - `createSpeedGuard`: live, on raw GPS fixes (Doppler speed, smoothed over `windowMs`), so the
 *   runner is warned in the moment.
 * - `trackOverspeed`: on the saved track's segments, the rule the server applies in `submit_activity`
 *   (migration `20261022000100_speed_guard.sql`). Keep the two in lockstep.
 */
import { distanceMeters } from '@/lib/geo';

import type { ActivityKind, RawFix, TrackPoint } from './types';

export const SPEED_GUARD: Record<ActivityKind, { limitMps: number; sustainMs: number; graceMs: number }> = {
  // 6.7 m/s ≈ 24 km/h ≈ 15 mph ≈ 4:00/mi: faster than world-record marathon pace.
  run: { limitMps: 6.7, sustainMs: 20_000, graceMs: 45_000 },
  // 12.5 m/s ≈ 45 km/h ≈ 28 mph: well above Bluebike e-assist (20 mph); a car or a long steep descent.
  bike: { limitMps: 12.5, sustainMs: 20_000, graceMs: 45_000 },
};

/** Live smoothing window and the GPS quality a fix needs to count. */
export const GUARD_LIVE = { windowMs: 10_000, maxAccuracyM: 30, maxGapMs: 30_000 } as const;

export type GuardEvent = 'none' | 'warn' | 'void';

export const SPEED_GUARD_COPY = {
  warnTitle: (k: ActivityKind) => (k === 'run' ? 'Slow down to keep this run' : 'Slow down to keep this ride'),
  warnBody: (k: ActivityKind) =>
    k === 'run'
      ? 'You’re moving faster than running pace. Keep this up and the run will be deleted so it can’t count on leaderboards or territory.'
      : 'You’re moving faster than a Bluebike goes. Keep this up and the ride will be deleted so it can’t count on leaderboards.',
  warnSpoken: (k: ActivityKind) =>
    k === 'run' ? 'You’re going faster than running pace. Slow down, or this run will be deleted.' : 'You’re going too fast for a Bluebike. Slow down, or this ride will be deleted.',
  voidTitle: (k: ActivityKind) => (k === 'run' ? 'Run deleted' : 'Ride deleted'),
  voidBody: (k: ActivityKind) =>
    k === 'run'
      ? 'This run stayed faster than running pace after the warning, so it was deleted and won’t count on leaderboards or territory.'
      : 'This ride stayed faster than a Bluebike goes after the warning, so it was deleted and won’t count on leaderboards.',
} as const;

/** Advance the warn/void state machine by one interval of `dt` ms that was (or wasn't) too fast. */
function step(s: { runMs: number; warned: boolean; postMs: number }, over: boolean, dt: number, k: ActivityKind): GuardEvent {
  const cfg = SPEED_GUARD[k];
  if (!over) {
    s.runMs = 0;
    return 'none';
  }
  const before = s.runMs;
  s.runMs += dt;
  if (!s.warned) {
    if (s.runMs < cfg.sustainMs) return 'none';
    s.warned = true;
    // Time in this episode beyond the sustain threshold already counts toward the grace period.
    s.postMs += s.runMs - Math.max(before, cfg.sustainMs);
    return s.postMs >= cfg.graceMs ? 'void' : 'warn';
  }
  s.postMs += dt;
  return s.postMs >= cfg.graceMs ? 'void' : 'none';
}

/**
 * The server rule on a finished track: segments longer than 30 s are gaps (they reset the episode and
 * never count). Returns whether the warning threshold was reached and whether the track is void.
 */
export function trackOverspeed(points: readonly TrackPoint[], k: ActivityKind): { warned: boolean; voided: boolean } {
  const s = { runMs: 0, warned: false, postMs: 0 };
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt <= 0 || dt > GUARD_LIVE.maxGapMs) {
      s.runMs = 0;
      continue;
    }
    const d = distanceMeters({ latitude: points[i - 1].lat, longitude: points[i - 1].lon }, { latitude: points[i].lat, longitude: points[i].lon });
    if (step(s, d / (dt / 1000) > SPEED_GUARD[k].limitMps, dt, k) === 'void') return { warned: true, voided: true };
  }
  return { warned: s.warned, voided: false };
}

export type SpeedGuard = { push(fix: RawFix): GuardEvent; readonly warned: boolean; readonly voided: boolean };

/**
 * Live guard on raw fixes. Each usable fix (accuracy ≤ 30 m) gives a speed sample: the Doppler speed
 * when the phone reports one, else the speed implied by the previous usable fix. The mean over the
 * last 10 s decides whether the interval since the previous fix was too fast. Emits 'warn' once and
 * 'void' once.
 */
export function createSpeedGuard(k: ActivityKind): SpeedGuard {
  const s = { runMs: 0, warned: false, postMs: 0 };
  let voided = false;
  let prev: RawFix | null = null;
  const samples: { t: number; v: number }[] = [];

  return {
    get warned() {
      return s.warned;
    },
    get voided() {
      return voided;
    },
    push(fix) {
      if (voided) return 'none';
      if (fix.accuracy === null || fix.accuracy > GUARD_LIVE.maxAccuracyM) return 'none';
      const last = prev;
      prev = fix;
      if (!last) return 'none';
      const dt = fix.timestamp - last.timestamp;
      if (dt <= 0) return 'none';
      if (dt > GUARD_LIVE.maxGapMs) {
        s.runMs = 0;
        samples.length = 0;
        return 'none';
      }
      const doppler = fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
      const implied = distanceMeters(last, fix) / (dt / 1000);
      samples.push({ t: fix.timestamp, v: doppler ?? implied });
      while (samples.length > 0 && samples[0].t < fix.timestamp - GUARD_LIVE.windowMs) samples.shift();
      const mean = samples.reduce((a, x) => a + x.v, 0) / samples.length;
      const ev = step(s, mean > SPEED_GUARD[k].limitMps, dt, k);
      if (ev === 'void') voided = true;
      return ev;
    },
  };
}
