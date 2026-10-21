import type { ScheduleSet } from '@/mbta/model/types';

import { clearScheduleCache, getSchedulesCached, SCHEDULE_CACHE_MAX, scheduleCacheKeys } from '../useStopLiveData';

const mockFetch = jest.fn<Promise<ScheduleSet>, [string[], string]>();
jest.mock('@/mbta/api/endpoints', () => ({
  fetchSchedulesForStops: (ids: string[], date: string) => mockFetch(ids, date),
  fetchPredictionsForStops: jest.fn(),
}));

const set = (): ScheduleSet => ({ schedules: [], trips: {} });

beforeEach(() => {
  clearScheduleCache();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => set());
});

describe('schedule cache', () => {
  it('serves repeats from memory and shares an in-flight request', async () => {
    const [a, b] = await Promise.all([getSchedulesCached(['s2', 's1'], '2026-10-19'), getSchedulesCached(['s1', 's2'], '2026-10-19')]);
    expect(a).toBe(b);
    expect(await getSchedulesCached(['s1', 's2'], '2026-10-19')).toBe(a);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it(`keeps at most ${SCHEDULE_CACHE_MAX} stop sets, evicting the least recently used`, async () => {
    for (let i = 0; i < SCHEDULE_CACHE_MAX; i++) await getSchedulesCached([`s${i}`], '2026-10-19');
    await getSchedulesCached(['s0'], '2026-10-19'); // s0 is now the most recent
    await getSchedulesCached(['new'], '2026-10-19');
    const keys = scheduleCacheKeys();
    expect(keys).toHaveLength(SCHEDULE_CACHE_MAX);
    expect(keys).not.toContain('2026-10-19|s1');
    expect(keys).toContain('2026-10-19|s0');
    expect(keys[keys.length - 1]).toBe('2026-10-19|new');
    expect(mockFetch).toHaveBeenCalledTimes(SCHEDULE_CACHE_MAX + 1);
  });

  it('drops other service dates when a new day is cached', async () => {
    await getSchedulesCached(['a'], '2026-10-19');
    await getSchedulesCached(['b'], '2026-10-19');
    await getSchedulesCached(['a'], '2026-10-20');
    expect(scheduleCacheKeys()).toEqual(['2026-10-20|a']);
  });

  it('does not cache failures', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(getSchedulesCached(['a'], '2026-10-19')).rejects.toThrow('offline');
    expect(scheduleCacheKeys()).toEqual([]);
    await getSchedulesCached(['a'], '2026-10-19');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
