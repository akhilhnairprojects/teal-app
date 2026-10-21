import { easternInstant } from '@/mbta/time/eastern';

import { formatDistanceM, formatDurationMs, formatPace } from '../format';
import { periodEndMs, periodLabel, periodStart, shiftPeriod } from '../periods';

describe('periods (Eastern time)', () => {
  it('rolls the week over at Monday 00:00 ET, not UTC', () => {
    // Sunday 2026-10-25 23:59 ET (= Monday 03:59 UTC) is still the week of Oct 19.
    expect(periodStart('week', easternInstant(2026, 10, 25, 23, 59))).toBe('2026-10-19');
    expect(periodStart('week', easternInstant(2026, 10, 26, 0, 0))).toBe('2026-10-26');
    expect(periodStart('week', easternInstant(2026, 10, 19, 0, 0) - 1)).toBe('2026-10-12');
  });

  it('handles the fall-back DST change (2026-11-01)', () => {
    // 01:30 happens twice; both instants are on Sunday Nov 1, in the week of Oct 26 and month of November.
    const first = easternInstant(2026, 11, 1, 1, 30);
    const second = first + 3_600_000;
    for (const t of [first, second]) {
      expect(periodStart('week', t)).toBe('2026-10-26');
      expect(periodStart('month', t)).toBe('2026-11-01');
    }
    expect(periodStart('month', easternInstant(2026, 11, 1, 0, 0) - 1)).toBe('2026-10-01');
    // The week containing the change is 7 × 24 h + 1 h long.
    expect(periodEndMs('week', '2026-10-26') - easternInstant(2026, 10, 26)).toBe(7 * 86_400_000 + 3_600_000);
  });

  it('handles the spring-forward DST change (2027-03-14)', () => {
    expect(periodStart('week', easternInstant(2027, 3, 14, 3, 30))).toBe('2027-03-08');
    expect(periodEndMs('week', '2027-03-08')).toBe(easternInstant(2027, 3, 15));
    expect(periodEndMs('week', '2027-03-08') - easternInstant(2027, 3, 8)).toBe(7 * 86_400_000 - 3_600_000);
    expect(periodEndMs('month', '2027-03-01')).toBe(easternInstant(2027, 4, 1));
  });

  it('computes month ends across the year boundary and shifts periods', () => {
    expect(periodEndMs('month', '2026-12-01')).toBe(easternInstant(2027, 1, 1));
    expect(new Date(periodEndMs('month', '2026-10-01')).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(shiftPeriod('month', '2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftPeriod('month', '2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftPeriod('week', '2026-10-26', -1)).toBe('2026-10-19');
  });

  it('labels periods', () => {
    expect(periodLabel('week', '2026-10-19')).toBe('Week of Oct 19');
    expect(periodLabel('month', '2026-10-01')).toBe('October 2026');
  });
});

describe('format', () => {
  it('formats distances in miles (default) and km', () => {
    expect(formatDistanceM(5000, 'mi')).toBe('3.11 mi');
    expect(formatDistanceM(50, 'mi')).toBe('164 ft');
    expect(formatDistanceM(5000, 'km')).toBe('5.00 km');
    expect(formatDistanceM(80, 'km')).toBe('80 m');
    expect(formatDistanceM(-5, 'km')).toBe('0 m');
  });

  it('formats durations and paces', () => {
    expect(formatDurationMs(1_500_000)).toBe('25:00');
    expect(formatDurationMs(3_725_000)).toBe('1:02:05');
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatPace(301.5, 'km')).toBe('5:02 /km');
    expect(formatPace(301.5, 'mi')).toBe('8:05 /mi');
    expect(formatPace(null, 'mi')).toBe('–:–– /mi');
  });
});
