// Key/serialization semantics ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/FavoriteTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Teal stores only the RouteStopDirection list (no notification settings).
import AsyncStorage from '@react-native-async-storage/async-storage';

import { readCache } from '@/lib/cache';

import {
  deserializeFavorites,
  FAVORITES_KEY,
  FAVORITES_VERSION,
  removeFavoriteStored,
  resetFavoritesStore,
  serializeFavorites,
  toggleFavorite,
  toggleFavoriteStored,
} from '../favorites';
import { MAX_RECENTS, pushRecent, recordStopVisit, resetRecentsStore, RECENTS_KEY, RECENTS_VERSION } from '../recents';
import { parseRsdKey, rsdKey } from '../rsd';

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFavoritesStore();
  resetRecentsStore();
});

describe('favorites', () => {
  it('keys by route (line id for Green), parent stop and direction', () => {
    expect(rsdKey({ routeId: 'line-Green', stopId: 'place-pktrm', directionId: 0 })).toBe('line-Green|place-pktrm|0');
    expect(rsdKey({ routeId: 'Red', stopId: 'place-pktrm', directionId: 0 })).not.toBe(rsdKey({ routeId: 'Red', stopId: 'place-pktrm', directionId: 1 }));
    expect(parseRsdKey('line-Green|place-pktrm|1')).toEqual({ routeId: 'line-Green', stopId: 'place-pktrm', directionId: 1 });
    expect(parseRsdKey('broken')).toBeNull();
  });

  it('parses stored lists, dropping malformed entries and duplicates', () => {
    const raw = [
      { routeId: 'route1', stopId: 'stop1', directionId: 0 },
      { routeId: 'route2', stopId: 'stop2', directionId: 1 },
      { routeId: 'route1', stopId: 'stop1', directionId: 0 },
      { routeId: 'route3', stopId: 'stop3', directionId: 2 },
      { route: 'old-shape' },
      null,
    ];
    expect(deserializeFavorites(raw)).toEqual([
      { routeId: 'route1', stopId: 'stop1', directionId: 0 },
      { routeId: 'route2', stopId: 'stop2', directionId: 1 },
    ]);
    expect(deserializeFavorites('nope')).toEqual([]);
  });

  it('round-trips through serialization', () => {
    const list = [{ routeId: 'line-Green', stopId: 'place-boyls', directionId: 0 as const }];
    expect(deserializeFavorites(JSON.parse(JSON.stringify(serializeFavorites(list))))).toEqual(list);
  });

  it('toggles by value equality', () => {
    const a = { routeId: 'Red', stopId: 'place-pktrm', directionId: 0 as const };
    const added = toggleFavorite([], a);
    expect(added).toEqual([a]);
    expect(toggleFavorite(added, { ...a })).toEqual([]);
  });

  it('persists toggles and removals', async () => {
    const a = { routeId: 'line-Green', stopId: 'place-pktrm', directionId: 1 as const };
    await toggleFavoriteStored(a);
    expect((await readCache(FAVORITES_KEY, FAVORITES_VERSION))?.value).toEqual([a]);
    await removeFavoriteStored(a);
    expect((await readCache(FAVORITES_KEY, FAVORITES_VERSION))?.value).toEqual([]);
  });
});

describe('recent stops', () => {
  it('puts the latest first, dedupes and caps at 10', () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) list = pushRecent(list, `s${i}`);
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0]).toBe('s11');
    expect(pushRecent(list, 's5')).toEqual(['s5', ...list.filter((x) => x !== 's5')].slice(0, 10));
  });

  it('persists visits', async () => {
    await recordStopVisit('place-pktrm');
    await recordStopVisit('place-dwnxg');
    await recordStopVisit('place-pktrm');
    expect((await readCache(RECENTS_KEY, RECENTS_VERSION))?.value).toEqual(['place-pktrm', 'place-dwnxg']);
  });
});
