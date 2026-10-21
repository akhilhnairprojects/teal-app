// Occupancy mapping ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/Vehicle.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Status strings follow androidApp stopDetails/TripHeaderCard.kt; `recommendCar` is Teal's own rule (spec §3).
import type { Carriage, OccupancyStatus, Vehicle } from '@/mbta/model/types';

export type CrowdingLevel = 'notCrowded' | 'someCrowding' | 'crowded';

/** GTFS-RT occupancy -> the 3-step crowding scale. EMPTY counts as not crowded [ours]. */
export function crowdingLevel(o: OccupancyStatus | null): CrowdingLevel | null {
  switch (o) {
    case 'EMPTY':
    case 'MANY_SEATS_AVAILABLE':
      return 'notCrowded';
    case 'FEW_SEATS_AVAILABLE':
      return 'someCrowding';
    case 'STANDING_ROOM_ONLY':
    case 'CRUSHED_STANDING_ROOM_ONLY':
    case 'FULL':
    case 'NOT_ACCEPTING_PASSENGERS':
      return 'crowded';
    default:
      return null;
  }
}

export function crowdingText(l: CrowdingLevel): 'Not crowded' | 'Some crowding' | 'Crowded' {
  switch (l) {
    case 'notCrowded':
      return 'Not crowded';
    case 'someCrowding':
      return 'Some crowding';
    case 'crowded':
      return 'Crowded';
  }
}

/** Any carriage reports usable occupancy (Vehicle.hasCarLevelCrowding). */
export const hasCarLevelCrowding = (v: Vehicle): boolean =>
  v.carriages.some((c) => c.occupancyStatus !== null && c.occupancyStatus !== 'NO_DATA_AVAILABLE' && c.occupancyStatus !== 'NOT_BOARDABLE');

export type CarRecommendation = {
  bestSequences: number[];
  carCount: number;
  label: string /* 'Board car 3 of 6' | 'Board cars 1–2 of 6' */;
  levels: (CrowdingLevel | null)[] /* index = sequence-1 */;
  frontIsSequence1: true;
};

const LEVEL_MIDPOINT: Record<CrowdingLevel, number> = { notCrowded: 20, someCrowding: 55, crowded: 85 };
/** Cars within this many points of the emptiest are recommended too. */
const TIE_POINTS = 5;

function carScore(c: Carriage): number | null {
  if (c.occupancyStatus === 'NO_DATA_AVAILABLE' || c.occupancyStatus === 'NOT_BOARDABLE') return null;
  if (c.occupancyPercentage !== null) return c.occupancyPercentage;
  const level = crowdingLevel(c.occupancyStatus);
  return level ? LEVEL_MIDPOINT[level] : null;
}

/**
 * The one wording for recommended cars: 'Board car 3', 'Board cars 1–2', 'Board cars 1, 4', plus
 * ' of 6' when `count` is given (the diagram label) [ours].
 */
export function describeCars(seqs: readonly number[], count?: number): string {
  const contiguous = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1);
  const cars =
    seqs.length === 1 ? `car ${seqs[0]}` : contiguous ? `cars ${seqs[0]}–${seqs[seqs.length - 1]}` : `cars ${seqs.join(', ')}`;
  return count === undefined ? `Board ${cars}` : `Board ${cars} of ${count}`;
}

/**
 * The least crowded car(s): score by occupancy percentage, else the level midpoint (20/55/85);
 * no-data and not-boardable cars are skipped. Null with fewer than 2 scored cars or when every
 * scored car ties. Sequence 1 is the front car in the direction of travel.
 */
export function recommendCar(carriages: Carriage[]): CarRecommendation | null {
  const scored = carriages.map((c) => ({ c, score: carScore(c) })).filter((x): x is { c: Carriage; score: number } => x.score !== null);
  if (scored.length < 2) return null;
  const min = Math.min(...scored.map((x) => x.score));
  const max = Math.max(...scored.map((x) => x.score));
  if (min === max) return null;
  const bestSequences = scored
    .filter((x) => x.score - min <= TIE_POINTS)
    .map((x) => x.c.sequence)
    .sort((a, b) => a - b);
  const carCount = Math.max(carriages.length, ...carriages.map((c) => c.sequence));
  const levels: (CrowdingLevel | null)[] = Array.from({ length: carCount }, () => null);
  for (const c of carriages) if (c.sequence >= 1 && c.sequence <= carCount) levels[c.sequence - 1] = crowdingLevel(c.occupancyStatus);
  return { bestSequences, carCount, label: describeCars(bestSequences, carCount), levels, frontIsSequence1: true };
}

export const NO_VEHICLE_TEXT = 'Location not available yet';

/** Header status for the vehicle serving a trip. */
export function vehicleStatusText(v: Vehicle, onTrip: boolean, atFirstStop: boolean): string {
  if (!onTrip) return 'Finishing another trip';
  switch (v.currentStatus) {
    case 'INCOMING_AT':
      return 'Approaching';
    case 'IN_TRANSIT_TO':
      return 'Next stop';
    case 'STOPPED_AT':
      return atFirstStop ? 'Waiting to depart' : 'Now at';
  }
}

/** Vehicles older than an hour are stale (Vehicle.isStale). */
export const isVehicleStale = (v: Vehicle, now: number): boolean => now - v.updatedAt > 60 * 60_000;
