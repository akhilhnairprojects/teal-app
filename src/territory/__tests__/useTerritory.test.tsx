import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { mockSupabase } from '@/backend/testing/mockSupabase';
import { flush } from '@/mbta/testing/render';

import {
  BBOX_QUANTUM,
  requestBounds,
  resetTerritoryForTests,
  TERRITORY_CACHE_MS,
  TERRITORY_DEBOUNCE_MS,
  useTerritory,
  type Region,
  type TerritoryView,
} from '../useTerritory';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('@/backend/auth', () => ({ getAuthState: () => ({ status: 'signedOut' }) }));

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const MONTH = '2026-10-01';
const COMMON: Region = { latitude: 42.355, longitude: -71.065, latitudeDelta: 0.02, longitudeDelta: 0.02 };

const latest: { view: TerritoryView | null } = { view: null };
const record = (view: TerritoryView) => {
  latest.view = view;
};
function Probe({ month, region, enabled = true }: { month: string; region: Region | null; enabled?: boolean }) {
  const view = useTerritory(month, region, { enabled });
  useEffect(() => record(view));
  return null;
}

const calls = () => mockSupabase.raw.rpc.mock.calls.filter(([fn]) => fn === 'get_territory');

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  return r;
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSupabase.reset();
  resetTerritoryForTests();
  latest.view = null;
  mockSupabase.onRpc('get_territory', () => ({ data: [{ cell_id: 7290791, owner_id: OWNER, nickname: 'ana', color: 3 }] }));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('requestBounds', () => {
  it('rounds the region outward to the quantum and clips to the grid', () => {
    const b = requestBounds(COMMON)!;
    expect(b.south).toBeLessThanOrEqual(42.345);
    expect(b.north).toBeGreaterThanOrEqual(42.365);
    expect(b.west).toBeLessThanOrEqual(-71.075);
    expect(b.east).toBeGreaterThanOrEqual(-71.055);
    for (const v of Object.values(b)) expect(Math.abs(v / BBOX_QUANTUM - Math.round(v / BBOX_QUANTUM))).toBeLessThan(1e-6);
    // A small pan stays in the same box.
    expect(requestBounds({ ...COMMON, latitude: COMMON.latitude + 0.001, longitude: COMMON.longitude - 0.001 })).toEqual(b);
    // Clipped to the grid, or nothing outside it.
    expect(requestBounds({ latitude: 42.0, longitude: -71.5, latitudeDelta: 0.1, longitudeDelta: 0.1 })).toMatchObject({ south: 42, west: -71.5 });
    expect(requestBounds({ latitude: 40.78, longitude: -73.97, latitudeDelta: 0.05, longitudeDelta: 0.05 })).toBeNull();
  });
});

describe('useTerritory', () => {
  it('waits 500 ms after the region settles, and only the last region is fetched', async () => {
    const r = await mount(<Probe month={MONTH} region={COMMON} />);
    expect(latest.view?.status).toBe('loading');
    await advance(TERRITORY_DEBOUNCE_MS - 100);
    const moved = { ...COMMON, latitude: 42.3, longitude: -71.1 };
    await act(async () => r.update(<Probe month={MONTH} region={moved} />));
    await advance(TERRITORY_DEBOUNCE_MS - 1);
    expect(calls()).toHaveLength(0);
    await advance(1);
    expect(calls()).toHaveLength(1);
    const b = requestBounds(moved)!;
    expect(calls()[0][1]).toEqual({ p_south: b.south, p_west: b.west, p_north: b.north, p_east: b.east, p_month: MONTH, p_after: null, p_limit: 1000 });
    expect(latest.view).toMatchObject({ status: 'ready', month: MONTH, truncated: false });
    expect(latest.view?.cells).toEqual([{ cellId: 7290791, ownerId: OWNER, nickname: 'ana', color: 3 }]);
    act(() => r.unmount());
  });

  it('serves the same month and rounded box from the cache for 60 s', async () => {
    const r = await mount(<Probe month={MONTH} region={COMMON} />);
    await advance(TERRITORY_DEBOUNCE_MS);
    expect(calls()).toHaveLength(1);

    // A small pan inside the same rounded box: cached, applied at once.
    const pan = { ...COMMON, latitude: COMMON.latitude + 0.001 };
    await act(async () => r.update(<Probe month={MONTH} region={pan} />));
    expect(latest.view?.status).toBe('ready');
    await advance(TERRITORY_DEBOUNCE_MS);
    expect(calls()).toHaveLength(1);

    // Another month is another key.
    await act(async () => r.update(<Probe month="2026-09-01" region={pan} />));
    expect(latest.view).toMatchObject({ status: 'loading', month: '2026-09-01', cells: [] });
    await advance(TERRITORY_DEBOUNCE_MS);
    expect(calls()).toHaveLength(2);

    // After 60 s the entry is stale and refetched.
    await advance(TERRITORY_CACHE_MS);
    await act(async () => r.update(<Probe month={MONTH} region={COMMON} />));
    await advance(TERRITORY_DEBOUNCE_MS);
    expect(calls()).toHaveLength(3);
    act(() => r.unmount());
  });

  it('does nothing while disabled (signed out) and cancels a pending fetch on unmount', async () => {
    const r = await mount(<Probe month={MONTH} region={COMMON} enabled={false} />);
    await advance(TERRITORY_DEBOUNCE_MS * 2);
    expect(calls()).toHaveLength(0);
    expect(latest.view?.status).toBe('idle');
    await act(async () => r.update(<Probe month={MONTH} region={COMMON} />));
    act(() => r.unmount());
    await advance(TERRITORY_DEBOUNCE_MS * 2);
    expect(calls()).toHaveLength(0);
  });

  it('reports a truncated result and errors', async () => {
    mockSupabase.onRpc('get_territory', () => ({
      data: Array.from({ length: 20_000 }, (_, k) => ({ cell_id: 7000000 + k, owner_id: OWNER, nickname: 'ana', color: 3 })),
    }));
    const r = await mount(<Probe month={MONTH} region={COMMON} />);
    await advance(TERRITORY_DEBOUNCE_MS);
    expect(latest.view?.truncated).toBe(true);
    act(() => r.unmount());

    resetTerritoryForTests();
    mockSupabase.rpcError('get_territory', 'not_authenticated');
    const r2 = await mount(<Probe month={MONTH} region={COMMON} />);
    await advance(TERRITORY_DEBOUNCE_MS);
    expect(latest.view).toMatchObject({ status: 'error', error: { code: 'not_authenticated' } });
    act(() => r2.unmount());
  });
});
