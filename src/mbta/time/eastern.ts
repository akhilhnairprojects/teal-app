// `formatMinutes` ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/utils/MinutesFormat.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// The other helpers are Teal's own.
/**
 * Eastern (America/New_York) wall-clock helpers. All app times are epoch ms; this is the only
 * place that converts them to Boston local time.
 *
 * Uses `Intl.DateTimeFormat` with a time zone when the JS engine supports it, and otherwise
 * falls back to the US DST rule (2nd Sunday of March to 1st Sunday of November, 02:00 local).
 */

export type EasternParts = { y: number; mo: number; d: number; h: number; mi: number; dow: number };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Day of month of the nth (1-based) Sunday of a month, in a given year. */
function nthSunday(year: number, month0: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
}

/** UTC offset in hours (−4 or −5) for an instant, by the US DST rule. */
export function fallbackOffsetHours(ms: number): -4 | -5 {
  const year = new Date(ms).getUTCFullYear();
  // DST starts at 02:00 EST (07:00 UTC) and ends at 02:00 EDT (06:00 UTC).
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 7);
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 6);
  return ms >= start && ms < end ? -4 : -5;
}

/** Eastern wall-clock parts from the DST rule alone (exported for tests). */
export function easternPartsFallback(ms: number): EasternParts {
  const local = new Date(ms + fallbackOffsetHours(ms) * HOUR_MS);
  return {
    y: local.getUTCFullYear(),
    mo: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    h: local.getUTCHours(),
    mi: local.getUTCMinutes(),
    dow: local.getUTCDay(),
  };
}

let intlFormatter: Intl.DateTimeFormat | null | undefined;

function getIntlFormatter(): Intl.DateTimeFormat | null {
  if (intlFormatter !== undefined) return intlFormatter;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    // Self-check against a known instant (2026-01-15 12:00 UTC = 07:00 EST, and a summer one)
    // so an engine that ignores `timeZone` falls back instead of returning device-local time.
    const winter = partsFromIntl(f, Date.UTC(2026, 0, 15, 12, 0));
    const summer = partsFromIntl(f, Date.UTC(2026, 6, 15, 12, 0));
    intlFormatter = winter?.h === 7 && summer?.h === 8 && winter.dow === 4 ? f : null;
  } catch {
    intlFormatter = null;
  }
  return intlFormatter;
}

function partsFromIntl(f: Intl.DateTimeFormat, ms: number): EasternParts | null {
  if (typeof f.formatToParts !== 'function') return null;
  const out: Partial<EasternParts> = {};
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === 'year') out.y = Number(p.value);
    else if (p.type === 'month') out.mo = Number(p.value);
    else if (p.type === 'day') out.d = Number(p.value);
    else if (p.type === 'hour') out.h = Number(p.value) % 24;
    else if (p.type === 'minute') out.mi = Number(p.value);
    else if (p.type === 'weekday') out.dow = WEEKDAYS[p.value];
  }
  const { y, mo, d, h, mi, dow } = out;
  if ([y, mo, d, h, mi, dow].some((v) => v === undefined || Number.isNaN(v))) return null;
  return out as EasternParts;
}

/** True when the engine's Intl supports the America/New_York zone (Hermes in Expo Go should). */
export function hasIntlTimeZone(): boolean {
  return getIntlFormatter() !== null;
}

export function easternParts(ms: number): EasternParts {
  const f = getIntlFormatter();
  return (f && partsFromIntl(f, ms)) || easternPartsFallback(ms);
}

/** Offset of Eastern time from UTC at an instant, in ms (e.g. −4 h in summer). */
function offsetMs(ms: number): number {
  const p = easternParts(ms);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  return asUtc - Math.floor(ms / 60_000) * 60_000;
}

/**
 * Epoch ms for an Eastern wall-clock time. During the fall-back hour the earlier (EDT) instant
 * is returned; a nonexistent spring-forward time resolves to the instant one hour later.
 */
export function easternInstant(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  for (const guessHours of [-4, -5]) {
    const candidate = wall - guessHours * HOUR_MS;
    if (offsetMs(candidate) === guessHours * HOUR_MS) return candidate;
  }
  return wall + 4 * HOUR_MS;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for calendar parts, normalising day overflow. */
function isoDate(y: number, mo: number, d: number): string {
  const date = new Date(Date.UTC(y, mo - 1, d));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** The MBTA service date ('YYYY-MM-DD'): the Eastern calendar date, rolled back before 03:00. */
export function serviceDate(now: number): string {
  const p = easternParts(now);
  return p.h >= 3 ? isoDate(p.y, p.mo, p.d) : isoDate(p.y, p.mo, p.d - 1);
}

/** Add whole days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  return isoDate(y, mo, d + days);
}

/** Minutes since local midnight of the service date, which can exceed 24:00 after midnight. */
export function serviceMinutes(ms: number): number {
  const p = easternParts(ms);
  const minutes = p.h * 60 + p.mi;
  return p.h >= 3 ? minutes : minutes + 24 * 60;
}

/** 'HH:MM' for schedule `min_time`/`max_time` filters; hours may be ≥ 24. */
export function formatServiceTime(totalMinutes: number): string {
  const m = Math.max(0, Math.floor(totalMinutes));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** '8:05 PM' in Eastern time. */
export function formatClock(ms: number): string {
  const { h, mi } = easternParts(ms);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad2(mi)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Minutes as '5 min', '1 hr' or '1 hr 5 min' (port of MinutesFormat.kt). */
export function formatMinutes(min: number): string {
  const hours = Math.floor(min / 60);
  const rest = min - hours * 60;
  if (hours >= 1) return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  return `${min} min`;
}

/** True when both instants fall on the same Eastern hour and minute. */
export function sameEasternMinute(a: number, b: number): boolean {
  const pa = easternParts(a);
  const pb = easternParts(b);
  return pa.h === pb.h && pa.mi === pb.mi;
}

export const MS = { minute: 60_000, hour: HOUR_MS, day: DAY_MS } as const;
