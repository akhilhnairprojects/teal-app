import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockSupabase } from '@/backend/testing/mockSupabase';
import { encodePolyline } from '@/lib/polyline';

import { constantRun } from '../__fixtures__/tracks';
import { computeTrackMetrics } from '../metrics';
import {
  deleteActivity,
  fetchMyTrack,
  getLocalActivity,
  getLocalPoints,
  listLocalActivities,
  mergeActivityLists,
  pointsKey,
  POINTS_RETENTION_MS,
  pruneSyncedPoints,
  resetActivityStoreForTests,
  saveNewActivity,
  setActivitySharing,
  updateLocalActivity,
  wipeLocalUserData,
  type LocalActivity,
  type ServerActivity,
} from '../store';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const SERVER = '44444444-4444-4444-8444-444444444444';
const POINTS = constantRun().slice(0, 100);

const local = (localId: string, startedAt: number, o: Partial<LocalActivity> = {}): LocalActivity => ({
  localId,
  kind: 'run',
  startedAt,
  endedAt: startedAt + 99_000,
  ownerUserId: null,
  shareRoute: false,
  metrics: computeTrackMetrics(POINTS, 'run'),
  previewPolyline: '',
  sync: { state: 'local', attempts: 0, nextAttemptAt: null, lastError: null, server: null },
  ...o,
});

const server = (o: Partial<ServerActivity> = {}): ServerActivity => ({
  id: SERVER,
  clientId: B,
  kind: 'bike',
  status: 'valid',
  flags: [],
  startedAt: '2026-10-19T12:00:00.000Z',
  endedAt: '2026-10-19T12:30:00.000Z',
  weekStart: '2026-10-19',
  monthStart: '2026-10-01',
  distanceM: 8000,
  excludedM: 0,
  elapsedMs: 1_800_000,
  movingMs: 1_700_000,
  isLoop: false,
  leaderboardEligible: true,
  shareRoute: true,
  efforts: [],
  ...o,
});

const wire = (s: ServerActivity) => ({
  id: s.id,
  client_id: s.clientId,
  kind: s.kind,
  status: s.status,
  flags: s.flags,
  started_at: s.startedAt,
  ended_at: s.endedAt,
  week_start: s.weekStart,
  month_start: s.monthStart,
  distance_m: s.distanceM,
  excluded_m: s.excludedM,
  elapsed_ms: s.elapsedMs,
  moving_ms: s.movingMs,
  is_loop: s.isLoop,
  leaderboard_eligible: s.leaderboardEligible,
  share_route: s.shareRoute,
  efforts: [],
});

beforeEach(async () => {
  mockSupabase.reset();
  resetActivityStoreForTests();
  await AsyncStorage.clear();
});

