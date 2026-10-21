/**
 * Bike parking engine (spec G1): rank Bluebikes docks near a destination and decide when to
 * re-route. Pure functions over the live GBFS stations; the session (session.ts) owns polling,
 * location, notifications and the map.
 *
 * Score (minutes) = ride here→dock + walk dock→destination + fullness + staleness.
 */
import type { BikeStation } from '@/data/bluebikes';
import { bikeMinutes, distanceMeters, walkMinutesDetour, type LatLng } from '@/lib/geo';
import { canReturn } from '@/planner/bike';
import { WALK_DETOUR } from '@/planner/constants';

import { PARKING, type DockCandidate, type EvaluateParking, type ParkingEvent, type ParkingState, type RankDocks } from './types';

/** Penalty minutes for a dock that may fill before the rider gets there: 1 dock +4, 2 docks +2, 3 docks +1. */
export function fullnessPenalty(openDocks: number): number {
  if (openDocks <= 1) return 4;
  if (openDocks === 2) return 2;
  if (openDocks === 3) return 1;
  return 0;
}

/** Risk tier matching the fullness penalty: 1 dock critical, 2–3 low, otherwise ok. */
export function dockRisk(openDocks: number): DockCandidate['risk'] {
  if (openDocks <= 1) return 'critical';
  if (openDocks <= 3) return 'low';
  return 'ok';
}

/** A station whose last report is older than this adds `STALE_PENALTY_MIN`. */
export const STALE_REPORT_MS = PARKING.staleMs;
export const STALE_PENALTY_MIN = 2;

/** Ride minutes to the dock (0 without a location) plus the walk to the destination. No penalties. */
export function travelMinutes(c: DockCandidate, here: LatLng | null): number {
  return (here ? bikeMinutes(c.rideM) : 0) + walkMinutesDetour(c.walkM, WALK_DETOUR);
}

/** Score one station as a parking target (whether or not it can take a bike right now). */
export function scoreStation(station: BikeStation, here: LatLng | null, destination: LatLng, now: number): DockCandidate {
  const rideM = here ? distanceMeters(here, station.location) : 0;
  const walkM = distanceMeters(station.location, destination);
  const stale = now - station.reportedAt > STALE_REPORT_MS ? STALE_PENALTY_MIN : 0;
  const base: DockCandidate = { station, rideM, walkM, scoreMin: 0, risk: dockRisk(station.openDocks) };
  return { ...base, scoreMin: travelMinutes(base, here) + fullnessPenalty(station.openDocks) + stale };
}

/** `rankDocks` with an explicit clock (the staleness penalty depends on it). */
export function rankDocksAt(
  stations: readonly BikeStation[],
  here: LatLng | null,
  destination: LatLng,
  radiusM: number,
  now: number,
): DockCandidate[] {
  const out: DockCandidate[] = [];
  for (const s of stations) {
    if (!canReturn(s) || distanceMeters(s.location, destination) > radiusM) continue;
    out.push(scoreStation(s, here, destination, now));
  }
  return out.sort((a, b) => a.scoreMin - b.scoreMin || a.walkM - b.walkM || a.station.id.localeCompare(b.station.id));
}

/** Docks that can take a bike within `radiusM` of the destination, best (lowest score) first. */
export const rankDocks: RankDocks = (stations, here, destination, radiusM) => rankDocksAt(stations, here, destination, radiusM, Date.now());

const NONE: ParkingEvent = { kind: 'none' };

const otherThan = (cands: readonly DockCandidate[], id: string | undefined): DockCandidate | null =>
  cands.find((c) => c.station.id !== id) ?? null;

/**
 * One parking decision from fresh stations and the rider's position. In priority order:
 * the target filled or closed → re-route now; arrival within 35 m; a better dock (≥ 3 min gain,
 * ≥ 2 min since the last switch); the target dropped to ≤ 1 dock; the dock data is over 10 min
 * old. Candidates come from 600 m around the destination, widened to 1200 m when there are none.
 * `arrived` and `ended` are terminal.
 */
