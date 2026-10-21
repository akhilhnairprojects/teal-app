import { figure8Run, legsTrack, loopRun, LOOP_SIDE_M, offset } from '@/activity/__fixtures__/tracks';
import { round6, type TrackPoint } from '@/activity/types';

import { cellCenter, cellId, cellIJ, cellOf, GRID } from '../grid';
import { distanceMeters } from '@/lib/geo';

import { CLAIM_PRIVACY_ZONE_M, cellsInLoop, loopAreaM2, outsidePrivacyZone, previewClaim, previewClaimText, PREVIEW_LABEL } from '../preview';

/** Postgres round(float8): round half to even (rint). */
const rint = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/**
 * A port of `public._test_rect` in supabase/tests/territory.sql: a clockwise rectangle (north, east,
 * south, west) at 4 m/s, one point per second, rounded to 6 dp and closing exactly.
 */
function sqlTestRect(lat: number, lon: number, n: number, e: number): TrackPoint[] {
  const legs: [number, number, number][] = [
    [1, 0, n],
    [0, 1, e],
    [-1, 0, n],
    [0, -1, e],
  ];
  const pts: TrackPoint[] = [{ t: 0, lat: round6(lat), lon: round6(lon) }];
  let sn = 0;
  let se = 0;
  let idx = 0;
  for (const [dn, de, len] of legs) {
    const steps = rint(len / 4.0);
    const step = len / steps;
    for (let k = 1; k <= steps; k++) {
      sn += dn * step;
      se += de * step;
      idx++;
      pts.push({
        t: idx * 1000,
        lat: round6(lat + ((sn / 6371000) * 180) / Math.PI),
        lon: round6(lon + ((se / (6371000 * Math.cos(lat * (Math.PI / 180)))) * 180) / Math.PI),
      });
    }
  }
  return pts;
}

/** Exact number of cell centres inside an axis-aligned box (closed). */
function analyticCount(south: number, west: number, north: number, east: number): number {
  const rows = Math.floor((north - GRID.lat0) / GRID.dLat - 0.5) - Math.ceil((south - GRID.lat0) / GRID.dLat - 0.5) + 1;
  const cols = Math.floor((east - GRID.lon0) / GRID.dLon - 0.5) - Math.ceil((west - GRID.lon0) / GRID.dLon - 0.5) + 1;
  return Math.max(rows, 0) * Math.max(cols, 0);
}

const boxOf = (pts: readonly TrackPoint[]) => ({
  south: Math.min(...pts.map((p) => p.lat)),
  north: Math.max(...pts.map((p) => p.lat)),
  west: Math.min(...pts.map((p) => p.lon)),
  east: Math.max(...pts.map((p) => p.lon)),
});

