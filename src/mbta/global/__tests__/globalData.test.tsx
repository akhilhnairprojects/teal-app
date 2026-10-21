import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

import { mbtaBudget } from '@/mbta/api/client';
import { v3RoutePatterns, v3Routes, v3Stops } from '@/mbta/testing/v3Fixtures';
import { serviceDate } from '@/mbta/time/eastern';
import { writeCache } from '@/lib/cache';

import {
  childStopIds,
  GLOBAL_CACHE_KEY,
  GLOBAL_CACHE_VERSION,
  loadCachedGlobalData,
  parentStationId,
  resetGlobalDataStore,
  stationStopIds,
  STOP_BLOCKLIST,
  useGlobalData,
  type GlobalData,
} from '../globalData';
import { railShapeRefs } from '../shapes';

const fetchMock = jest.fn();
const ok = (body: unknown) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });

function routeFetches() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/routes?')) return ok(v3Routes);
    if (url.includes('/stops?')) return ok(v3Stops);
    if (url.includes('/route_patterns?')) return ok(v3RoutePatterns());
    throw new Error(`unexpected ${url}`);
  });
}

function Probe({ onRender }: { onRender: (s: ReturnType<typeof useGlobalData>) => void }) {
  const s = useGlobalData();
  onRender(s);
  return <Text>{s.status}</Text>;
}

async function renderUntilReady(): Promise<ReturnType<typeof useGlobalData>> {
  let last: ReturnType<typeof useGlobalData> | null = null;
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(<Probe onRender={(s) => (last = s)} />);
  });
  for (let i = 0; i < 20 && last!.status !== 'ready'; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  act(() => renderer!.unmount());
  return last!;
}

afterAll(() => mbtaBudget.reset());

beforeEach(async () => {
  await AsyncStorage.clear();
  resetGlobalDataStore();
  mbtaBudget.reset();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe('global data', () => {
  it('loads cold from the network (3 calls), then warm from AsyncStorage with no calls', async () => {
    routeFetches();
    const cold = await renderUntilReady();
    expect(cold.status).toBe('ready');
    expect(Object.keys(cold.data!.routes)).toEqual(['Red']);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    resetGlobalDataStore();
    fetchMock.mockClear();
    const warm = await renderUntilReady();
    expect(warm.status).toBe('ready');
    expect(warm.data!.patternIdsByStop['70075']).toEqual(['Red-3-0']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves stale cache immediately and refetches when the service date changed', async () => {
    const stale: GlobalData = {
      version: 1,
      fetchedAt: Date.now() - 60_000,
      serviceDate: '2001-01-01',
      routes: {},
      lines: {},
      stops: {},
      patterns: {},
      trips: {},
      patternIdsByStop: {},
    };
    await writeCache(GLOBAL_CACHE_KEY, GLOBAL_CACHE_VERSION, stale, stale.fetchedAt);
    const hit = await loadCachedGlobalData();
    expect(hit?.fresh).toBe(false);
    routeFetches();
    const s = await renderUntilReady();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(s.data!.serviceDate).toBe(serviceDate(Date.now()));
  });

  it('expires after 24 h even on the same service date', async () => {
    const now = Date.now();
    const old: GlobalData = { version: 1, fetchedAt: now - 25 * 3_600_000, serviceDate: serviceDate(now), routes: {}, lines: {}, stops: {}, patterns: {}, trips: {}, patternIdsByStop: {} };
    await writeCache(GLOBAL_CACHE_KEY, GLOBAL_CACHE_VERSION, old, old.fetchedAt);
    expect((await loadCachedGlobalData(now))?.fresh).toBe(false);
  });

  it('reports an error when the first load fails with no cache', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    let last: ReturnType<typeof useGlobalData> | null = null;
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<Probe onRender={(s) => (last = s)} />);
    });
    for (let i = 0; i < 20 && last!.status !== 'error'; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(last!.status).toBe('error');
    expect(last!.error).toBe('Couldn’t load MBTA station data');
    act(() => renderer!.unmount());
  });
});

describe('global data lookups', () => {
  it('resolves parents, children, stations, blocklist and shape refs', async () => {
    routeFetches();
    const s = await renderUntilReady();
    const g = s.data!;
    expect(parentStationId(g, '70075')).toBe('place-pktrm');
    expect(parentStationId(g, 'place-pktrm')).toBe('place-pktrm');
    expect(childStopIds(g, 'place-pktrm')).toEqual(['70075', '70076']);
    expect(stationStopIds(g).sort()).toEqual(['place-dwnxg', 'place-pktrm', 'place-qnctr']);
    expect(STOP_BLOCKLIST).toEqual(['place-symcl']);
    expect(railShapeRefs(g)).toEqual([{ routeId: 'Red', shapeId: 'canonical-933_0009', directionId: 0 }]);
  });
});
