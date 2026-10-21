/**
 * Territory claim preview (spec §2.7, G4): which grid cells a finished run would claim, computed on
 * the phone with the same rules as the server's `private.claim_territory`, for the recorder summary
 * and the activity detail. It is an estimate until the server confirms it (`fetchActivityClaim`):
 * the server also checks the month, the opt-out and the final validity of the upload.
 *
 * Server rules mirrored here:
 * - only a valid run that is a loop (`computeTrackMetrics(...).isLoop`) claims;
 * - the polygon is the trace closed back to its start, in plain lon/lat; `ST_MakeValid` keeps a
 *   self-crossing loop's faces with even–odd parity (a figure-8 becomes two lobes), which is what
 *   the even–odd scanline below computes;
 * - the area must be 20 000 m² … 25 km²;
 * - the cells tested are those of the polygon's bounding box, clipped to the grid, at most 80 000;
 * - a cell is claimed when its centre intersects the polygon (the boundary counts);
 * - except cells whose centre is within 300 m (haversine, `private.ll_dist_m`) of the trace's first
 *   or last point: a privacy zone around the start (review S4).
 */
import { computeTrackMetrics, expectedFlags } from '@/activity/metrics';
import type { TrackPoint } from '@/activity/types';
import { distanceMeters } from '@/lib/geo';

import { cellCenter, cellId, GRID, type CellId } from './grid';

export const CLAIM_MIN_AREA_M2 = 20_000;
export const CLAIM_MAX_AREA_M2 = 25_000_000;
/** The server skips loops whose bounding box spans more cells than this. */
export const CLAIM_MAX_BBOX_CELLS = 80_000;
/** No cell whose centre is within this distance of the start or the finish is ever claimed. */
export const CLAIM_PRIVACY_ZONE_M = 300;

/** Shown next to every preview number. */
export const PREVIEW_LABEL = 'Estimate · confirmed after sync';

/** Mean Earth radius for the area estimate (the server measures on the spheroid). */
const R = 6_371_008.8;
const RAD = Math.PI / 180;
/** Scanlines used for the area estimate. */
const AREA_ROWS = 1024;

type Pt = { lat: number; lon: number };
type Edge = { x1: number; y1: number; x2: number; y2: number; ymin: number; ymax: number };

/** Edges of the ring closed back to its first point (as `ST_AddPoint(line, ST_StartPoint(line))`). */
function ringEdges(points: readonly Pt[]): Edge[] {
  const edges: Edge[] = [];
  const n = points.length;
  for (let k = 0; k < n; k++) {
    const a = points[k];
    const b = points[(k + 1) % n];
    edges.push({ x1: a.lon, y1: a.lat, x2: b.lon, y2: b.lat, ymin: Math.min(a.lat, b.lat), ymax: Math.max(a.lat, b.lat) });
  }
  return edges;
}

/**
 * Visit ascending scanlines `ys` with the sorted x of every edge crossing (half-open in y, so a
 * vertex on the line is counted once when the ring passes through it and twice or not at all at a
 * local extremum, which keeps even–odd parity exact). Active-edge table: O((E + crossings) log E).
 */
function scan(edges: readonly Edge[], ys: readonly number[], visit: (row: number, xs: number[]) => void): void {
  const sorted = edges.filter((e) => e.ymin < e.ymax).sort((a, b) => a.ymin - b.ymin);
  let next = 0;
  let active: Edge[] = [];
  for (let row = 0; row < ys.length; row++) {
    const y = ys[row];
    while (next < sorted.length && sorted[next].ymin <= y) active.push(sorted[next++]);
    active = active.filter((e) => e.ymax > y);
    const xs = active.map((e) => (e.y1 === y ? e.x1 : e.y2 === y ? e.x2 : e.x1 + ((y - e.y1) * (e.x2 - e.x1)) / (e.y2 - e.y1)));
    xs.sort((a, b) => a - b);
    visit(row, xs);
  }
}

const gridI = (lon: number) => Math.floor((lon - GRID.lon0) / GRID.dLon);
const gridJ = (lat: number) => Math.floor((lat - GRID.lat0) / GRID.dLat);
const centerLon = (i: number) => GRID.lon0 + (i + 0.5) * GRID.dLon;
const centerLat = (j: number) => GRID.lat0 + (j + 0.5) * GRID.dLat;

function bbox(points: readonly Pt[]) {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  return { south, north, west, east };
}

const finite = (points: readonly Pt[]) => points.length >= 3 && points.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

/**
 * Even–odd area of the closed loop in m² (scanline integration on a sphere). An estimate of the
 * server's `ST_Area(geography)`; within a fraction of a percent for loops of running size.
 */
export function loopAreaM2(points: readonly Pt[]): number {
  if (!finite(points)) return 0;
  const b = bbox(points);
  const height = b.north - b.south;
  if (!(height > 0) || !(b.east > b.west)) return 0;
  const dy = height / AREA_ROWS;
  const ys = Array.from({ length: AREA_ROWS }, (_, k) => b.south + (k + 0.5) * dy);
  let area = 0;
  scan(ringEdges(points), ys, (row, xs) => {
    let width = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) width += xs[k + 1] - xs[k];
    area += width * RAD * R * Math.cos(ys[row] * RAD) * dy * RAD * R;
  });
  return area;
}

export type LoopCells = { cellIds: CellId[]; outsideGrid: boolean; tooLarge: boolean };

/**
 * The cells whose centres intersect the loop polygon (interior or boundary), sorted by id. Exact
 * comparisons on the same doubles as PostGIS, so a centre lying on the trace is decided the same way.
 */
