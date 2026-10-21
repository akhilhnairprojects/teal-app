/** Every API parser keeps good rows and drops malformed ones instead of casting them (spec §4). */
import { parseServerActivity } from '@/activity/store';
import { parseMyProfile } from '@/backend/auth';
import { listOf, nullable, numeric, uuid } from '@/backend/parse';
import { parseFriend, parseInviteInput } from '@/social/friends';
import { parseGroup, parseGroupMember } from '@/social/groups';
import { parseInboxItem } from '@/social/inbox';
import { parseChampion, parseFeaturedRun, parseLeaderboardRow } from '@/social/leaderboards';
import { parseGroupSession, parseLiveProgress, parseSessionResult, presenceUserIds } from '@/social/sessions';
import { parseTerritoryCell, parseTerritoryStanding } from '@/territory/api';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('expo-linking', () => ({ createURL: (p: string) => `teal://${p}` }));

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const TS = '2026-10-20T14:00:00+00:00';

describe('parse helpers', () => {
  it('normalises uuids, numeric strings and nullable fields', () => {
    expect(uuid(U1.toUpperCase())).toBe(U1);
    expect(uuid('not-a-uuid')).toBeNull();
    expect(numeric('12345')).toBe(12345);
    expect(numeric('x')).toBeNull();
    expect(nullable(null, uuid)).toBeNull();
    expect(nullable('bad', uuid)).toBeUndefined();
    expect(listOf('nope', uuid)).toBeNull();
  });
});

