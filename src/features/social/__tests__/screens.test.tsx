/** Render smoke tests for the social screens against the mock Supabase client (no network). */
import { router } from 'expo-router';
import { Share, TextInput } from 'react-native';
import { act } from 'react-test-renderer';

import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';
import { textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';
import { resetSessionRuntimeForTests } from '@/social/sessionRuntime';

import { FriendsScreen } from '../FriendsScreen';
import { GroupScreen } from '../GroupScreen';
import { InboxScreen } from '../InboxScreen';
import { FriendInviteScreen } from '../InviteScreens';
import { SessionScreen } from '../SessionScreen';
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
const GROUP = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
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

afterEach(() => resetSessionRuntimeForTests());

const group = { id: GROUP, name: 'Fenway Striders', role: 'owner', member_count: 2, invite_code: 'K7M2P9QX', created_at: TS };

describe('FriendsScreen', () => {
  beforeEach(() => {
    mockSupabase.onRpc('list_friends', () => ({
      data: [
        { user_id: BO, nickname: 'bo', color: 1, status: 'friends', since: TS, week_run_m: 22852 },
        { user_id: '55555555-5555-4555-8555-555555555555', nickname: 'cy', color: 3, status: 'incoming', since: TS, week_run_m: null },
      ],
    }));
    mockSupabase.onRpc('list_my_groups', () => ({ data: [group] }));
  });

  it('shows my code, requests, friends with weekly distance, and groups', async () => {
    await withScreen(<FriendsScreen />, async (r) => {
      await waitForText(r, 'ABCDEFGH', 'Requests', 'cy', 'bo', '14.20 mi', 'Fenway Striders', '2 members · owner');
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

describe('GroupScreen', () => {
  it('shows the group board, sessions and members, and creates a session', async () => {
    mockSupabase.onRpc('list_my_groups', () => ({ data: [group] }));
    mockSupabase.onRpc('get_group_members', () => ({
      data: [
        { user_id: ME, nickname: 'Ana', color: 2, role: 'owner', joined_at: TS },
        { user_id: BO, nickname: 'bo', color: 1, role: 'member', joined_at: TS },
      ],
    }));
    mockSupabase.onRpc('get_leaderboard', (a) => ({
      data: [
        { rank: 1, user_id: BO, nickname: 'bo', color: 1, value: a.p_board === 'run_distance' ? 8046.72 : 250_000, activity_id: null, achieved_on: '2026-10-20', is_me: false },
        { rank: 2, user_id: ME, nickname: 'Ana', color: 2, value: 3218.69, activity_id: null, achieved_on: '2026-10-20', is_me: true },
      ],
    }));
    mockSupabase.setTable('group_sessions', [
      { id: SESSION, group_id: GROUP, title: 'Saturday long run', kind: 'run', status: 'live', created_by: ME, starts_at: null, started_at: TS, ended_at: null },
    ]);
    mockSupabase.onRpc('create_group_session', () => ({ data: SESSION }));
    await withScreen(<GroupScreen groupId={GROUP} />, async (r) => {
      await waitForText(r, 'Fenway Striders', 'K7M2P9QX', '1. bo', '5.00 mi', '2. Ana (you)', 'Saturday long run', 'Live now', 'Remove');
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('get_leaderboard', expect.objectContaining({ p_scope: 'group', p_group_id: GROUP, p_board: 'run_distance' }));

      act(() => r.root.findByProps({ testID: 'group-board-run_1k' }).props.onPress());
      await waitForText(r, '4:10');

      const title = r.root.findByProps({ testID: 'group-session-title' }).findByType(TextInput);
      await act(async () => title.props.onChangeText('Tuesday tempo'));
      await act(async () => r.root.findByProps({ testID: 'group-session-create' }).props.onPress());
      await waitUntil(() => (router.push as jest.Mock).mock.calls.length > 0);
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('create_group_session', { p_group: GROUP, p_title: 'Tuesday tempo', p_kind: 'run', p_starts_at: null });
      expect(router.push).toHaveBeenCalledWith(`/session/${SESSION}`);
    });
  });

  it('says so when I am not in the group', async () => {
    mockSupabase.onRpc('list_my_groups', () => ({ data: [] }));
    mockSupabase.rpcError('get_group_members', 'not_member');
    mockSupabase.onRpc('get_leaderboard', () => ({ data: [] }));
    await withScreen(<GroupScreen groupId={GROUP} />, async (r) => {
      await waitForText(r, 'You’re not in this group');
    });
  });
});

describe('SessionScreen', () => {
  const sessionRow = (status: string, participants: { user_id: string; nickname: string }[], createdBy = BO) => ({
    id: SESSION,
    group_id: GROUP,
    title: 'Saturday long run',
    kind: 'run',
    status,
    created_by: createdBy,
    starts_at: null,
    started_at: status === 'open' ? null : TS,
    ended_at: status === 'ended' ? TS : null,
    participants: participants.map((p) => ({ ...p, color: 1, joined_at: TS })),
  });

  beforeEach(() => {
    mockSupabase.onRpc('list_my_groups', () => ({ data: [{ ...group, role: 'member' }] }));
    mockSupabase.onRpc('get_session_results', () => ({ data: [] }));
  });

  it('lobby: join, then wait for the start', async () => {
    let joined = false;
    mockSupabase.onRpc('get_group_session', () => ({
      data: sessionRow('open', joined ? [{ user_id: BO, nickname: 'bo' }, { user_id: ME, nickname: 'Ana' }] : [{ user_id: BO, nickname: 'bo' }]),
    }));
    mockSupabase.onRpc('join_group_session', () => {
      joined = true;
      return { data: null };
    });
    await withScreen(<SessionScreen sessionId={SESSION} />, async (r) => {
      await waitForText(r, 'Saturday long run', 'Lobby', 'Join session', 'bo');
      expect(textOf(r)).not.toContain('Start session'); // not the creator or owner
      await act(async () => r.root.findByProps({ testID: 'session-join' }).props.onPress());
      await waitForText(r, 'You’re in', 'Ana (you)');
      expect(mockSupabase.channels.some((c) => c.topic === `session:${SESSION}`)).toBe(true);
    });
  });

  it('live: a participant gets Start recording, which opens the recorder for this session', async () => {
    mockSupabase.onRpc('get_group_session', () => ({ data: sessionRow('live', [{ user_id: ME, nickname: 'Ana' }]) }));
    await withScreen(<SessionScreen sessionId={SESSION} />, async (r) => {
      await waitForText(r, 'Live now', 'Start recording');
      act(() => r.root.findByProps({ testID: 'session-start-recording' }).props.onPress());
      expect(router.push).toHaveBeenCalledWith(`/record?kind=run&sessionId=${SESSION}`);
    });
  });

  it('creator can start the session and it broadcasts the status', async () => {
    let status = 'open';
    mockSupabase.onRpc('get_group_session', () => ({ data: sessionRow(status, [{ user_id: ME, nickname: 'Ana' }], ME) }));
    mockSupabase.onRpc('set_group_session_status', (a) => {
      status = String(a.p_status);
      return { data: null };
    });
    await withScreen(<SessionScreen sessionId={SESSION} />, async (r) => {
      await waitForText(r, 'Start session');
      await act(async () => r.root.findByProps({ testID: 'session-go-live' }).props.onPress());
      await waitForText(r, 'Live now', 'End session');
      const ch = mockSupabase.channels.find((c) => c.topic === `session:${SESSION}`)!;
      expect(ch.sent).toContainEqual({ type: 'broadcast', event: 'status', payload: { status: 'live' } });
    });
  });

  it('ended: shows results with times', async () => {
    mockSupabase.onRpc('get_group_session', () => ({ data: sessionRow('ended', [{ user_id: ME, nickname: 'Ana' }, { user_id: BO, nickname: 'bo' }]) }));
    mockSupabase.onRpc('get_session_results', () => ({
      data: [
        { user_id: ME, nickname: 'Ana', color: 2, activity_status: 'valid', distance_m: 5000, moving_ms: 1_500_000, elapsed_ms: 1_560_000, best_1k_ms: 290_000, best_5k_ms: 1_500_000 },
        { user_id: BO, nickname: 'bo', color: 1, activity_status: null, distance_m: null, moving_ms: null, elapsed_ms: null, best_1k_ms: null, best_5k_ms: null },
      ],
    }));
    await withScreen(<SessionScreen sessionId={SESSION} />, async (r) => {
      await waitForText(r, 'Ended', 'Results', 'Ana (you)', '3.11 mi', 'Moving 25:00 · 1K 4:50 · 5K 25:00', 'No activity yet');
      expect(textOf(r)).not.toContain('Start recording');
    });
  });
});

describe('InboxScreen', () => {
  it('lists items with their copy, marks unread ones read, and routes taps', async () => {
    const unread = '66666666-6666-4666-8666-666666666666';
    mockSupabase.setTable('notifications', [
      { id: unread, kind: 'overtake', created_at: TS, read_at: null, payload: { actor_nickname: 'bo', their_m: 22852, your_m: 22370 } },
      { id: '77777777-7777-4777-8777-777777777777', kind: 'session_live', created_at: TS, read_at: TS, payload: { session_id: SESSION, title: 'Long run', group_name: 'Striders' } },
    ]);
    mockSupabase.onRpc('mark_notifications_read', () => ({ data: null }));
    await withScreen(<InboxScreen />, async (r) => {
      await waitForText(r, 'bo passed you this week · 14.2 mi vs your 13.9 mi', 'Striders: Long run is starting');
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
