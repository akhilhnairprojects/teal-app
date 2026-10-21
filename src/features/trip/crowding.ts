import type { Vehicle } from '@/mbta/model/types';
import { crowdingLevel, describeCars, hasCarLevelCrowding, recommendCar, type CarRecommendation, type CrowdingLevel } from '@/mbta/rules/vehicle';

export type TripCrowding = {
  /** Whole-vehicle level; null shows "Crowding not available". */
  level: CrowdingLevel | null;
  /** Per-car data is present, so the car diagram is worth drawing. */
  hasCars: boolean;
  /** The least crowded car(s), when the cars differ. */
  recommendation: CarRecommendation | null;
  /** Short call to action, e.g. 'Board car 3' or 'Board cars 1–2'. */
  hint: string | null;
};

/**
 * Crowding for a vehicle serving `tripId`, or null when it should not be shown: no vehicle, the
 * vehicle is finishing another trip (its load is not this trip's), or it is still at the first
 * stop [MA §3.5].
 */
export function tripCrowding(vehicle: Vehicle | null, tripId: string, atFirstStop: boolean): TripCrowding | null {
  if (!vehicle || vehicle.tripId !== tripId || atFirstStop) return null;
  const recommendation = recommendCar(vehicle.carriages);
  return {
    level: crowdingLevel(vehicle.occupancyStatus),
    hasCars: hasCarLevelCrowding(vehicle),
    recommendation,
    hint: recommendation ? describeCars(recommendation.bestSequences) : null,
  };
}