describe('API parsers drop malformed rows', () => {
  it('leaderboard rows', () => {
    const good = { rank: 1, user_id: U1, nickname: 'ana', color: 3, value: 250000, activity_id: U2, achieved_on: '2026-10-20', is_me: true };
    const rows = listOf(
      [good, { ...good, rank: 'one' }, { ...good, achieved_on: '10/20/2026' }, { ...good, value: '1500' }, null, 5],
      parseLeaderboardRow,
    );
    expect(rows).toHaveLength(2);
    expect(rows![1].value).toBe(1500);
  });

  it('featured runs, champions', () => {
    const run = { activity_id: U1, nickname: 'ana', color: 1, effort_m: 5000, duration_ms: 1_250_000, total_m: 5200.5, achieved_on: '2026-10-20', route_polyline: null };
    expect(listOf([run, { ...run, effort_m: 3000 }, { ...run, route_polyline: 7 }], parseFeaturedRun)).toEqual([{ ...omitWire(run), route: null }]);
    const champ = { board: 'run_5k', rank: 1, user_id: U1, nickname: 'ana', color: 1, value: 1_250_000 };
    expect(listOf([champ, { ...champ, board: 'walk' }], parseChampion)).toHaveLength(1);
  });

  it('friends, groups, members', () => {
    const f = { user_id: U1, nickname: 'ana', color: 2, status: 'friends', since: TS, week_run_m: 4200 };
    expect(listOf([f, { ...f, status: 'enemies' }, { ...f, week_run_m: 'far' }, { ...f, week_run_m: null }], parseFriend)).toHaveLength(2);
    const g = { id: U1, name: 'Club', role: 'owner', member_count: 3, invite_code: 'ABCDEFGH', created_at: TS };
    expect(listOf([g, { ...g, member_count: null }], parseGroup)).toHaveLength(1);
    const m = { user_id: U2, nickname: 'bo', color: 0, role: 'member', joined_at: TS };
    expect(listOf([m, { ...m, role: 'admin' }], parseGroupMember)).toHaveLength(1);
  });

  it('sessions, results, live progress', () => {
    const s = {
      id: U1,
      group_id: U2,
      title: 'Sunday long run',
      kind: 'run',
      status: 'live',
      created_by: null,
      starts_at: null,
      started_at: TS,
      ended_at: null,
      created_at: TS,
      participants: [{ user_id: U1, nickname: 'ana', color: 1, joined_at: TS }, { user_id: 'x' }],
    };
    expect(parseGroupSession(s)?.participants).toHaveLength(1);
    expect(parseGroupSession({ ...s, status: 'paused' })).toBeNull();
    const r = { user_id: U1, nickname: 'ana', color: 1, activity_status: null, distance_m: null, moving_ms: null, elapsed_ms: null, best_1k_ms: null, best_5k_ms: null };
    expect(listOf([r, { ...r, distance_m: 'x' }], parseSessionResult)).toHaveLength(1);
    // Extra fields such as coordinates are dropped from progress payloads.
    expect(parseLiveProgress({ userId: U1, distanceM: 1200, elapsedMs: 300_000, state: 'recording', at: 1, lat: 42.3, lon: -71 })).toEqual({
      userId: U1,
      distanceM: 1200,
      elapsedMs: 300_000,
      state: 'recording',
      at: 1,
    });
    expect(presenceUserIds({ a: [{ userId: U2 }, { userId: 'bad' }], b: [{ userId: U1 }] })).toEqual([U1, U2]);
  });

  it('inbox items and territory rows', () => {
    const i = { id: U1, kind: 'overtake', created_at: TS, read_at: null, payload: { actor_nickname: 'ana', their_m: 22000 } };
    const items = listOf([i, { ...i, kind: 'spam' }, { ...i, payload: 'x' }], parseInboxItem);
    expect(items).toHaveLength(1);
    expect(items![0].actorNickname).toBe('ana');
    expect(listOf([{ cell_id: 7290791, owner_id: U1, nickname: 'ana', color: 1 }, { cell_id: -1, owner_id: U1, nickname: 'a', color: 1 }], parseTerritoryCell)).toHaveLength(1);
    expect(listOf([{ rank: 1, user_id: U1, nickname: 'ana', color: 1, cells: 40, is_me: false }, { rank: 1 }], parseTerritoryStanding)).toHaveLength(1);
  });

  it('profiles and server activities', () => {
    const p = {
      id: U1,
      nickname: 'ana',
      color: 4,
      created_at: TS,
      invite_code: 'ABCDEFGH',
      territory_opt_in: true,
      notify_overtake: true,
      notify_sessions: false,
      notify_friend_requests: true,
    };
    expect(parseMyProfile(p)).toMatchObject({ nickname: 'ana', territoryOptIn: true, notifySessions: false });
    expect(parseMyProfile({ ...p, color: 12 })).toBeNull();
    const a = {
      id: U1,
      client_id: U2,
      kind: 'run',
      status: 'valid',
      flags: [],
      started_at: TS,
      ended_at: TS,
      week_start: '2026-10-19',
      month_start: '2026-10-01',
      distance_m: 5000.25,
      excluded_m: 0,
      elapsed_ms: 1_500_000,
      moving_ms: 1_490_000,
      is_loop: false,
      leaderboard_eligible: true,
      share_route: false,
      group_session_id: null,
      efforts: [{ distance_m: 1000, duration_ms: 250_000, start_offset_ms: 0 }, { distance_m: 2000, duration_ms: 1, start_offset_ms: 0 }],
    };
    expect(parseServerActivity(a)?.efforts).toEqual([{ distanceM: 1000, durationMs: 250_000, startOffsetMs: 0 }]);
    expect(parseServerActivity({ ...a, kind: 'walk' })).toBeNull();
    expect(parseServerActivity({ ...a, elapsed_ms: 1.5 })).toBeNull();
  });
});

describe('parseInviteInput', () => {
  it('accepts a code, a link or a nickname, and rejects junk', () => {
    expect(parseInviteInput(' ABCDEFGH ')).toEqual({ code: 'ABCDEFGH' });
    expect(parseInviteInput('teal://friend/abcdefgh')).toEqual({ code: 'ABCDEFGH' });
    expect(parseInviteInput('exp://192.168.1.2:8081/--/friend/K7M2P9QX?x=1')).toEqual({ code: 'K7M2P9QX' });
    expect(parseInviteInput('runnerab')).toEqual({ nickname: 'runnerab' });
    expect(parseInviteInput('@ana_runs')).toEqual({ nickname: 'ana_runs' });
    expect(parseInviteInput('ABCDEFG0')).toEqual({ nickname: 'ABCDEFG0' }); // 0 isn't in the code alphabet
    expect(parseInviteInput('')).toBeNull();
    expect(parseInviteInput('hi there!')).toBeNull();
    expect(parseInviteInput('teal://friend/ABCDEFG0')).toBeNull();
  });
});

function omitWire(run: { activity_id: string; nickname: string; color: number; effort_m: number; duration_ms: number; total_m: number; achieved_on: string }) {
  return {
    activityId: run.activity_id,
    nickname: run.nickname,
    color: run.color,
    effortM: run.effort_m,
    durationMs: run.duration_ms,
    totalM: run.total_m,
    achievedOn: run.achieved_on,
  };
}
