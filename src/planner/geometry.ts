/**
 * Map geometry for itineraries: transit legs are sliced from the cached rail shapes between the
 * points nearest the two stations; walk and bike legs are straight segments [ours].
 */
import type { GlobalData, RailShapes } from '@/mbta/global/globalData';
import { distanceMeters, type LatLng } from '@/lib/geo';
import type { ItineraryOverlay, MapOverlay } from '@/state/mapOverlay';

import type { Itinerary } from './types';

/** A station farther than this from every point of a shape is not on it. */
export const MAX_SNAP_M = 400;

export function nearestIndex(coords: readonly LatLng[], p: LatLng): { index: number; meters: number } {
  let index = -1;
  let meters = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = distanceMeters(coords[i], p);
    if (d < meters) {
      meters = d;
      index = i;
    }
  }
  return { index, meters };
}

/** The part of `coords` between the points nearest `from` and `to`, ordered from → to. */
export function sliceShape(coords: readonly LatLng[], from: LatLng, to: LatLng): LatLng[] {
  if (coords.length === 0) return [from, to];
  const a = nearestIndex(coords, from).index;
  const b = nearestIndex(coords, to).index;
  if (a === b) return [from, to];
  return a < b ? coords.slice(a, b + 1) : coords.slice(b, a + 1).reverse();
}

/** Path for a transit leg: the route's best-fitting shape (branches differ), else a straight line. */
export function transitPath(shapes: RailShapes | null, routeId: string, from: LatLng, to: LatLng): LatLng[] {
  let best: { coords: LatLng[]; cost: number } | null = null;
  for (const shape of shapes?.[routeId] ?? []) {
    if (shape.coordinates.length < 2) continue;
    const a = nearestIndex(shape.coordinates, from).meters;
    const b = nearestIndex(shape.coordinates, to).meters;
    if (a > MAX_SNAP_M || b > MAX_SNAP_M) continue;
    if (!best || a + b < best.cost) best = { coords: shape.coordinates, cost: a + b };
  }
  return best ? sliceShape(best.coords, from, to) : [from, to];
}

const stationLatLng = (g: GlobalData, id: string): LatLng | null => {
  const s = g.stops[id];
  return s ? { latitude: s.latitude, longitude: s.longitude } : null;
};

/** Overlay lines and markers for one itinerary. */
export function itineraryOverlay(
  itin: Itinerary,
  g: GlobalData,
  shapes: RailShapes | null,
  colors: { walk: string; bike: string },
  ends: { origin: LatLng; destination: LatLng; originName: string; destinationName: string },
): ItineraryOverlay {
  const legs: ItineraryOverlay['legs'] = [];
  const markers: ItineraryOverlay['markers'] = [
    { kind: 'origin', latLng: ends.origin, label: ends.originName },
    { kind: 'destination', latLng: ends.destination, label: ends.destinationName },
  ];
  for (const leg of itin.legs) {
    if (leg.mode === 'walk') {
      legs.push({ mode: 'walk', color: colors.walk, coordinates: [leg.from, leg.to] });
    } else if (leg.mode === 'bike') {
      legs.push({ mode: 'bike', color: colors.bike, coordinates: [leg.fromDock.latLng, leg.toDock.latLng] });
      markers.push({ kind: 'dock', latLng: leg.fromDock.latLng, label: leg.fromDock.name });
      markers.push({ kind: 'dock', latLng: leg.toDock.latLng, label: leg.toDock.name });
    } else {
      const from = stationLatLng(g, leg.fromStopId);
      const to = stationLatLng(g, leg.toStopId);
      if (!from || !to) continue;
      legs.push({ mode: 'transit', color: g.routes[leg.routeId]?.color ?? colors.walk, coordinates: transitPath(shapes, leg.routeId, from, to) });
      markers.push({ kind: 'station', latLng: from, label: g.stops[leg.fromStopId]?.name ?? '' });
      markers.push({ kind: 'station', latLng: to, label: g.stops[leg.toStopId]?.name ?? '' });
    }
  }
  return { legs, markers };
}

/** Map overlay for the planner: the itinerary, framed on its markers (every leg starts and ends at one). */
export function plannerMapOverlay(overlay: ItineraryOverlay): MapOverlay {
  return { itinerary: overlay, fitTo: overlay.markers.map((m) => m.latLng) };
}
