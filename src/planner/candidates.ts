/**
 * Candidate generation with zero API calls [AR §3.2 steps 1–2]: stations near the origin and
 * destination, direct and one-transfer rides pre-scored by hop estimates, and bike+T mixes.
 */
import type { BikeStation } from '@/data/bluebikes';
import { distanceMeters, walkMinutesDetour, type LatLng } from '@/lib/geo';
import type { Stop } from '@/mbta/model/types';

import { bikeSegment, type BikeSegment } from './bike';
import {
  CANDIDATE_RADIUS_M,
  DEFAULT_HEADWAY_MIN,
  DOCK_NEAR_PLACE_M,
  DOCK_NEAR_STATION_M,
  HEADWAY_MIN,
  MAX_CANDIDATE_STATIONS,
  MAX_MIXED_STATIONS,
  MIXED_MAX_M,
  MIXED_MIN_M,
  TOP_TRANSIT_OPTIONS,
  TRANSFER_BASE_MIN,
  WALK_DETOUR,
} from './constants';
import { directLegs, legSpec, serves, type LegSpec, type TransitGraph } from './graph';

export type StationCandidate = { stationId: string; meters: number; walkMin: number };

export const stopLatLng = (s: Stop): LatLng => ({ latitude: s.latitude, longitude: s.longitude });

/** Up to `max` graph stations within `radius` of `at`, nearest first. `stopId` (a chosen station) is always included. */
export function nearbyStations(
  graph: TransitGraph,
  at: LatLng,
  o: { radius?: number; max?: number; stationId?: string | null } = {},
): StationCandidate[] {
  const radius = o.radius ?? CANDIDATE_RADIUS_M;
  const max = o.max ?? MAX_CANDIDATE_STATIONS;
  const all: StationCandidate[] = [];
  for (const [stationId, stop] of Object.entries(graph.stations)) {
    const meters = stationId === o.stationId ? 0 : distanceMeters(at, stopLatLng(stop));
    if (meters <= radius) all.push({ stationId, meters, walkMin: walkMinutesDetour(meters, WALK_DETOUR) });
  }
  return all.sort((a, b) => a.meters - b.meters || a.stationId.localeCompare(b.stationId)).slice(0, max);
}

export type TransitOption = {
  id: string;
  access: StationCandidate;
  egress: StationCandidate;
  /** One leg (direct) or two (one transfer). */
  legs: LegSpec[];
  preScore: number;
};

export const transferPenaltyMin = (lineKey: string): number => TRANSFER_BASE_MIN + (HEADWAY_MIN[lineKey] ?? DEFAULT_HEADWAY_MIN) / 2;

const optionId = (legs: LegSpec[]) => legs.map((l) => l.key).join('>');

/**
 * Direct rides (`idx(o) < idx(d)`) and one-transfer rides via a station shared by two patterns,
 * pre-scored as walk + hops × avgHop + transfer (4 + headway/2) + walk; the best `limit` are kept.
 * Transfers are only considered for an origin/destination pair with no usable direct ride.
 */
export function enumerateTransit(
  graph: TransitGraph,
  origins: StationCandidate[],
  destinations: StationCandidate[],
  o: { isBlocked?: (leg: LegSpec) => boolean; limit?: number } = {},
): TransitOption[] {
  const blocked = o.isBlocked ?? (() => false);
  const options = new Map<string, TransitOption>();
  const add = (opt: TransitOption, dedupeKey: string) => {
    const prev = options.get(dedupeKey);
    if (!prev || opt.preScore < prev.preScore) options.set(dedupeKey, opt);
  };

  for (const access of origins) {
    for (const egress of destinations) {
      if (access.stationId === egress.stationId) continue;
      const direct = directLegs(graph, access.stationId, egress.stationId).filter((l) => !blocked(l));
      for (const leg of direct) {
        const legs = [leg];
        add({ id: optionId(legs), access, egress, legs, preScore: access.walkMin + leg.rideMin + egress.walkMin }, optionId(legs));
      }
      if (direct.length > 0) continue;

      for (const p1 of graph.byStation[access.stationId] ?? []) {
        const start = p1.index[access.stationId];
        for (let i = start + 1; i < p1.stations.length; i++) {
          const x = p1.stations[i];
          if (x === egress.stationId || !graph.transferStations.has(x)) continue;
          for (const p2 of graph.byStation[x] ?? []) {
            if (p2 === p1 || !serves(p2, x, egress.stationId)) continue;
            const l1 = legSpec(graph, p1.lineKey, p1.directionId, access.stationId, x);
            const l2 = legSpec(graph, p2.lineKey, p2.directionId, x, egress.stationId);
            if (!l1 || !l2 || blocked(l1) || blocked(l2)) continue;
            const legs = [l1, l2];
            const preScore = access.walkMin + l1.rideMin + transferPenaltyMin(l2.lineKey) + l2.rideMin + egress.walkMin;
            const dedupeKey = `${access.stationId}|${egress.stationId}|${l1.lineKey}|${l1.directionId}|${l2.lineKey}|${l2.directionId}`;
            add({ id: optionId(legs), access, egress, legs, preScore }, dedupeKey);
          }
        }
      }
    }
  }
  return [...options.values()].sort((a, b) => a.preScore - b.preScore || a.id.localeCompare(b.id)).slice(0, o.limit ?? TOP_TRANSIT_OPTIONS);
}

