import { cellBounds, cellCenter, cellIJ, cellId, cellOf, GRID } from '../grid';

describe('territory grid', () => {
  it('maps known points to cell ids (same integer math as private.grid_i / grid_j)', () => {
    // Park Street: i = floor((−71.0624 + 71.5) / 0.0006) = 729, j = floor((42.35639 − 42) / 0.00045) = 791.
    expect(cellOf({ latitude: 42.35639, longitude: -71.0624 })).toBe(729 * 10000 + 791);
    expect(cellOf({ latitude: 42.0, longitude: -71.5 })).toBe(0);
    expect(cellOf({ latitude: 42.0 + 1555.5 * GRID.dLat, longitude: -71.5 + 1500.5 * GRID.dLon })).toBe(1500 * 10000 + 1555);
  });

  it('returns null outside the box', () => {
    expect(cellOf({ latitude: 41.99999, longitude: -71.2 })).toBeNull();
    expect(cellOf({ latitude: 42.3, longitude: -71.50001 })).toBeNull();
    expect(cellOf({ latitude: 42.0 + 1556.01 * GRID.dLat, longitude: -71.2 })).toBeNull();
    expect(cellOf({ latitude: 42.3, longitude: -71.5 + 1501.01 * GRID.dLon })).toBeNull();
    expect(cellOf({ latitude: 40.7128, longitude: -74.006 })).toBeNull();
    expect(cellOf({ latitude: NaN, longitude: -71 })).toBeNull();
  });

  it('has exact edges: points just inside a cell map to it, just outside to the neighbour', () => {
    const id = cellId(729, 791);
    const b = cellBounds(id);
    const eps = 1e-9;
    expect(cellOf({ latitude: b.south + eps, longitude: b.west + eps })).toBe(id);
    expect(cellOf({ latitude: b.north - eps, longitude: b.east - eps })).toBe(id);
    expect(cellOf({ latitude: b.north + eps, longitude: b.west + eps })).toBe(cellId(729, 792));
    expect(cellOf({ latitude: b.south + eps, longitude: b.east + eps })).toBe(cellId(730, 791));
    expect(cellOf({ latitude: b.south - eps, longitude: b.west - eps })).toBe(cellId(728, 790));
    expect(b.north - b.south).toBeCloseTo(GRID.dLat, 12);
    expect(b.east - b.west).toBeCloseTo(GRID.dLon, 12);
  });

  it('round-trips cellOf(cellCenter(id)) for cells across the whole box', () => {
    for (let i = 0; i <= GRID.iMax; i += 37) {
      for (let j = 0; j <= GRID.jMax; j += 41) {
        const id = cellId(i, j);
        expect(cellIJ(id)).toEqual({ i, j });
        expect(cellOf(cellCenter(id))).toBe(id);
      }
    }
  });
});
