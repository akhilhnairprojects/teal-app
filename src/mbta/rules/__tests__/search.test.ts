// Teal's own local search (MBTA Go uses hosted Algolia). WP4 owns the ranking acceptance tests;
// these check the basic contract.
import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';

import { matchRoutes, matchStations, normalizeSearch } from '../search';

function global() {
  const b = createBuilder();
  redLine(b);
  greenLine(b);
  b.stop({ id: 'place-chncl', name: 'Chinatown', locationType: 1 });
  return b.global();
}

describe('search', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeSearch('  Saint Mary’s Street ')).toBe('saint mary s street');
    expect(normalizeSearch('Café')).toBe('cafe');
  });

  it('ranks exact, then prefix, then word prefix matches', () => {
    const g = global();
    expect(matchStations(g, 'park', 3)[0].stop.id).toBe('place-pktrm');
    expect(matchStations(g, 'HARVARD', 3)[0].stop.id).toBe('place-harsq');
    expect(matchStations(g, 'circle', 3).map((m) => m.stop.id)).toEqual(['place-clmnl']);
    expect(matchStations(g, 'park', 3)[0].routeIds).toEqual(['Red', 'Green-B', 'Green-C', 'Green-D', 'Green-E']);
    expect(matchStations(g, '', 3)).toEqual([]);
  });

  it('finds lines and Green branches by common names', () => {
    const g = global();
    expect(matchRoutes(g, 'gl b', 3)[0].id).toBe('Green-B');
    expect(matchRoutes(g, 'b line', 3)[0].id).toBe('Green-B');
    expect(matchRoutes(g, 'green', 3)[0].id).toBe('line-Green');
    expect(matchRoutes(g, 'red', 3)[0].id).toBe('Red');
  });
});
