/** Render smoke tests for the social screens against the mock Supabase client (no network). */
import { router } from 'expo-router';
import { Share, TextInput } from 'react-native';
import { act } from 'react-test-renderer';

import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';
import { textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';

import { FriendsScreen } from '../FriendsScreen';
import { InboxScreen } from '../InboxScreen';
import { FriendInviteScreen } from '../InviteScreens';
import { ADD_FRIEND_COPY } from '../socialModel';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('expo-linking', () => ({ createURL: (p: string) => `teal://${p}` }));
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    usePathname: () => '/friends',
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => <RNText>{`redirect:${href}`}</RNText>,
  };
});

const ME = '11111111-1111-4111-8111-111111111111';
const BO = '22222222-2222-4222-8222-222222222222';
const TS = '2026-10-20T14:00:00+00:00';
const PROFILE = {
  id: ME,
  nickname: 'Ana',
  color: 2,
  inviteCode: 'ABCDEFGH',
  territoryOptIn: true,
  territoryNoticeSeen: true,
  notifyOvertake: true,
  notifySessions: true,
  notifyFriendRequests: true,
  createdAt: TS,
};
jest.mock('@/backend/auth', () => {
  const state = { status: 'signedIn', userId: '11111111-1111-4111-8111-111111111111', profile: {} as Record<string, unknown> };
  return { useAuth: () => state, getAuthState: () => state, subscribeAuth: () => () => {}, __state: state };
});
jest.mock('expo-notifications', () => ({}));
jest.mock('@/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => 'denied'),
  registerForPush: jest.fn(async () => 'noProjectId'),
  notificationHref: jest.requireActual('@/notifications').notificationHref,
}));
jest.mock('@/activity/recorder', () => {
  const snapshot = { phase: 'idle', groupSessionId: null, recentPath: [], stats: { distanceM: 0, elapsedMs: 0 } };
  return { useRecorder: () => snapshot, getRecorderSnapshot: () => snapshot, subscribeRecorder: () => () => {} };
});

beforeAll(() => {
  (jest.requireMock('@/backend/auth') as { __state: { profile: unknown } }).__state.profile = PROFILE;
});

beforeEach(() => {
  mockSupabase.reset();
  mockSupabase.setSession(mockSession(ME));
  (router.push as jest.Mock).mockClear();
  (router.replace as jest.Mock).mockClear();
});

describe('FriendsScreen', () => {
  beforeEach(() => {
    mockSupabase.onRpc('list_friends', () => ({
      data: [
        { user_id: BO, nickname: 'bo', color: 1, status: 'friends', since: TS, week_run_m: 22852 },
        { user_id: '55555555-5555-4555-8555-555555555555', nickname: 'cy', color: 3, status: 'incoming', since: TS, week_run_m: null },
      ],
    }));
  });

  it('shows my code, requests and friends with weekly distance', async () => {
    await withScreen(<FriendsScreen />, async (r) => {
      await waitForText(r, 'ABCDEFGH', 'Requests', 'cy', 'bo', '14.20 mi');
    });
  });

  it('adds a friend by code, rejects my own code and junk', async () => {
    mockSupabase.onRpc('send_friend_request', () => ({ data: 'accepted' }));
    await withScreen(<FriendsScreen />, async (r) => {
      await waitForText(r, 'bo');
      const input = r.root.findByProps({ testID: 'friends-add-input' }).findByType(TextInput);
      const submit = () => r.root.findByProps({ testID: 'friends-add-button' }).props.onPress();

      await act(async () => input.props.onChangeText('hi there!'));
      await act(async () => submit());
      await waitForText(r, ADD_FRIEND_COPY.invalid);

      await act(async () => input.props.onChangeText('ABCDEFGH'));
      await act(async () => submit());
      await waitForText(r, ADD_FRIEND_COPY.self);
      expect(mockSupabase.raw.rpc).not.toHaveBeenCalledWith('send_friend_request', expect.anything());

      await act(async () => input.props.onChangeText('K7M2P9QX'));
      await act(async () => submit());
      await waitForText(r, ADD_FRIEND_COPY.accepted);
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('send_friend_request', { p_code: 'K7M2P9QX' });
    });
  });

  it('retries a lower-case code as a code when no such nickname exists', async () => {
    mockSupabase.onRpc('send_friend_request', (a) => (a.p_code ? { data: 'accepted' } : { error: { code: 'P0001', message: 'not_found' } }));
    await withScreen(<FriendsScreen />, async (r) => {
      await waitForText(r, 'bo');
      const input = r.root.findByProps({ testID: 'friends-add-input' }).findByType(TextInput);
      await act(async () => input.props.onChangeText('k7m2p9qx'));
      await act(async () => r.root.findByProps({ testID: 'friends-add-button' }).props.onPress());
      await waitForText(r, ADD_FRIEND_COPY.accepted);
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('send_friend_request', { p_nickname: 'k7m2p9qx' });
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('send_friend_request', { p_code: 'K7M2P9QX' });
    });
  });

  it('shares the invite code', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await withScreen(<FriendsScreen />, async (r) => {
      await waitForText(r, 'ABCDEFGH');
      act(() => r.root.findByProps({ testID: 'friends-share' }).props.onPress());
      expect(share.mock.calls[0][0]).toEqual({ message: expect.stringContaining('ABCDEFGH') });
      expect((share.mock.calls[0][0] as { message: string }).message).toContain('teal://friend/ABCDEFGH');
    });
  });
});

describe('InboxScreen', () => {
  it('lists items with their copy, marks unread ones read, and routes taps', async () => {
    const unread = '66666666-6666-4666-8666-666666666666';
    mockSupabase.setTable('notifications', [
      { id: unread, kind: 'overtake', created_at: TS, read_at: null, payload: { actor_nickname: 'bo', their_m: 22852, your_m: 22370 } },
      { id: '77777777-7777-4777-8777-777777777777', kind: 'friend_accepted', created_at: TS, read_at: TS, payload: { actor_nickname: 'cy' } },
      { id: '88888888-8888-4888-8888-888888888888', kind: 'session_live', created_at: TS, read_at: null, payload: { title: 'Long run' } },
    ]);
    mockSupabase.onRpc('mark_notifications_read', () => ({ data: null }));
    await withScreen(<InboxScreen />, async (r) => {
      await waitForText(r, 'bo passed you this week · 14.2 mi vs your 13.9 mi', 'You and cy are now friends on Teal.');
      expect(textOf(r)).not.toContain('Long run');
      await waitUntil(() => mockSupabase.raw.rpc.mock.calls.some((c) => c[0] === 'mark_notifications_read'));
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('mark_notifications_read', { p_ids: [unread] });
      act(() => r.root.findByProps({ testID: `inbox-${unread}` }).props.onPress());
      expect(router.push).toHaveBeenCalledWith('/friends');
    });
  });
});

describe('FriendInviteScreen', () => {
  it('adds by the link’s code and refuses my own', async () => {
    mockSupabase.onRpc('send_friend_request', () => ({ data: 'accepted' }));
    await withScreen(<FriendInviteScreen code="K7M2P9QX" />, async (r) => {
      await waitForText(r, 'K7M2P9QX');
      await act(async () => r.root.findByProps({ testID: 'friend-invite-accept' }).props.onPress());
      expect(router.replace).toHaveBeenCalledWith('/friends');
    });
    await withScreen(<FriendInviteScreen code="ABCDEFGH" />, async (r) => {
      await waitForText(r, 'This is your own invite');
    });
    await withScreen(<FriendInviteScreen code={null} />, async (r) => {
      await waitForText(r, 'isn’t valid');
    });
  });
});
