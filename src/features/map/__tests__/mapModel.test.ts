import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';

import { expandRouteIds, mapStations, shapeLines, STATION_ZOOM_LIMIT, visibleStations, withAlpha } from '../mapModel';

function network() {
  const b = createBuilder();
  redLine(b);
  greenLine(b);
  return b.global();
}

describe('mapModel', () => {
  it('expands line ids to their routes and drops unknown ids', () => {
    const g = network();
    expect(expandRouteIds(g, ['line-Green'])).toEqual(['Green-B', 'Green-C', 'Green-D', 'Green-E']);
    expect(expandRouteIds(g, ['Red', 'nope'])).toEqual(['Red']);
    expect(expandRouteIds(g, undefined)).toEqual([]);
    expect(expandRouteIds(null, ['Red'])).toEqual([]);
  });

  it('marks stations served by two lines as transfers (Green branches count once)', () => {
    const g = network();
    const byId = Object.fromEntries(mapStations(g).map((s) => [s.id, s]));
    expect(byId['place-pktrm']).toMatchObject({ transfer: true, color: null, lineIds: ['line-Green', 'line-Red'] });
    expect(byId['place-kencl']).toMatchObject({ transfer: false, color: '#00843D', lineIds: ['line-Green'] });
    expect(byId['place-jfk']).toMatchObject({ transfer: false, color: '#DA291C' });
  });

  it('shows only transfer (and focused) stations when zoomed out', () => {
    const stations = mapStations(network());
    expect(visibleStations(stations, STATION_ZOOM_LIMIT, null)).toHaveLength(stations.length);
    const far = visibleStations(stations, 0.5, 'place-jfk').map((s) => s.id);
    expect(far).toContain('place-pktrm');
    expect(far).toContain('place-jfk');
    expect(far).not.toContain('place-kencl');
  });

  it('dims routes outside the emphasis and draws emphasized ones last', () => {
    const g = network();
    const coords = [
      { latitude: 42.35, longitude: -71.06 },
      { latitude: 42.36, longitude: -71.05 },
    ];
    const shapes = {
      Red: [{ shapeId: 'r', directionId: 0 as const, coordinates: coords }],
      'Green-B': [{ shapeId: 'b', directionId: 0 as const, coordinates: coords }],
      'Green-C': [{ shapeId: 'c', directionId: 0 as const, coordinates: coords.slice(0, 1) }],
    };
    const lines = shapeLines(g, shapes, ['Red']);
    expect(lines.map((l) => [l.routeId, l.dimmed])).toEqual([
      ['Green-B', true],
      ['Red', false],
    ]);
    expect(shapeLines(g, shapes, []).every((l) => !l.dimmed)).toBe(true);
  });

  it('converts hex colors to rgba', () => {
    expect(withAlpha('#DA291C', 0.3)).toBe('rgba(218, 41, 28, 0.3)');
    expect(withAlpha('red', 0.3)).toBe('red');
  });
});
