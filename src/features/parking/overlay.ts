/**
 * The parking map overlay: reuses the itinerary overlay (spec §3.2) — a bike leg from the rider to
 * the target dock, a walk leg from the dock to the destination, and dock and destination markers.
 * With a location the map follows the rider; without one it frames the dock and destination.
 */
import type { LatLng } from '@/lib/geo';
import type { ParkingState } from '@/parking/types';
import type { MapOverlay } from '@/state/mapOverlay';

/** ~10 m: keeps the overlay (compared by JSON) from changing on every GPS fix. */
const round4 = (p: LatLng): LatLng => ({ latitude: Math.round(p.latitude * 1e4) / 1e4, longitude: Math.round(p.longitude * 1e4) / 1e4 });

export function parkingOverlay(
  state: Pick<ParkingState, 'phase' | 'destination' | 'target'>,
  here: LatLng | null,
  colors: { walk: string; bike: string },
): MapOverlay | null {
  const { destination, target } = state;
  if (!destination || (state.phase !== 'navigating' && state.phase !== 'arrived')) return null;
  const dest = destination.latLng;
  const markers: NonNullable<MapOverlay['itinerary']>['markers'] = [{ kind: 'destination', latLng: dest, label: destination.name }];
  const legs: NonNullable<MapOverlay['itinerary']>['legs'] = [];
  if (target) {
    const dock = target.station.location;
    markers.push({ kind: 'dock', latLng: dock, label: target.station.name });
    if (here && state.phase === 'navigating') legs.push({ mode: 'bike', color: colors.bike, coordinates: [round4(here), dock] });
    legs.push({ mode: 'walk', color: colors.walk, coordinates: [dock, dest] });
  }
  const itinerary = { legs, markers };
  if (here && state.phase === 'navigating') return { itinerary, followUser: true };
  return { itinerary, fitTo: markers.map((m) => m.latLng) };
}
