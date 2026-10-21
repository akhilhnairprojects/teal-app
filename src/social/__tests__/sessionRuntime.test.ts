/** Live session broadcasting: ≤ 1 progress message per 10 s, no coordinates, stops on finish. */
import type { RecorderSnapshot } from '@/activity/recorder';
import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';

import {
  attachSession,
  broadcastSessionStatus,
  followRecorder,
  getSessionLive,
  isFollowing,
  resetSessionRuntimeForTests,
  SESSION_RUNTIME,
} from '../sessionRuntime';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const ME = '11111111-1111-4111-8111-111111111111';
const YOU = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';

jest.mock('@/backend/auth', () => ({ getAuthState: () => ({ status: 'signedIn', userId: '11111111-1111-4111-8111-111111111111' }) }));

type Snap = Pick<RecorderSnapshot, 'phase' | 'groupSessionId' | 'recentPath'> & { stats: { distanceM: number; elapsedMs: number } };
const mockRecorder: { snapshot: Snap; listeners: Set<(s: Snap) => void> } = {
  snapshot: { phase: 'idle', groupSessionId: null, recentPath: [], stats: { distanceM: 0, elapsedMs: 0 } },
  listeners: new Set(),
};
jest.mock('@/activity/recorder', () => ({
  getRecorderSnapshot: () => mockRecorder.snapshot,
  subscribeRecorder: (l: (s: Snap) => void) => {
    mockRecorder.listeners.add(l);
    return () => mockRecorder.listeners.delete(l);
  },
}));

const publish = (s: Partial<Snap>) => {
  mockRecorder.snapshot = { ...mockRecorder.snapshot, ...s };
  mockRecorder.listeners.forEach((l) => l(mockRecorder.snapshot));
};

/** The recorder publishes about once a second while recording. */
const recordFor = (seconds: number, from: { distanceM: number; elapsedMs: number }) => {
  for (let i = 1; i <= seconds; i++) {
    jest.advanceTimersByTime(1000);
    publish({ phase: 'recording', groupSessionId: SESSION, stats: { distanceM: from.distanceM + i * 3, elapsedMs: from.elapsedMs + i * 1000 } });
  }
};

const channel = () => mockSupabase.channels.find((c) => c.topic === `session:${SESSION}`)!;
const progressSent = () =>
  channel()
    .sent.map((m) => m as { event: string; payload: Record<string, unknown> })
    .filter((m) => m.event === 'progress');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-20T14:00:00Z'));
  mockSupabase.reset();
  mockSupabase.setSession(mockSession(ME));
  mockRecorder.snapshot = { phase: 'idle', groupSessionId: null, recentPath: [], stats: { distanceM: 0, elapsedMs: 0 } };
  mockRecorder.listeners.clear();
});

afterEach(() => {
  resetSessionRuntimeForTests();
  jest.useRealTimers();
});

it('throttles progress to one message per 10 s and sends no coordinates', () => {
  followRecorder(SESSION);
  recordFor(35, { distanceM: 0, elapsedMs: 0 });
  const sent = progressSent();
  // t = 1 s, 11 s, 21 s, 31 s
  expect(sent).toHaveLength(4);
  const times = sent.map((m) => m.payload.at as number);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(SESSION_RUNTIME.progressEveryMs);
  for (const m of sent) {
    expect(Object.keys(m.payload).sort()).toEqual(['at', 'distanceM', 'elapsedMs', 'state', 'userId']);
    expect(m.payload.userId).toBe(ME);
  }
  expect(channel().opts).toEqual({ config: { private: true, presence: { key: ME } } });
});

it('sends a pause within the next slot, then one finished message, and stops', () => {
  followRecorder(SESSION);
  recordFor(3, { distanceM: 0, elapsedMs: 0 });
  publish({ phase: 'paused' });
  expect(progressSent()).toHaveLength(1);
  jest.advanceTimersByTime(SESSION_RUNTIME.progressEveryMs);
  expect(progressSent().map((m) => m.payload.state)).toEqual(['recording', 'paused']);

  publish({ phase: 'finished', stats: { distanceM: 1234, elapsedMs: 600_000 } });
  const last = progressSent().at(-1)!;
  expect(last.payload).toMatchObject({ state: 'finished', distanceM: 1234, elapsedMs: 600_000 });
  expect(isFollowing(SESSION)).toBe(false);
  expect(channel().removed).toBe(true); // nothing else needs the channel

  const count = progressSent().length;
  recordFor(30, { distanceM: 2000, elapsedMs: 700_000 });
  jest.advanceTimersByTime(60_000);
  expect(progressSent()).toHaveLength(count);
});

it('ignores recordings for other sessions and a follow that never recorded', () => {
  followRecorder(SESSION);
  publish({ phase: 'recording', groupSessionId: null, stats: { distanceM: 10, elapsedMs: 1000 } });
  publish({ phase: 'finished', groupSessionId: null });
  expect(progressSent()).toHaveLength(0);
  expect(isFollowing(SESSION)).toBe(true);
});

it('fans channel events out to the page and shows my own progress locally', () => {
  const onProgress = jest.fn();
  const onStatus = jest.fn();
  const detach = attachSession(SESSION, { onProgress, onPresence: jest.fn(), onStatus });
  followRecorder(SESSION);
  recordFor(1, { distanceM: 0, elapsedMs: 0 });
  channel().emit('broadcast', 'progress', { payload: { userId: YOU, distanceM: 500, elapsedMs: 120_000, state: 'recording', at: Date.now(), lat: 42.3 } });
  expect(getSessionLive(SESSION).progress.map((p) => p.userId).sort()).toEqual([ME, YOU]);
  expect(JSON.stringify(getSessionLive(SESSION))).not.toContain('42.3');
  expect(onProgress).toHaveBeenCalledTimes(2);

  // A status broadcast of 'ended' stops following but the page stays attached.
  channel().emit('broadcast', 'status', { payload: { status: 'ended' } });
  expect(onStatus).toHaveBeenCalledWith('ended');
  expect(isFollowing(SESSION)).toBe(false);
  expect(channel().removed).toBe(false);
  detach();
  expect(channel().removed).toBe(true);
});

it('keeps one channel per session and broadcasts status changes', () => {
  const detachA = attachSession(SESSION, { onProgress: jest.fn(), onPresence: jest.fn(), onStatus: jest.fn() });
  followRecorder(SESSION);
  followRecorder(SESSION);
  expect(mockSupabase.channels).toHaveLength(1);
  broadcastSessionStatus(SESSION, 'live');
  expect(channel().sent).toContainEqual({ type: 'broadcast', event: 'status', payload: { status: 'live' } });
  detachA();
  expect(channel().removed).toBe(false); // still following
  broadcastSessionStatus(SESSION, 'ended');
  expect(channel().removed).toBe(true);
});

it('picks up a recording already in progress when following starts', () => {
  mockRecorder.snapshot = { phase: 'recording', groupSessionId: SESSION, recentPath: [], stats: { distanceM: 800, elapsedMs: 240_000 } };
  followRecorder(SESSION);
  expect(progressSent()[0].payload).toMatchObject({ distanceM: 800, state: 'recording' });
});
