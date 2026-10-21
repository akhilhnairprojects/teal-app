// Ordering and dedupe behavior modelled on mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/usecases/VisitHistoryUsecaseTest.kt
// and viewModel/SearchViewModelTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md. Ranking cases are Teal's own (local search, no Algolia).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create } from 'react-test-renderer';

import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';
import { getLineOrRoute } from '@/mbta/rules/lineOrRoute';
import { MAX_RECENTS, recordStopVisit, resetRecentsStore, useRecentStops } from '@/state/recents';

import { resolveRecents, searchResults, stationsOnRoute, useDebouncedValue, SEARCH_DEBOUNCE_MS } from '../searchModel';

function global() {
  const b = createBuilder();
  redLine(b);
  greenLine(b);
  b.stop({ id: 'st-harvard-ave', name: 'Harvard Avenue', locationType: 1 });
  b.stop({ id: 'st-old-harvard', name: 'Old Harvard Yard', locationType: 1 });
  b.stop({ id: 'st-cafe', name: 'Café Square', locationType: 1 });
  return b.global();
}

const stationIds = (q: string) => {
  const r = searchResults(global(), q, []);
  return r.kind === 'results' ? r.stations.map((m) => m.stop.id) : [];
};
const routeIds = (q: string) => {
  const r = searchResults(global(), q, []);
  return r.kind === 'results' ? r.routes.map((lr) => lr.id) : [];
};

describe('search results', () => {
  it('ranks exact > prefix > word prefix', () => {
    expect(stationIds('harvard')).toEqual(['place-harsq', 'st-harvard-ave', 'st-old-harvard']);
    expect(stationIds('park')[0]).toBe('place-pktrm');
  });

  it('is case and accent insensitive', () => {
    expect(stationIds('HARVARD')[0]).toBe('place-harsq');
    expect(stationIds('PaRk StReEt')[0]).toBe('place-pktrm');
    expect(stationIds('cafe')).toEqual(['st-cafe']);
    expect(stationIds('CAFÉ')).toEqual(['st-cafe']);
    expect(stationIds('saint mary')[0]).toBe('place-smary');
  });

  it('finds Green branches by rider names', () => {
    expect(routeIds('gl b')[0]).toBe('Green-B');
    expect(routeIds('b line')[0]).toBe('Green-B');
    expect(routeIds('Red')[0]).toBe('Red');
  });

  it('shows recents for an empty or blank query', () => {
    const g = global();
    expect(searchResults(g, '', ['place-harsq'])).toEqual({ kind: 'recents', recents: [expect.objectContaining({ stop: g.stops['place-harsq'] })] });
    expect(searchResults(g, '   ', []).kind).toBe('recents');
    expect(searchResults(g, ' park ', []).kind).toBe('results');
  });

  it('resolves recents to parent stations, deduped, dropping unknown and blocklisted ids', () => {
    const g = global();
    const recents = resolveRecents(g, ['place-pktrm-0', 'place-harsq', 'place-pktrm', 'nope', 'place-symcl']);
    expect(recents.map((r) => r.stop.id)).toEqual(['place-pktrm', 'place-harsq']);
    expect(recents[0].routeIds).toContain('Red');
  });

  it('lists a route’s stations in order without duplicates', () => {
    const g = global();
    const stops = stationsOnRoute(g, getLineOrRoute(g, 'Red')!).map((s) => s.id);
    expect(stops[0]).toBe('place-alfcl');
    expect(stops).toEqual(expect.arrayContaining(['place-brntn', 'place-asmnl', 'place-jfk']));
    expect(new Set(stops).size).toBe(stops.length);
    const green = stationsOnRoute(g, getLineOrRoute(g, 'line-Green')!).map((s) => s.id);
    expect(green).not.toContain('place-symcl');
    expect(green).toContain('place-lake');
  });
});

describe('recent stops', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetRecentsStore();
  });

  it('keeps the most recent first, deduped, capped at 10', async () => {
    for (let i = 1; i <= 12; i++) await recordStopVisit(`stop-${i}`);
    await recordStopVisit('stop-5');
    let seen: string[] = [];
    function Probe() {
      seen = useRecentStops().stopIds;
      return null;
    }
    await act(async () => {
      create(<Probe />);
    });
    expect(seen).toHaveLength(MAX_RECENTS);
    expect(seen[0]).toBe('stop-5');
    expect(seen.filter((id) => id === 'stop-5')).toHaveLength(1);
    expect(seen).not.toContain('stop-1');
  });
});

describe('useDebouncedValue', () => {
  it('waits 300 ms after the last change', () => {
    jest.useFakeTimers();
    let value = '';
    function Probe({ v }: { v: string }) {
      value = useDebouncedValue(v);
      return null;
    }
    let r!: ReturnType<typeof create>;
    act(() => {
      r = create(<Probe v="p" />);
    });
    act(() => r.update(<Probe v="pa" />));
    act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(value).toBe('p');
    act(() => r.update(<Probe v="par" />));
    act(() => jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(value).toBe('p');
    act(() => jest.advanceTimersByTime(1));
    expect(value).toBe('par');
    act(() => r.unmount());
    jest.useRealTimers();
  });
});
