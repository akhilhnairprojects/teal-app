// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/repositories/NearbyRepository.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Uses a linear haversine scan instead of MBTA Go's k-d tree; the rail data set is ~300 stops.
import { STOP_BLOCKLIST, type GlobalData } from '@/mbta/global/globalData';
import type { LatLng } from '@/mbta/model/types';
import { distanceMeters } from '@/lib/geo';

import { resolveParentStop } from './lineOrRoute';

const MILE_M = 1609.344;
const COMMUTER_RAIL: number = 2;

/**
 * Leaf stops near a point, nearest first: within 0.5 mi (1 mi for Commuter Rail), widening to
 * 2 mi (10 mi CR) when nothing is found. Each hit expands to its siblings under the same parent
 * (beyond the normal radius only CR siblings), and blocklisted stations are dropped.
 */
export function nearbyStopIds(g: GlobalData, at: LatLng, blocklist: readonly string[] = STOP_BLOCKLIST): string[] {
  // Same candidates as GlobalResponse.leafStopsKdTree: stops or stations with a vehicle type.
  const candidates = Object.values(g.stops).filter((s) => (s.locationType === 0 || s.locationType === 1) && s.vehicleType !== null);

  const find = (radius: number, crRadius: number) =>
    candidates
      .map((s) => ({ stop: s, distance: distanceMeters(at, { latitude: s.latitude, longitude: s.longitude }) }))
      .filter(({ stop, distance }) => distance <= crRadius && (distance < radius || stop.vehicleType === COMMUTER_RAIL))
      .sort((a, b) => a.distance - b.distance);

  let radius = 0.5 * MILE_M;
  let hits = find(radius, 1.0 * MILE_M);
  if (hits.length === 0) {
    radius = 2.0 * MILE_M;
    hits = find(radius, 10.0 * MILE_M);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { stop, distance } of hits) {
    const siblings = stop.parentStationId
      ? (g.stops[stop.parentStationId]?.childStopIds ?? []).map((id) => g.stops[id]).filter((s) => s !== undefined)
      : [stop];
    const selected = distance <= radius ? siblings : siblings.filter((s) => s.vehicleType === COMMUTER_RAIL);
    for (const s of selected) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s.id);
    }
  }
  return out.filter((id) => {
    const stop = g.stops[id];
    return !(stop && blocklist.includes(resolveParentStop(g.stops, stop).id));
  });
}
