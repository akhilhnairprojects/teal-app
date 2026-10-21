/**
 * Bluebikes dock selection for bike legs [AR §3.2]: a start dock needs a rentable bike and an end
 * dock needs an open dock. Ride time = meters × 1.25 ÷ 250 + 2 min (`bikeMinutes`).
 */
import type { BikeStation } from '@/data/bluebikes';
import { bikeMinutes, distanceMeters, walkMinutesDetour, type LatLng } from '@/lib/geo';

import { WALK_DETOUR } from './constants';
import type { BikeDock } from './types';

export function toDock(s: BikeStation): BikeDock {
  return {
    stationId: s.id,
    name: s.name,
    latLng: s.location,
    bikes: s.classicBikes + s.ebikes,
    ebikes: s.ebikes,
    docks: s.openDocks,
    rentalUrl: s.rentalUrl,
  };
}

export type DockPick = { station: BikeStation; dock: BikeDock; walkMeters: number };

export type DockProblem = 'noStartDock' | 'noStartBikes' | 'noEndDock' | 'noEndDocks';

export const canRent = (s: BikeStation): boolean => s.isRenting && s.classicBikes + s.ebikes > 0;
export const canReturn = (s: BikeStation): boolean => s.isReturning && s.openDocks > 0;

/** Stations within `radius` of `at`, nearest first. */
export function docksNear(stations: readonly BikeStation[], at: LatLng, radius: number): { station: BikeStation; meters: number }[] {
  const out: { station: BikeStation; meters: number }[] = [];
  for (const station of stations) {
    const meters = distanceMeters(at, station.location);
    if (meters <= radius) out.push({ station, meters });
  }
  return out.sort((a, b) => a.meters - b.meters);
}

/** The nearest usable dock within `radius`, or why there is none. */
export function pickDock(
  stations: readonly BikeStation[],
  at: LatLng,
  radius: number,
  role: 'start' | 'end',
): { pick: DockPick; problem: null } | { pick: null; problem: DockProblem } {
  const near = docksNear(stations, at, radius);
  if (near.length === 0) return { pick: null, problem: role === 'start' ? 'noStartDock' : 'noEndDock' };
  const usable = near.find((n) => (role === 'start' ? canRent(n.station) : canReturn(n.station)));
  if (!usable) return { pick: null, problem: role === 'start' ? 'noStartBikes' : 'noEndDocks' };
  return { pick: { station: usable.station, dock: toDock(usable.station), walkMeters: usable.meters }, problem: null };
}

export type BikeSegment = {
  start: DockPick;
  end: DockPick;
  rideMeters: number;
  /** Walk to the start dock + ride (with docking) + walk from the end dock. */
  minutes: number;
  walkToMin: number;
  rideMin: number;
  walkFromMin: number;
};

/** Walk → bike → walk between two points, choosing the nearest usable docks. */
export function bikeSegment(
  stations: readonly BikeStation[],
  from: LatLng,
  to: LatLng,
  startRadius: number,
  endRadius: number,
): { segment: BikeSegment; problem: null } | { segment: null; problem: DockProblem } {
  const start = pickDock(stations, from, startRadius, 'start');
  if (!start.pick) return { segment: null, problem: start.problem };
  const end = pickDock(stations, to, endRadius, 'end');
  if (!end.pick) return { segment: null, problem: end.problem };
  if (start.pick.station.id === end.pick.station.id) return { segment: null, problem: 'noEndDock' };
  const rideMeters = distanceMeters(start.pick.dock.latLng, end.pick.dock.latLng);
  const walkToMin = walkMinutesDetour(start.pick.walkMeters, WALK_DETOUR);
  const rideMin = bikeMinutes(rideMeters);
  const walkFromMin = walkMinutesDetour(end.pick.walkMeters, WALK_DETOUR);
  return {
    segment: { start: start.pick, end: end.pick, rideMeters, minutes: walkToMin + rideMin + walkFromMin, walkToMin, rideMin, walkFromMin },
    problem: null,
  };
}

/** Rider-facing text for a dock problem. */
export function dockProblemText(problem: DockProblem): string {
  switch (problem) {
    case 'noStartDock':
      return 'No Bluebikes dock within a short walk of the start.';
    case 'noStartBikes':
      return 'No bikes available at the docks near the start right now.';
    case 'noEndDock':
      return 'No Bluebikes dock within a short walk of the destination.';
    case 'noEndDocks':
      return 'No open docks near the destination right now, so there is nowhere to park a bike.';
  }
}