export function cellsInLoop(points: readonly Pt[]): LoopCells {
  if (!finite(points)) return { cellIds: [], outsideGrid: false, tooLarge: false };
  const b = bbox(points);
  const i0 = Math.max(gridI(b.west), 0);
  const i1 = Math.min(gridI(b.east), GRID.iMax);
  const j0 = Math.max(gridJ(b.south), 0);
  const j1 = Math.min(gridJ(b.north), GRID.jMax);
  if (i1 < i0 || j1 < j0) return { cellIds: [], outsideGrid: true, tooLarge: false };
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > CLAIM_MAX_BBOX_CELLS) return { cellIds: [], outsideGrid: false, tooLarge: true };

  const edges = ringEdges(points);
  const rows: number[] = [];
  for (let j = j0; j <= j1; j++) rows.push(centerLat(j));

  // Boundary pieces lying exactly on a scanline: vertices, and horizontal edges.
  const onLine = new Map<number, { xs: number[]; spans: [number, number][] }>();
  const at = (y: number) => {
    let v = onLine.get(y);
    if (!v) onLine.set(y, (v = { xs: [], spans: [] }));
    return v;
  };
  for (const e of edges) {
    at(e.y1).xs.push(e.x1);
    if (e.y1 === e.y2) at(e.y1).spans.push([Math.min(e.x1, e.x2), Math.max(e.x1, e.x2)]);
  }

  const ids: CellId[] = [];
  scan(edges, rows, (row, xs) => {
    const j = j0 + row;
    const extra = onLine.get(rows[row]);
    let k = 0; // first crossing ≥ the current centre
    for (let i = i0; i <= i1; i++) {
      const x = centerLon(i);
      while (k < xs.length && xs[k] < x) k++;
      // Inside when an odd number of crossings lie to the left; on the boundary when a crossing equals x.
      let hit = k % 2 === 1 || (k < xs.length && xs[k] === x);
      if (!hit && extra) hit = extra.xs.includes(x) || extra.spans.some(([lo, hi]) => lo <= x && x <= hi);
      if (hit) ids.push(cellId(i, j));
    }
  });
  ids.sort((a, b) => a - b);
  return { cellIds: ids, outsideGrid: false, tooLarge: false };
}

/** Cells whose centre is more than CLAIM_PRIVACY_ZONE_M from both the start and the finish (as the server's `> 300`). */
export function outsidePrivacyZone(cellIds: readonly CellId[], start: Pt, end: Pt): CellId[] {
  const s = { latitude: start.lat, longitude: start.lon };
  const e = { latitude: end.lat, longitude: end.lon };
  return cellIds.filter((id) => {
    const c = cellCenter(id);
    return distanceMeters(c, s) > CLAIM_PRIVACY_ZONE_M && distanceMeters(c, e) > CLAIM_PRIVACY_ZONE_M;
  });
}

export type ClaimPreviewStatus = 'claims' | 'nearStartOnly' | 'notLoop' | 'flagged' | 'tooSmall' | 'tooLarge' | 'outsideGrid' | 'optedOut';

export type ClaimPreview = {
  status: ClaimPreviewStatus;
  /** Cells the loop would claim (0 unless status is 'claims'). */
  cells: number;
  cellIds: CellId[];
  /** Estimated loop area, or null when the run is not a loop. */
  areaM2: number | null;
};

const none = (status: ClaimPreviewStatus, areaM2: number | null): ClaimPreview => ({ status, cells: 0, cellIds: [], areaM2 });

/**
 * Estimate what a finished run would claim. `optedIn` is the user's territory setting (on by
 * default, Addendum D); the server re-checks it and the current month when the run syncs.
 */
export function previewClaim(points: readonly TrackPoint[], o: { optedIn?: boolean } = {}): ClaimPreview {
  if (o.optedIn === false) return none('optedOut', null);
  const metrics = computeTrackMetrics(points, 'run');
  if (!metrics.isLoop) return none('notLoop', null);
  const flags = expectedFlags(metrics);
  if (flags.includes('vehicle') || flags.includes('implausible_effort')) return none('flagged', null);
  const areaM2 = loopAreaM2(points);
  if (areaM2 < CLAIM_MIN_AREA_M2) return none('tooSmall', areaM2);
  if (areaM2 > CLAIM_MAX_AREA_M2) return none('tooLarge', areaM2);
  const loop = cellsInLoop(points);
  if (loop.outsideGrid) return none('outsideGrid', areaM2);
  if (loop.tooLarge) return none('tooLarge', areaM2);
  const cellIds = outsidePrivacyZone(loop.cellIds, points[0], points[points.length - 1]);
  if (cellIds.length === 0) return none('nearStartOnly', areaM2);
  return { status: 'claims', cells: cellIds.length, cellIds, areaM2 };
}

/**
 * One line for the recorder summary or activity detail, or null when there is nothing to say.
 * `local`: the run stays on this phone (signed out), so the count is final rather than an estimate.
 */
export function previewClaimText(p: ClaimPreview, o: { local?: boolean } = {}): string | null {
  switch (p.status) {
    case 'claims': {
      if (p.cells <= 0) return null;
      const squares = `${p.cells} territory ${p.cells === 1 ? 'square' : 'squares'}`;
      return o.local ? `Claimed ${squares}` : `About ${squares} · ${PREVIEW_LABEL.toLowerCase()}`;
    }
    case 'nearStartOnly':
      return 'No territory: squares within 300 m of your start and finish are never claimed.';
    case 'tooSmall':
      return 'Loop too small to claim territory (needs about 2 hectares inside).';
    case 'tooLarge':
      return 'Loop too large to claim territory.';
    case 'outsideGrid':
      return 'Territory covers Greater Boston only.';
    case 'notLoop':
    case 'flagged':
    case 'optedOut':
      return null;
  }
}
