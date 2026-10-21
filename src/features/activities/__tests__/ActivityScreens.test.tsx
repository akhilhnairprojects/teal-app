import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, type ReactTestRenderer } from 'react-test-renderer';

import { constantRun } from '@/activity/__fixtures__/tracks';
import { computeTrackMetrics } from '@/activity/metrics';
import { getLocalActivity, resetActivityStoreForTests, saveNewActivity, type LocalActivity, type ServerActivity } from '@/activity/store';
import { resetSyncForTests } from '@/activity/sync';
import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';
import { textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';

import { ActivitiesScreen } from '../ActivitiesScreen';
import { ActivityDetailScreen } from '../ActivityDetailScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), dismissAll: jest.fn(), canDismiss: jest.fn(() => false) },
    usePathname: () => '/activities',
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const ME = '11111111-1111-4111-8111-111111111111';
const mockAuthState: { current: Record<string, unknown> } = { current: { status: 'signedOut' } };
jest.mock('@/backend/auth', () => ({
  useAuth: () => mockAuthState.current,
  getAuthState: () => mockAuthState.current,
  subscribeAuth: () => () => {},
}));

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const SERVER_B = '44444444-4444-4444-8444-444444444444';
const REMOTE = '55555555-5555-4555-8555-555555555555';
const REMOTE_CLIENT = '66666666-6666-4666-8666-666666666666';
// 4 m/s for 1 650 s: 6.6 km, so a 1K and a 5K effort and four whole mile splits.
const POINTS = constantRun().slice(0, 1651);
const METRICS = computeTrackMetrics(POINTS, 'run');
const STARTED = Date.parse('2026-10-20T11:05:00Z');

const local = (localId: string, o: Partial<LocalActivity> = {}): LocalActivity => ({
  localId,
  kind: 'run',
  startedAt: STARTED,
  endedAt: STARTED + 1_650_000,
  ownerUserId: null,
  groupSessionId: null,
  shareRoute: false,
  metrics: METRICS,
  previewPolyline: '',
  sync: { state: 'local', attempts: 0, nextAttemptAt: null, lastError: null, server: null },
  ...o,
});

const serverRow = (o: Record<string, unknown> = {}) => ({
  id: REMOTE,
  client_id: REMOTE_CLIENT,
  kind: 'bike',
  status: 'valid',
  flags: [],
  started_at: '2026-10-18T12:00:00+00:00',
  ended_at: '2026-10-18T12:30:00+00:00',
  week_start: '2026-10-12',
  month_start: '2026-10-01',
  distance_m: 8000,
  excluded_m: 0,
  elapsed_ms: 1_800_000,
  moving_ms: 1_700_000,
  is_loop: false,
  leaderboard_eligible: true,
  share_route: false,
  group_session_id: null,
  efforts: [],
  ...o,
});

const flaggedServer: ServerActivity = {
  id: SERVER_B,
  clientId: B,
  kind: 'run',
  status: 'flagged',
  flags: ['vehicle'],
  startedAt: '2026-10-19T12:00:00.000Z',
  endedAt: '2026-10-19T12:30:00.000Z',
  weekStart: '2026-10-19',
  monthStart: '2026-10-01',
  distanceM: 6000,
  excludedM: 3000,
  elapsedMs: 1_800_000,
  movingMs: 1_500_000,
  isLoop: false,
  leaderboardEligible: false,
  shareRoute: false,
  groupSessionId: null,
  efforts: [],
};

const { router } = jest.requireMock('expo-router') as { router: Record<string, jest.Mock> };

const press = (r: ReactTestRenderer, testID: string) =>
  act(async () => {
    await r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0].props.onPress();
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  resetActivityStoreForTests();
  resetSyncForTests();
  resetMapOverlays();
  mockSupabase.reset();
  mockAuthState.current = { status: 'signedOut' };
  router.push.mockClear();
  router.back.mockClear();
});

describe('ActivitiesScreen', () => {
  it('merges local and server activities with sync chips', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: { nickname: 'Ana' } };
    mockSupabase.setSession(mockSession(ME));
    mockSupabase.onRpc('list_my_activities', () => ({ data: [serverRow()] }));
    await saveNewActivity(local(A, { ownerUserId: ME, sync: { state: 'pending', attempts: 1, nextAttemptAt: Date.now() + 60_000, lastError: 'offline', server: null } }), POINTS);
    await saveNewActivity(
      local(B, { ownerUserId: ME, startedAt: STARTED - 86_400_000, sync: { state: 'synced', attempts: 1, nextAttemptAt: null, lastError: null, server: flaggedServer } }),
      POINTS,
    );
    await withScreen(<ActivitiesScreen />, async (r) => {
      await waitForText(r, 'Waiting to sync', 'Not counted: part of it looked like a vehicle', 'Bluebike ride · 4.97 mi', 'Synced');
      expect(textOf(r)).toContain('1 waiting to sync');
      expect(textOf(r)).toContain('Run · 4.10 mi');
      await press(r, `activity-row-${REMOTE}`);
      expect(router.push).toHaveBeenCalledWith(`/activity/${REMOTE}`);
    });
  });

  it('offers sign-in and recording when signed out and empty', async () => {
    await withScreen(<ActivitiesScreen />, async (r) => {
      await waitForText(r, 'No activities yet', 'Sign in to upload them');
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('list_my_activities', expect.anything());
    });
  });
});

