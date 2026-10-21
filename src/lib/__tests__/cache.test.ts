import AsyncStorage from '@react-native-async-storage/async-storage';

import { hashKey, readCache, removeCache, writeCache } from '../cache';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('cache envelopes', () => {
  it('round-trips a value and reports freshness within the TTL', async () => {
    await writeCache('k', 1, { a: 1 }, 1_000);
    expect(await readCache('k', 1, { ttlMs: 500, now: 1_200 })).toEqual({ value: { a: 1 }, fetchedAt: 1_000, fresh: true });
  });

  it('marks entries past the TTL as stale but still returns them', async () => {
    await writeCache('k', 1, 'old', 1_000);
    expect(await readCache('k', 1, { ttlMs: 500, now: 1_600 })).toEqual({ value: 'old', fetchedAt: 1_000, fresh: false });
  });

  it('treats a schema version bump as a miss and deletes the old entry', async () => {
    await writeCache('k', 1, 'v1', 1_000);
    expect(await readCache('k', 2)).toBeNull();
    expect(await AsyncStorage.getItem('k')).toBeNull();
  });

  it('treats corrupt JSON and non-envelopes as a miss', async () => {
    await AsyncStorage.setItem('bad', '{not json');
    expect(await readCache('bad', 1)).toBeNull();
    await AsyncStorage.setItem('odd', JSON.stringify({ hello: 'world' }));
    expect(await readCache('odd', 1)).toBeNull();
  });

  it('applies a custom freshness check (service date)', async () => {
    await writeCache('g', 1, { serviceDate: '2026-10-18' }, 1_000);
    const hit = await readCache<{ serviceDate: string }>('g', 1, { ttlMs: 1e9, now: 2_000, isFresh: (e) => e.value.serviceDate === '2026-10-19' });
    expect(hit?.fresh).toBe(false);
    expect(hit?.value.serviceDate).toBe('2026-10-18');
  });

  it('survives storage failures', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    expect(await readCache('k', 1)).toBeNull();
    spy.mockRestore();
    await removeCache('missing');
  });

  it('hashes keys stably', () => {
    expect(hashKey('https://api.weather.gov/x')).toBe(hashKey('https://api.weather.gov/x'));
    expect(hashKey('a')).not.toBe(hashKey('b'));
  });
});