export type MixedOption = {
  id: string;
  kind: 'bike+transit' | 'transit+bike';
  bike: BikeSegment;
  /** The station where the bike meets the T. */
  station: string;
  leg: LegSpec;
  /** bike+transit: the alighting candidate near the destination. transit+bike: the boarding candidate near the origin. */
  candidate: StationCandidate;
  preScore: number;
};

/**
 * Bike to a station 1–4 km from the origin that rides directly to the destination set (end dock
 * within 300 m of the station, start dock within 500 m of the origin), and the reverse. Up to 3 each.
 */
export function enumerateMixed(
  graph: TransitGraph,
  origin: LatLng,
  destination: LatLng,
  origins: StationCandidate[],
  destinations: StationCandidate[],
  bikes: readonly BikeStation[],
  o: { isBlocked?: (leg: LegSpec) => boolean } = {},
): MixedOption[] {
  const blocked = o.isBlocked ?? (() => false);
  const bestLeg = (legs: LegSpec[]) => legs.filter((l) => !blocked(l)).sort((a, b) => a.rideMin - b.rideMin)[0];
  const bikeFirst: MixedOption[] = [];
  const bikeLast: MixedOption[] = [];

  for (const [stationId, stop] of Object.entries(graph.stations)) {
    const at = stopLatLng(stop);

    const fromOrigin = distanceMeters(origin, at);
    if (fromOrigin >= MIXED_MIN_M && fromOrigin <= MIXED_MAX_M) {
      let best: MixedOption | null = null;
      let segment: BikeSegment | null | undefined;
      for (const d of destinations) {
        const leg = bestLeg(directLegs(graph, stationId, d.stationId));
        if (!leg) continue;
        if (segment === undefined) segment = bikeSegment(bikes, origin, at, DOCK_NEAR_PLACE_M, DOCK_NEAR_STATION_M).segment;
        if (!segment) break;
        const preScore = segment.minutes + leg.rideMin + d.walkMin;
        if (!best || preScore < best.preScore) {
          best = { id: `bike>${leg.key}`, kind: 'bike+transit', bike: segment, station: stationId, leg, candidate: d, preScore };
        }
      }
      if (best) bikeFirst.push(best);
    }

    const toDestination = distanceMeters(destination, at);
    if (toDestination >= MIXED_MIN_M && toDestination <= MIXED_MAX_M) {
      let best: MixedOption | null = null;
      let segment: BikeSegment | null | undefined;
      for (const a of origins) {
        const leg = bestLeg(directLegs(graph, a.stationId, stationId));
        if (!leg) continue;
        if (segment === undefined) segment = bikeSegment(bikes, at, destination, DOCK_NEAR_STATION_M, DOCK_NEAR_PLACE_M).segment;
        if (!segment) break;
        const preScore = a.walkMin + leg.rideMin + segment.minutes;
        if (!best || preScore < best.preScore) {
          best = { id: `${leg.key}>bike`, kind: 'transit+bike', bike: segment, station: stationId, leg, candidate: a, preScore };
        }
      }
      if (best) bikeLast.push(best);
    }
  }
  const top = (list: MixedOption[]) => list.sort((a, b) => a.preScore - b.preScore || a.id.localeCompare(b.id)).slice(0, MAX_MIXED_STATIONS);
  return [...top(bikeFirst), ...top(bikeLast)];
}
