import { bikeMinutes, boundsOf, distanceMeters, formatDistance, isInBostonArea, walkMinutes, walkMinutesDetour } from '../geo';

describe('geo', () => {
  it('measures Park Street to Downtown Crossing at roughly 200 m', () => {
    const d = distanceMeters(
      { latitude: 42.35639, longitude: -71.0624 },
      { latitude: 42.355518, longitude: -71.060225 },
    );
    expect(d).toBeGreaterThan(180);
    expect(d).toBeLessThan(230);
  });

  it('treats Cambridge as in the Boston area and New York as outside it', () => {
    expect(isInBostonArea({ latitude: 42.3736, longitude: -71.119 })).toBe(true);
    expect(isInBostonArea({ latitude: 40.7128, longitude: -74.006 })).toBe(false);
  });

  it('rounds walking time up with a one-minute floor', () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(81)).toBe(2);
  });

  it('formats short distances in feet and longer ones in miles', () => {
    expect(formatDistance(100)).toBe('328 ft');
    expect(formatDistance(1609.344)).toBe('1.0 mi');
  });
});

describe('planner geo helpers', () => {
  it('inflates walking by the detour factor (unrounded)', () => {
    expect(walkMinutesDetour(800)).toBeCloseTo(13, 5);
    expect(walkMinutesDetour(800, 1)).toBeCloseTo(10, 5);
  });

  it('estimates bike minutes as meters × 1.25 / 250 + 2', () => {
    expect(bikeMinutes(0)).toBe(2);
    expect(bikeMinutes(2000)).toBeCloseTo(12, 5);
  });

  it('computes bounds, or null for no points', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { latitude: 42.3, longitude: -71.1 },
        { latitude: 42.4, longitude: -71.0 },
        { latitude: 42.35, longitude: -71.2 },
      ]),
    ).toEqual({ minLatitude: 42.3, maxLatitude: 42.4, minLongitude: -71.2, maxLongitude: -71.0 });
  });
});
