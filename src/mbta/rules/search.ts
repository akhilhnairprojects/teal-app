/**
 * Local station and route search over cached global data (replaces MBTA Go's hosted Algolia
 * search, which Teal cannot use). Ranking: exact > prefix > word prefix > all-words > substring;
 * case- and accent-insensitive. [ours]
 */
import { STOP_BLOCKLIST, type GlobalData } from '@/mbta/global/globalData';
import type { Route, Stop } from '@/mbta/model/types';

import { GROUPED_LINE_IDS, isShuttleRoute, lineOrRouteFor, routesByLineId, sortRoute, type LineOrRoute } from './lineOrRoute';

export type StopMatch = { stop: Stop; score: number; routeIds: string[] };

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeSearch(s: string): string {
  let out = s;
  try {
    out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    // Engines without normalize(): keep accents.
  }
  return out
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Score one candidate name against a normalised query (0 = no match). */
function scoreName(name: string, q: string): number {
  if (!q) return 0;
  const n = normalizeSearch(name);
  if (!n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const words = n.split(' ');
  if (words.some((w) => w.startsWith(q))) return 60;
  const qWords = q.split(' ');
  if (qWords.length > 1 && qWords.every((qw) => words.some((w) => w.startsWith(qw)))) return 50;
  if (n.includes(q)) return 30;
  return 0;
}

/** Routes serving a station through its platforms' patterns (typical patterns first). */
export function routeIdsAtStation(g: GlobalData, stationId: string): string[] {
  const stop = g.stops[stationId];
  if (!stop) return [];
  const ids = [stationId, ...stop.childStopIds];
  const routes: string[] = [];
  for (const id of ids) {
    for (const patternId of g.patternIdsByStop[id] ?? []) {
      const routeId = g.patterns[patternId]?.routeId;
      if (routeId && !routes.includes(routeId) && !routeId.startsWith('Shuttle')) routes.push(routeId);
    }
  }
  return routes.sort((a, b) => (g.routes[a]?.sortOrder ?? 0) - (g.routes[b]?.sortOrder ?? 0));
}

/** Parent stations (and parentless stops) whose name matches, best first. */
export function matchStations(g: GlobalData, query: string, limit: number): StopMatch[] {
  const q = normalizeSearch(query);
  if (!q || limit <= 0) return [];
  const matches: StopMatch[] = [];
  for (const stop of Object.values(g.stops)) {
    const isStation = stop.locationType === 1 || (stop.locationType === 0 && stop.parentStationId === null);
    if (!isStation || STOP_BLOCKLIST.includes(stop.id)) continue;
    const score = scoreName(stop.name, q);
    if (score === 0) continue;
    matches.push({ stop, score, routeIds: routeIdsAtStation(g, stop.id) });
  }
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.stop.name.length - b.stop.name.length ||
        b.routeIds.length - a.routeIds.length ||
        a.stop.name.localeCompare(b.stop.name),
    )
    .slice(0, limit);
}

/** Names a rider might type for a route: long/short names, initials, Green branch aliases. */
function routeAliases(r: Route): string[] {
  const names = [r.longName, r.shortName, r.id];
  const initials = r.longName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('');
  if (initials.length > 1) names.push(initials);
  const branch = /^Green-([A-Z])$/.exec(r.id)?.[1];
  if (branch) {
    const b = branch.toLowerCase();
    names.push(`gl ${b}`, `${b} line`, `green ${b}`, `${b} branch`, `green line ${b}`);
  }
  return names.filter(Boolean);
}

/** Lines (Green) and non-shuttle routes whose names match, best first. */
export function matchRoutes(g: GlobalData, query: string, limit: number): LineOrRoute[] {
  const q = normalizeSearch(query);
  if (!q || limit <= 0) return [];
  const byLine = routesByLineId(g);
  const scored: { lr: LineOrRoute; score: number }[] = [];
  for (const lineId of GROUPED_LINE_IDS) {
    const line = g.lines[lineId];
    if (!line || !byLine[lineId]?.length) continue;
    const score = Math.max(scoreName(line.longName, q), scoreName(line.shortName, q), scoreName('gl', q));
    if (score > 0) scored.push({ lr: { kind: 'line', id: line.id, line, routes: byLine[lineId] }, score });
  }
  for (const r of Object.values(g.routes)) {
    if (isShuttleRoute(r)) continue;
    const score = Math.max(...routeAliases(r).map((n) => scoreName(n, q)));
    if (score > 0) {
      // Green branches are listed as routes so "gl b" finds Green-B itself.
      const lr = r.id.startsWith('Green-') ? { kind: 'route' as const, id: r.id, route: r } : lineOrRouteFor(g, r, byLine);
      if (!scored.some((s) => s.lr.id === lr.id)) scored.push({ lr, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || sortRoute(a.lr).sortOrder - sortRoute(b.lr).sortOrder)
    .slice(0, limit)
    .map((s) => s.lr);
}
