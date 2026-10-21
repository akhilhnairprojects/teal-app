/**
 * The one owner of the sheet's routes: path builders (returning `Href`), the parsers for the params
 * those paths carry, and the two navigation moves the shell uses (switch tab, go back). Paths are
 * built as strings and cast once here, so callers work even while a route file is not in the
 * generated typed-routes list yet. Route files in `src/app/` parse with the functions below.
 */
import { router, type Href } from 'expo-router';

import type { ActivityKind } from '@/activity/types';
import type { PeriodKind } from '@/activity/periods';
import type { DirectionId } from '@/mbta/model/types';
import type { BoardId } from '@/social/leaderboards';

export const PATHS = {
  nearby: '/',
  plan: '/plan',
  favorites: '/favorites',
  move: '/move',
  search: '/search',
  more: '/more',
  account: '/account',
  activities: '/activities',
  friends: '/friends',
  inbox: '/inbox',
} as const;

type StaticPath = (typeof PATHS)[keyof typeof PATHS];

/** Href for a path without params. */
export const pathHref = (path: StaticPath): Href => path as Href;

/** Routes reached from the tab row; everything else is pushed with a back button. */
export const TOP_LEVEL_PATHS: readonly string[] = [PATHS.nearby, PATHS.plan, PATHS.favorites, PATHS.move];

export const isTopLevelPath = (pathname: string): boolean => TOP_LEVEL_PATHS.includes(pathname === '' ? '/' : pathname);

type QueryValue = string | number | null | undefined;

function withQuery(path: string, params: Record<string, QueryValue>): Href {
  const q = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return (q ? `${path}?${q}` : path) as Href;
}

/** A route param as one string (expo-router gives arrays for repeated keys). */
export type Param = string | string[] | undefined;
export const firstParam = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);

// --- stop: /stop/[stopId]?routeId&directionId ------------------------------------------

/** Stop details filtered to one route (or line, e.g. 'line-Green') and direction. */
export type StopFilter = { routeId: string; directionId: DirectionId };

export const stopPath = (stopId: string, filter?: StopFilter | null): Href =>
  withQuery(`/stop/${encodeURIComponent(stopId)}`, { routeId: filter?.routeId, directionId: filter?.directionId });

/** The filter from route params, or null when absent or malformed. */
export function parseStopFilter(params: { routeId?: Param; directionId?: Param }): StopFilter | null {
  const routeId = firstParam(params.routeId)?.trim();
  const dir = firstParam(params.directionId);
  if (!routeId || (dir !== '0' && dir !== '1')) return null;
  return { routeId, directionId: dir === '0' ? 0 : 1 };
}

/** Route params for a filter; `undefined` values clear the params with `router.setParams`. */
export function stopFilterParams(f: StopFilter | null): { routeId: string | undefined; directionId: string | undefined } {
  return f ? { routeId: f.routeId, directionId: String(f.directionId) } : { routeId: undefined, directionId: undefined };
}

// --- trip: /trip/[tripId]?stopId&stopSequence&vehicleId --------------------------------

/** Trip page params (all optional except the trip). */
export type TripPageParams = { tripId: string; stopId: string | null; stopSequence: number | null; vehicleId: string | null };

export const tripPath = (tripId: string, o: { stopId?: string | null; stopSequence?: number | null; vehicleId?: string | null } = {}): Href =>
  withQuery(`/trip/${encodeURIComponent(tripId)}`, { stopId: o.stopId, stopSequence: o.stopSequence, vehicleId: o.vehicleId });

export function parseTripParams(p: { tripId?: Param; stopId?: Param; stopSequence?: Param; vehicleId?: Param }): TripPageParams | null {
  const tripId = firstParam(p.tripId) || null;
  if (!tripId) return null;
  const seq = firstParam(p.stopSequence) || null;
  const n = seq !== null && /^\d+$/.test(seq) ? Number(seq) : null;
  return { tripId, stopId: firstParam(p.stopId) || null, stopSequence: n, vehicleId: firstParam(p.vehicleId) || null };
}

// --- alert: /alert/[alertId] -----------------------------------------------------------

export const alertPath = (alertId: string): Href => `/alert/${encodeURIComponent(alertId)}` as Href;

// --- plan: /plan?q&toName&toLat&toLon&toStopId (all optional) ---------------------------

export type PlanParams = { q?: string; toName?: string; toLat?: string; toLon?: string; toStopId?: string };

export const planPath = (p: PlanParams = {}): Href =>
  withQuery(PATHS.plan, { q: p.q?.trim(), toName: p.toName, toLat: p.toLat, toLon: p.toLon, toStopId: p.toStopId });

export function parsePlanParams(p: { q?: Param; toName?: Param; toLat?: Param; toLon?: Param; toStopId?: Param }): PlanParams {
  return {
    q: firstParam(p.q),
    toName: firstParam(p.toName),
    toLat: firstParam(p.toLat),
    toLon: firstParam(p.toLon),
    toStopId: firstParam(p.toStopId),
  };
}