export const evaluateParking: EvaluateParking = (s, i) => {
  if (s.phase === 'arrived' || s.phase === 'ended' || !s.destination) return { state: s, event: NONE };
  const destination = s.destination.latLng;
  const { here, now, stations } = i;

  let radiusM: number = PARKING.searchRadiusM;
  let candidates = rankDocksAt(stations, here, destination, radiusM, now);
  if (candidates.length === 0) {
    radiusM = PARKING.widenRadiusM;
    candidates = rankDocksAt(stations, here, destination, radiusM, now);
  }
  const base: ParkingState = { ...s, candidates, radiusM };
  const stale: ParkingEvent | null =
    s.lastCheckAt !== null && now - s.lastCheckAt > PARKING.staleMs ? { kind: 'staleData', ageMs: now - s.lastCheckAt } : null;
  const navigating = s.phase === 'navigating';
  const arrivedAt = (c: DockCandidate) => navigating && here !== null && distanceMeters(here, c.station.location) <= PARKING.arriveM;

  const prev = s.target;
  if (!prev) {
    const target = candidates[0] ?? null;
    const state: ParkingState = { ...base, target, backup: otherThan(candidates, target?.station.id) };
    if (!target) return { state, event: { kind: 'noDocks' } };
    if (arrivedAt(target)) return { state: { ...state, phase: 'arrived' }, event: { kind: 'arrived', dock: target } };
    return { state, event: stale ?? NONE };
  }

  const live = stations.find((st) => st.id === prev.station.id) ?? null;
  if (!live || !live.isReturning || live.openDocks <= 0) {
    const reason = live && live.isReturning ? 'targetFull' : 'targetClosed';
    const from = scoreStation(live ?? prev.station, here, destination, now);
    const to = candidates[0] ?? null;
    if (!to) return { state: { ...base, target: null, backup: null }, event: { kind: 'noDocks' } };
    return {
      state: { ...base, target: to, backup: otherThan(candidates, to.station.id), lastSwitchAt: now },
      event: { kind: 'rerouted', reason, from, to },
    };
  }

  // Re-score the target even when it is outside the current search radius.
  const target = scoreStation(live, here, destination, now);
  const kept: ParkingState = { ...base, target, backup: otherThan(candidates, target.station.id) };
  if (arrivedAt(target)) return { state: { ...kept, phase: 'arrived' }, event: { kind: 'arrived', dock: target } };

  const best = candidates[0];
  const cooled = s.lastSwitchAt === null || now - s.lastSwitchAt >= PARKING.switchCooldownMs;
  if (best && best.station.id !== target.station.id && target.scoreMin - best.scoreMin >= PARKING.switchGainMin && cooled) {
    return {
      state: { ...base, target: best, backup: otherThan(candidates, best.station.id), lastSwitchAt: now },
      event: { kind: 'rerouted', reason: 'better', from: target, to: best },
    };
  }

  if (prev.station.openDocks > 1 && live.openDocks <= 1) return { state: kept, event: { kind: 'lowDocks', dock: target } };
  return { state: kept, event: stale ?? NONE };
};

// --- copy ---------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Rider-facing text for a re-route, e.g. "Dock full. Now heading to Kendall T, +2 min". */
export function rerouteText(e: Extract<ParkingEvent, { kind: 'rerouted' }>, here: LatLng | null): string {
  const delta = Math.round(travelMinutes(e.to, here) - travelMinutes(e.from, here));
  const name = e.to.station.name;
  if (e.reason === 'better') return delta < 0 ? `Better dock found. Now heading to ${name}, saves ${-delta} min` : `Better dock found. Now heading to ${name}`;
  const lead = e.reason === 'targetFull' ? 'Dock full.' : 'Dock not accepting bikes.';
  return delta > 0 ? `${lead} Now heading to ${name}, +${delta} min` : `${lead} Now heading to ${name}`;
}

/** "3 docks · 5 bikes" */
export function dockCountsText(s: BikeStation): string {
  return `${plural(s.openDocks, 'dock', 'docks')} · ${plural(s.classicBikes + s.ebikes, 'bike', 'bikes')}`;
}