describe('previewClaim: parity with supabase/tests/territory.sql', () => {
  it('claims 35 cells for the 400 m × 400 m loop near Boston Common (the server claimed 35)', () => {
    const pts = sqlTestRect(42.352, -71.07, 400, 400);
    expect(pts[pts.length - 1].lat).toBe(pts[0].lat);
    expect(pts[pts.length - 1].lon).toBe(pts[0].lon);
    const p = previewClaim(pts);
    expect(p.status).toBe('claims');
    // 64 centres lie inside the square; the 300 m zone around the corner start removes 29 (review S4).
    const b = boxOf(pts);
    expect(cellsInLoop(pts).cellIds).toHaveLength(analyticCount(b.south, b.west, b.north, b.east));
    expect(cellsInLoop(pts).cellIds).toHaveLength(64);
    expect(p.cells).toBe(35);
    // The SQL test's bounds: 28–44 cells, 150 000–170 000 m² (the server measured 160 252 m²).
    expect(p.areaM2).toBeGreaterThan(150_000);
    expect(p.areaM2).toBeLessThan(170_000);
    expect(p.cellIds.every((id) => cellOf(cellCenter(id)) === id)).toBe(true);
    const start = { latitude: pts[0].lat, longitude: pts[0].lon };
    expect(p.cellIds.every((id) => distanceMeters(cellCenter(id), start) > CLAIM_PRIVACY_ZONE_M)).toBe(true);
  });

  it('the later overlapping loop claims the same cells as the server and steals 9 from the first', () => {
    const a = new Set(previewClaim(sqlTestRect(42.352, -71.07, 400, 400)).cellIds);
    const b = previewClaim(sqlTestRect(42.352, -71.0676, 400, 400));
    // Cell ids the server claimed for this loop (supabase/tests/territory.sql, B's loop), recorded 2026-10-20.
    const server = [
      7210788, 7210789, 7220788, 7220789, 7230788, 7230789, 7240787, 7240788, 7240789, 7250786, 7250787, 7250788, 7250789, 7260784,
      7260785, 7260786, 7260787, 7260788, 7260789, 7270782, 7270783, 7270784, 7270785, 7270786, 7270787, 7270788, 7270789, 7280782,
      7280783, 7280784, 7280785, 7280786, 7280787, 7280788, 7280789,
    ];
    expect(b.cellIds).toEqual(server);
    expect(b.cellIds.filter((id) => a.has(id))).toHaveLength(9);
  });

  it('drops cells within 300 m of the start or the finish, and says so when nothing is left', () => {
    const start = { lat: 42.352, lon: -71.07 };
    const end = offset(start.lat, start.lon, 0, 1000); // a finish 1 km east (the zone applies to both ends)
    const near = cellOf({ latitude: offset(start.lat, start.lon, 200, 0).lat, longitude: start.lon })!;
    const nearEnd = cellOf({ latitude: end.lat, longitude: end.lon })!;
    const far = cellOf({ latitude: offset(start.lat, start.lon, 600, 500).lat, longitude: offset(start.lat, start.lon, 600, 500).lon })!;
    expect(outsidePrivacyZone([near, nearEnd, far], start, end)).toEqual([far]);
    expect(previewClaimText({ status: 'nearStartOnly', cells: 0, cellIds: [], areaM2: 30_000 })).toMatch(/300 m of your start/);
  });

  it('a 520 m × 10 m loop is a loop but too small; a Manhattan loop is outside the grid', () => {
    const thin = previewClaim(sqlTestRect(42.3, -71.1, 520, 10));
    expect(thin.status).toBe('tooSmall');
    expect(thin.areaM2).toBeLessThan(20_000);
    expect(previewClaim(sqlTestRect(40.78, -73.97, 400, 400)).status).toBe('outsideGrid');
  });
});

describe('previewClaim', () => {
  it('a 1.2 km² square loop claims the analytic number of cells (±2)', () => {
    const pts = loopRun();
    const p = previewClaim(pts);
    expect(p.status).toBe('claims');
    const b = boxOf(pts);
    const inside = cellsInLoop(pts).cellIds;
    expect(Math.abs(inside.length - analyticCount(b.south, b.west, b.north, b.east))).toBeLessThanOrEqual(2);
    expect(p.areaM2! / 1_200_000).toBeCloseTo(1, 2);
    // About area / cell area (50.0 m × 49.3 m).
    expect(inside.length).toBeGreaterThan(470);
    expect(inside.length).toBeLessThan(510);
    // Claimed: those centres minus the 300 m zone at the start/finish.
    expect(p.cellIds).toEqual(outsidePrivacyZone(inside, pts[0], pts[pts.length - 1]));
    expect(p.cells).toBeLessThan(inside.length);
    expect(LOOP_SIDE_M).toBeCloseTo(1095.4, 1);
  });

  it('a figure-8 claims both lobes (even–odd), not the area between them', () => {
    const pts = figure8Run();
    const p = previewClaim(pts);
    expect(p.status).toBe('claims');
    expect(p.areaM2! / 500_000).toBeCloseTo(1, 1);
    const inside = cellsInLoop(pts).cellIds;
    expect(p.cellIds).toEqual(outsidePrivacyZone(inside, pts[0], pts[pts.length - 1]));
    const start = offset(42.36, -71.09, 0, 0);
    const top = offset(42.36, -71.09, 500, 500);
    const bottom = offset(42.36, -71.09, -500, -500);
    const lobeNE = analyticCount(start.lat, start.lon, top.lat, top.lon);
    const lobeSW = analyticCount(bottom.lat, bottom.lon, start.lat, start.lon);
    expect(Math.abs(inside.length - (lobeNE + lobeSW))).toBeLessThanOrEqual(2);
    // Nothing in the north-west or south-east quadrants.
    const nw = cellOf({ latitude: offset(42.36, -71.09, 250, -250).lat, longitude: offset(42.36, -71.09, 250, -250).lon })!;
    const se = cellOf({ latitude: offset(42.36, -71.09, -250, 250).lat, longitude: offset(42.36, -71.09, -250, 250).lon })!;
    expect(p.cellIds).not.toContain(nw);
    expect(p.cellIds).not.toContain(se);
  });

  it('does not claim for a run that does not return to its start, or when opted out', () => {
    const outAndBack = legsTrack([{ headingDeg: 0, meters: 2000, mps: 4 }]);
    expect(previewClaim(outAndBack).status).toBe('notLoop');
    expect(previewClaim(loopRun(), { optedIn: false }).status).toBe('optedOut');
    expect(previewClaimText(previewClaim(outAndBack))).toBeNull();
  });

  it('does not claim for a loop the server would flag (a car leg)', () => {
    const car = legsTrack(
      [
        { headingDeg: 0, meters: 800, mps: 4 },
        { headingDeg: 90, meters: 3000, mps: 15 },
        { headingDeg: 180, meters: 800, mps: 4 },
        { headingDeg: 270, meters: 3000, mps: 4 },
      ],
      { lat: 42.35, lon: -71.1 },
    );
    expect(previewClaim(car).status).toBe('flagged');
  });

  it('labels the estimate', () => {
    expect(previewClaimText(previewClaim(sqlTestRect(42.352, -71.07, 400, 400)))).toBe(
      `About 35 territory squares · ${PREVIEW_LABEL.toLowerCase()}`,
    );
    // Signed out the run stays on this phone, so the count is final.
    expect(previewClaimText(previewClaim(sqlTestRect(42.352, -71.07, 400, 400)), { local: true })).toBe('Claimed 35 territory squares');
  });
});

