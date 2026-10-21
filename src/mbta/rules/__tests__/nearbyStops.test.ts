// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/repositories/NearbyRepositoryTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
import type { LatLng, RouteType } from '@/mbta/model/types';
import { createBuilder, type Builder } from '@/mbta/testing/builders';

import { nearbyStopIds } from '../nearbyStops';

const SEARCH: LatLng = { latitude: 42.3513706803105, longitude: -71.06649626809957 };
const EARTH_RADIUS_M = 6_371_000;
const MILE = 1609.344;

let bearingSeed = 0;
/** A point `miles` from the search point on a varying bearing (Kotlin used a random bearing). */
function pointAtDistance(miles: number): LatLng {
  const bearing = ((bearingSeed++ * 137.5) % 360) * (Math.PI / 180);
  const d = (miles * MILE) / EARTH_RADIUS_M;
  const lat1 = (SEARCH.latitude * Math.PI) / 180;
  const lon1 = (SEARCH.longitude * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: (lat2 * 180) / Math.PI, longitude: (lon2 * 180) / Math.PI };
}

function rpsAtDistance(b: Builder, miles: number, routeType: RouteType, headsign: string, byStop: Record<string, string[]>) {
  const route = b.route({ type: routeType });
  const pattern = b.pattern(route, { typicality: 'typical', representativeTrip: { headsign } });
  const stop = b.stop({ ...pointAtDistance(miles), vehicleType: routeType });
  (byStop[stop.id] ??= []).push(pattern.id);
  return { route, pattern, stop };
}

describe('nearbyStopIds (NearbyRepository)', () => {
  it('finds points within smaller radius', () => {
    const b = createBuilder();
    const byStop: Record<string, string[]> = {};
    const { stop: nearbySubway } = rpsAtDistance(b, 0.49, 1, 'Nearby Subway', byStop);
    rpsAtDistance(b, 0.51, 1, 'Distant Subway', byStop);
    const { stop: nearbyCR } = rpsAtDistance(b, 0.99, 2, 'Nearby Commuter Rail', byStop);
    rpsAtDistance(b, 1.01, 2, 'Distant Commuter Rail', byStop);
    expect(nearbyStopIds(b.global({ patternIdsByStop: byStop }), SEARCH)).toEqual([nearbySubway.id, nearbyCR.id]);
  });

  it('includes nearby child stops only and not stations', () => {
    const b = createBuilder();
    const route = b.route({ type: 1 });
    const pattern = b.pattern(route);
    b.stop({ id: 'station1', locationType: 1, ...pointAtDistance(0.01), childStopIds: ['stop1'] });
    const stop1 = b.stop({ id: 'stop1', ...pointAtDistance(0.01), vehicleType: 1, parentStationId: 'station1' });
    expect(nearbyStopIds(b.global({ patternIdsByStop: { [stop1.id]: [pattern.id] } }), SEARCH)).toEqual([stop1.id]);
  });

  it('does not filter stops that are redundant to closer ones based on route patterns served', () => {
    const b = createBuilder();
    const route = b.route({ type: 1 });
    const all = b.pattern(route);
    const p3 = b.pattern(route);
    b.stop({ id: 'station', ...pointAtDistance(0.01), childStopIds: ['stop1', 'stop1Node'] });
    const stop1 = b.stop({ id: 'stop1', ...pointAtDistance(0.01), vehicleType: 1, parentStationId: 'station' });
    const stop2 = b.stop({ id: 'stop2', ...pointAtDistance(0.02), vehicleType: 1 });
    const stop3 = b.stop({ id: 'stop3', ...pointAtDistance(0.03), vehicleType: 1 });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [all.id], [stop2.id]: [all.id], [stop3.id]: [all.id, p3.id] } });
    expect(nearbyStopIds(g, SEARCH)).toEqual([stop1.id, stop2.id, stop3.id]);
  });

  it('filters stops that are in the blocklist', () => {
    const b = createBuilder();
    const route = b.route({ type: 1 });
    const blocked = b.stop({ id: 'station', ...pointAtDistance(0.01), childStopIds: ['stop1', 'stop1Node'] });
    const stop1 = b.stop({ id: 'stop1', ...pointAtDistance(0.01), vehicleType: 1, parentStationId: 'station' });
    const good = b.stop({ id: 'stop2', ...pointAtDistance(0.02), vehicleType: 1 });
    const g = b.global({ patternIdsByStop: { [stop1.id]: [b.pattern(route).id], [good.id]: [b.pattern(route).id] } });
    expect(nearbyStopIds(g, SEARCH, [blocked.id])).toEqual([good.id]);
  });

  it('blocks Symphony by default', () => {
    const b = createBuilder();
    b.stop({ id: 'place-symcl', locationType: 1, ...pointAtDistance(0.01), childStopIds: ['70241'] });
    b.stop({ id: '70241', ...pointAtDistance(0.01), vehicleType: 0, parentStationId: 'place-symcl' });
    const other = b.stop({ id: 'other', ...pointAtDistance(0.02), vehicleType: 0 });
    expect(nearbyStopIds(b.global(), SEARCH)).toEqual([other.id]);
  });

  it('falls back to larger radius', () => {
    const b = createBuilder();
    const byStop: Record<string, string[]> = {};
    const { stop: nearbySubway } = rpsAtDistance(b, 1.99, 1, 'Nearby Subway', byStop);
    rpsAtDistance(b, 2.01, 1, 'Distant Subway', byStop);
    const { stop: nearbyCR } = rpsAtDistance(b, 9.99, 2, 'Nearby Commuter Rail', byStop);
    rpsAtDistance(b, 10.01, 2, 'Distant Commuter Rail', byStop);
    expect(nearbyStopIds(b.global({ patternIdsByStop: byStop }), SEARCH)).toEqual([nearbySubway.id, nearbyCR.id]);
  });

  it('finds nothing if outside search area', () => {
    const b = createBuilder();
    const byStop: Record<string, string[]> = {};
    rpsAtDistance(b, 2.01, 1, 'Distant Subway', byStop);
    rpsAtDistance(b, 10.01, 2, 'Distant Commuter Rail', byStop);
    expect(nearbyStopIds(b.global({ patternIdsByStop: byStop }), SEARCH)).toEqual([]);
  });
});
