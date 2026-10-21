import { cellBounds, cellId, GRID } from '../grid';
import {
  aggregateSuperCells,
  layoutTerritory,
  mergeRuns,
  rectBounds,
  rectPolygon,
  squaresOf,
  type OwnedSquare,
} from '../merge';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const sq = (i: number, j: number, ownerId = A): OwnedSquare => ({ i, j, ownerId });

describe('mergeRuns', () => {
  it('collapses adjacent cells of one owner in a row into one rectangle', () => {
    expect(mergeRuns([sq(3, 5), sq(1, 5), sq(2, 5)])).toEqual([{ ownerId: A, i0: 1, i1: 3, j0: 5, j1: 5, scale: 1 }]);
  });

  it('never merges different owners, and splits a row at gaps', () => {
    const rects = mergeRuns([sq(1, 5), sq(2, 5, B), sq(3, 5), sq(5, 5)]);
    expect(rects).toEqual([
      { ownerId: A, i0: 1, i1: 1, j0: 5, j1: 5, scale: 1 },
      { ownerId: B, i0: 2, i1: 2, j0: 5, j1: 5, scale: 1 },
      { ownerId: A, i0: 3, i1: 3, j0: 5, j1: 5, scale: 1 },
      { ownerId: A, i0: 5, i1: 5, j0: 5, j1: 5, scale: 1 },
    ]);
  });

  it('stacks identical runs on consecutive rows and keeps rows correct otherwise', () => {
    const square = [];
    for (let j = 10; j < 18; j++) for (let i = 20; i < 28; i++) square.push(sq(i, j));
    expect(mergeRuns(square)).toEqual([{ ownerId: A, i0: 20, i1: 27, j0: 10, j1: 17, scale: 1 }]);

    // An L shape: two rows of 3, then one row of 1; a skipped row starts a new rectangle.
    const rects = mergeRuns([sq(0, 0), sq(1, 0), sq(2, 0), sq(0, 1), sq(1, 1), sq(2, 1), sq(0, 2), sq(0, 4), sq(1, 4), sq(2, 4)]);
    expect(rects).toEqual([
      { ownerId: A, i0: 0, i1: 2, j0: 0, j1: 1, scale: 1 },
      { ownerId: A, i0: 0, i1: 0, j0: 2, j1: 2, scale: 1 },
      { ownerId: A, i0: 0, i1: 2, j0: 4, j1: 4, scale: 1 },
    ]);
  });

  it('covers every input cell exactly once', () => {
    const cells: OwnedSquare[] = [];
    for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i++) if ((i * 7 + j * 3) % 5 !== 0) cells.push(sq(i, j, (i + j) % 3 ? A : B));
    const rects = mergeRuns(cells);
    const covered = new Map<string, string>();
    for (const r of rects) {
      for (let j = r.j0; j <= r.j1; j++) {
        for (let i = r.i0; i <= r.i1; i++) {
          expect(covered.has(`${i}:${j}`)).toBe(false);
          covered.set(`${i}:${j}`, r.ownerId);
        }
      }
    }
    expect(covered.size).toBe(cells.length);
    for (const c of cells) expect(covered.get(`${c.i}:${c.j}`)).toBe(c.ownerId);
    expect(rects.length).toBeLessThan(cells.length);
  });

  it('keeps the first owner of a duplicated cell', () => {
    expect(mergeRuns([sq(1, 1), sq(1, 1, B), sq(2, 1)])).toEqual([{ ownerId: A, i0: 1, i1: 2, j0: 1, j1: 1, scale: 1 }]);
  });
});

describe('super-cells', () => {
  it('colors a 4×4 block by its majority owner, ties to the smaller id', () => {
    const cells = [sq(0, 0), sq(1, 0), sq(2, 0, B), sq(5, 5, B), sq(6, 5), sq(9, 9, B)];
    const supers = aggregateSuperCells(cells, 4);
    expect(supers).toEqual(
      expect.arrayContaining([
        { i: 0, j: 0, ownerId: A },
        { i: 1, j: 1, ownerId: A }, // 1 A vs 1 B: A < B
        { i: 2, j: 2, ownerId: B },
      ]),
    );
    expect(supers).toHaveLength(3);
  });

  it('switches to 4×4 super-cells when zoomed out and draws them at their scale', () => {
    const cells = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) cells.push({ cellId: cellId(100 + i, 200 + j), ownerId: A });
    const near = layoutTerritory(cells, { latitudeDelta: 0.02 });
    expect(near.scale).toBe(1);
    expect(near.rects).toEqual([{ ownerId: A, i0: 100, i1: 107, j0: 200, j1: 207, scale: 1 }]);
    const far = layoutTerritory(cells, { latitudeDelta: 0.1 });
    expect(far.scale).toBe(4);
    expect(far.rects).toEqual([{ ownerId: A, i0: 25, i1: 26, j0: 50, j1: 51, scale: 4 }]);
    // Same footprint either way.
    expect(rectBounds(far.rects[0])).toEqual(rectBounds(near.rects[0]));
    expect(rectBounds(near.rects[0]).south).toBeCloseTo(cellBounds(cellId(100, 200)).south, 12);
  });

  it('coarsens until under the polygon cap, then caps', () => {
    // A checkerboard of two owners: nothing merges at cell level.
    const cells = [];
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) cells.push({ cellId: cellId(i, j), ownerId: (i + j) % 2 ? A : B });
    const l = layoutTerritory(cells, { latitudeDelta: 0.01, maxPolygons: 600 });
    expect(l.rects.length).toBeLessThanOrEqual(600);
    expect(l.scale).toBeGreaterThan(1);
    expect(l.capped).toBe(false);
    const tiny = layoutTerritory(cells, { latitudeDelta: 0.01, maxPolygons: 0 });
    expect(tiny).toMatchObject({ rects: [], capped: true });
  });
});

describe('geometry', () => {
  it('turns a rectangle into its four corners on the grid', () => {
    const [sw, se, ne, nw] = rectPolygon({ ownerId: A, i0: 2, i1: 3, j0: 4, j1: 4, scale: 1 });
    expect(sw.latitude).toBeCloseTo(GRID.lat0 + 4 * GRID.dLat, 12);
    expect(sw.longitude).toBeCloseTo(GRID.lon0 + 2 * GRID.dLon, 12);
    expect(se.longitude).toBeCloseTo(GRID.lon0 + 4 * GRID.dLon, 12);
    expect(ne.latitude).toBeCloseTo(GRID.lat0 + 5 * GRID.dLat, 12);
    expect(nw.longitude).toBeCloseTo(sw.longitude, 12);
  });

  it('reads squares from cell ids', () => {
    expect(squaresOf([{ cellId: 7290791, ownerId: A }])).toEqual([{ i: 729, j: 791, ownerId: A }]);
  });
});
