import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';

import { getActiveModes, resetActiveModes } from '@/state/activeModes';

import { offset, ORIGIN } from '../__fixtures__/tracks';
import { recorder, REC_HEADER_KEY, recChunkKey, resetRecorderForTests, subscribeRecorder, type RecorderSnapshot } from '../recorder';
import { getLocalPoints, listLocalActivities, resetActivityStoreForTests } from '../store';
import type { RawFix } from '../types';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('@/backend/auth', () => ({ getAuthState: () => ({ status: 'signedOut' }), subscribeAuth: () => () => {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/notifications', () => ({ haptic: jest.fn(), notifyLocal: jest.fn(async () => {}) }));
jest.mock('@/voice/speak', () => ({ speakUpdate: jest.fn() }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) }));

const mockHub: { listener: ((f: RawFix) => void) | null; release: jest.Mock; error: string | null } = {
  listener: null,
  release: jest.fn(),
  error: null,
};
jest.mock('../locationHub', () => ({
  canTrackInBackground: () => false,
  acquireFixes: jest.fn(async (_owner: string, listener: (f: RawFix) => void) => {
    if (mockHub.error) return { ok: false, error: mockHub.error };
    mockHub.listener = listener;
    return { ok: true, mode: 'foreground', release: mockHub.release };
  }),
}));

const notifications = jest.requireMock('@/notifications') as { notifyLocal: jest.Mock };
const keepAwake = jest.requireMock('expo-keep-awake') as { activateKeepAwakeAsync: jest.Mock; deactivateKeepAwake: jest.Mock };

const T0 = Date.UTC(2026, 9, 20, 13, 0, 0);
let appStateHandler: ((s: AppStateStatus) => void) | null = null;
let northM = 0;
let last: RecorderSnapshot | null = null;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Deliver `seconds` fixes, one per second, moving north at `mps` (accuracy 5 m). */
async function feed(seconds: number, mps = 4, accuracy = 5) {
  for (let k = 0; k < seconds; k++) {
    jest.advanceTimersByTime(1000);
    northM += mps;
    const p = offset(ORIGIN.lat, ORIGIN.lon, northM, 0);
    mockHub.listener?.({ latitude: p.lat, longitude: p.lon, accuracy, speed: mps, timestamp: Date.now() });
  }
  await flush();
}

beforeEach(async () => {
  jest.useFakeTimers({ now: T0 });
  resetRecorderForTests();
  resetActivityStoreForTests();
  resetActiveModes();
  await AsyncStorage.clear();
  mockHub.listener = null;
  mockHub.error = null;
  mockHub.release.mockClear();
  keepAwake.activateKeepAwakeAsync.mockClear();
  notifications.notifyLocal.mockClear();
  keepAwake.deactivateKeepAwake.mockClear();
  northM = 0;
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  subscribeRecorder((s) => {
    last = s;
  });
});

/** Simulate the app being killed: memory is gone, storage stays. */
function kill() {
  resetRecorderForTests();
  resetActivityStoreForTests();
  subscribeRecorder((s) => {
    last = s;
  });
}

afterEach(() => {
  resetRecorderForTests();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('recorder', () => {
  it('acquires GPS, then records once a fix is within 20 m', async () => {
    expect((await recorder.start({ kind: 'run' })).ok).toBe(true);
    expect(last!.phase).toBe('acquiring');
    expect(last!.warnings).toContain('foregroundOnly');
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('teal-recorder');
    expect(getActiveModes()[0]).toMatchObject({ id: 'recording', href: '/record?kind=run' });

    await feed(2, 0, 35); // too inaccurate to start
    expect(last!.phase).toBe('acquiring');
    await feed(1, 4, 5);
    expect(last!.phase).toBe('recording');
    await feed(120);
    jest.advanceTimersByTime(1000);
    expect(last!.stats.distanceM).toBeGreaterThan(450);
    expect(last!.stats.currentPaceSecPerKm).toBeCloseTo(250, -1);
    expect(last!.recentPath.length).toBeGreaterThan(10);
    expect(getActiveModes()[0].label).toMatch(/^● Recording · 0\.\d\d mi$/);
  });

  it('flags poor GPS when no good fix arrives within 30 s, and can start anyway', async () => {
    await recorder.start({ kind: 'bike' });
    await feed(31, 0, 40);
    expect(last!.warnings).toContain('poorGps');
    recorder.resume(); // "start anyway"
    expect(last!.phase).toBe('recording');
    expect(last!.warnings).not.toContain('poorGps');
  });

  it('reports a denied permission', async () => {
    mockHub.error = 'permissionDenied';
    const r = await recorder.start({ kind: 'run' });
    expect(!r.ok && r.error.code).toBe('forbidden');
    expect(last!.phase).toBe('idle');
    expect(last!.warnings).toContain('permissionDenied');
    expect(getActiveModes()).toEqual([]);
  });

  it('does not count a manual pause, and records background gaps with a warning', async () => {
    await recorder.start({ kind: 'run' });
    await feed(100);
    const before = last!.stats.distanceM;
    recorder.pause();
    expect(last!.phase).toBe('paused');
    await feed(60); // fixes during the pause are ignored, but the runner moved 240 m
    recorder.resume();
    await feed(50);
    jest.advanceTimersByTime(1000);
    const after = last!.stats.distanceM;
    // The 60 s pause becomes an uncounted gap; only ~200 m of the 50 s after it count.
    expect(after - before).toBeGreaterThan(150);
    expect(after - before).toBeLessThan(215);

    appStateHandler!('background');
    jest.advanceTimersByTime(240_000);
    appStateHandler!('active');
    expect(last!.backgroundGapMs).toBe(240_000);
    expect(last!.warnings).toContain('backgroundGap');
  });

  it('persists 300-point chunks every 15 s, and recovers after a kill', async () => {
    await recorder.start({ kind: 'run' });
    await feed(400, 5);
    jest.advanceTimersByTime(15_000);
    await flush();
    const header = JSON.parse((await AsyncStorage.getItem(REC_HEADER_KEY))!).value;
    expect(header).toMatchObject({ kind: 'run', chunks: 2 });
    expect(header.points).toBeGreaterThan(300);
    expect(JSON.parse((await AsyncStorage.getItem(recChunkKey(0)))!).value).toHaveLength(300);
    expect(await AsyncStorage.getItem(recChunkKey(1))).not.toBeNull();

    kill();
    const pending = await recorder.pendingRecovery();
    expect(pending).toEqual({ kind: 'run', startedAt: header.startedAt, points: header.points });
    expect((await recorder.start({ kind: 'run' })).ok).toBe(false); // resolve the old one first

    await recorder.recover('save');
    const saved = await listLocalActivities();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ kind: 'run', ownerUserId: null, sync: { state: 'local' } });
    expect(saved[0].metrics.distanceM).toBeGreaterThan(1000);
    expect((await getLocalPoints(saved[0].localId))![0].t).toBe(0);
    expect(await AsyncStorage.getItem(REC_HEADER_KEY)).toBeNull();
    expect(await recorder.pendingRecovery()).toBeNull();
  });

  it('can resume an unfinished recording', async () => {
    await recorder.start({ kind: 'run' });
    await feed(60);
    jest.advanceTimersByTime(15_000);
    await flush();
    kill();
    await recorder.recover('resume');
    expect(last!.phase).toBe('recording');
    await feed(70);
    const done = await recorder.finish({ shareRoute: true });
    expect('discarded' in done).toBe(false);
    if (!('discarded' in done)) {
      expect(done.shareRoute).toBe(true);
      // Points from before the kill and after the resume are both in the saved activity.
      expect(done.metrics.distanceM).toBeGreaterThan(400);
      expect(done.metrics.distanceM).toBeLessThan(4 * 130 + 1);
    }
  });

  it('stays paused with a GPS warning when a resumed recording cannot get GPS, and Resume retries', async () => {
    await recorder.start({ kind: 'run' });
    await feed(60);
    jest.advanceTimersByTime(15_000);
    await flush();
    kill();

    mockHub.error = 'permissionDenied';
    const r = await recorder.recover('resume');
    expect(!r.ok && r.error.code).toBe('forbidden');
    expect(last!.phase).toBe('paused');
    expect(last!.warnings).toEqual(expect.arrayContaining(['gpsStopped', 'permissionDenied']));

    // Still no permission: Resume fails and the run stays paused (never "Recording" without GPS).
    const again = await recorder.resume();
    expect(again.ok).toBe(false);
    expect(last!.phase).toBe('paused');

    // Permission granted: Resume acquires GPS, then records.
    mockHub.error = null;
    const ok = await recorder.resume();
    expect(ok.ok).toBe(true);
    expect(last!.phase).toBe('recording');
    expect(last!.warnings).not.toContain('gpsStopped');
    expect(last!.warnings).not.toContain('permissionDenied');
    const before = last!.stats.distanceM;
    await feed(30);
    jest.advanceTimersByTime(1000);
    expect(last!.stats.distanceM).toBeGreaterThan(before + 80);
    const done = await recorder.finish({ shareRoute: false });
    expect('discarded' in done).toBe(false);
    expect(mockHub.release).toHaveBeenCalled();
  });

  it('discards recordings under 100 m or 60 s, and cleans up', async () => {
    await recorder.start({ kind: 'run' });
    await feed(30);
    jest.advanceTimersByTime(15_000);
    await flush();
    expect(await recorder.finish({ shareRoute: false })).toEqual({ discarded: 'tooShort' });
    expect(last!.phase).toBe('idle');
    expect(mockHub.release).toHaveBeenCalled();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith('teal-recorder');
    expect(getActiveModes()).toEqual([]);
    expect(await AsyncStorage.getItem(REC_HEADER_KEY)).toBeNull();
    expect(await listLocalActivities()).toEqual([]);
  });

  it('saves a finished recording locally when signed out', async () => {
    await recorder.start({ kind: 'bike' });
    await feed(90, 6);
    const done = await recorder.finish({ shareRoute: false });
    expect(last!.phase).toBe('finished');
    expect('discarded' in done).toBe(false);
    if (!('discarded' in done)) {
      expect(done).toMatchObject({ kind: 'bike', ownerUserId: null, sync: { state: 'local' } });
      expect(done.metrics.efforts).toEqual([]);
      expect(done.previewPolyline.length).toBeGreaterThan(0);
    }
  });

  it('warns a runner who goes too fast, and keeps the run when they slow down', async () => {
    await recorder.start({ kind: 'run' });
    await feed(60, 3);
    await feed(30, 9); // 9 m/s ≈ 20 mph; the 10 s smoothing delays the warning a few seconds
    expect(last!.warnings).toContain('tooFast');
    expect(notifications.notifyLocal).toHaveBeenCalledWith(expect.objectContaining({ title: 'Slow down to keep this run' }));
    await feed(60, 3);
    const done = await recorder.finish({ shareRoute: false });
    expect('discarded' in done).toBe(false);
    expect(await listLocalActivities()).toHaveLength(1);
  });

  it('deletes a run that stays too fast after the warning', async () => {
    await recorder.start({ kind: 'run' });
    await feed(60, 3);
    await feed(80, 9);
    expect(last!.phase).toBe('idle');
    expect(last!.voided).toMatchObject({ kind: 'run' });
    expect(notifications.notifyLocal).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Run deleted' }));
    expect(mockHub.release).toHaveBeenCalled();
    expect(await AsyncStorage.getItem(REC_HEADER_KEY)).toBeNull();
    expect(await listLocalActivities()).toEqual([]);
    recorder.dismissVoided();
    expect(last!.voided).toBeNull();
  });
});
