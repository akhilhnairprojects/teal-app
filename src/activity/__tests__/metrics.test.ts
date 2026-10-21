import {
  CAR_LEG_M,
  carRun,
  constantRun,
  figure8Run,
  GAP,
  gapRun,
  legsTrack,
  loopRun,
  parityTrack,
} from '../__fixtures__/tracks';
import { bestEffort, computeTrackMetrics, EFFORT_FLOOR_MS, expectedFlags, recentPath, SEGMENT_RULES, splits } from '../metrics';

describe('computeTrackMetrics on the shared fixtures', () => {
  it('times a constant 4 m/s run to the millisecond', () => {
    const m = computeTrackMetrics(constantRun(), 'run');
    expect(m.distanceM).toBeCloseTo(11_000, 3);
    expect(m.excludedM).toBe(0);
    expect(m.elapsedMs).toBe(2_750_000);
    expect(m.movingMs).toBe(2_750_000);
    const byD = Object.fromEntries(m.efforts.map((e) => [e.distanceM, e.durationMs]));
    expect(Math.abs(byD[1000] - 250_000)).toBeLessThanOrEqual(5);
    expect(Math.abs(byD[5000] - 1_250_000)).toBeLessThanOrEqual(5);
    expect(Math.abs(byD[10000] - 2_500_000)).toBeLessThanOrEqual(5);
    expect(m.isLoop).toBe(false);
    expect(m.medianDtMs).toBe(1000);
  });

  it('excludes the car leg and flags the activity as a vehicle', () => {
    const m = computeTrackMetrics(carRun(), 'run');
    expect(Math.abs(m.excludedM - CAR_LEG_M) / CAR_LEG_M).toBeLessThan(0.01);
    expect(m.distanceM).toBeCloseTo(5000, 0);
    expect(expectedFlags(m)).toContain('vehicle');
    // Efforts never cross the excluded segment: the 5K needs 5 km of contiguous counted running.
    expect(m.efforts.map((e) => e.distanceM)).toEqual([1000]);
  });

  it('counts a car leg as distance when the kind is bike and the speed is under the bike cap', () => {
    const m = computeTrackMetrics(carRun(), 'bike');
    expect(m.excludedM).toBe(0);
    expect(m.efforts).toEqual([]); // bikes are never speed-ranked
  });

  it('never lets a 5K span the 40 s gap', () => {
    const pts = gapRun();
    const m = computeTrackMetrics(pts, 'run');
    const five = m.efforts.find((e) => e.distanceM === 5000)!;
    expect(five).toBeDefined();
    const end = five.startOffsetMs + five.durationMs;
    expect(five.startOffsetMs >= GAP.toT || end <= GAP.fromT).toBe(true);
    // The fastest 5K is in the 5 m/s stretch after the gap.
    expect(five.startOffsetMs).toBeGreaterThanOrEqual(GAP.toT);
    expect(Math.abs(five.durationMs - 1_000_000)).toBeLessThanOrEqual(5);
    // The gap itself is neither distance nor excluded.
    expect(m.distanceM).toBeCloseTo(11_500, 0);
    expect(m.excludedM).toBe(0);
  });

  it('recognises the 1.2 km² loop and the figure-8 as loops', () => {
    const loop = computeTrackMetrics(loopRun(), 'run');
    expect(loop.isLoop).toBe(true);
    expect(loop.loopGapM!).toBeLessThan(5);
    expect(computeTrackMetrics(figure8Run(), 'run').isLoop).toBe(true);
    expect(computeTrackMetrics(loopRun(), 'bike').isLoop).toBe(false);
  });

  it('does not call a short closed path a loop', () => {
    const square = legsTrack([
      { headingDeg: 0, meters: 200, mps: 4 },
      { headingDeg: 90, meters: 200, mps: 4 },
      { headingDeg: 180, meters: 200, mps: 4 },
      { headingDeg: 270, meters: 200, mps: 4 },
    ]);
    const m = computeTrackMetrics(square, 'run');
    expect(m.loopGapM!).toBeLessThan(1);
    expect(m.isLoop).toBe(false); // 800 m < 1 km
  });

  it('records the SQL parity values (supabase/tests/submit.sql asserts the same numbers)', () => {
    const pts = parityTrack();
    expect(pts).toHaveLength(PARITY.points);
    expect(pts[1]).toEqual({ t: 1000, lat: 42.300032, lon: -71.1 });
    const m = computeTrackMetrics(pts, 'run');
    expect(m.distanceM).toBeCloseTo(PARITY.distanceM, 1);
    expect(m.excludedM).toBeCloseTo(PARITY.excludedM, 1);
    expect(m.movingMs).toBe(PARITY.movingMs);
    expect(m.efforts).toEqual(PARITY.efforts);
    expect(expectedFlags(m)).toEqual([]);
  });
});