// --- gamification (spec §3.2): builders and parsers for every Move route -----------------

const enc = encodeURIComponent;

export const movePath = (): Href => pathHref(PATHS.move);
export const accountPath = (): Href => pathHref(PATHS.account);
export const nicknamePath = (): Href => '/account/nickname' as Href;
export const activitiesPath = (): Href => pathHref(PATHS.activities);
export const friendsPath = (): Href => pathHref(PATHS.friends);
export const inboxPath = (): Href => pathHref(PATHS.inbox);

/** An in-app path to return to after sign-in; anything else (external, protocol-relative) is dropped. */
export function safeNext(v: string | null | undefined): string | null {
  if (!v || !v.startsWith('/') || v.startsWith('//') || /[\s\\]/.test(v)) return null;
  return v;
}

// /account/sign-in?next
export const signInPath = (o: { next?: string | null } = {}): Href => withQuery('/account/sign-in', { next: safeNext(o.next) });
export const parseSignInParams = (p: { next?: Param }): { next: string | null } => ({ next: safeNext(firstParam(p.next)) });

// /record?kind
const KINDS: readonly ActivityKind[] = ['run', 'bike'];
export const recordPath = (o: { kind: ActivityKind }): Href => withQuery('/record', { kind: o.kind });
export function parseRecordParams(p: { kind?: Param }): { kind: ActivityKind | null } {
  const k = firstParam(p.kind);
  return { kind: KINDS.includes(k as ActivityKind) ? (k as ActivityKind) : null };
}

// /activity/[activityId]
export const activityPath = (localId: string): Href => `/activity/${enc(localId)}` as Href;
export const parseActivityParams = (p: { activityId?: Param }): string | null => firstParam(p.activityId) || null;

// /leaderboards?board&period&scope
const BOARDS: readonly BoardId[] = ['run_1k', 'run_5k', 'run_10k', 'run_distance', 'bike_distance'];
const PERIODS: readonly PeriodKind[] = ['week', 'month'];
export type LeaderboardScopeParam = 'global' | 'friends';
const SCOPES: readonly LeaderboardScopeParam[] = ['global', 'friends'];
export type LeaderboardsParams = { board?: BoardId; period?: PeriodKind; scope?: LeaderboardScopeParam };
export const leaderboardsPath = (o: LeaderboardsParams = {}): Href => withQuery('/leaderboards', { board: o.board, period: o.period, scope: o.scope });
export function parseLeaderboardsParams(p: { board?: Param; period?: Param; scope?: Param }): {
  board: BoardId | null;
  period: PeriodKind | null;
  scope: LeaderboardScopeParam | null;
} {
  const board = firstParam(p.board);
  const period = firstParam(p.period);
  const scope = firstParam(p.scope);
  return {
    board: BOARDS.includes(board as BoardId) ? (board as BoardId) : null,
    period: PERIODS.includes(period as PeriodKind) ? (period as PeriodKind) : null,
    scope: SCOPES.includes(scope as LeaderboardScopeParam) ? (scope as LeaderboardScopeParam) : null,
  };
}

// /park?toName&toLat&toLon
export const parkPath = (o: { toName?: string | null; toLat?: number | null; toLon?: number | null } = {}): Href =>
  withQuery('/park', { toName: o.toName, toLat: o.toLat, toLon: o.toLon });
export function parseParkParams(p: { toName?: Param; toLat?: Param; toLon?: Param }): { toName: string | null; toLat: number | null; toLon: number | null } {
  const lat = Number(firstParam(p.toLat));
  const lon = Number(firstParam(p.toLon));
  const valid = firstParam(p.toLat) !== undefined && firstParam(p.toLon) !== undefined && Number.isFinite(lat) && Number.isFinite(lon);
  return { toName: firstParam(p.toName) || null, toLat: valid ? lat : null, toLon: valid ? lon : null };
}

/** Invite codes: 8 characters from A–Z and 2–9 without O and I (server private.new_code). */
export const INVITE_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const parseCode = (p: Param): string | null => {
  const c = firstParam(p)?.trim().toUpperCase();
  return c && INVITE_CODE_PATTERN.test(c) ? c : null;
};

// /friend/[code]
export const friendInvitePath = (code: string): Href => `/friend/${enc(code)}` as Href;
export const parseFriendInviteParams = (p: { code?: Param }): string | null => parseCode(p.code);

// /territory?month
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;
export const territoryPath = (o: { month?: string | null } = {}): Href => withQuery('/territory', { month: o.month });
export function parseTerritoryParams(p: { month?: Param }): { month: string | null } {
  const m = firstParam(p.month);
  return { month: m && MONTH_RE.test(m) ? m : null };
}

// --- navigation ------------------------------------------------------------------------

/**
 * Switch to a top-level page (the tab row's move). Pushed pages are dismissed first, so the
 * stack holds only the tab page afterwards: no stacked duplicates and the tab chrome shows.
 */
export function goToTab(target: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(target);
}

/** Back to the previous page, or to Nearby when a deep link opened this one. */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace(pathHref(PATHS.nearby));
}
