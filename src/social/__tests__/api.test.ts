/** API wrappers send the server's argument names and map results/errors (no network: mock client). */
import { mockSession, mockSupabase } from '@/backend/testing/mockSupabase';
import {
  fetchActivityClaim,
  fetchTerritory,
  fetchTerritoryChampions,
  fetchTerritoryStandings,
  TERRITORY_MAX_CELLS,
  TERRITORY_PAGE_SIZE,
} from '@/territory/api';

import { friendInviteLink, listFriends, rotateInviteCode, sendFriendRequest } from '../friends';
import { fetchInbox, markInboxRead, subscribeInboxInserts } from '../inbox';
import { fetchLeaderboard } from '../leaderboards';

jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
jest.mock('expo-linking', () => ({ createURL: (p: string) => `teal://${p}` }));
const mockAuth: { current: { status: string; userId?: string } } = { current: { status: 'signedIn' } };
jest.mock('@/backend/auth', () => ({ getAuthState: () => mockAuth.current }));

const ME = '11111111-1111-4111-8111-111111111111';
const YOU = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';
const TS = '2026-10-20T14:00:00+00:00';

const row = (rank: number, userId: string, isMe: boolean) => ({
  rank,
  user_id: userId,
  nickname: isMe ? 'me' : 'you',
  color: 1,
  value: 250_000 + rank,
  activity_id: null,
  achieved_on: '2026-10-20',
  is_me: isMe,
});

beforeEach(() => {
  mockSupabase.reset();
  mockSupabase.setSession(mockSession(ME));
  mockAuth.current = { status: 'signedIn', userId: ME };
});

describe('leaderboards', () => {
  it('asks for a scoped board and separates my appended row', async () => {
    mockSupabase.onRpc('get_leaderboard', () => ({ data: [row(1, YOU, false), row(2, YOU, false), row(57, ME, true)] }));
    const r = await fetchLeaderboard({ board: 'run_5k', period: 'week', periodStart: '2026-10-19', scope: { kind: 'friends' }, limit: 2 });
    expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('get_leaderboard', {
      p_board: 'run_5k',
      p_period: 'week',
      p_period_start: '2026-10-19',
      p_scope: 'friends',
      p_group_id: null,
      p_limit: 2,
    });
    expect(r.ok && r.value.rows.map((x) => x.rank)).toEqual([1, 2]);
    expect(r.ok && r.value.me?.rank).toBe(57);
  });

});

describe('friends', () => {
  it('sends requests by code or nickname', async () => {
    mockSupabase.onRpc('send_friend_request', (a) => ({ data: a.p_code ? 'accepted' : 'requested' }));
    expect(await sendFriendRequest({ code: ' abcdefgh ' })).toEqual({ ok: true, value: 'accepted' });
    expect(mockSupabase.raw.rpc).toHaveBeenLastCalledWith('send_friend_request', { p_code: 'ABCDEFGH' });
    expect(await sendFriendRequest({ nickname: ' Ana ' })).toEqual({ ok: true, value: 'requested' });
    expect(mockSupabase.raw.rpc).toHaveBeenLastCalledWith('send_friend_request', { p_nickname: 'Ana' });
    mockSupabase.rpcError('send_friend_request', 'not_found');
    const r = await sendFriendRequest({ nickname: 'ghost' });
    expect(!r.ok && r.error.code).toBe('not_found');
    // The server returns a miss as a value so its rate event commits (review S2).
    mockSupabase.onRpc('send_friend_request', () => ({ data: 'not_found' }));
    const miss = await sendFriendRequest({ code: 'ZZZZZZZZ' });
    expect(!miss.ok && miss.error.code).toBe('not_found');
  });

  it('lists friends, rotates codes, builds links', async () => {
    mockSupabase.onRpc('list_friends', () => ({ data: [{ user_id: YOU, nickname: 'you', color: 2, status: 'incoming', since: TS, week_run_m: null }] }));
    expect((await listFriends()).ok).toBe(true);
    mockSupabase.onRpc('rotate_invite_code', () => ({ data: 'K7M2P9QX' }));
    expect(await rotateInviteCode()).toEqual({ ok: true, value: 'K7M2P9QX' });
    expect(friendInviteLink('K7M2P9QX')).toBe('teal://friend/K7M2P9QX');
  });

});

describe('inbox', () => {
  it('reads my notifications newest first and marks them read', async () => {
    mockSupabase.setTable('notifications', [
      { id: GROUP, kind: 'friend_request', created_at: TS, read_at: null, payload: { actor_nickname: 'you' } },
      { id: 'bad', kind: 'friend_request' },
    ]);
    const r = await fetchInbox(20);
    expect(r.ok && r.value.map((i) => i.actorNickname)).toEqual(['you']);
    mockSupabase.onRpc('mark_notifications_read', () => ({ data: null }));
    await markInboxRead([GROUP]);
    expect(mockSupabase.raw.rpc).toHaveBeenLastCalledWith('mark_notifications_read', { p_ids: [GROUP] });
    expect(await markInboxRead([])).toEqual({ ok: true, value: undefined });
  });

  it('subscribes to inserts for my rows', () => {
    const got: string[] = [];
    const off = subscribeInboxInserts((i) => got.push(i.id));
    const ch = mockSupabase.channels[0];
    expect(ch.handlers[0].filter).toMatchObject({ event: 'INSERT', table: 'notifications', filter: `recipient_id=eq.${ME}` });
    ch.emit('postgres_changes', 'INSERT', { new: { id: GROUP, kind: 'overtake', created_at: TS, read_at: null, payload: {} } });
    expect(got).toEqual([GROUP]);
    off();
  });
});

