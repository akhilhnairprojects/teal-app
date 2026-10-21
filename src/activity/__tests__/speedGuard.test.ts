import { carRun, constantRun, legsTrack, offset, ORIGIN } from '../__fixtures__/tracks';
import { createSpeedGuard, SPEED_GUARD, trackOverspeed, type GuardEvent } from '../speedGuard';
import type { RawFix } from '../types';

describe('trackOverspeed (the server rule)', () => {
  it('leaves normal runs and sprint finishes alone', () => {
    expect(trackOverspeed(constantRun(), 'run')).toEqual({ warned: false, voided: false });
    const sprint = legsTrack([
      { headingDeg: 0, meters: 2000, mps: 4 },
      { headingDeg: 0, meters: 120, mps: 7.5 }, // 16 s over the limit, then done
    ]);
    expect(trackOverspeed(sprint, 'run')).toEqual({ warned: false, voided: false });
  });

  it('warns after 20 s too fast and voids after 45 s more', () => {
    const warnOnly = legsTrack([
      { headingDeg: 0, meters: 1000, mps: 4 },
      { headingDeg: 0, meters: 270, mps: 9 }, // 30 s: warned, 10 s into the grace period
      { headingDeg: 0, meters: 1000, mps: 4 },
    ]);
    expect(trackOverspeed(warnOnly, 'run')).toEqual({ warned: true, voided: false });
    // A car ride in the middle of a run (100 s at 15 m/s) is voided.
    expect(trackOverspeed(carRun(), 'run')).toEqual({ warned: true, voided: true });
  });

  it('counts grace time across separate too-fast stretches once warned', () => {
    const fast = { headingDeg: 0, meters: 40 * 9, mps: 9 }; // 40 s each
    const slow = { headingDeg: 0, meters: 400, mps: 4 };
    expect(trackOverspeed(legsTrack([slow, fast, slow]), 'run').voided).toBe(false); // 20 s of grace used
    expect(trackOverspeed(legsTrack([slow, fast, slow, fast, slow]), 'run').voided).toBe(true); // 20 + 40 s
  });

  it('uses a higher limit for Bluebike rides', () => {
    const ride = legsTrack([{ headingDeg: 0, meters: 5000, mps: 9 }]);
    expect(trackOverspeed(ride, 'bike').warned).toBe(false);
    expect(trackOverspeed(ride, 'run').voided).toBe(true);
    expect(SPEED_GUARD.bike.limitMps).toBeGreaterThan(SPEED_GUARD.run.limitMps);
  });

  it('does not count gaps over 30 s as speed', () => {
    const pts = legsTrack([{ headingDeg: 0, meters: 1000, mps: 4 }]);
    const jump = offset(ORIGIN.lat, ORIGIN.lon, 6000, 0); // 5 km in 31 s across a gap
    const after = pts[pts.length - 1].t + 31_000;
    expect(trackOverspeed([...pts, { t: after, ...jump }], 'run')).toEqual({ warned: false, voided: false });
  });
});

describe('createSpeedGuard (live)', () => {
  function drive(mps: number, seconds: number, o: { accuracy?: number; doppler?: boolean } = {}) {
    const g = createSpeedGuard('run');
    const events: GuardEvent[] = [];
    for (let k = 0; k <= seconds; k++) {
      const p = offset(ORIGIN.lat, ORIGIN.lon, k * mps, 0);
      const fix: RawFix = { latitude: p.lat, longitude: p.lon, accuracy: o.accuracy ?? 5, speed: o.doppler === false ? null : mps, timestamp: k * 1000 };
      events.push(g.push(fix));
    }
    return { g, events };
  }

  it('warns once, then voids once', () => {
    const { g, events } = drive(9, 120);
    expect(events.filter((e) => e === 'warn')).toHaveLength(1);
    expect(events.filter((e) => e === 'void')).toHaveLength(1);
    expect(events.indexOf('warn')).toBe(20);
    expect(events.indexOf('void')).toBe(65);
    expect(g.voided).toBe(true);
  });

  it('works from positions when the phone gives no Doppler speed', () => {
    expect(drive(9, 30, { doppler: false }).g.warned).toBe(true);
  });

  it('ignores inaccurate fixes and normal running', () => {
    expect(drive(9, 120, { accuracy: 50 }).events.every((e) => e === 'none')).toBe(true);
    expect(drive(4, 600).events.every((e) => e === 'none')).toBe(true);
  });
});
