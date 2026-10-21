import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';
import { easternInstant } from '@/mbta/time/eastern';

import { affectedStops, alertHasEnded, alertRoutes, causeLabel, formatPeriod, periodsToShow } from '../alertDetails';

const HOUR = 3_600_000;

describe('alert details', () => {
  it('labels causes and hides unknown ones', () => {
    expect(causeLabel('SINGLE_TRACKING')).toBe('Single tracking');
    expect(causeLabel('MAINTENANCE')).toBe('Maintenance');
    expect(causeLabel('UNKNOWN_CAUSE')).toBeNull();
    expect(causeLabel(null)).toBeNull();
  });

  it('formats periods in Eastern time', () => {
    const start = easternInstant(2026, 10, 19, 20, 5);
    expect(formatPeriod({ start, end: easternInstant(2026, 10, 19, 23, 0) })).toBe('Mon, Oct 19, 8:05 PM – 11:00 PM');
    expect(formatPeriod({ start, end: easternInstant(2026, 10, 20, 3, 0) })).toBe('Mon, Oct 19, 8:05 PM – Tue, Oct 20, 3:00 AM');
    expect(formatPeriod({ start, end: null })).toBe('From Mon, Oct 19, 8:05 PM until further notice');
  });

  it('lists current and upcoming periods, or the last one once ended', () => {
    const b = createBuilder();
    const now = Date.now();
    const periods = [-3, 1, 2, 3, 4, 5].map((d) => ({ start: now + d * 24 * HOUR, end: now + d * 24 * HOUR + HOUR }));
    const a = b.alert({ activePeriods: periods });
    expect(periodsToShow(a, now)).toEqual({ periods: periods.slice(1, 5), more: 1 });
    const ended = b.alert({ activePeriods: periods.slice(0, 1) });
    expect(periodsToShow(ended, now)).toEqual({ periods: periods.slice(0, 1), more: 0 });
    expect(alertHasEnded(ended, now)).toBe(true);
    expect(alertHasEnded(a, now)).toBe(false);
  });

  it('collects routes and parent stops in line order', () => {
    const b = createBuilder();
    redLine(b);
    greenLine(b);
    const g = b.global();
    const a = b.alert({
      effect: 'SHUTTLE',
      informedEntities: [
        b.entity({ routeId: 'Red', stopId: '70085' }),
        b.entity({ routeId: 'Red', stopId: 'place-harsq-0' }),
        b.entity({ routeId: 'Red', stopId: 'place-harsq-1' }),
        b.entity({ routeId: 'Red', stopId: 'place-andrw' }),
        b.entity({ routeId: 'Green-B', stopId: 'unknown-stop' }),
      ],
    });
    expect(alertRoutes(a, g).map((r) => r.id)).toEqual(expect.arrayContaining(['Red', 'Green-B']));
    expect(alertRoutes(a, g)[0].sortOrder).toBeLessThanOrEqual(alertRoutes(a, g)[1].sortOrder);
    const stops = affectedStops({ ...a, informedEntities: a.informedEntities.filter((e) => e.routeId === 'Red') }, g).map((s) => s.id);
    expect(stops).toEqual(['place-harsq', 'place-andrw', 'place-jfk']);
  });
});

describe('safeWebUrl', () => {
  it('keeps http(s) links and drops other schemes', () => {
    const { safeWebUrl } = jest.requireActual('../alertDetails');
    expect(safeWebUrl('https://www.mbta.com/alerts')).toBe('https://www.mbta.com/alerts');
    expect(safeWebUrl(' http://mbta.com ')).toBe('http://mbta.com');
    expect(safeWebUrl('javascript:alert(1)')).toBeNull();
    expect(safeWebUrl('tel:6172223200')).toBeNull();
    expect(safeWebUrl(null)).toBeNull();
  });
});
