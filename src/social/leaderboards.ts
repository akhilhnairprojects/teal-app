/**
 * Leaderboards, featured runs and champions (spec §2.6). Boards are signed-in only (decision O6);
 * rows carry an ET date, never a time of day.
 */
import { periodStart, type PeriodKind } from '@/activity/periods';
import type { LatLng } from '@/activity/types';
import { fail, ok, type Result } from '@/backend/errors';
import { bool, int, isObj, isoDay, listOf, nullable, numeric, oneOf, str, uuid } from '@/backend/parse';
import { rpc } from '@/backend/rpc';
import { decodePolyline } from '@/lib/polyline';

export type BoardId = 'run_1k' | 'run_5k' | 'run_10k' | 'run_distance' | 'bike_distance';

export const BOARD_META: Record<BoardId, { label: string; unit: 'duration' | 'distance'; order: 'asc' | 'desc' }> = {
  run_1k: { label: 'Fastest 1K', unit: 'duration', order: 'asc' },
  run_5k: { label: 'Fastest 5K', unit: 'duration', order: 'asc' },
  run_10k: { label: 'Fastest 10K', unit: 'duration', order: 'asc' },
  run_distance: { label: 'Running distance', unit: 'distance', order: 'desc' },
  bike_distance: { label: 'Bluebike distance', unit: 'distance', order: 'desc' },
};

export const BOARD_IDS = Object.keys(BOARD_META) as BoardId[];

export type BoardScope = { kind: 'global' } | { kind: 'friends' } | { kind: 'group'; groupId: string };

export type LeaderboardRow = {
  rank: number;
  userId: string;
  nickname: string;
  color: number;
  value: number;
  activityId: string | null;
  achievedOn: string | null;
  isMe: boolean;
};

export type Leaderboard = {
  board: BoardId;
  period: PeriodKind;
  periodStart: string;
  scope: BoardScope;
  /** Ranked rows within the limit (ties may add a few). */
  rows: LeaderboardRow[];
  /** The caller's row, whether inside `rows` or appended by the server from outside the limit. */
  me: LeaderboardRow | null;
  fetchedAt: number;
};

const boardOf = oneOf<BoardId>(BOARD_IDS);

export function parseLeaderboardRow(v: unknown): LeaderboardRow | null {
  if (!isObj(v)) return null;
  const rank = int(v.rank);
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const value = numeric(v.value);
  const activityId = nullable(v.activity_id, uuid);
  const achievedOn = nullable(v.achieved_on, isoDay);
  const isMe = bool(v.is_me);
  if (rank === null || !userId || !nickname || color === null || value === null) return null;
  if (activityId === undefined || achievedOn === undefined || isMe === null) return null;
  return { rank, userId, nickname, color, value, activityId, achievedOn, isMe };
}

export const DEFAULT_BOARD_LIMIT = 50;

export async function fetchLeaderboard(q: {
  board: BoardId;
  period: PeriodKind;
  periodStart?: string;
  scope: BoardScope;
  limit?: number;
}): Promise<Result<Leaderboard>> {
  const start = q.periodStart ?? periodStart(q.period, Date.now());
  const limit = q.limit ?? DEFAULT_BOARD_LIMIT;
  const r = await rpc('get_leaderboard', {
    p_board: q.board,
    p_period: q.period,
    p_period_start: start,
    p_scope: q.scope.kind,
    p_group_id: q.scope.kind === 'group' ? q.scope.groupId : null,
    p_limit: limit,
  });
  if (!r.ok) return r;
  const all = listOf(r.value, parseLeaderboardRow);
  if (!all) return fail('unknown');
  const me = all.find((row) => row.isMe) ?? null;
  const rows = all.filter((row) => row.rank <= limit);
  return ok({ board: q.board, period: q.period, periodStart: start, scope: q.scope, rows, me, fetchedAt: Date.now() });
}

export type FeaturedRun = {
  activityId: string;
  nickname: string;
  color: number;
  effortM: 1000 | 5000 | 10000;
  durationMs: number;
  totalM: number;
  achievedOn: string;
  route: LatLng[] | null;
};

export function parseFeaturedRun(v: unknown): FeaturedRun | null {
  if (!isObj(v)) return null;
  const activityId = uuid(v.activity_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const effortM = int(v.effort_m);
  const durationMs = int(v.duration_ms);
  const totalM = numeric(v.total_m);
  const achievedOn = isoDay(v.achieved_on);
  const polyline = nullable(v.route_polyline, str);
  if (!activityId || !nickname || color === null || (effortM !== 1000 && effortM !== 5000 && effortM !== 10000)) return null;
  if (durationMs === null || totalM === null || !achievedOn || polyline === undefined) return null;
  const route = polyline ? decodePolyline(polyline, 5) : null;
  return { activityId, nickname, color, effortM, durationMs, totalM, achievedOn, route: route && route.length >= 2 ? route : null };
}

export async function fetchFeaturedRuns(period: PeriodKind, start?: string): Promise<Result<FeaturedRun[]>> {
  const r = await rpc('get_featured_runs', { p_period: period, p_period_start: start ?? periodStart(period, Date.now()), p_limit: 10 });
  if (!r.ok) return r;
  const runs = listOf(r.value, parseFeaturedRun);
  return runs ? ok(runs) : fail('unknown');
}

export type Champion = { board: BoardId; rank: number; userId: string; nickname: string; color: number; value: number };

export function parseChampion(v: unknown): Champion | null {
  if (!isObj(v)) return null;
  const board = boardOf(v.board);
  const rank = int(v.rank);
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const value = numeric(v.value);
  if (!board || rank === null || !userId || !nickname || color === null || value === null) return null;
  return { board, rank, userId, nickname, color, value };
}

/** Top 10 per board of a closed period (archived 3 h after it ends). */
export async function fetchChampions(period: PeriodKind, start: string): Promise<Result<Champion[]>> {
  const r = await rpc('get_champions', { p_period: period, p_period_start: start });
  if (!r.ok) return r;
  const rows = listOf(r.value, parseChampion);
  return rows ? ok(rows) : fail('unknown');
}