describe('activity store', () => {
  it('saves activities and their points, newest first, and survives a restart', async () => {
    await saveNewActivity(local(A, 1000), POINTS);
    await saveNewActivity(local(B, 2000), POINTS);
    resetActivityStoreForTests();
    expect((await listLocalActivities()).map((a) => a.localId)).toEqual([B, A]);
    expect(await getLocalPoints(A)).toEqual(POINTS);
    expect(await getLocalPoints('missing')).toBeNull();
  });

  it('serialises concurrent updates', async () => {
    await saveNewActivity(local(A, 1000), POINTS);
    await Promise.all([
      updateLocalActivity(A, (a) => ({ ...a, sync: { ...a.sync, attempts: a.sync.attempts + 1 } })),
      updateLocalActivity(A, (a) => ({ ...a, sync: { ...a.sync, attempts: a.sync.attempts + 1 } })),
    ]);
    expect((await getLocalActivity(A))!.sync.attempts).toBe(2);
  });

  it('merges local and server-only activities by client id', () => {
    const items = mergeActivityLists([local(A, Date.parse('2026-10-20T12:00:00Z')), local(B, 0)], [server(), server({ id: A, clientId: 'other', kind: 'run' })]);
    // B is local, so the server copy with client id B is not listed twice.
    expect(items.map((i) => [i.localId, i.serverId, i.syncState])).toEqual([
      [A, null, 'local'],
      [null, A, 'remote'],
      [B, null, 'local'],
    ]);
  });

  it('deletes points 30 days after a successful sync, keeping the summary', async () => {
    const now = Date.now();
    await saveNewActivity(local(A, now - POINTS_RETENTION_MS - 200_000, { sync: { state: 'synced', attempts: 1, nextAttemptAt: null, lastError: null, server: null } }), POINTS);
    await saveNewActivity(local(B, now - POINTS_RETENTION_MS - 200_000), POINTS); // never synced: kept
    expect(await pruneSyncedPoints(now)).toBe(1);
    expect(await AsyncStorage.getItem(pointsKey(A))).toBeNull();
    expect(await getLocalPoints(B)).not.toBeNull();
    expect(await getLocalActivity(A)).not.toBeNull();
  });

  it('wipes activities, recordings and auth keys but nothing else', async () => {
    await saveNewActivity(local(A, 1000), POINTS);
    await AsyncStorage.multiSet([
      ['teal.rec.inprogress.v1', '{}'],
      ['sb-x-auth-token', '{}'],
      ['teal.favorites.v1', '{}'],
    ]);
    await wipeLocalUserData();
    expect(await AsyncStorage.getAllKeys()).toEqual(['teal.favorites.v1']);
    expect(await listLocalActivities()).toEqual([]);
  });
});

describe('server actions', () => {
  it('shares a route and stores the new summary on the local activity', async () => {
    await saveNewActivity(local(B, 1000, { sync: { state: 'synced', attempts: 1, nextAttemptAt: null, lastError: null, server: server({ shareRoute: false }) } }), POINTS);
    mockSupabase.onRpc('set_activity_sharing', (args) => ({ data: wire(server({ shareRoute: args.p_share as boolean })) }));
    const r = await setActivitySharing(SERVER, true);
    expect(r.ok && r.value.shareRoute).toBe(true);
    expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('set_activity_sharing', { p_activity: SERVER, p_share: true });
    expect((await getLocalActivity(B))!.shareRoute).toBe(true);

    mockSupabase.rpcError('set_activity_sharing', 'trace_expired');
    const expired = await setActivitySharing(SERVER, true);
    expect(!expired.ok && expired.error.code).toBe('trace_expired');
  });

  it('deletes on the server then locally; an already-deleted server copy is fine', async () => {
    await saveNewActivity(local(B, 1000, { sync: { state: 'synced', attempts: 1, nextAttemptAt: null, lastError: null, server: server() } }), POINTS);
    mockSupabase.rpcError('delete_activity', 'not_found');
    expect(await deleteActivity({ localId: B, serverId: null })).toEqual({ ok: true, value: undefined });
    expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('delete_activity', { p_activity: SERVER });
    expect(await getLocalActivity(B)).toBeNull();
    expect(await getLocalPoints(B)).toBeNull();
  });

  it('keeps the local copy when the server delete fails for another reason', async () => {
    await saveNewActivity(local(B, 1000, { sync: { state: 'synced', attempts: 1, nextAttemptAt: null, lastError: null, server: server() } }), POINTS);
    mockSupabase.onRpc('delete_activity', () => {
      throw new TypeError('Network request failed');
    });
    const r = await deleteActivity({ localId: B, serverId: SERVER });
    expect(!r.ok && r.error.code).toBe('offline');
    expect(await getLocalActivity(B)).not.toBeNull();
  });

  it('decodes my stored track, or reports an expired one as null', async () => {
    const path = [
      { latitude: 42.3, longitude: -71.1 },
      { latitude: 42.301, longitude: -71.1 },
    ];
    mockSupabase.onRpc('get_my_activity_track', () => ({ data: encodePolyline(path) }));
    expect(await fetchMyTrack(SERVER)).toEqual({ ok: true, value: path });
    mockSupabase.onRpc('get_my_activity_track', () => ({ data: null }));
    expect(await fetchMyTrack(SERVER)).toEqual({ ok: true, value: null });
  });
});
