import {
  addDays,
  easternInstant,
  easternParts,
  easternPartsFallback,
  fallbackOffsetHours,
  formatClock,
  formatMinutes,
  formatServiceTime,
  hasIntlTimeZone,
  serviceDate,
  serviceMinutes,
} from '../eastern';

describe('Eastern time', () => {
  it('uses Intl time zones in this engine', () => {
    expect(hasIntlTimeZone()).toBe(true);
  });

  it('converts instants to Eastern wall-clock parts', () => {
    // 2026-10-19 16:00 UTC = 12:00 EDT (Monday)
    expect(easternParts(Date.UTC(2026, 9, 19, 16, 0))).toEqual({ y: 2026, mo: 10, d: 19, h: 12, mi: 0, dow: 1 });
    // 2026-01-15 17:30 UTC = 12:30 EST (Thursday)
    expect(easternParts(Date.UTC(2026, 0, 15, 17, 30))).toEqual({ y: 2026, mo: 1, d: 15, h: 12, mi: 30, dow: 4 });
  });

  describe('DST fallback rule (2nd Sunday of March to 1st Sunday of November, 02:00)', () => {
    it('switches to EDT at 02:00 EST on the second Sunday of March', () => {
      // 2026-03-08 is the second Sunday; 07:00 UTC = 02:00 EST.
      expect(fallbackOffsetHours(Date.UTC(2026, 2, 8, 6, 59))).toBe(-5);
      expect(fallbackOffsetHours(Date.UTC(2026, 2, 8, 7, 0))).toBe(-4);
    });

    it('switches back to EST at 02:00 EDT on the first Sunday of November', () => {
      // 2026-11-01 is the first Sunday; 06:00 UTC = 02:00 EDT.
      expect(fallbackOffsetHours(Date.UTC(2026, 10, 1, 5, 59))).toBe(-4);
      expect(fallbackOffsetHours(Date.UTC(2026, 10, 1, 6, 0))).toBe(-5);
    });

    it('agrees with Intl across a year of hourly samples', () => {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3 * 3_600_000 + 17 * 60_000) {
        expect(easternPartsFallback(t)).toEqual(easternParts(t));
      }
    });

    it('handles other years (2024 and 2030)', () => {
      expect(fallbackOffsetHours(Date.UTC(2024, 2, 10, 7, 0))).toBe(-4);
      expect(fallbackOffsetHours(Date.UTC(2024, 10, 3, 6, 0))).toBe(-5);
      expect(fallbackOffsetHours(Date.UTC(2030, 2, 10, 7, 0))).toBe(-4);
      expect(fallbackOffsetHours(Date.UTC(2030, 2, 10, 6, 59))).toBe(-5);
    });
  });

  it('builds instants from Eastern wall-clock times, including across DST', () => {
    expect(easternInstant(2026, 10, 19, 12, 0)).toBe(Date.UTC(2026, 9, 19, 16, 0));
    expect(easternInstant(2026, 1, 15, 12, 30)).toBe(Date.UTC(2026, 0, 15, 17, 30));
    expect(easternInstant(2024, 2, 21, 9, 30, 8)).toBe(Date.UTC(2024, 1, 21, 14, 30, 8));
  });

  it('computes the service date with a 03:00 rollover', () => {
    expect(serviceDate(easternInstant(2026, 10, 19, 2, 59))).toBe('2026-10-18');
    expect(serviceDate(easternInstant(2026, 10, 19, 3, 0))).toBe('2026-10-19');
    expect(serviceDate(easternInstant(2026, 1, 1, 0, 30))).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('expresses after-midnight times past 24:00 for schedule filters', () => {
    expect(serviceMinutes(easternInstant(2026, 10, 19, 0, 41))).toBe(24 * 60 + 41);
    expect(formatServiceTime(serviceMinutes(easternInstant(2026, 10, 19, 0, 41)))).toBe('24:41');
    expect(formatServiceTime(8 * 60 + 5)).toBe('08:05');
  });

  it('formats clock times and minutes', () => {
    expect(formatClock(easternInstant(2026, 10, 19, 20, 5))).toBe('8:05 PM');
    expect(formatClock(easternInstant(2026, 10, 19, 0, 7))).toBe('12:07 AM');
    expect(formatClock(easternInstant(2026, 10, 19, 12, 0))).toBe('12:00 PM');
    expect(formatMinutes(5)).toBe('5 min');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(65)).toBe('1 hr 5 min');
    expect(formatMinutes(125)).toBe('2 hr 5 min');
  });
});
