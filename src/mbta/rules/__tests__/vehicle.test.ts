// Occupancy cases follow mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/Vehicle.kt and
// VehicleTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md. recommendCar cases are Teal's own rule (spec §3).
import { parseVehicle } from '@/mbta/model/parse';
import type { Carriage, OccupancyStatus } from '@/mbta/model/types';
import { build } from '@/mbta/testing/builders';

import { crowdingLevel, crowdingText, hasCarLevelCrowding, NO_VEHICLE_TEXT, recommendCar, vehicleStatusText } from '../vehicle';

const car = (sequence: number, occupancyStatus: OccupancyStatus | null, occupancyPercentage: number | null = null): Carriage => ({
  label: String(1900 + sequence),
  sequence,
  occupancyStatus,
  occupancyPercentage,
});

describe('crowding', () => {
  it('maps occupancy to the 3-step crowding scale', () => {
    expect(crowdingLevel('MANY_SEATS_AVAILABLE')).toBe('notCrowded');
    expect(crowdingLevel('FEW_SEATS_AVAILABLE')).toBe('someCrowding');
    for (const s of ['STANDING_ROOM_ONLY', 'CRUSHED_STANDING_ROOM_ONLY', 'FULL', 'NOT_ACCEPTING_PASSENGERS'] as OccupancyStatus[]) {
      expect(crowdingLevel(s)).toBe('crowded');
    }
    expect(crowdingLevel('NO_DATA_AVAILABLE')).toBeNull();
    expect(crowdingLevel('NOT_BOARDABLE')).toBeNull();
    expect(crowdingLevel(null)).toBeNull();
    expect(crowdingText('notCrowded')).toBe('Not crowded');
    expect(crowdingText('someCrowding')).toBe('Some crowding');
    expect(crowdingText('crowded')).toBe('Crowded');
  });

  it('discards unknown occupancy and status values when parsing (VehicleTest: unknown decoration)', () => {
    const v = parseVehicle({
      type: 'vehicle',
      id: 'G-12345',
      attributes: {
        bearing: null,
        current_status: 'IN_TRANSIT_TO',
        carriages: null,
        current_stop_sequence: null,
        direction_id: 0,
        latitude: 1,
        longitude: 2,
        updated_at: '2025-12-05T15:52:00-04:00',
        occupancy_status: 'SOMETHING_NEW',
        decoration: 'Night Train to Rigel Film Adaptation Promotional Wrap',
      },
    });
    expect(v.occupancyStatus).toBeNull();
    expect(v.carriages).toEqual([]);
    expect(v.updatedAt).toBe(Date.parse('2025-12-05T15:52:00-04:00'));
  });

  it('detects car-level crowding only when some car has data', () => {
    expect(hasCarLevelCrowding(build.vehicle({ carriages: [car(1, 'NO_DATA_AVAILABLE'), car(2, 'NO_DATA_AVAILABLE')] }))).toBe(false);
    expect(hasCarLevelCrowding(build.vehicle({ carriages: [car(1, 'NO_DATA_AVAILABLE'), car(2, 'FULL')] }))).toBe(true);
  });
});

describe('recommendCar', () => {
  it('scores by percentage and recommends the emptiest car', () => {
    const r = recommendCar([car(1, 'FULL', 90), car(2, 'MANY_SEATS_AVAILABLE', 12), car(3, 'FEW_SEATS_AVAILABLE', 40), car(4, 'FULL', 88)]);
    expect(r).toMatchObject({ bestSequences: [2], carCount: 4, label: 'Board car 2 of 4', frontIsSequence1: true });
    expect(r?.levels).toEqual(['crowded', 'notCrowded', 'someCrowding', 'crowded']);
  });

  it('includes cars within 5 points of the best (ties)', () => {
    expect(recommendCar([car(1, null, 10), car(2, null, 14), car(3, null, 60)])?.label).toBe('Board cars 1–2 of 3');
    expect(recommendCar([car(1, null, 10), car(2, null, 60), car(3, null, 15)])?.label).toBe('Board cars 1, 3 of 3');
  });

  it('returns null when all scored cars are equal', () => {
    expect(recommendCar([car(1, 'MANY_SEATS_AVAILABLE'), car(2, 'MANY_SEATS_AVAILABLE')])).toBeNull();
    expect(recommendCar([car(1, null, 30), car(2, null, 30), car(3, null, 30)])).toBeNull();
  });

  it('returns null when every car is NO_DATA (or not boardable)', () => {
    expect(recommendCar([car(1, 'NO_DATA_AVAILABLE'), car(2, 'NO_DATA_AVAILABLE'), car(3, 'NOT_BOARDABLE')])).toBeNull();
  });

  it('returns null for a single scored car', () => {
    expect(recommendCar([car(1, 'FULL')])).toBeNull();
    expect(recommendCar([car(1, 'FULL'), car(2, 'NO_DATA_AVAILABLE')])).toBeNull();
  });

  it('uses level midpoints when percentages are missing, and percentage over status when both exist', () => {
    // FEW (55) beats FULL (85) by status; car 1's 50% beats car 2's midpoint 55 by 5 → both recommended.
    expect(recommendCar([car(1, 'FULL'), car(2, 'FEW_SEATS_AVAILABLE')])?.bestSequences).toEqual([2]);
    expect(recommendCar([car(1, 'FULL', 50), car(2, 'FEW_SEATS_AVAILABLE')])?.bestSequences).toEqual([1, 2]);
    expect(recommendCar([car(1, 'FULL', 10), car(2, 'MANY_SEATS_AVAILABLE')])?.bestSequences).toEqual([1]);
  });

  it('skips no-data cars but keeps their slot in levels', () => {
    const r = recommendCar([car(1, 'FULL'), car(2, 'NO_DATA_AVAILABLE'), car(3, 'MANY_SEATS_AVAILABLE')]);
    expect(r?.bestSequences).toEqual([3]);
    expect(r?.levels).toEqual(['crowded', null, 'notCrowded']);
  });
});

describe('vehicleStatusText', () => {
  it('describes the vehicle relative to its trip', () => {
    expect(vehicleStatusText(build.vehicle({ currentStatus: 'INCOMING_AT' }), true, false)).toBe('Approaching');
    expect(vehicleStatusText(build.vehicle({ currentStatus: 'IN_TRANSIT_TO' }), true, false)).toBe('Next stop');
    expect(vehicleStatusText(build.vehicle({ currentStatus: 'STOPPED_AT' }), true, false)).toBe('Now at');
    expect(vehicleStatusText(build.vehicle({ currentStatus: 'STOPPED_AT' }), true, true)).toBe('Waiting to depart');
    expect(vehicleStatusText(build.vehicle({ currentStatus: 'STOPPED_AT' }), false, false)).toBe('Finishing another trip');
    expect(NO_VEHICLE_TEXT).toBe('Location not available yet');
  });
});
