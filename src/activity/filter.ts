/**
 * GPS filter for the recorder (spec §3.3): reject bad fixes, smooth with a Kalman filter, drop
 * single-fix jumps, and emit `TrackPoint`s on real movement or as 5 s keepalives.
 *
 * Teal choices beyond the spec's rules:
 * - Stationary hold: when fixes carry a valid Doppler speed below the kind's pause speed (0.5 m/s run,
 *   1.0 m/s bike), positions are held instead of emitted, and leaving the hold takes two fixes at or
 *   above it. Doppler speed is far less noisy than position differences, so standing still at a light
 *   doesn't add GPS jitter as distance. Fixes without a speed (null or negative) use the displacement
 *   rule alone.
 * - Innovation gate: besides the spec's implied-speed check (last emitted point → smoothed position),
 *   a fix whose raw position is further from the filter's prediction than `cap·dt + 3σ` also counts as
 *   a violation. Smoothing shrinks a single spike below the cap, so the spec's check alone lets it in.
 */
import { fromLocal, kalmanInit, kalmanStep, localFrame, toLocal, type KalmanState, type LocalFrame } from './kalman';
import { SEGMENT_RULES } from './metrics';
import { round6, type ActivityKind, type RawFix, type TrackPoint } from './types';

export type FilterConfig = {
  /** Fixes with a worse (larger) horizontal accuracy are rejected. */
  maxAccuracyM: number;
  /** Fixes older than this at arrival are rejected. */
  staleMs: number;
  /** Kalman process noise, m²/s. */
  kalmanQ: number;
  /** Emit when the smoothed position is this far from the last emitted point. */
  minMoveM: number;
  /** Emit a keepalive (same position, new time) after this long without a point. */
  keepaliveMs: number;
  /** Up to this many consecutive over-cap fixes are dropped as jumps. */
  jumpTolerance: number;
  /** Over-cap fixes sustained this long raise `vehicleSuspected`. */
  vehicleSustainMs: number;
  /** Auto-pause (display only) below this speed... */
  pauseMps: number;
  /** ...and resume above this one. */
  resumeMps: number;
  pauseAfterMs: number;
  resumeAfterMs: number;
};

export const FILTER_CONFIG: Record<ActivityKind, FilterConfig> = {
  run: {
    maxAccuracyM: 25,
    staleMs: 10_000,
    kalmanQ: 3,
    minMoveM: 4,
    keepaliveMs: 5_000,
    jumpTolerance: 2,
    vehicleSustainMs: 20_000,
    pauseMps: 0.5,
    resumeMps: 0.9,
    pauseAfterMs: 5_000,
    resumeAfterMs: 3_000,
  },
  bike: {
    maxAccuracyM: 30,
    staleMs: 10_000,
    kalmanQ: 8,
    minMoveM: 6,
    keepaliveMs: 5_000,
    jumpTolerance: 2,
    vehicleSustainMs: 20_000,
    pauseMps: 1.0,
    resumeMps: 1.5,
    pauseAfterMs: 5_000,
    resumeAfterMs: 3_000,
  },
};

export type FilterVerdict = 'emitted' | 'held' | 'inaccurate' | 'stale' | 'outOfOrder' | 'jump';

export type GpsFilter = {
  push(fix: RawFix, now: number): { verdict: FilterVerdict; point: TrackPoint | null; vehicleSuspected: boolean };
  reset(startedAt: number): void;
};

type Emitted = { x: number; y: number; ts: number; point: TrackPoint };

/** Fixes at or above the pause speed needed to leave the stationary hold. */
const STATIONARY_RELEASE_FIXES = 2;
/** Innovation gate width, in standard deviations of the predicted measurement. */
const INNOVATION_SIGMAS = 3;

