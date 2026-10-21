/** The foreground fallback: local banners only when push isn't available, each row at most once. */
import { AppState, type AppStateStatus } from 'react-native';

import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';

import { INBOX_WATCHER, startInboxWatcher } from '../inboxWatcher';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const ME = '11111111-1111-4111-8111-111111111111';
const mockAuth: { current: { status: string; userId?: string }; listeners: Set<() => void> } = { current: { status: 'signedIn' }, listeners: new Set() };
jest.mock('@/backend/auth', () => ({
  getAuthState: () => mockAuth.current,
  subscribeAuth: (l: () => void) => {
    mockAuth.listeners.add(l);
    return () => mockAuth.listeners.delete(l);
  },
}));

const mockPush: { availability: string } = { availability: 'noProjectId' };
const mockNotifyLocal = jest.fn(async (_n: { title: string; body: string; url?: string }) => {});
jest.mock('@/notifications', () => ({
  getPushAvailability: () => mockPush.availability,
  notifyLocal: (n: { title: string; body: string; url?: string }) => mockNotifyLocal(n),
}));

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const notification = (n: number, kind = 'friend_request', readAt: string | null = null) => ({
  id: id(n),
  kind,
  created_at: '2026-10-20T14:00:00Z',
  read_at: readAt,
  payload: { actor_nickname: `friend${n}`, their_m: 2000, your_m: 1000 },
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const inboxChannel = () => mockSupabase.channels.find((c) => c.topic === `inbox:${ME}` && !c.removed);
const insert = (row: ReturnType<typeof notification>) => inboxChannel()!.emit('postgres_changes', 'INSERT', { new: row });
const setAppState = (s: AppStateStatus) => Object.defineProperty(AppState, 'currentState', { value: s, configurable: true, writable: true });

let stop: (() => void) | null = null;

beforeEach(() => {
  mockSupabase.reset();
  mockSupabase.setSession(mockSession(ME));
  mockAuth.current = { status: 'signedIn', userId: ME };
  mockAuth.listeners.clear();
  mockPush.availability = 'noProjectId';
  mockNotifyLocal.mockClear();
  setAppState('active');
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  stop?.();
  stop = null;
});

it('treats rows unread at start as known, then notifies new realtime rows once', async () => {
  mockSupabase.setTable('notifications', [notification(1)]);
  stop = startInboxWatcher();
  await flush();
  expect(mockNotifyLocal).not.toHaveBeenCalled();

  insert(notification(2, 'overtake'));
  insert(notification(2, 'overtake')); // duplicate delivery
  expect(mockNotifyLocal).toHaveBeenCalledTimes(1);
  expect(mockNotifyLocal).toHaveBeenCalledWith({ title: 'You’ve been passed', body: 'friend2 passed you this week · 1.2 mi vs your 0.6 mi', url: '/friends' });

  // A foreground re-read that includes the same row does not repeat it.
  mockSupabase.setTable('notifications', [notification(2, 'overtake'), notification(1)]);
  appStateHandler?.('background');
  appStateHandler?.('active');
  await flush();
  expect(mockNotifyLocal).toHaveBeenCalledTimes(1);
});

it('does nothing locally when remote push is available, but still tracks the rows', async () => {
  mockPush.availability = 'available';
  stop = startInboxWatcher();
  await flush();
  insert(notification(3));
  expect(mockNotifyLocal).not.toHaveBeenCalled();
  mockPush.availability = 'permissionDenied';
  insert(notification(3));
  expect(mockNotifyLocal).not.toHaveBeenCalled();
  insert(notification(4));
  expect(mockNotifyLocal).toHaveBeenCalledTimes(1);
});

it('picks up rows that arrived while in the background, capped per batch, skipping read rows', async () => {
  stop = startInboxWatcher();
  await flush();
  appStateHandler?.('background');
  expect(inboxChannel()).toBeUndefined(); // realtime stops in the background
  mockSupabase.setTable('notifications', [notification(10), notification(11), notification(12), notification(13), notification(14, 'overtake', '2026-10-20T15:00:00Z')]);
  appStateHandler?.('active');
  await flush();
  expect(mockNotifyLocal).toHaveBeenCalledTimes(INBOX_WATCHER.maxLocalPerBatch);
  expect(inboxChannel()).toBeDefined();
});

it('stays idle while signed out and resets on account switch', async () => {
  mockAuth.current = { status: 'signedOut' };
  stop = startInboxWatcher();
  await flush();
  expect(inboxChannel()).toBeUndefined();
  expect(mockSupabase.raw.from).not.toHaveBeenCalled();

  mockSupabase.setTable('notifications', [notification(20)]);
  mockAuth.current = { status: 'signedIn', userId: ME };
  mockAuth.listeners.forEach((l) => l());
  await flush();
  expect(inboxChannel()).toBeDefined();
  expect(mockNotifyLocal).not.toHaveBeenCalled(); // first read after sign-in seeds silently
});

it('is reference-counted: the realtime channel closes when the last user stops', async () => {
  const stopA = startInboxWatcher();
  const stopB = startInboxWatcher();
  await flush();
  expect(mockSupabase.channels.filter((c) => c.topic === `inbox:${ME}`)).toHaveLength(1);
  stopA();
  expect(inboxChannel()).toBeDefined();
  stopB();
  await flush();
  expect(inboxChannel()).toBeUndefined();
});
