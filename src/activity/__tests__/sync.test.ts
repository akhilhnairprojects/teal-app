import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockSupabase } from '@/backend/testing/mockSupabase';

import { constantRun } from '../__fixtures__/tracks';
import { computeTrackMetrics } from '../metrics';
import { getLocalActivity, resetActivityStoreForTests, saveNewActivity, type LocalActivity } from '../store';
import {
  attachUnownedActivities,
  backoffFor,
  buildSubmitPayload,
  countUnownedActivities,
  resetSyncForTests,
  SYNC_BACKOFF_MS,
  syncPending,
} from '../sync';
import type { TrackPoint } from '../types';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const mockAuth: { current: { status: string; userId?: string } } = { current: { status: 'signedOut' } };
jest.mock('@/backend/auth', () => ({
  getAuthState: () => mockAuth.current,
  subscribeAuth: () => () => {},
}));

const ME = '11111111-1111-4111-8111-111111111111';
const LOCAL_ID = '22222222-2222-4222-8222-222222222222';
const SERVER_ID = '33333333-3333-4333-8333-333333333333';
const STARTED = Date.UTC(2026, 9, 20, 13, 0, 0);

/** 1.2 km of the constant run (5 min at 4 m/s). */
const POINTS: TrackPoint[] = constantRun().slice(0, 301);

function local(o: Partial<LocalActivity> = {}): LocalActivity {
  return {
    localId: LOCAL_ID,
    kind: 'run',
    startedAt: STARTED,
    endedAt: STARTED + 300_000,
    ownerUserId: ME,
    groupSessionId: null,
    shareRoute: false,
    metrics: computeTrackMetrics(POINTS, 'run'),
    previewPolyline: '',
    sync: { state: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, server: null },
    ...o,
  };
}

/** What submit_activity returns: the server's own (slightly different) numbers. */
const summary = (clientId = LOCAL_ID) => ({
  id: SERVER_ID,
  client_id: clientId,
  kind: 'run',
  status: 'valid',
  flags: [],
  started_at: new Date(STARTED).toISOString(),
  ended_at: new Date(STARTED + 300_000).toISOString(),
  week_start: '2026-10-19',
  month_start: '2026-10-01',
  distance_m: 1199.5,
  excluded_m: 0,
  elapsed_ms: 300_000,
  moving_ms: 299_000,
  is_loop: false,
  leaderboard_eligible: true,
  share_route: false,
  group_session_id: null,
  efforts: [{ distance_m: 1000, duration_ms: 250_100, start_offset_ms: 0 }],
});

beforeEach(async () => {
  mockSupabase.reset();
  resetSyncForTests();
  resetActivityStoreForTests();
  await AsyncStorage.clear();
  mockAuth.current = { status: 'signedIn', userId: ME };
});

