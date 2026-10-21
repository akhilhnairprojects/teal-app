import { routeCardsForStopList } from '@/mbta/rules/routeCardData';
import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';
import { rsdKey, type RouteStopDirection } from '@/state/rsd';

import { favoriteRouteCards, favoriteRouteIds, favoriteRows, favoriteStopIds } from '../favoritesModel';

const MIN = 60_000;
const NOW = Date.UTC(2026, 0, 1, 15, 0);

/** Red + Green fixtures plus a low-sort-order bus route, so subway-first sorting is visible. */
function fixture() {
  const b = createBuilder();
  const red = redLine(b);
  greenLine(b);
  const bus = b.route({ id: '1', type: 3, shortName: '1', longName: 'Harvard Square - Nubian Station', sortOrder: 50, color: '#FFC72C' });
  for (const [id, name] of [
    ['bus-a', 'Mass Ave @ Main St'],
    ['bus-b', 'Mass Ave @ Beacon St'],
    ['bus-c', 'Nubian'],
  ]) {
    b.stop({ id, name, locationType: 0 });
  }
  const busPattern = b.pattern(bus, {
    id: '1-0-0',
    directionId: 0,
    typicality: 'typical',
    canonical: true,
    representativeTrip: { headsign: 'Nubian', stopIds: ['bus-a', 'bus-b', 'bus-c'] },
  });
  return { b, red, bus, busPattern };
}

const redPark: RouteStopDirection = { routeId: 'Red', stopId: 'place-pktrm', directionId: 0 };
const busFav: RouteStopDirection = { routeId: '1', stopId: 'bus-b', directionId: 0 };

function cardsFor(favorites: RouteStopDirection[], withBusTrip: boolean) {
  const { b, red, busPattern } = fixture();
  b.prediction({ trip: b.tripFor(red.braintreeSouth), stopId: 'place-pktrm-0', stopSequence: 3, arrivalTime: NOW + 4 * MIN, departureTime: NOW + 5 * MIN });
  if (withBusTrip) {
    b.prediction({ trip: b.tripFor(busPattern), stopId: 'bus-b', stopSequence: 2, arrivalTime: NOW + 6 * MIN, departureTime: NOW + 6 * MIN });
  }
  const g = b.global();
  const keys = new Set(favorites.map(rsdKey));
  const input = { global: g, favorites, keys, schedules: b.scheduleSet([]), predictions: b.liveDepartures(), alerts: [], now: NOW };
  return { g, keys, input, cards: favoriteRouteCards(input)! };
}

describe('favorites list', () => {
  it('orders cards without the subway-first bucket (route sort order instead)', () => {
    const { cards, g, input } = cardsFor([redPark, busFav], true);
    expect(cards.map((c) => c.id)).toEqual(['1', 'Red']);
    // The same stops in Nearby put subway first.
    const nearby = routeCardsForStopList({ ...input, favorites: undefined, stopIds: favoriteStopIds(g, [redPark, busFav]), sortByDistanceFrom: null, context: 'nearby' })!;
    expect(nearby.map((c) => c.id).indexOf('Red')).toBeLessThan(nearby.map((c) => c.id).indexOf('1'));
  });

  it('ignores distance (no position is used) but keeps the service bucket', () => {
    const { cards } = cardsFor([redPark, busFav], false);
    // The bus has no trips today, so Red (with a departure) comes first despite sort order.
    expect(cards.map((c) => c.id)).toEqual(['Red', '1']);
    expect(cards.every((c) => c.stops.every((s) => s.distanceMeters === null))).toBe(true);
  });

  it('shows only the favorited route and direction at each stop', () => {
    const { cards } = cardsFor([redPark], true);
    expect(cards).toHaveLength(1);
    expect(cards[0].stops.map((s) => s.stop.id)).toEqual(['place-pktrm']);
    expect(cards[0].stops[0].leaves.map((l) => l.direction.id)).toEqual([0]);
  });

  it('is empty for no favorites and null without global data', () => {
    const { input } = cardsFor([], false);
    expect(favoriteRouteCards({ ...input, favorites: [], keys: new Set() })).toEqual([]);
    expect(favoriteRouteCards({ ...input, global: null })).toBeNull();
  });

  it('queries the favorites’ stations and platforms, expanding line-Green to its branches', () => {
    const { b } = fixture();
    const g = b.global();
    const green: RouteStopDirection = { routeId: 'line-Green', stopId: 'place-pktrm', directionId: 1 };
    expect(favoriteRouteIds(g, [green, redPark])).toEqual(['Green-B', 'Green-C', 'Green-D', 'Green-E', 'Red']);
    const ids = favoriteStopIds(g, [green, redPark, { routeId: 'Red', stopId: 'place-gone', directionId: 0 }]);
    expect(ids).toEqual(expect.arrayContaining(['place-pktrm', 'place-pktrm-0', 'place-pktrm-1', 'place-pktrm-g0']));
    expect(ids).not.toContain('place-gone');
  });

  it('marks favorites whose stop or route is gone as no longer served', () => {
    const { b } = fixture();
    const g = b.global();
    const goneStop: RouteStopDirection = { routeId: 'Red', stopId: 'place-gone', directionId: 0 };
    const goneRoute: RouteStopDirection = { routeId: 'Silver-X', stopId: 'place-pktrm', directionId: 0 };
    const rows = favoriteRows(g, [redPark, goneStop, goneRoute], NOW);
    expect(rows.map((r) => [r.key, r.served])).toEqual([
      ['Red|place-pktrm|0', true],
      ['Red|place-gone|0', false],
      ['Silver-X|place-pktrm|0', false],
    ]);
    expect(rows[0]).toMatchObject({ stopName: 'Park Street', directionText: 'Southbound to Ashmont/Braintree' });
    expect(rows[1].stopName).toBeNull();
    expect(rows[2].lineOrRoute).toBeNull();
  });
});
