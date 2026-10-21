// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/DirectionTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// TestData is replaced by the hand-built networks in src/mbta/testing/fixtures.ts.
import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';

import { directionFor, directionLabel, getDirectionForPattern, getDirections, getDirectionsForLine } from '../direction';

describe('Direction', () => {
  it('basic case gets correct values', () => {
    const b = createBuilder();
    const route = b.route({ directionNames: ['Wrong Name', 'Right Name'], directionDestinations: ['Wrong Destination', 'Right Destination'] });
    expect(directionFor(1, route)).toEqual({ id: 1, name: 'Right Name', destination: 'Right Destination' });
  });

  it('special cases get correct values', () => {
    const b = createBuilder();
    const gl = greenLine(b);
    const red = redLine(b);
    const arlington = gl.stations['place-armnl'];
    const savinHill = red.stations['place-shmnl'];

    const glWest = directionFor(0, gl.routes.b, arlington, ['place-gover', 'place-pktrm', 'place-armnl', 'place-hymnl', 'place-kencl', 'place-lake']);
    expect(glWest).toMatchObject({ name: 'West', destination: 'Copley & West' });
    const glEast = directionFor(1, gl.routes.b, arlington, ['place-lake', 'place-kencl', 'place-hymnl', 'place-armnl', 'place-pktrm', 'place-gover']);
    expect(glEast).toMatchObject({ name: 'East', destination: 'Gov Ctr & North' });
    const rlSouth = directionFor(0, red.route, savinHill, ['place-alfcl', 'place-jfk', 'place-shmnl', 'place-asmnl']);
    expect(rlSouth).toMatchObject({ name: 'South', destination: 'Ashmont' });
    const rlNorth = directionFor(1, red.route, savinHill, ['place-asmnl', 'place-shmnl', 'place-jfk', 'place-alfcl']);
    expect(rlNorth).toMatchObject({ name: 'North', destination: 'Alewife' });
  });

  const backOfTheHill = () => {
    const b = createBuilder();
    const gl = greenLine(b);
    const stop = gl.stations['place-bckhl'];
    const route = gl.routes.e;
    return { b, gl, stop, route };
  };

  it('both direction helper provides correct values', () => {
    const { b, gl, stop, route } = backOfTheHill();
    const rp1 = b.pattern(route, {
      id: 'rp1',
      directionId: 0,
      typicality: 'atypical',
      representativeTrip: { stopIds: ['place-mdftf', 'place-armnl', 'place-bckhl', 'place-hsmnl'] },
    });
    const patterns = [rp1, gl.patterns.e.west, gl.patterns.e.east];
    const g = b.global({ patternIdsByStop: { [stop.id]: patterns.map((p) => p.id) } });
    const directions = getDirections(g, stop, route, patterns);
    expect(directions[0].destination).toBe('Heath Street');
    expect(directions[1].destination).toBe('Park St & North');
  });

  it('atypical headsigns override route destination', () => {
    const { b, gl, stop, route } = backOfTheHill();
    const rp1 = b.pattern(route, {
      id: 'rp1',
      directionId: 0,
      typicality: 'atypical',
      representativeTrip: { headsign: 'Other Headsign', stopIds: ['place-mdftf', 'place-armnl', 'place-bckhl', 'place-hsmnl'] },
    });
    const patterns = [rp1, gl.patterns.e.west, gl.patterns.e.east];
    const g = b.global({ patternIdsByStop: { [stop.id]: patterns.map((p) => p.id) } });
    expect(getDirectionForPattern(g, stop, route, rp1).destination).toBe('Other Headsign');
    expect(getDirectionForPattern(g, stop, route, gl.patterns.e.west).destination).toBe('Heath Street');
    expect(getDirectionForPattern(g, stop, route, gl.patterns.e.east).destination).toBe('Park St & North');
  });

  it('getDirectionsForLine at different stops along the GL', () => {
    const b = createBuilder();
    const gl = greenLine(b);
    const g = b.global();
    const s = gl.stations;
    const { b: B, c: C, e: E } = gl.patterns;
    const dir = (id: 0 | 1, name: string, destination: string | null) => ({ id, name, destination });

    expect(getDirectionsForLine(g, s['place-sougr'], [B.west, B.east])).toEqual([dir(0, 'West', 'Boston College'), dir(1, 'East', 'Park St & North')]);
    expect(getDirectionsForLine(g, s['place-kencl'], [B.west, B.east, C.west, C.east])).toEqual([dir(0, 'West', null), dir(1, 'East', 'Park St & North')]);
    expect(getDirectionsForLine(g, s['place-hymnl'], [B.west, B.east, C.west, C.east])).toEqual([
      dir(0, 'West', 'Kenmore & West'),
      dir(1, 'East', 'Park St & North'),
    ]);
    expect(getDirectionsForLine(g, s['place-gover'], [B.west, B.east, C.west, C.east, E.west, E.east])).toEqual([
      dir(0, 'West', 'Copley & West'),
      dir(1, 'East', 'North Station & North'),
    ]);
    expect(getDirectionsForLine(g, s['place-mgngl'], [E.west, E.east])).toEqual([dir(0, 'West', 'Copley & West'), dir(1, 'East', 'Medford/Tufts')]);
  });

  it('labels directions', () => {
    expect(directionLabel({ id: 0, name: 'South', destination: 'Ashmont' })).toBe('Southbound to Ashmont');
    expect(directionLabel({ id: 0, name: 'West', destination: null })).toBe('Westbound');
    expect(directionLabel({ id: 0, name: '', destination: 'Heath Street' })).toBe('Heath Street');
  });
});