describe('territory', () => {
  const BOX = { south: 42.35, west: -71.07, north: 42.36, east: -71.05 };
  const cell = (id: number) => ({ cell_id: id, owner_id: YOU, nickname: 'you', color: 3 });
  /** A server with `total` cells (ids 7000000…) that pages by cursor like get_territory. */
  const pagedServer = (total: number) => (a: Record<string, unknown>) => {
    const after = (a.p_after as number | null) ?? -1;
    const first = Math.max(7_000_000, after + 1);
    const n = Math.max(0, Math.min(a.p_limit as number, 7_000_000 + total - first));
    return { data: Array.from({ length: n }, (_, k) => cell(first + k)) };
  };
  const territoryCalls = () => mockSupabase.raw.rpc.mock.calls.filter(([fn]) => fn === 'get_territory');

  it('fetches cells for a box and a month in one short page', async () => {
    mockSupabase.onRpc('get_territory', () => ({ data: [cell(7290791)] }));
    const r = await fetchTerritory(BOX, '2026-10-01');
    expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('get_territory', {
      p_south: 42.35,
      p_west: -71.07,
      p_north: 42.36,
      p_east: -71.05,
      p_month: '2026-10-01',
      p_after: null,
      p_limit: TERRITORY_PAGE_SIZE,
    });
    expect(r).toEqual({ ok: true, value: { month: '2026-10-01', cells: [{ cellId: 7290791, ownerId: YOU, nickname: 'you', color: 3 }], truncated: false } });
  });

  it('pages past the API row cap by cursor, so no cell is dropped (review S1)', async () => {
    mockSupabase.onRpc('get_territory', pagedServer(2500));
    const r = await fetchTerritory(BOX, '2026-10-01');
    expect(r.ok && r.value.cells.length).toBe(2500);
    expect(r.ok && r.value.truncated).toBe(false);
    expect(territoryCalls().map(([, a]) => a?.p_after)).toEqual([null, 7_000_999, 7_001_999]);
    // Exactly one full page: one more (empty) request confirms the end.
    mockSupabase.raw.rpc.mockClear();
    mockSupabase.onRpc('get_territory', pagedServer(1000));
    const one = await fetchTerritory(BOX, '2026-10-01');
    expect(one.ok && [one.value.cells.length, one.value.truncated]).toEqual([1000, false]);
    expect(territoryCalls()).toHaveLength(2);
  });

  it('stops at the cell cap and reports truncation; a failed page fails the fetch', async () => {
    mockSupabase.onRpc('get_territory', pagedServer(50_000));
    const r = await fetchTerritory(BOX, '2026-10-01');
    expect(r.ok && r.value.cells.length).toBe(TERRITORY_MAX_CELLS);
    expect(r.ok && r.value.truncated).toBe(true);
    expect(territoryCalls()).toHaveLength(TERRITORY_MAX_CELLS / TERRITORY_PAGE_SIZE);

    let n = 0;
    mockSupabase.onRpc('get_territory', (a) => (++n === 2 ? { error: { code: 'P0001', message: 'not_authenticated' } } : pagedServer(5000)(a)));
    const failed = await fetchTerritory(BOX, '2026-10-01');
    expect(failed.ok).toBe(false);
  });

  it('pages at the server page cap (get_territory limits a page to 1000 rows)', () => {
    const fs = jest.requireActual<{ readFileSync(p: string, enc: 'utf8'): string }>('fs');
    const path = jest.requireActual<{ join(...p: string[]): string; dirname(p: string): string }>('path');
    const here = path.dirname(expect.getState().testPath!);
    const sql = fs.readFileSync(path.join(here, '../../../supabase/migrations/20261021000900_review_fixes.sql'), 'utf8');
    const cap = /v_limit int := least\(greatest\(coalesce\(p_limit, (\d+)\), 1\), (\d+)\);/.exec(sql);
    expect(cap).not.toBeNull();
    expect(Number(cap![1])).toBe(TERRITORY_PAGE_SIZE);
    expect(Number(cap![2])).toBe(TERRITORY_PAGE_SIZE);
  });

  it('reads standings, champions and claims', async () => {
    mockSupabase.onRpc('get_territory_standings', () => ({ data: [{ rank: 1, user_id: ME, nickname: 'me', color: 1, cells: 30, is_me: true }] }));
    expect((await fetchTerritoryStandings('2026-10-01')).ok).toBe(true);
    mockSupabase.setTable('territory_champions', [{ rank: 1, user_id: ME, cells: 99, profiles: { nickname: 'me', color: 1 } }]);
    expect(await fetchTerritoryChampions('2026-09-01')).toEqual({
      ok: true,
      value: [{ rank: 1, userId: ME, nickname: 'me', color: 1, cells: 99, isMe: true }],
    });
    mockSupabase.onRpc('get_activity_claim', () => ({ data: null }));
    expect(await fetchActivityClaim(GROUP)).toEqual({ ok: true, value: null });
    mockSupabase.onRpc('get_activity_claim', () => ({ data: { cells_claimed: 12, cells_stolen: 3, area_m2: 45000, month_start: '2026-10-01' } }));
    expect(await fetchActivityClaim(GROUP)).toEqual({ ok: true, value: { cellsClaimed: 12, cellsStolen: 3, areaM2: 45000 } });
  });
});
