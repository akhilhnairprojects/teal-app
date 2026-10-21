import type { GlobalData } from '@/mbta/global/globalData';
import type { Alert, Route, Stop } from '@/mbta/model/types';
import { allClear } from '@/mbta/rules/alerts';
import { resolveParentStop } from '@/mbta/rules/lineOrRoute';
import { easternParts, formatClock } from '@/mbta/time/eastern';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** V3 cause as words ('SINGLE_TRACKING' -> 'Single tracking'); null when unknown. */
export function causeLabel(cause: string | null): string | null {
  if (!cause || cause === 'UNKNOWN_CAUSE' || cause === 'OTHER_CAUSE') return null;
  const words = cause.toLowerCase().replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/** 'Mon, Oct 19' in Eastern time. */
export function formatDay(ms: number): string {
  const p = easternParts(ms);
  return `${WEEKDAYS[p.dow]}, ${MONTHS[p.mo - 1]} ${p.d}`;
}

const sameDay = (a: number, b: number) => {
  const pa = easternParts(a);
  const pb = easternParts(b);
  return pa.y === pb.y && pa.mo === pb.mo && pa.d === pb.d;
};

/** One active period in Eastern time, e.g. 'Mon, Oct 19, 8:05 PM – 11:00 PM'. */
export function formatPeriod(p: { start: number; end: number | null }): string {
  const start = `${formatDay(p.start)}, ${formatClock(p.start)}`;
  if (p.end === null) return `From ${start} until further notice`;
  const end = sameDay(p.start, p.end) ? formatClock(p.end) : `${formatDay(p.end)}, ${formatClock(p.end)}`;
  return `${start} – ${end}`;
}

/**
 * Periods worth listing: current and future ones in order, at most `limit`, with a count of the
 * rest. When every period has ended, the last one (so the page still says when it was).
 */
export function periodsToShow(a: Alert, now: number, limit = 4): { periods: { start: number; end: number | null }[]; more: number } {
  const sorted = [...a.activePeriods].sort((x, y) => x.start - y.start);
  const open = sorted.filter((p) => p.end === null || p.end >= now);
  if (open.length === 0) return { periods: sorted.slice(-1), more: 0 };
  return { periods: open.slice(0, limit), more: Math.max(0, open.length - limit) };
}

/** Distinct routes the alert names, by sort order. */
export function alertRoutes(a: Alert, g: GlobalData): Route[] {
  const seen = new Map<string, Route>();
  for (const e of a.informedEntities) {
    const r = e.routeId ? g.routes[e.routeId] : undefined;
    if (r) seen.set(r.id, r);
  }
  return [...seen.values()].sort((x, y) => x.sortOrder - y.sortOrder);
}

/**
 * Distinct parent stations the alert names, in line order when the first route's typical
 * pattern covers them (unknown positions keep their first-seen order, after the rest).
 */
export function affectedStops(a: Alert, g: GlobalData): Stop[] {
  const parents = new Map<string, Stop>();
  for (const e of a.informedEntities) {
    const s = e.stopId ? g.stops[e.stopId] : undefined;
    if (!s) continue;
    const parent = resolveParentStop(g.stops, s);
    if (!parents.has(parent.id)) parents.set(parent.id, parent);
  }
  const list = [...parents.values()];
  const [route] = alertRoutes(a, g);
  if (!route || list.length < 2) return list;

  // Order along the typical pattern of the route that covers the most of these stops.
  let order: string[] = [];
  for (const p of Object.values(g.patterns)) {
    if (p.routeId !== route.id || (p.typicality !== null && p.typicality !== 'typical')) continue;
    const ids = (g.trips[p.representativeTripId]?.stopIds ?? []).map((id) => (g.stops[id] ? resolveParentStop(g.stops, g.stops[id]).id : id));
    const covered = ids.filter((id) => parents.has(id)).length;
    if (covered > order.filter((id) => parents.has(id)).length) order = ids;
  }
  const index = new Map(order.map((id, i) => [id, i] as const));
  return list
    .map((s, i) => ({ s, i, at: index.get(s.id) ?? Number.POSITIVE_INFINITY }))
    .sort((x, y) => x.at - y.at || x.i - y.i)
    .map((x) => x.s);
}

/** The alert is over: every period has ended. */
/** An alert's link only if it is a plain web address; anything else (app schemes, javascript:) is dropped. */
export function safeWebUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

export const alertHasEnded = (a: Alert, now: number): boolean => a.activePeriods.length > 0 && allClear(a, now);
