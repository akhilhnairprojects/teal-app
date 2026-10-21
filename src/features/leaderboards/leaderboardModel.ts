/**
 * Display rules for leaderboards (spec §5 G2): value formatting per board, my row pinned below the
 * top N, reset labels, chips, featured-card text, and a 60 s refetch gate (review S4).
 */
import { formatDistanceM, formatDurationMs, type Units } from '@/activity/format';
import { periodEndMs, shiftPeriod, type PeriodKind } from '@/activity/periods';
import { BOARD_IDS, BOARD_META, type BoardId, type BoardScope, type FeaturedRun, type Leaderboard, type LeaderboardRow } from '@/social/leaderboards';

import { effortLabel, shortDay } from '@/features/activities/activityModel';

/** Durations as '22:31'; distances in the chosen units. Bike boards are distance only, never speed. */
export function formatBoardValue(board: BoardId, value: number, u: Units): string {
  return BOARD_META[board].unit === 'duration' ? formatDurationMs(value) : formatDistanceM(value, u);
}

/** Short chip labels, in board order. */
export const BOARD_CHIP_LABEL: Record<BoardId, string> = {
  run_1k: '1K',
  run_5k: '5K',
  run_10k: '10K',
  run_distance: 'Run distance',
  bike_distance: 'Bike distance',
};

export const BOARD_CHIPS: readonly { board: BoardId; label: string }[] = BOARD_IDS.map((board) => ({ board, label: BOARD_CHIP_LABEL[board] }));

/** The rows to list, and my row to pin underneath when it isn't among them. */
export function splitMyRow(lb: Pick<Leaderboard, 'rows' | 'me'>): { rows: LeaderboardRow[]; pinned: LeaderboardRow | null } {
  const me = lb.me;
  if (!me) return { rows: lb.rows, pinned: null };
  const inList = lb.rows.some((r) => r.userId === me.userId);
  return { rows: lb.rows, pinned: inList ? null : me };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR = 3_600_000;

/**
 * When the period resets: 'Resets in 3 h' / 'Resets in 25 min' inside the last day, otherwise
 * 'Resets Mon' (weeks) or 'Resets Nov 1' (months).
 */
export function resetCountdown(period: PeriodKind, start: string, now: number): string {
  const left = periodEndMs(period, start) - now;
  if (left <= 0) return 'Resetting now';
  if (left < HOUR) return `Resets in ${Math.max(1, Math.ceil(left / 60_000))} min`;
  if (left < 24 * HOUR) return `Resets in ${Math.round(left / HOUR)} h`;
  if (period === 'week') return 'Resets Mon';
  const next = shiftPeriod('month', start, 1);
  const mo = Number(next.split('-')[1]);
  return `Resets ${MON[mo - 1]} 1`;
}

/** 'Last week’s champions' / 'Last month’s champions'. */
export const championsTitle = (period: PeriodKind): string => `Last ${period}’s champions`;

/** The start of the period before this one (whose champions are archived). */
export const previousPeriodStart = (period: PeriodKind, start: string): string => shiftPeriod(period, start, -1);

export type ScopeChip = { key: string; label: string; scope: BoardScope };

/** Everyone · Friends. */
export const SCOPE_CHIPS: readonly ScopeChip[] = [
  { key: 'global', label: 'Everyone', scope: { kind: 'global' } },
  { key: 'friends', label: 'Friends', scope: { kind: 'friends' } },
];

export const scopeKey = (s: BoardScope): string => s.kind;

export function emptyBoardText(board: BoardId, period: PeriodKind): string {
  const when = period === 'week' ? 'this week' : 'this month';
  if (board === 'bike_distance') return `No Bluebike rides on this board ${when} yet. Record one to get on it.`;
  return `No runs on this board ${when} yet. Record one to get on it.`;
}

/** '5K · 22:31' and 'Ana · 3.4 mi · Oct 19' for a featured card. */
export function featuredCardText(run: FeaturedRun, u: Units): { headline: string; detail: string } {
  return {
    headline: `${effortLabel(run.effortM)} · ${formatDurationMs(run.durationMs)}`,
    detail: `${run.nickname} · ${formatDistanceM(run.totalM, u)} · ${shortDay(run.achievedOn)}`,
  };
}

export const ROUTE_NOT_SHARED = 'Route not shared';

/** Minimum time between refetches of the same query (review S4). */
export const REFETCH_MIN_MS = 60_000;

/** A per-key cache that answers only while an entry is younger than `minMs`. */
export function createTimedCache<T>(minMs = REFETCH_MIN_MS) {
  const entries = new Map<string, { at: number; value: T }>();
  return {
    fresh(key: string, now: number): T | null {
      const e = entries.get(key);
      return e && now - e.at < minMs ? e.value : null;
    },
    /** The last value even when stale (shown while refetching). */
    last(key: string): T | null {
      return entries.get(key)?.value ?? null;
    },
    set(key: string, value: T, now: number): void {
      entries.set(key, { at: now, value });
    },
    clear(): void {
      entries.clear();
    },
  };
}

export const boardQueryKey = (q: { board: BoardId; period: PeriodKind; periodStart: string; scope: BoardScope }): string =>
  `${q.board}|${q.period}|${q.periodStart}|${scopeKey(q.scope)}`;