describe('ActivityDetailScreen', () => {
  it('shows stats, efforts, mile splits and the track from local points', async () => {
    await saveNewActivity(local(A), POINTS);
    await withScreen(<ActivityDetailScreen id={A} />, async (r) => {
      await waitForText(r, 'Saved on this phone', 'Best efforts', '1K', '4:10', '5K', '20:50', 'Splits per mile', '6:42 /mi');
      expect(textOf(r)).toContain('Numbers are from this phone');
      const overlay = getActiveMapOverlay();
      expect(overlay?.tracks?.[0].coordinates.length).toBeLessThanOrEqual(500);
      expect(overlay?.fitTo).toBe(overlay?.tracks?.[0].coordinates);
    });
  });

  it('confirms before sharing an unsynced route and stores the choice for upload', async () => {
    await saveNewActivity(local(A), POINTS);
    await withScreen(<ActivityDetailScreen id={A} />, async (r) => {
      await waitForText(r, 'Show route on featured runs');
      const toggle = () => r.root.findAll((n) => n.props.testID === 'activity-share-toggle' && typeof n.props.onValueChange === 'function')[0];
      act(() => toggle().props.onValueChange(true));
      await waitForText(r, 'Show this route on featured runs?', 'general area');
      expect((await getLocalActivity(A))?.shareRoute).toBe(false);
      await press(r, 'activity-share-yes');
      await waitUntil(() => toggle().props.value === true, () => textOf(r));
      expect((await getLocalActivity(A))?.shareRoute).toBe(true);
    });
  });

  it('shares a synced route through the server and shows a territory claim', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: { nickname: 'Ana' } };
    const synced: ServerActivity = { ...flaggedServer, id: SERVER_B, clientId: A, status: 'valid', flags: [], leaderboardEligible: true, isLoop: true };
    await saveNewActivity(local(A, { ownerUserId: ME, sync: { state: 'synced', attempts: 1, nextAttemptAt: null, lastError: null, server: synced } }), POINTS);
    mockSupabase.onRpc('get_activity_claim', () => ({ data: { cells_claimed: 12, cells_stolen: 3, area_m2: 30000 } }));
    mockSupabase.onRpc('set_activity_sharing', () => ({ data: { ...serverRow({ id: SERVER_B, client_id: A, kind: 'run', share_route: true }) } }));
    await withScreen(<ActivityDetailScreen id={A} />, async (r) => {
      await waitForText(r, 'Synced', 'Territory: claimed 12 squares (3 taken from others)');
      act(() => r.root.findAll((n) => n.props.testID === 'activity-share-toggle' && typeof n.props.onValueChange === 'function')[0].props.onValueChange(true));
      await press(r, 'activity-share-yes');
      await waitUntil(() => mockSupabase.raw.rpc.mock.calls.some(([fn]) => fn === 'set_activity_sharing'));
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('set_activity_sharing', { p_activity: SERVER_B, p_share: true });
    });
  });

  it('falls back to the stored trace for a remote activity and deletes after confirming', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: { nickname: 'Ana' } };
    mockSupabase.onRpc('list_my_activities', () => ({ data: [serverRow()] }));
    mockSupabase.onRpc('get_my_activity_track', () => ({ data: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }));
    mockSupabase.onRpc('delete_activity', () => ({ data: null }));
    await withScreen(<ActivityDetailScreen id={REMOTE} />, async (r) => {
      await waitForText(r, 'Bluebike ride', 'Synced', 'Avg speed');
      await waitUntil(() => (getActiveMapOverlay()?.tracks?.[0].coordinates.length ?? 0) === 3);
      await press(r, 'activity-delete');
      await waitForText(r, 'and from Teal');
      await press(r, 'activity-delete-yes');
      await waitUntil(() => router.back.mock.calls.length > 0);
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('delete_activity', { p_activity: REMOTE });
    });
  });

  it('says when an activity is gone', async () => {
    await withScreen(<ActivityDetailScreen id={A} />, async (r) => {
      await waitForText(r, 'Activity not found');
    });
  });
});