/** Jest's values for parityTrack(); submit.sql must match within ±1 m and ±50 ms. */
const PARITY = {
  points: 2962,
  distanceM: 10205.359172510456,
  excludedM: 900.0117362618278,
  movingMs: 2_900_000,
  efforts: [
    { distanceM: 1000, durationMs: 276_269, startOffsetMs: 36_000 },
    { distanceM: 5000, durationMs: 1_422_412, startOffsetMs: 44_000 },
  ],
};

describe('segment rules', () => {
  it('match the server constants', () => {
    expect(SEGMENT_RULES.run).toEqual({ capMps: 7.5, maxGapMs: 30_000, movingMps: 0.5 });
    expect(SEGMENT_RULES.bike).toEqual({ capMps: 17, maxGapMs: 30_000, movingMps: 1.0 });
    expect(EFFORT_FLOOR_MS).toEqual({ 1000: 150_000, 5000: 810_000, 10000: 1_680_000 });
  });

  it('flags implausibly fast efforts, sparse sampling and very short activities', () => {
    const fast = legsTrack([{ headingDeg: 0, meters: 1200, mps: 7.4 }]); // 1K in ~2:15
    expect(expectedFlags(computeTrackMetrics(fast, 'run'))).toContain('implausible_effort');
    const sparse = constantRun().filter((_, i) => i % 6 === 0); // one point every 6 s
    expect(expectedFlags(computeTrackMetrics(sparse, 'run'))).toContain('sparse');
    const short = legsTrack([{ headingDeg: 0, meters: 150, mps: 3 }]);
    expect(expectedFlags(computeTrackMetrics(short, 'run'))).toContain('too_short');
  });

  it('treats non-increasing times as uncounted and copes with tiny tracks', () => {
    expect(computeTrackMetrics([], 'run')).toMatchObject({ distanceM: 0, elapsedMs: 0, efforts: [], loopGapM: null, medianDtMs: null });
    const p = { t: 0, lat: 42.3, lon: -71.1 };
    expect(computeTrackMetrics([p, { ...p, lat: 42.3001 }], 'run').distanceM).toBe(0);
    expect(bestEffort([p], 'run', 1000)).toBeNull();
  });

  it('only counts moving time above the moving speed', () => {
    const slow = legsTrack([{ headingDeg: 0, meters: 100, mps: 0.4 }]);
    const m = computeTrackMetrics(slow, 'run');
    expect(m.distanceM).toBeGreaterThan(99);
    expect(m.movingMs).toBe(0);
  });
});

describe('splits and recentPath', () => {
  it('splits a constant run into equal kilometres plus the remainder', () => {
    const s = splits(constantRun(), 'run', 1000);
    expect(s).toHaveLength(11);
    for (const split of s) {
      expect(split.distanceM).toBeCloseTo(1000, 3);
      expect(Math.abs(split.durationMs - 250_000)).toBeLessThanOrEqual(1);
    }
    const miles = splits(constantRun(), 'run', 1609.344);
    expect(miles).toHaveLength(7);
    expect(miles[6].distanceM).toBeCloseTo(11_000 - 6 * 1609.344, 1);
  });

  it('decimates evenly and keeps the ends', () => {
    const pts = constantRun();
    const path = recentPath(pts, 500);
    expect(path).toHaveLength(500);
    expect(path[0]).toEqual({ latitude: pts[0].lat, longitude: pts[0].lon });
    expect(path[499]).toEqual({ latitude: pts[pts.length - 1].lat, longitude: pts[pts.length - 1].lon });
    expect(recentPath(pts.slice(0, 3), 500)).toHaveLength(3);
    expect(recentPath(pts, 0)).toEqual([]);
  });
});
