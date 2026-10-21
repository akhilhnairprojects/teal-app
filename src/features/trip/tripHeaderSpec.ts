// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/stopDetailsPage/TripHeaderSpec.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Header text follows androidApp stopDetails/TripHeaderCard.kt, same commit.
import type { GlobalData } from '@/mbta/global/globalData';
import type { Stop, Vehicle } from '@/mbta/model/types';
import { resolveParentStop } from '@/mbta/rules/lineOrRoute';
import { NO_VEHICLE_TEXT, vehicleStatusText } from '@/mbta/rules/vehicle';

import { equalOrFamily, type StopListEntry, type TripDetailsStopList } from './tripDetailsStopList';

export type TripHeaderSpec =
  | { kind: 'finishingAnotherTrip' }
  | { kind: 'noVehicle' }
  | { kind: 'scheduled'; stop: Stop; entry: StopListEntry }
  | { kind: 'vehicleOnTrip'; vehicle: Vehicle; stop: Stop; entry: StopListEntry | null; atTerminal: boolean };

/**
 * Which header a trip gets: its vehicle (on this trip, or finishing another one), predictions
 * without a vehicle, or a scheduled departure from the first stop. Null when nothing is known.
 * `terminalStop` and `vehicleStop` are parent stations.
 */
export function tripHeaderSpec(
  tripId: string,
  stops: TripDetailsStopList,
  terminalStop: Stop | null,
  vehicle: Vehicle | null,
  vehicleStop: Stop | null,
  g?: GlobalData | null,
): TripHeaderSpec | null {
  if (vehicle && vehicleStop) {
    const atTerminal = terminalStop !== null && terminalStop.id === vehicleStop.id && vehicle.currentStatus === 'STOPPED_AT';
    if (vehicle.tripId !== tripId) return { kind: 'finishingAnotherTrip' };
    // Entries hold platforms while vehicleStop is a parent, so match station families [ours].
    const entry = atTerminal
      ? stops.startTerminalEntry
      : (stops.stops.find((e) => e.stop.id === vehicleStop.id || (g ? equalOrFamily(e.stop.id, vehicleStop.id, g.stops) : false)) ?? null);
    return { kind: 'vehicleOnTrip', vehicle, stop: vehicleStop, entry, atTerminal };
  }
  if (stops.stops.some((e) => e.prediction !== null)) return { kind: 'noVehicle' };
  if (terminalStop && stops.startTerminalEntry) return { kind: 'scheduled', stop: terminalStop, entry: stops.startTerminalEntry };
  return null;
}

/** Parent stations for the header: the trip's first stop and the vehicle's current stop. */
export function headerStops(
  g: GlobalData,
  list: TripDetailsStopList,
  vehicle: Vehicle | null,
): { terminalStop: Stop | null; vehicleStop: Stop | null } {
  const parentOf = (id: string | null | undefined) => {
    const s = id ? g.stops[id] : undefined;
    return s ? resolveParentStop(g.stops, s) : null;
  };
  // Trips from predictions carry no stop list; fall back to the first known entry [ours].
  const terminalStop = parentOf(list.trip.stopIds?.[0]) ?? parentOf(list.startTerminalEntry?.stop.id);
  return { terminalStop, vehicleStop: parentOf(vehicle?.stopId) };
}

/** The header's status line and stop name, e.g. { status: 'Next stop', stopName: 'Park Street' }. */
export function headerText(spec: TripHeaderSpec | null): { status: string; stopName: string | null } {
  if (spec === null) return { status: NO_VEHICLE_TEXT, stopName: null };
  switch (spec.kind) {
    case 'finishingAnotherTrip':
      return { status: 'Finishing another trip', stopName: null };
    case 'noVehicle':
      return { status: NO_VEHICLE_TEXT, stopName: null };
    case 'scheduled':
      return { status: 'Scheduled to depart', stopName: spec.stop.name };
    case 'vehicleOnTrip':
      return { status: vehicleStatusText(spec.vehicle, true, spec.atTerminal), stopName: spec.stop.name };
  }
}

/** Crowding is shown only for a vehicle on this trip that has left the first stop [MA §3.5]. */
export const showsCrowding = (spec: TripHeaderSpec | null): spec is Extract<TripHeaderSpec, { kind: 'vehicleOnTrip' }> =>
  spec?.kind === 'vehicleOnTrip' && !spec.atTerminal;
