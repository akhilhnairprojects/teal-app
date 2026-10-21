import { routeCardsForStopList } from '@/mbta/rules/routeCardData';
import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';
import { rsdKey, toggleFavorite } from '@/state/favorites';

import { favoriteFor, normalizeFilter, selectFiltered, stopPageStopIds } from '../stopFilter';

describe('favorite star', () => {
  it('toggles the rsdKey with the line-Green id on a Green branch', () => {
    const b = createBuilder();
    greenLine(b);
    const g = b.global();
    const platform = g.stops['place-pktrm'].childStopIds[0];
    const fav = favoriteFor(g, platform, { routeId: 'Green-B', directionId: 0 });
    expect(fav).toEqual({ routeId: 'line-Green', stopId: 'place-pktrm', directionId: 0 });
    const on = toggleFavorite([], fav!);
    expect(on.map(rsdKey)).toEqual(['line-Green|place-pktrm|0']);
    expect(toggleFavorite(on, fav!)).toEqual([]);
  });

  it('keeps plain route ids and rejects unknown routes', () => {
    const b = createBuilder();
    redLine(b);
    const g = b.global();
    expect(favoriteFor(g, 'place-jfk', { routeId: 'Red', directionId: 1 })).toEqual({ routeId: 'Red', stopId: 'place-jfk', directionId: 1 });
    expect(normalizeFilter(g, { routeId: 'Nope', directionId: 0 })).toBeNull();
  });
});

describe('selectFiltered', () => {
  it('picks the card and leaf for the filter at a stop', () => {
    const b = createBuilder();
    redLine(b);
    const g = b.global();
    const ids = stopPageStopIds(g, '70085')!;
    expect(ids.parentId).toBe('place-jfk');
    expect(ids.allIds[0]).toBe('place-jfk');
    expect(ids.liveIds).toEqual(expect.arrayContaining(['70085', '70095', '70086', '70096']));
    const cards = routeCardsForStopList({
      stopIds: ids.allIds,
      global: g,
      sortByDistanceFrom: null,
      schedules: { schedules: [], trips: {} },
      predictions: { predictions: [], trips: {}, vehicles: {} },
      alerts: [],
      now: Date.now(),
      context: 'stopDetailsFiltered',
    });
    const sel = selectFiltered(cards, { routeId: 'Red', directionId: 1 });
    expect(sel?.card.id).toBe('Red');
    expect(sel?.leaf?.direction.id).toBe(1);
    expect(selectFiltered(cards, { routeId: 'Orange', directionId: 1 })).toBeNull();
    expect(stopPageStopIds(g, 'missing')).toBeNull();
  });
});
