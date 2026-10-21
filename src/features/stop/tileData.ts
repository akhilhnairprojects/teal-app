// Logic ported from mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/stopDetailsPage/TileData.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// LeafFormat.tileData from model/LeafFormat.kt and TripDetailsFilter from model/StopDetailsFilters.kt, same commit.
import type { Route } from '@/mbta/model/types';
import type { LeafFormat } from '@/mbta/rules/leafFormat';
import type { UpcomingFormat } from '@/mbta/rules/upcomingFormat';
import { formatUpcomingTrip, hidesSchedules, upcomingStopSequence, type UpcomingTrip } from '@/mbta/rules/upcomingTrip';

/** The trip selected on a stop page: a trip, optionally pinned to a vehicle and stop sequence. */
export type TripDetailsFilter = { tripId: string; vehicleId: string | null; stopSequence: number | null };

/** One departure tile in filtered stop details. `formatted` is always a single-trip `some`. */
export type TileData = {
  id: string;
  route: Route | null;
  headsign: string | null;
  formatted: Extract<UpcomingFormat, { kind: 'some' }>;
  upcoming: UpcomingTrip;
};

const tile = (route: Route | null, headsign: string | null, formatted: TileData['formatted'], upcoming: UpcomingTrip): TileData => ({
  id: upcoming.id,
  route,
  headsign,
  formatted,
  upcoming,
});

/** The tile matches the filter's trip, and its stop sequence when both are known. */
export function isTileSelected(t: TileData, filter: TripDetailsFilter | null): boolean {
  if (!filter || t.upcoming.trip.id !== filter.tripId) return false;
  if (filter.stopSequence === null) return true;
  const seq = upcomingStopSequence(t.upcoming);
  return seq === null || seq === filter.stopSequence;
}

/** A tile for one upcoming trip in the filtered context, or null when it would be hidden. */
export function tileFromUpcoming(upcoming: UpcomingTrip, route: Route, now: number): TileData | null {
  const formatted = formatUpcomingTrip(upcoming, now, route.type, 'stopDetailsFiltered', hidesSchedules(route), false);
  if (!formatted) return null;
  return tile(route, upcoming.trip.headsign, { kind: 'some', trips: [formatted], secondaryAlert: null }, upcoming);
}

/**
 * Tiles for a formatted leaf (LeafFormat.tileData): one per shown trip. A single-destination
 * leaf drops its headsign when it equals the direction's destination; branch rows without
 * exactly one trip are skipped.
 */
export function tileDataFor(f: LeafFormat, directionDestination: string | null): TileData[] {
  if (f.kind === 'single') {
    if (f.format.kind !== 'some') return [];
    const headsign = f.headsign === directionDestination ? null : f.headsign;
    const warning = f.format.secondaryAlert;
    return f.format.trips.map((trip) => tile(f.route, headsign, { kind: 'some', trips: [trip], secondaryAlert: warning }, trip.trip));
  }
  return f.rows.flatMap((row) => {
    if (row.format.kind !== 'some' || row.format.trips.length !== 1) return [];
    const [trip] = row.format.trips;
    return [tile(row.route, row.headsign, { kind: 'some', trips: [trip], secondaryAlert: row.format.secondaryAlert }, trip.trip)];
  });
}
