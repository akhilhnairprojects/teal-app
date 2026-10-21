/**
 * Territory API (spec §2.7): cells by bounding box, monthly standings, archived champions and an
 * activity's claim. Territory is on by default with a per-user opt-out (Addendum D, O3); cells are
 * shown only as grid squares, never as the raw loop.
 */
import { periodStart } from '@/activity/periods';
import { getAuthState } from '@/backend/auth';
import { getSupabase } from '@/backend/client';
import { fail, ok, toBackendError, type Result } from '@/backend/errors';
import { bool, int, isObj, listOf, num, str, uuid } from '@/backend/parse';
import { rpc } from '@/backend/rpc';

import type { CellId } from './grid';

export type TerritoryCell = { cellId: CellId; ownerId: string; nickname: string; color: number };
export type TerritoryStanding = { rank: number; userId: string; nickname: string; color: number; cells: number; isMe: boolean };

/**
 * Rows per `get_territory` page. The server caps a page at 1000 (PostgREST's default "Max rows", the
 * project setting this relies on; see spec §2.4), and a full page means there may be more.
 */
export const TERRITORY_PAGE_SIZE = 1000;
/** The most cells fetched for one view (20 pages); past it the layer reports "Zoom in". */
export const TERRITORY_MAX_CELLS = 20_000;

/**
 * Owner colors by profile `color` (0–11): mid-tone hues that read on the light and dark map styles,
 * drawn at 35 % fill by the territory layer.
 */
export const OWNER_COLORS: readonly string[] = [
  '#0D9488', // teal
  '#2563EB', // blue
  '#DB2777', // pink
  '#EA580C', // orange
  '#7C3AED', // violet
  '#16A34A', // green
  '#DC2626', // red
  '#0891B2', // cyan
  '#CA8A04', // amber
  '#9333EA', // purple
  '#4D7C0F', // olive
  '#BE185D', // magenta
];

const currentMonth = () => periodStart('month', Date.now());

export function parseTerritoryCell(v: unknown): TerritoryCell | null {
  if (!isObj(v)) return null;
  const cellId = int(v.cell_id);
  const ownerId = uuid(v.owner_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  if (cellId === null || cellId < 0 || !ownerId || !nickname || color === null) return null;
  return { cellId, ownerId, nickname, color };
}

export function parseTerritoryStanding(v: unknown): TerritoryStanding | null {
  if (!isObj(v)) return null;
  const rank = int(v.rank);
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const cells = int(v.cells);
  const isMe = bool(v.is_me);
  if (rank === null || !userId || !nickname || color === null || cells === null || isMe === null) return null;
  return { rank, userId, nickname, color, cells, isMe };
}

/**
 * Every cell in a box for a month, paged by cell id (keyset cursor `p_after`) so no page is cut by
 * the API's row cap. Stops at a short page, or at TERRITORY_MAX_CELLS with `truncated: true` when the
 * last page was full (more may exist). A failed page fails the whole fetch: no partial map.
 */
export async function fetchTerritory(
  b: { south: number; west: number; north: number; east: number },
  month?: string,
): Promise<Result<{ month: string; cells: TerritoryCell[]; truncated: boolean }>> {
  const m = month ?? currentMonth();
  const cells: TerritoryCell[] = [];
  let after: number | null = null;
  for (;;) {
    const r = await rpc('get_territory', {
      p_south: b.south,
      p_west: b.west,
      p_north: b.north,
      p_east: b.east,
      p_month: m,
      p_after: after,
      p_limit: TERRITORY_PAGE_SIZE,
    });
    if (!r.ok) return r;
    const page = listOf(r.value, parseTerritoryCell);
    if (!page) return fail('unknown');
    // Pages are ascending by cell id; anything else would make the cursor skip or repeat cells.
    const last = page.length > 0 ? page[page.length - 1].cellId : null;
    if (last !== null && after !== null && page[0].cellId <= after) return fail('unknown');
    cells.push(...page);
    if (page.length < TERRITORY_PAGE_SIZE || last === null) return ok({ month: m, cells, truncated: false });
    if (cells.length >= TERRITORY_MAX_CELLS) return ok({ month: m, cells, truncated: true });
    after = last;
  }
}

export async function fetchTerritoryStandings(month?: string): Promise<Result<TerritoryStanding[]>> {
  const r = await rpc('get_territory_standings', { p_month: month ?? currentMonth(), p_limit: 50 });
  if (!r.ok) return r;
  const rows = listOf(r.value, parseTerritoryStanding);
  return rows ? ok(rows) : fail('unknown');
}

/** Archived top 10 of a closed month (table territory_champions, readable by signed-in users). */
export async function fetchTerritoryChampions(month: string): Promise<Result<TerritoryStanding[]>> {
  const sb = getSupabase();
  if (!sb) return fail('not_configured');
  const auth = getAuthState();
  const me = auth.status === 'signedIn' ? auth.userId : null;
  try {
    const { data, error } = await sb
      .from('territory_champions')
      .select('rank,user_id,cells,profiles(nickname,color)')
      .eq('month_start', month)
      .order('rank', { ascending: true });
    if (error) return { ok: false, error: toBackendError(error) };
    const rows = listOf(data, (v) => {
      if (!isObj(v) || !isObj(v.profiles)) return null;
      const userId = uuid(v.user_id);
      return parseTerritoryStanding({ ...v, nickname: v.profiles.nickname, color: v.profiles.color, is_me: userId !== null && userId === me });
    });
    return rows ? ok(rows) : fail('unknown');
  } catch (e) {
    return { ok: false, error: toBackendError(e) };
  }
}

/** Cells claimed and stolen by one of my activities, or null when it claimed nothing. */
export async function fetchActivityClaim(serverId: string): Promise<Result<{ cellsClaimed: number; cellsStolen: number; areaM2: number } | null>> {
  const r = await rpc('get_activity_claim', { p_activity: serverId });
  if (!r.ok) return r;
  if (r.value === null) return ok(null);
  if (!isObj(r.value)) return fail('unknown');
  const cellsClaimed = int(r.value.cells_claimed);
  const cellsStolen = int(r.value.cells_stolen);
  const areaM2 = num(r.value.area_m2);
  if (cellsClaimed === null || cellsStolen === null || areaM2 === null) return fail('unknown');
  return ok({ cellsClaimed, cellsStolen, areaM2 });
}
