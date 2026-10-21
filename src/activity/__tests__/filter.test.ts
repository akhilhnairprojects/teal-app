import { offset, ORIGIN, runningFixes, stationaryNoisyFixes } from '../__fixtures__/tracks';
import { createGpsFilter, FILTER_CONFIG } from '../filter';
import { fromLocal, kalmanInit, kalmanStep, localFrame, toLocal } from '../kalman';
import { computeTrackMetrics } from '../metrics';
import type { RawFix, TrackPoint } from '../types';

const T0 = 1_800_000_000_000;

/** Push fixes arriving on time (now = fix time + 200 ms); return emitted points and verdicts. */
function run(fixes: RawFix[], kind: 'run' | 'bike' = 'run') {
  const f = createGpsFilter(kind, fixes[0]?.timestamp ?? T0);
  const points: TrackPoint[] = [];
  const verdicts: string[] = [];
  let vehicle = false;
  for (const fix of fixes) {
    const r = f.push(fix, fix.timestamp + 200);
    verdicts.push(r.verdict);
    if (r.point) points.push(r.point);
    vehicle = vehicle || r.vehicleSuspected;
  }
  return { points, verdicts, vehicle };
}

describe('kalman', () => {
  it('round-trips the local frame and moves toward measurements by the gain', () => {
    const f = localFrame(42.36, -71.06);
    const xy = toLocal(f, 42.361, -71.059);
    const back = fromLocal(f, xy.x, xy.y);
    expect(back.lat).toBeCloseTo(42.361, 9);
    expect(back.lon).toBeCloseTo(-71.059, 9);
    const s0 = kalmanInit(0, 0, 25, 0);
    const s1 = kalmanStep(s0, 10, 0, 25, 1000, 3); // prior 28, gain 28/53
    expect(s1.x).toBeCloseTo((10 * 28) / 53, 9);
    expect(s1.p).toBeCloseTo((25 * 28) / 53, 9);
  });
});

describe('GPS filter', () => {
  it('keeps a phone lying still for 10 minutes (σ 8 m noise) under 15 m', () => {
    const { points } = run(stationaryNoisyFixes());
    const m = computeTrackMetrics(points, 'run');
    expect(m.distanceM).toBeLessThan(15);
    // Keepalives still advance time every 5 s.
    expect(points.length).toBeGreaterThan(100);
    expect(points[points.length - 1].t).toBeGreaterThanOrEqual(595_000);
  });

  it('tracks a steady 4 m/s run closely', () => {
    const { points } = run(runningFixes(301));
    const m = computeTrackMetrics(points, 'run');
    // Constant-position smoothing lags the runner by a fixed amount; the total is within 2 %.
    expect(m.distanceM).toBeGreaterThan(1176);
    expect(m.distanceM).toBeLessThanOrEqual(1200);
    expect(m.excludedM).toBe(0);
  });

  it('drops a single 40 m/s spike', () => {
    const fixes = runningFixes(60);
    const spike = offset(fixes[30].latitude, fixes[30].longitude, 0, 40);
    fixes[30] = { ...fixes[30], latitude: spike.lat, longitude: spike.lon };
    const { verdicts, points } = run(fixes);
    expect(verdicts[30]).toBe('jump');
    const m = computeTrackMetrics(points, 'run');
    expect(m.excludedM).toBe(0);
    expect(m.distanceM).toBeLessThan(4 * 59 + 1);
  });

  it('emits sustained over-cap movement and suspects a vehicle after 20 s', () => {
    const car = runningFixes(40, T0, 15).map((f) => ({ ...f, speed: 15 }));
    const { verdicts, vehicle, points } = run(car);
    expect(verdicts.slice(1, 3)).toEqual(['jump', 'jump']); // the first two violations are dropped
    expect(verdicts[3]).toBe('emitted');
    expect(vehicle).toBe(true);
    expect(computeTrackMetrics(points, 'run').excludedM).toBeGreaterThan(0);
  });

  it('rejects inaccurate, stale and out-of-order fixes', () => {
    const f = createGpsFilter('run', T0);
    const base: RawFix = { latitude: ORIGIN.lat, longitude: ORIGIN.lon, accuracy: 5, speed: 0, timestamp: T0 };
    expect(f.push({ ...base, accuracy: null }, T0).verdict).toBe('inaccurate');
    expect(f.push({ ...base, accuracy: FILTER_CONFIG.run.maxAccuracyM + 1 }, T0).verdict).toBe('inaccurate');
    expect(f.push(base, T0 + 10_001).verdict).toBe('stale');
    expect(f.push(base, T0 + 100).verdict).toBe('emitted');
    // The clock moves backwards mid-run: equal or earlier timestamps are rejected.
    expect(f.push({ ...base, timestamp: T0 }, T0 + 1000).verdict).toBe('outOfOrder');
    expect(f.push({ ...base, timestamp: T0 - 5000 }, T0 + 1000).verdict).toBe('outOfOrder');
    // Bikes accept up to 30 m.
    const b = createGpsFilter('bike', T0);
    expect(b.push({ ...base, accuracy: 28 }, T0).verdict).toBe('emitted');
  });

  it('emits keepalives that repeat the last position and add zero distance', () => {
    const still: RawFix[] = Array.from({ length: 21 }, (_, k) => ({
      latitude: ORIGIN.lat,
      longitude: ORIGIN.lon,
      accuracy: 5,
      speed: null,
      timestamp: T0 + k * 1000,
    }));
    const { points, verdicts } = run(still);
    expect(points.map((p) => p.t)).toEqual([0, 5000, 10_000, 15_000, 20_000]);
    expect(new Set(points.map((p) => `${p.lat},${p.lon}`)).size).toBe(1);
    expect(verdicts.filter((v) => v === 'held')).toHaveLength(16);
    expect(computeTrackMetrics(points, 'run').distanceM).toBe(0);
  });

  it('rounds to 6 dp and uses integer ms since the start; reset starts over', () => {
    const f = createGpsFilter('run', T0 - 1234);
    const p = f.push({ latitude: 42.123456789, longitude: -71.987654321, accuracy: 5, speed: 3, timestamp: T0 }, T0).point!;
    expect(p).toEqual({ t: 1234, lat: 42.123457, lon: -71.987654 });
    f.reset(T0);
    expect(f.push({ latitude: 42.1, longitude: -71.1, accuracy: 5, speed: 3, timestamp: T0 + 5 }, T0 + 5).point!.t).toBe(5);
  });
});
