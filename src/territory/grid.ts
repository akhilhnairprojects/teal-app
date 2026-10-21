/**
 * The territory grid (spec §2.7): an equal-angle grid over Greater Boston, about 50 m × 49 m cells.
 * The same integer math runs in PostGIS (private.grid_i / grid_j), so a cell id means the same cell
 * on both sides. Points outside the box have no cell.
 */
import type { LatLng } from '@/lib/geo';

export const GRID = { lat0: 42.0, lon0: -71.5, dLat: 0.00045, dLon: 0.0006, iMax: 1500, jMax: 1555 } as const;

/** cell_id = i · 10000 + j. */
export type CellId = number;

const ID_BASE = 10000;

export function cellOf(p: LatLng): CellId | null {
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null;
  const i = Math.floor((p.longitude - GRID.lon0) / GRID.dLon);
  const j = Math.floor((p.latitude - GRID.lat0) / GRID.dLat);
  if (i < 0 || i > GRID.iMax || j < 0 || j > GRID.jMax) return null;
  return i * ID_BASE + j;
}

export function cellIJ(id: CellId): { i: number; j: number } {
  return { i: Math.floor(id / ID_BASE), j: id % ID_BASE };
}

export const cellId = (i: number, j: number): CellId => i * ID_BASE + j;

export function cellBounds(id: CellId): { south: number; west: number; north: number; east: number } {
  const { i, j } = cellIJ(id);
  return {
    south: GRID.lat0 + j * GRID.dLat,
    west: GRID.lon0 + i * GRID.dLon,
    north: GRID.lat0 + (j + 1) * GRID.dLat,
    east: GRID.lon0 + (i + 1) * GRID.dLon,
  };
}

/** The cell's centre (the point the server tests against a loop polygon). */
export function cellCenter(id: CellId): LatLng {
  const { i, j } = cellIJ(id);
  return { latitude: GRID.lat0 + (j + 0.5) * GRID.dLat, longitude: GRID.lon0 + (i + 0.5) * GRID.dLon };
}
