import type { LiveStats } from '@/activity/types';

import { backgroundGapText, bigStats, formatSpeed, isActivePhase, RECORD_COPY, recordBanners } from '../recordModel';

const stats = (o: Partial<LiveStats> = {}): LiveStats => ({
  elapsedMs: 25 * 60_000 + 5_000,
  movingMs: 25 * 60_000,
  distanceM: 5000,
  excludedM: 0,
  currentPaceSecPerKm: 300,
  avgPaceSecPerKm: 301,
  autoPaused: false,
  gpsQuality: 'good',
  vehicleSuspected: false,
  ...o,
});

describe('recordModel', () => {
  it('reports a background gap in seconds or minutes', () => {
    expect(backgroundGapText(4 * 60_000)).toBe('Paused for 4 min while Teal was in the background. That stretch isn’t counted.');
    expect(backgroundGapText(40_000)).toMatch(/^Paused for 40 s /);
    expect(backgroundGapText(200)).toMatch(/^Paused for 1 s /);
  });

  it('shows run pace in min/mi by default and km when chosen', () => {
    const run = bigStats('run', stats(), 'mi');
    expect(run.map((s) => s.label)).toEqual(['Time', 'Distance', 'Pace', 'Avg pace']);
    expect(run.map((s) => s.value)).toEqual(['25:05', '3.11 mi', '8:03 /mi', '8:04 /mi']);
    expect(bigStats('run', stats(), 'km')[2].value).toBe('5:00 /km');
  });

  it('shows bike speed for display only, and blanks current pace or speed while auto-paused', () => {
    const bike = bigStats('bike', stats({ currentPaceSecPerKm: 180, avgPaceSecPerKm: 200 }), 'mi');
    expect(bike.map((s) => s.label)).toEqual(['Time', 'Distance', 'Speed', 'Avg speed']);
    expect(bike[2].value).toBe('12.4 mph');
    expect(formatSpeed(180, 'km')).toBe('20.0 km/h');
    expect(formatSpeed(null, 'mi')).toBe('– mph');
    expect(bigStats('run', stats({ autoPaused: true }), 'mi')[2].value).toBe('–:–– /mi');
    expect(bigStats('bike', stats({ autoPaused: true }), 'mi')[2].value).toBe('– mph');
  });

  it('turns recorder warnings into banners, permission first; foregroundOnly stays a chip', () => {
    const banners = recordBanners({
      phase: 'recording',
      backgroundGapMs: 120_000,
      warnings: ['foregroundOnly', 'vehicleSegment', 'backgroundGap', 'poorGps'],
    });
    expect(banners.map((b) => b.key)).toEqual(['backgroundGap', 'vehicleSegment']);
    expect(banners[0].text).toContain('Paused for 2 min');
    const denied = recordBanners({ phase: 'idle', backgroundGapMs: 0, warnings: ['permissionDenied'] });
    expect(denied).toEqual([{ key: 'permissionDenied', text: RECORD_COPY.permissionDenied, settings: true }]);
    expect(recordBanners({ phase: 'acquiring', backgroundGapMs: 0, warnings: ['poorGps'] })[0].key).toBe('poorGps');
  });

  it('knows which phases own the recorder', () => {
    expect(['idle', 'acquiring', 'recording', 'paused', 'finished'].map((p) => isActivePhase(p as never))).toEqual([false, true, true, true, false]);
  });

  it('states the Expo Go limits in the copy', () => {
    expect(RECORD_COPY.firstStartBody).toContain('iPhone pauses GPS when Teal is in the background or the phone locks');
    expect(RECORD_COPY.screenOnChip).toBe('Screen on · keep Teal open');
    expect(RECORD_COPY.shareDetail).toBe('Start and finish (~200–300 m) are hidden. Shown to signed-in Teal users.');
  });
});
