import { createBuilder } from '@/mbta/testing/builders';

import { describeCars } from '@/mbta/rules/vehicle';

import { tripCrowding } from '../crowding';

describe('trip crowding', () => {
  const b = createBuilder();
  const cars = (...statuses: Parameters<typeof b.carriage>[0]['occupancyStatus'][]) =>
    statuses.map((occupancyStatus, i) => b.carriage({ sequence: i + 1, occupancyStatus }));

  it('recommends the least crowded car on a Red train with carriages', () => {
    const v = b.vehicle({
      tripId: 't1',
      occupancyStatus: 'FEW_SEATS_AVAILABLE',
      carriages: cars('FULL', 'STANDING_ROOM_ONLY', 'MANY_SEATS_AVAILABLE', 'FEW_SEATS_AVAILABLE', 'FULL', 'FULL'),
    });
    const c = tripCrowding(v, 't1', false)!;
    expect(c.level).toBe('someCrowding');
    expect(c.hasCars).toBe(true);
    expect(c.recommendation?.bestSequences).toEqual([3]);
    expect(c.hint).toBe('Board car 3');
    expect(c.recommendation?.label).toBe('Board car 3 of 6');
  });

  it('shows "not available" for an ADDED trip whose cars report NO_DATA', () => {
    const v = b.vehicle({ tripId: 'added', occupancyStatus: 'NO_DATA_AVAILABLE', carriages: cars('NO_DATA_AVAILABLE', 'NO_DATA_AVAILABLE') });
    expect(tripCrowding(v, 'added', false)).toEqual({ level: null, hasCars: false, recommendation: null, hint: null });
  });

  it('hides crowding at the first stop, for other trips, and with no vehicle', () => {
    const v = b.vehicle({ tripId: 't1', carriages: cars('FULL', 'MANY_SEATS_AVAILABLE') });
    expect(tripCrowding(v, 't1', true)).toBeNull();
    expect(tripCrowding(v, 'other', false)).toBeNull();
    expect(tripCrowding(null, 't1', false)).toBeNull();
  });

  it('words ties as a range or list of cars, with or without the car count', () => {
    expect(describeCars([3])).toBe('Board car 3');
    expect(describeCars([1, 2])).toBe('Board cars 1–2');
    expect(describeCars([1, 4])).toBe('Board cars 1, 4');
    expect(describeCars([3], 6)).toBe('Board car 3 of 6');
    expect(describeCars([1, 2, 3], 6)).toBe('Board cars 1–3 of 6');
    expect(describeCars([2, 5], 6)).toBe('Board cars 2, 5 of 6');
  });
});