describe('sync', () => {
  it('uploads the server payload and replaces local metrics with the server summary', async () => {
    let sent: Record<string, unknown> | null = null;
    mockSupabase.onRpc('submit_activity', (args) => {
      sent = args.p as Record<string, unknown>;
      return { data: summary() };
    });
    await saveNewActivity(local(), POINTS);
    expect(await syncPending('finish')).toEqual({ synced: 1, rejected: 0, failed: 0 });
    expect(sent).toMatchObject({
      client_id: LOCAL_ID,
      kind: 'run',
      started_at: '2026-10-20T13:00:00.000Z',
      ended_at: '2026-10-20T13:05:00.000Z',
      share_route: false,
      group_session_id: null,
    });
    expect((sent!.points as number[][])[0]).toEqual([0, POINTS[0].lat, POINTS[0].lon]);
    const a = (await getLocalActivity(LOCAL_ID))!;
    expect(a.sync).toMatchObject({ state: 'synced', lastError: null, nextAttemptAt: null });
    expect(a.sync.server?.id).toBe(SERVER_ID);
    expect(a.metrics).toMatchObject({ distanceM: 1199.5, movingMs: 299_000, efforts: [{ distanceM: 1000, durationMs: 250_100, startOffsetMs: 0 }] });
  });

  it('rebases points so the first is t = 0', () => {
    const shifted = POINTS.slice(10, 20);
    const p = buildSubmitPayload(local(), shifted);
    expect(p.points[0][0]).toBe(0);
    expect(p.started_at).toBe(new Date(STARTED + shifted[0].t).toISOString());
    expect(p.ended_at).toBe(new Date(STARTED + shifted[9].t).toISOString());
  });

  it('backs off 30 s, 2 min, 10 min, 1 h after failures, then an idempotent retry returns the existing summary', async () => {
    expect(SYNC_BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 3_600_000]);
    expect([1, 2, 3, 4, 5, 9].map(backoffFor)).toEqual([30_000, 120_000, 600_000, 3_600_000, 3_600_000, 3_600_000]);

    let calls = 0;
    mockSupabase.onRpc('submit_activity', () => {
      calls++;
      if (calls === 1) throw new TypeError('Network request failed');
      return { data: summary() }; // the server already had it, or stores it now: same summary either way
    });
    await saveNewActivity(local(), POINTS);
    const before = Date.now();
    expect(await syncPending('foreground')).toEqual({ synced: 0, rejected: 0, failed: 1 });
    let a = (await getLocalActivity(LOCAL_ID))!;
    expect(a.sync).toMatchObject({ state: 'pending', attempts: 1, lastError: 'offline' });
    expect(a.sync.nextAttemptAt! - before).toBeGreaterThanOrEqual(30_000);
    expect(a.sync.nextAttemptAt! - before).toBeLessThan(31_000);

    // Not due yet: a foreground trigger skips it.
    expect(await syncPending('foreground')).toEqual({ synced: 0, rejected: 0, failed: 0 });
    expect(calls).toBe(1);

    // Manual retry ignores the backoff.
    expect(await syncPending('manual')).toEqual({ synced: 1, rejected: 0, failed: 0 });
    a = (await getLocalActivity(LOCAL_ID))!;
    expect(a.sync.state).toBe('synced');

    // Synced activities are never re-sent.
    expect(await syncPending('manual')).toEqual({ synced: 0, rejected: 0, failed: 0 });
    expect(calls).toBe(2);
  });

  it('retries rate limits but never retries invalid_time', async () => {
    mockSupabase.rpcError('submit_activity', 'rate_limited');
    await saveNewActivity(local(), POINTS);
    await syncPending('manual');
    expect((await getLocalActivity(LOCAL_ID))!.sync).toMatchObject({ state: 'pending', lastError: 'rate_limited' });

    mockSupabase.rpcError('submit_activity', 'invalid_time');
    expect(await syncPending('manual')).toEqual({ synced: 0, rejected: 1, failed: 0 });
    expect((await getLocalActivity(LOCAL_ID))!.sync).toMatchObject({ state: 'rejected', lastError: 'invalid_time', nextAttemptAt: null });
    expect(await syncPending('manual')).toEqual({ synced: 0, rejected: 0, failed: 0 });
    expect(mockSupabase.raw.rpc).toHaveBeenCalledTimes(2);
  });

  it('does nothing while signed out, and attaches signed-out recordings after sign-in', async () => {
    mockSupabase.onRpc('submit_activity', () => ({ data: summary() }));
    mockAuth.current = { status: 'signedOut' };
    await saveNewActivity(local({ ownerUserId: null, sync: { state: 'local', attempts: 0, nextAttemptAt: null, lastError: null, server: null } }), POINTS);
    expect(await syncPending('finish')).toEqual({ synced: 0, rejected: 0, failed: 0 });

    mockAuth.current = { status: 'signedIn', userId: ME };
    // Not uploaded until the user agrees.
    expect(await syncPending('signIn')).toEqual({ synced: 0, rejected: 0, failed: 0 });
    expect(await countUnownedActivities()).toBe(1);
    expect(await attachUnownedActivities()).toBe(1);
    for (let i = 0; i < 20 && (await getLocalActivity(LOCAL_ID))!.sync.state !== 'synced'; i++) await new Promise((r) => setTimeout(r, 0));
    const a = (await getLocalActivity(LOCAL_ID))!;
    expect(a.ownerUserId).toBe(ME);
    expect(a.sync.state).toBe('synced');
    expect(await countUnownedActivities()).toBe(0);
  });

  it('never uploads another account’s activities', async () => {
    mockSupabase.onRpc('submit_activity', () => ({ data: summary() }));
    await saveNewActivity(local({ ownerUserId: '44444444-4444-4444-8444-444444444444' }), POINTS);
    expect(await syncPending('manual')).toEqual({ synced: 0, rejected: 0, failed: 0 });
  });
});
