import { act, type ReactTestRenderer } from 'react-test-renderer';

import { periodStart, shiftPeriod } from '@/activity/periods';
import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';
import { textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';

import { LeaderboardsScreen, resetLeaderboardCachesForTests, type LeaderboardsScreenParams } from '../LeaderboardsScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), dismissAll: jest.fn(), canDismiss: jest.fn(() => false) },
    usePathname: () => '/leaderboards',
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
    Redirect: ({ href }: { href: string }) => <RNText>{`redirect:${href}`}</RNText>,
  };
});

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const ME = '11111111-1111-4111-8111-111111111111';
const YOU = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const RUN_SHARED = '44444444-4444-4444-8444-444444444444';
const RUN_PRIVATE = '55555555-5555-4555-8555-555555555555';

const mockAuthState: { current: Record<string, unknown> } = { current: { status: 'signedOut' } };
jest.mock('@/backend/auth', () => ({
  useAuth: () => mockAuthState.current,
  getAuthState: () => mockAuthState.current,
  subscribeAuth: () => () => {},
}));

const row = (rank: number, userId: string, nickname: string, value: number, isMe = false) => ({
  rank,
  user_id: userId,
  nickname,
  color: 2,
  value,
  activity_id: null,
  achieved_on: '2026-10-19',
  is_me: isMe,
});

const PARAMS: LeaderboardsScreenParams = { board: null, period: null, scope: null, groupId: null };

const rpcCalls = (fn: string) => mockSupabase.raw.rpc.mock.calls.filter(([name]) => name === fn);

const press = (r: ReactTestRenderer, testID: string) =>
  act(async () => {
    await r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0].props.onPress();
  });

beforeEach(() => {
  mockSupabase.reset();
  mockSupabase.setSession(mockSession(ME));
  mockAuthState.current = { status: 'signedIn', userId: ME, profile: { nickname: 'Ana' } };
  resetLeaderboardCachesForTests();
  resetMapOverlays();
  mockSupabase.onRpc('list_my_groups', () => ({
    data: [{ id: GROUP, name: 'Tuesday crew', role: 'member', member_count: 4, invite_code: 'ABCDEFGH', created_at: '2026-10-01T12:00:00+00:00' }],
  }));
  mockSupabase.onRpc('get_leaderboard', (args) =>
    args.p_board === 'run_5k'
      ? { data: [row(1, YOU, 'Bo', 1_200_000)] }
      : { data: [row(1, YOU, 'Bo', 20_000), row(2, YOU, 'Cy', 15_000), row(57, ME, 'Ana', 1609.344, true)] },
  );
  mockSupabase.onRpc('get_featured_runs', () => ({
    data: [
      { activity_id: RUN_SHARED, nickname: 'Bo', color: 1, effort_m: 5000, duration_ms: 1_200_000, total_m: 8046.72, achieved_on: '2026-10-19', route_polyline: '_p~iF~ps|U_ulLnnqC' },
      { activity_id: RUN_PRIVATE, nickname: 'Cy', color: 3, effort_m: 1000, duration_ms: 230_000, total_m: 3000, achieved_on: '2026-10-20', route_polyline: null },
    ],
  }));
  mockSupabase.onRpc('get_champions', () => ({
    data: [
      { board: 'run_distance', rank: 1, user_id: YOU, nickname: 'Dee', color: 4, value: 40_000 },
      { board: 'run_5k', rank: 1, user_id: YOU, nickname: 'Eve', color: 5, value: 1_100_000 },
    ],
  }));
});

describe('LeaderboardsScreen', () => {
  it('is gated for signed-out users', async () => {
    mockAuthState.current = { status: 'signedOut' };
    await withScreen(<LeaderboardsScreen params={PARAMS} />, async (r) => {
      expect(textOf(r)).toContain('Sign in to see this');
      expect(mockSupabase.raw.rpc).not.toHaveBeenCalled();
    });
  });

  it('shows this week’s board with my row pinned, featured runs and last week’s champions', async () => {
    await withScreen(<LeaderboardsScreen params={PARAMS} />, async (r) => {
      await waitForText(r, 'Running distance', 'Bo', '12.43 mi', 'Ana (you)', '1.00 mi', 'Featured runs', '5K · 20:00', 'Last week’s champions', 'Dee');
      expect(textOf(r)).toContain('Resets');
      expect(textOf(r)).toContain('Tuesday crew');
      const start = periodStart('week', Date.now());
      expect(rpcCalls('get_leaderboard')[0][1]).toEqual({
        p_board: 'run_distance',
        p_period: 'week',
        p_period_start: start,
        p_scope: 'global',
        p_group_id: null,
        p_limit: 50,
      });
      expect(rpcCalls('get_champions')[0][1]).toEqual({ p_period: 'week', p_period_start: shiftPeriod('week', start, -1) });
      expect(r.root.findAllByProps({ testID: 'lb-row-me' }).length).toBeGreaterThan(0);
    });
  });

  it('draws a shared featured route and says when a route is not shared', async () => {
    await withScreen(<LeaderboardsScreen params={PARAMS} />, async (r) => {
      await waitForText(r, '5K · 20:00', '1K · 3:50');
      await press(r, `lb-featured-${RUN_SHARED}`);
      const overlay = getActiveMapOverlay();
      expect(overlay?.tracks?.[0].id).toBe(`featured:${RUN_SHARED}`);
      expect(overlay?.fitTo).toHaveLength(2);
      await press(r, `lb-featured-${RUN_PRIVATE}`);
      await waitForText(r, 'Route not shared');
      expect(getActiveMapOverlay()).toBeNull();
    });
  });

  it('switches boards and scopes without refetching a board seen in the last minute', async () => {
    await withScreen(<LeaderboardsScreen params={{ ...PARAMS, scope: 'group', groupId: GROUP }} />, async (r) => {
      await waitUntil(() => rpcCalls('get_leaderboard').length === 1);
      expect(rpcCalls('get_leaderboard')[0][1]).toMatchObject({ p_scope: 'group', p_group_id: GROUP });
      await press(r, 'lb-board-run_5k');
      await waitForText(r, 'Fastest 5K', '20:00', 'Eve');
      await press(r, 'lb-board-run_distance');
      await waitForText(r, 'Running distance', '12.43 mi');
      expect(rpcCalls('get_leaderboard')).toHaveLength(2);
      await press(r, 'lb-scope-friends');
      await waitUntil(() => rpcCalls('get_leaderboard').length === 3);
      expect(rpcCalls('get_leaderboard')[2][1]).toMatchObject({ p_scope: 'friends', p_group_id: null });
    });
  });

  it('switches to the month and shows an empty board', async () => {
    mockSupabase.onRpc('get_leaderboard', () => ({ data: [] }));
    await withScreen(<LeaderboardsScreen params={{ ...PARAMS, board: 'bike_distance' }} />, async (r) => {
      await press(r, 'lb-period-month');
      await waitForText(r, 'No Bluebike rides on this board this month yet');
      expect(rpcCalls('get_leaderboard').some(([, a]) => (a as Record<string, unknown>).p_period === 'month')).toBe(true);
      expect(textOf(r)).toMatch(/Resets (\w{3} 1|in \d+ (h|min))/);
    });
  });
});
