/**
 * Leaderboard periods in Eastern time (spec §2.6): weeks start Monday 00:00 ET, months on the 1st.
 * Matches the server's private.week_start / month_start / period_end.
 */
import { addDays, easternInstant, easternParts } from '@/mbta/time/eastern';

export type PeriodKind = 'week' | 'month';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function parseDay(start: string): { y: number; mo: number; d: number } {
  const [y, mo, d] = start.split('-').map(Number);
  return { y, mo, d };
}

/** 'YYYY-MM-DD' of the period containing `now`: the Monday (week) or the 1st (month), in ET. */
export function periodStart(kind: PeriodKind, now: number): string {
  const p = easternParts(now);
  if (kind === 'month') return `${p.y}-${pad2(p.mo)}-01`;
  const today = `${p.y}-${pad2(p.mo)}-${pad2(p.d)}`;
  return addDays(today, -((p.dow + 6) % 7));
}

/** The instant the period that begins on `start` ends (the next period's 00:00 ET). */
export function periodEndMs(kind: PeriodKind, start: string): number {
  if (kind === 'week') {
    const next = parseDay(addDays(start, 7));
    return easternInstant(next.y, next.mo, next.d);
  }
  const { y, mo } = parseDay(start);
  return mo === 12 ? easternInstant(y + 1, 1, 1) : easternInstant(y, mo + 1, 1);
}

/** The start of the period `delta` periods away (−1 = the previous one). */
export function shiftPeriod(kind: PeriodKind, start: string, delta: number): string {
  if (kind === 'week') return addDays(start, 7 * delta);
  const { y, mo } = parseDay(start);
  const index = y * 12 + (mo - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}-01`;
}

/** 'Week of Oct 19' or 'October 2026'. */
export function periodLabel(kind: PeriodKind, start: string): string {
  const { y, mo, d } = parseDay(start);
  if (kind === 'month') return `${MONTHS[mo - 1]} ${y}`;
  return `Week of ${MONTHS[mo - 1].slice(0, 3)} ${d}`;
}
