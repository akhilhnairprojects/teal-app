/**
 * Bike parking mode contracts (spec §4). G1 implements `rankDocks` and `evaluateParking` in
 * engine.ts with exactly the signatures of `RankDocks` and `EvaluateParking` below.
 */
import type { BikeStation } from '@/data/bluebikes';
import type { LatLng } from '@/lib/geo';
import type { Place } from '@/planner/types';

export type DockCandidate = { station: BikeStation; rideM: number; walkM: number; scoreMin: number; risk: 'ok' | 'low' | 'critical' };

export type ParkingPhase = 'choosing' | 'navigating' | 'arrived' | 'ended';

export type ParkingState = {
  phase: ParkingPhase;
  destination: Place | null;
  target: DockCandidate | null;
  backup: DockCandidate | null;
  candidates: DockCandidate[];
  radiusM: number;
  lastCheckAt: number | null;
  lastSwitchAt: number | null;
  error: string | null;
};

export type ParkingEvent =
  | { kind: 'none' }
  | { kind: 'rerouted'; reason: 'targetFull' | 'targetClosed' | 'better'; from: DockCandidate; to: DockCandidate }
  | { kind: 'lowDocks'; dock: DockCandidate }
  | { kind: 'arrived'; dock: DockCandidate }
  | { kind: 'noDocks' }
  | { kind: 'staleData'; ageMs: number };

export const PARKING = {
  pollMs: 45_000,
  searchRadiusM: 600,
  widenRadiusM: 1200,
  arriveM: 35,
  switchGainMin: 3,
  switchCooldownMs: 120_000,
  staleMs: 600_000,
  reminderLeadMs: 120_000,
} as const;

/** Signature of engine.ts `rankDocks` (G1). */
export type RankDocks = (stations: readonly BikeStation[], here: LatLng | null, destination: LatLng, radiusM: number) => DockCandidate[];

/** Signature of engine.ts `evaluateParking` (G1). */
export type EvaluateParking = (
  s: ParkingState,
  i: { stations: readonly BikeStation[]; here: LatLng | null; now: number },
) => { state: ParkingState; event: ParkingEvent };
