import AsyncStorage from '@react-native-async-storage/async-storage';

import { constantRun, loopRun } from '@/activity/__fixtures__/tracks';
import { computeTrackMetrics } from '@/activity/metrics';
import { periodStart } from '@/activity/periods';
import { resetActivityStoreForTests, saveNewActivity, type LocalActivity } from '@/activity/store';
import type { ActivityKind, TrackPoint } from '@/activity/types';

import { LOCAL_OWNER_ID, localTerritoryCells, resetLocalTerritoryForTests } from '../local';
import { previewClaim } from '../preview';

jest.mock('@/backend/auth', () => ({ getAuthState: () => ({ status: 'signedOut' }), subscribeAuth: () => () => {} }));

const STARTED = Date.UTC(2026, 9, 20, 13, 0, 0);
const OCTOBER = periodStart('month', STARTED);

function activity(id: string, points: TrackPoint[], o: { kind?: ActivityKind; startedAt?: number } = {}): LocalActivity {
  const startedAt = o.startedAt ?? STARTED;
  return {
    localId: id,
    kind: o.kind ?? 'run',
    startedAt,
    endedAt: startedAt + points[points.length - 1].t,
    ownerUserId: null,
    shareRoute: false,
    metrics: computeTrackMetrics(points, o.kind ?? 'run'),
    previewPolyline: '',
    sync: { state: 'local', attempts: 0, nextAttemptAt: null, lastError: null, server: null },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetActivityStoreForTests();
  resetLocalTerritoryForTests();
});

describe('territory on this phone (no account)', () => {
  it('claims the squares inside this month’s loops, owned by me', async () => {
    const loop = loopRun();
    await saveNewActivity(activity('a', loop), loop);
    const expected = previewClaim(loop).cellIds;
    expect(expected.length).toBeGreaterThan(0);
    const cells = await localTerritoryCells(OCTOBER);
    expect(cells.map((c) => c.cellId)).toEqual(expected);
    expect(cells.every((c) => c.ownerId === LOCAL_OWNER_ID)).toBe(true);
  });

  it('counts overlapping loops once, and skips rides, straight runs and other months', async () => {
    const loop = loopRun();
    await saveNewActivity(activity('a', loop), loop);
    await saveNewActivity(activity('b', loop, { startedAt: STARTED + 86_400_000 }), loop);
    await saveNewActivity(activity('ride', loop, { kind: 'bike', startedAt: STARTED + 2 * 86_400_000 }), loop);
    const straight = constantRun();
    await saveNewActivity(activity('straight', straight, { startedAt: STARTED + 3 * 86_400_000 }), straight);
    await saveNewActivity(activity('sept', loop, { startedAt: Date.UTC(2026, 8, 15, 13) }), loop);
    expect(await localTerritoryCells(OCTOBER)).toHaveLength(previewClaim(loop).cellIds.length);
    expect(await localTerritoryCells('2026-09-01')).toHaveLength(previewClaim(loop).cellIds.length);
    expect(await localTerritoryCells('2026-11-01')).toEqual([]);
  });
});