export function createGpsFilter(kind: ActivityKind, startedAt: number): GpsFilter {
  const cfg = FILTER_CONFIG[kind];
  const cap = SEGMENT_RULES[kind].capMps;

  let start = startedAt;
  let frame: LocalFrame | null = null;
  let kalman: KalmanState | null = null;
  let lastAcceptedTs = -Infinity;
  let last: Emitted | null = null;
  let violations = 0;
  let violationSince: number | null = null;
  let vehicleSuspected = false;
  let stationary = false;
  let movingStreak = 0;

  const result = (verdict: FilterVerdict, point: TrackPoint | null = null) => ({ verdict, point, vehicleSuspected });

  function emitAt(state: KalmanState, ts: number): TrackPoint {
    const f = frame!;
    const ll = fromLocal(f, state.x, state.y);
    const point: TrackPoint = { t: Math.max(0, Math.round(ts - start)), lat: round6(ll.lat), lon: round6(ll.lon) };
    last = { x: state.x, y: state.y, ts, point };
    return point;
  }

  return {
    reset(nextStartedAt: number) {
      start = nextStartedAt;
      frame = null;
      kalman = null;
      lastAcceptedTs = -Infinity;
      last = null;
      violations = 0;
      violationSince = null;
      vehicleSuspected = false;
      stationary = false;
      movingStreak = 0;
    },

    push(fix, now) {
      if (fix.accuracy === null || !Number.isFinite(fix.accuracy) || fix.accuracy > cfg.maxAccuracyM) return result('inaccurate');
      if (fix.timestamp <= lastAcceptedTs) return result('outOfOrder');
      if (now - fix.timestamp > cfg.staleMs) return result('stale');
      lastAcceptedTs = fix.timestamp;

      if (!frame) frame = localFrame(fix.latitude, fix.longitude);
      const z = toLocal(frame, fix.latitude, fix.longitude);
      const variance = Math.max(fix.accuracy, 1) ** 2;
      const candidate = kalman
        ? kalmanStep(kalman, z.x, z.y, variance, fix.timestamp, cfg.kalmanQ)
        : kalmanInit(z.x, z.y, variance, fix.timestamp);

      if (!last) {
        kalman = candidate;
        return result('emitted', emitAt(candidate, fix.timestamp));
      }

      const prev: Emitted = last;
      const speed = fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
      if (speed === null) {
        stationary = false;
        movingStreak = 0;
      } else if (speed < cfg.pauseMps) {
        stationary = true;
        movingStreak = 0;
      } else if (stationary && ++movingStreak >= STATIONARY_RELEASE_FIXES) {
        stationary = false;
      }
      if (stationary) {
        // Doppler says stationary: keep smoothing, but position jitter is neither movement nor a jump.
        violations = 0;
        violationSince = null;
        vehicleSuspected = false;
        kalman = candidate;
      } else {
        // Jump / vehicle check on the implied speed from the last emitted point.
        const d = Math.hypot(candidate.x - prev.x, candidate.y - prev.y);
        const dtS = (fix.timestamp - prev.ts) / 1000;
        const k = kalman!;
        const sinceStateS = Math.max(0, (fix.timestamp - k.tMs) / 1000);
        const innovation = Math.hypot(z.x - k.x, z.y - k.y);
        const innovationLimit = cap * sinceStateS + INNOVATION_SIGMAS * Math.sqrt(k.p + cfg.kalmanQ * sinceStateS + variance);
        if ((dtS > 0 && d / dtS > cap) || innovation > innovationLimit) {
          violations += 1;
          if (violationSince === null) violationSince = fix.timestamp;
          if (violations <= cfg.jumpTolerance) return result('jump'); // smoothing state is not updated
        } else {
          violations = 0;
          violationSince = null;
        }
        vehicleSuspected = violationSince !== null && fix.timestamp - violationSince >= cfg.vehicleSustainMs;
        kalman = candidate;
        if (d >= cfg.minMoveM) return result('emitted', emitAt(candidate, fix.timestamp));
      }

      if (fix.timestamp - prev.ts >= cfg.keepaliveMs) {
        // Keepalive: repeat the last position with the new time, adding zero distance.
        const point: TrackPoint = { t: Math.max(0, Math.round(fix.timestamp - start)), lat: prev.point.lat, lon: prev.point.lon };
        last = { ...prev, ts: fix.timestamp, point };
        return result('emitted', point);
      }
      return result('held');
    },
  };
}