describe('cellsInLoop boundary rules (ST_Intersects counts the boundary)', () => {
  const j = 800;
  const i = 700;
  const y = GRID.lat0 + (j + 0.5) * GRID.dLat; // a centre row
  const x = GRID.lon0 + (i + 0.5) * GRID.dLon; // a centre column
  const pt = (lat: number, lon: number) => ({ lat, lon });

  it('includes centres on a horizontal edge', () => {
    // A rectangle whose bottom edge runs exactly through centre row j.
    const ring = [pt(y, x - 0.002), pt(y, x + 0.002), pt(y + 0.001, x + 0.002), pt(y + 0.001, x - 0.002)];
    const ids = cellsInLoop(ring).cellIds;
    expect(ids).toContain(cellId(i, j));
    expect(ids.filter((id) => cellIJ(id).j === j)).toHaveLength(7);
  });

  it('includes a centre at a top vertex (both edges go down) and at a bottom vertex', () => {
    const top = [pt(y, x), pt(y - 0.0003, x + 0.0004), pt(y - 0.0003, x - 0.0004)];
    expect(cellsInLoop(top).cellIds).toContain(cellId(i, j));
    const bottom = [pt(y, x), pt(y + 0.0003, x + 0.0004), pt(y + 0.0003, x - 0.0004)];
    expect(cellsInLoop(bottom).cellIds).toContain(cellId(i, j));
  });

  it('excludes centres just outside', () => {
    const ring = [pt(y + 1e-9, x - 0.002), pt(y + 1e-9, x + 0.002), pt(y + 0.001, x + 0.002), pt(y + 0.001, x - 0.002)];
    expect(cellsInLoop(ring).cellIds).not.toContain(cellId(i, j));
  });

  it('clips to the grid and skips huge boxes', () => {
    expect(cellsInLoop([pt(41.0, -71.0), pt(41.01, -71.0), pt(41.01, -70.99)]).outsideGrid).toBe(true);
    expect(cellsInLoop([pt(42.0, -71.5), pt(42.6, -71.5), pt(42.6, -70.6)]).tooLarge).toBe(true);
  });

  it('measures the even–odd area', () => {
    const sq = sqlTestRect(42.352, -71.07, 400, 400);
    expect(loopAreaM2(sq) / 160_000).toBeCloseTo(1, 2);
    expect(loopAreaM2([])).toBe(0);
  });
});
