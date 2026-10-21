/**
 * Turn territory cells into few map polygons (spec G4 layer): horizontal run-length rectangles per
 * owner, stacked when consecutive rows have the same run, with 4×4 (or coarser) majority-owner
 * super-cells when zoomed out or when the view would need more than the polygon cap.
 */
import type { LatLng } from '@/lib/geo';

import { cellIJ, GRID, type CellId } from './grid';

/** A grid square at some scale: `scale` 1 is a cell, 4 is a 4×4 super-cell. */
export type OwnedSquare = { i: number; j: number; ownerId: string };

/** Columns i0…i1 by rows j0…j1 (inclusive) of squares at `scale`, all owned by `ownerId`. */
export type OwnerRect = { ownerId: string; i0: number; i1: number; j0: number; j1: number; scale: number };

/** Draw at most this many polygons. */
export const MAX_POLYGONS = 600;
/** Aggregate to super-cells when the map's latitudeDelta is above this. */
export const SUPER_CELL_DELTA = 0.08;
export const SUPER_CELL_FACTOR = 4;
const MAX_SCALE = 64;

export function squaresOf(cells: readonly { cellId: CellId; ownerId: string }[]): OwnedSquare[] {
  return cells.map((c) => ({ ...cellIJ(c.cellId), ownerId: c.ownerId }));
}

/**
 * Merge squares into rectangles. Each row collapses into runs of consecutive columns with one
 * owner; a run identical to one in the row below extends that rectangle upward. Different owners
 * never merge. Duplicate squares keep their first owner.
 */
export function mergeRuns(squares: readonly OwnedSquare[], scale = 1): OwnerRect[] {
  const sorted = [...squares].sort((a, b) => a.j - b.j || a.i - b.i);
  const out: OwnerRect[] = [];
  let open = new Map<string, OwnerRect>(); // runs ending on the previous row, by owner:i0:i1
  let k = 0;
  while (k < sorted.length) {
    const j = sorted[k].j;
    const nextOpen = new Map<string, OwnerRect>();
    while (k < sorted.length && sorted[k].j === j) {
      const start = sorted[k];
      let i1 = start.i;
      k++;
      while (k < sorted.length && sorted[k].j === j && sorted[k].i <= i1 + 1) {
        if (sorted[k].i === i1 + 1) {
          if (sorted[k].ownerId !== start.ownerId) break;
          i1++;
        }
        k++; // a duplicate square (same i) is skipped
      }
      const key = `${start.ownerId}:${start.i}:${i1}`;
      const below = open.get(key);
      if (below && below.j1 === j - 1) {
        below.j1 = j;
        nextOpen.set(key, below);
      } else {
        const rect = { ownerId: start.ownerId, i0: start.i, i1, j0: j, j1: j, scale };
        out.push(rect);
        nextOpen.set(key, rect);
      }
    }
    open = nextOpen;
  }
  return out;
}

/**
 * Group squares into `factor`×`factor` super-squares owned by the owner with the most squares in
 * each (ties: the smaller owner id, so the result is stable).
 */
export function aggregateSuperCells(squares: readonly OwnedSquare[], factor = SUPER_CELL_FACTOR): OwnedSquare[] {
  const counts = new Map<string, { i: number; j: number; byOwner: Map<string, number> }>();
  for (const s of squares) {
    const i = Math.floor(s.i / factor);
    const j = Math.floor(s.j / factor);
    const key = `${i}:${j}`;
    let entry = counts.get(key);
    if (!entry) counts.set(key, (entry = { i, j, byOwner: new Map() }));
    entry.byOwner.set(s.ownerId, (entry.byOwner.get(s.ownerId) ?? 0) + 1);
  }
  const out: OwnedSquare[] = [];
  for (const { i, j, byOwner } of counts.values()) {
    let best: string | null = null;
    let bestN = 0;
    for (const [owner, n] of byOwner) {
      if (n > bestN || (n === bestN && best !== null && owner < best)) {
        best = owner;
        bestN = n;
      }
    }
    if (best !== null) out.push({ i, j, ownerId: best });
  }
  return out;
}

export type TerritoryLayout = { rects: OwnerRect[]; scale: number; capped: boolean };

/**
 * The rectangles to draw: cell-level when zoomed in, 4×4 super-cells when `latitudeDelta` > 0.08,
 * and coarser super-cells (8, 16, …) while the result still exceeds `maxPolygons`. If even the
 * coarsest level is too many, the first `maxPolygons` are drawn and `capped` is set.
 */
export function layoutTerritory(
  cells: readonly { cellId: CellId; ownerId: string }[],
  o: { latitudeDelta: number; maxPolygons?: number },
): TerritoryLayout {
  const max = o.maxPolygons ?? MAX_POLYGONS;
  const squares = squaresOf(cells);
  let scale = o.latitudeDelta > SUPER_CELL_DELTA ? SUPER_CELL_FACTOR : 1;
  let rects = mergeRuns(scale === 1 ? squares : aggregateSuperCells(squares, scale), scale);
  while (rects.length > max && scale < MAX_SCALE) {
    scale = scale === 1 ? SUPER_CELL_FACTOR : scale * 2;
    rects = mergeRuns(aggregateSuperCells(squares, scale), scale);
  }
  return rects.length > max ? { rects: rects.slice(0, max), scale, capped: true } : { rects, scale, capped: false };
}

export function rectBounds(r: OwnerRect): { south: number; west: number; north: number; east: number } {
  return {
    south: GRID.lat0 + r.j0 * r.scale * GRID.dLat,
    north: GRID.lat0 + (r.j1 + 1) * r.scale * GRID.dLat,
    west: GRID.lon0 + r.i0 * r.scale * GRID.dLon,
    east: GRID.lon0 + (r.i1 + 1) * r.scale * GRID.dLon,
  };
}

/** The rectangle's corners, counter-clockwise from the south-west. */
export function rectPolygon(r: OwnerRect): LatLng[] {
  const b = rectBounds(r);
  return [
    { latitude: b.south, longitude: b.west },
    { latitude: b.south, longitude: b.east },
    { latitude: b.north, longitude: b.east },
    { latitude: b.north, longitude: b.west },
  ];
}

export const rectKey = (r: OwnerRect): string => `${r.scale}:${r.ownerId}:${r.i0}:${r.i1}:${r.j0}:${r.j1}`;
