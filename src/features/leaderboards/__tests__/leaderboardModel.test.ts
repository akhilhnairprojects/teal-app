import { periodLabel, periodStart } from '@/activity/periods';
import { easternInstant } from '@/mbta/time/eastern';
import type { LeaderboardRow } from '@/social/leaderboards';

import {
  BOARD_CHIPS,
  boardQueryKey,
  championsTitle,
  createTimedCache,
  emptyBoardText,
  featuredCardText,
  formatBoardValue,
  previousPeriodStart,
  resetCountdown,
  scopeChips,
  splitMyRow,
} from '../leaderboardModel';

const ME = '11111111-1111-4111-8111-111111111111';
const row = (rank: number, userId: string, isMe = false): LeaderboardRow => ({
  rank,
  userId,
  nickname: isMe ? 'me' : `u${rank}`,
  color: 1,
  value: 1000 * rank,
  activityId: null,
  achievedOn: '2026-10-19',
  isMe,
});

describe('formatBoardValue', () => {
  it('formats durations as times and distances in the chosen units', () => {
    expect(formatBoardValue('run_1k', 250_000, 'mi')).toBe('4:10');
    expect(formatBoardValue('run_5k', 1_250_000, 'km')).toBe('20:50');
    expect(formatBoardValue('run_10k', 3_725_000, 'mi')).toBe('1:02:05');
    expect(formatBoardValue('run_distance', 16_093.44, 'mi')).toBe('10.00 mi');
    expect(formatBoardValue('bike_distance', 12_000, 'km')).toBe('12.00 km');
  });

  it('offers no bike speed board', () => {
    expect(BOARD_CHIPS.map((b) => b.label)).toEqual(['1K', '5K', '10K', 'Run distance', 'Bike distance']);
  });
});

describe('splitMyRow', () => {
  it('pins my row below the list only when it is outside the top N', () => {
    const top = [row(1, 'a'), row(2, 'b')];
    const me = row(57, ME, true);
    expect(splitMyRow({ rows: top, me })).toEqual({ rows: top, pinned: me });
    const withMe = [row(1, 'a'), row(2, ME, true)];
    expect(splitMyRow({ rows: withMe, me: withMe[1] })).toEqual({ rows: withMe, pinned: null });
    expect(splitMyRow({ rows: top, me: null }).pinned).toBeNull();
  });
});

describe('periods', () => {
  it('labels periods and counts down to the reset', () => {
    const now = easternInstant(2026, 10, 20, 9, 0); // Tuesday
    const week = periodStart('week', now);
    const month = periodStart('month', now);
    expect(periodLabel('week', week)).toBe('Week of Oct 19');
    expect(periodLabel('month', month)).toBe('October 2026');
    expect(resetCountdown('week', week, now)).toBe('Resets Mon');
    expect(resetCountdown('month', month, now)).toBe('Resets Nov 1');
    expect(resetCountdown('month', '2026-12-01', easternInstant(2026, 12, 5))).toBe('Resets Jan 1');
    expect(resetCountdown('week', week, easternInstant(2026, 10, 25, 21, 0))).toBe('Resets in 3 h');
    expect(resetCountdown('week', week, easternInstant(2026, 10, 25, 23, 40))).toBe('Resets in 20 min');
    expect(resetCountdown('week', week, easternInstant(2026, 10, 26, 0, 0))).toBe('Resetting now');
  });

  it('finds the previous period for champions across DST and year ends', () => {
    expect(previousPeriodStart('week', '2026-11-02')).toBe('2026-10-26');
    expect(previousPeriodStart('month', '2027-01-01')).toBe('2026-12-01');
    expect(championsTitle('week')).toBe('Last week’s champions');
    expect(championsTitle('month')).toBe('Last month’s champions');
  });
});

describe('chips and cards', () => {
  it('lists Everyone, Friends, then each group', () => {
    const chips = scopeChips([{ id: 'g1', name: 'Tuesday crew' }]);
    expect(chips.map((c) => c.label)).toEqual(['Everyone', 'Friends', 'Tuesday crew']);
    expect(chips[2].scope).toEqual({ kind: 'group', groupId: 'g1' });
    expect(boardQueryKey({ board: 'run_5k', period: 'week', periodStart: '2026-10-19', scope: chips[2].scope })).toBe('run_5k|week|2026-10-19|group:g1');
  });

  it('describes a featured run with its date only', () => {
    const t = featuredCardText(
      { activityId: 'x', nickname: 'Ana', color: 0, effortM: 5000, durationMs: 1_351_000, totalM: 5471.77, achievedOn: '2026-10-19', route: null },
      'mi',
    );
    expect(t).toEqual({ headline: '5K · 22:31', detail: 'Ana · 3.40 mi · Oct 19' });
  });

  it('words empty boards per kind', () => {
    expect(emptyBoardText('bike_distance', 'month')).toMatch(/Bluebike rides on this board this month/);
    expect(emptyBoardText('run_5k', 'week')).toMatch(/runs on this board this week/);
  });
});

describe('createTimedCache', () => {
  it('serves an entry for 60 s and keeps the stale value for display', () => {
    const cache = createTimedCache<number>();
    cache.set('k', 1, 1_000);
    expect(cache.fresh('k', 60_999)).toBe(1);
    expect(cache.fresh('k', 61_000)).toBeNull();
    expect(cache.last('k')).toBe(1);
    expect(cache.fresh('other', 1_000)).toBeNull();
  });
});
