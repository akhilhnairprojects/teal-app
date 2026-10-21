import { act, create } from 'react-test-renderer';

import type { Vehicle } from '@/mbta/model/types';
import { createBuilder } from '@/mbta/testing/builders';

import { clearPollCache, type Polled } from '../usePolling';
import { useVehicles } from '../useVehicles';

const mockFetchVehicles = jest.fn<Promise<Vehicle[]>, []>();
jest.mock('@/mbta/api/endpoints', () => ({ fetchVehicles: () => mockFetchVehicles() }));

function Probe({ onRender }: { onRender: (p: Polled<Vehicle[]>) => void }) {
  onRender(useVehicles(['Red'], 0));
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  clearPollCache();
});
afterEach(() => jest.useRealTimers());

describe('useVehicles', () => {
  it('drops vehicles not updated for over an hour (Vehicle.isStale)', async () => {
    const b = createBuilder();
    const now = Date.now();
    const fresh = b.vehicle({ id: 'fresh', updatedAt: now - 30_000 });
    const hourOld = b.vehicle({ id: 'edge', updatedAt: now - 59 * 60_000 });
    const stale = b.vehicle({ id: 'stale', updatedAt: now - 61 * 60_000 });
    mockFetchVehicles.mockResolvedValue([fresh, hourOld, stale]);
    let last!: Polled<Vehicle[]>;
    let r!: ReturnType<typeof create>;
    await act(async () => {
      r = create(<Probe onRender={(p) => (last = p)} />);
    });
    expect(last.data?.map((v) => v.id)).toEqual(['fresh', 'edge']);
    act(() => r.unmount());
  });
});
