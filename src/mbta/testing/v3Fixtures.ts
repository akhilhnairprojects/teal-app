/**
 * Hand-written V3 JSON:API payloads shaped like the responses observed in
 * investigations/mbta-go/api-and-routing.md §2.2–2.3 (field names and nesting only; values are
 * illustrative). Used by parser, endpoint and global-data tests.
 */
import type { Resource } from '@/mbta/api/client';

const rel = (type: string, id: string | null) => ({ data: id === null ? null : { type, id } });
const rels = (type: string, ids: string[]) => ({ data: ids.map((id) => ({ type, id })) });

export const v3Routes: { data: Resource[]; included: Resource[] } = {
  data: [
    {
      type: 'route',
      id: 'Red',
      attributes: {
        color: 'DA291C',
        text_color: 'FFFFFF',
        direction_destinations: ['Ashmont/Braintree', 'Alewife'],
        direction_names: ['South', 'North'],
        long_name: 'Red Line',
        short_name: '',
        sort_order: 10010,
        type: 1,
      },
      relationships: { line: rel('line', 'line-Red') },
    },
  ],
  included: [{ type: 'line', id: 'line-Red', attributes: { color: 'DA291C', text_color: 'FFFFFF', long_name: 'Red Line', short_name: '', sort_order: 10010 } }],
};

const platform = (id: string, name: string, parent: string, platformName: string): Resource => ({
  type: 'stop',
  id,
  attributes: { name, latitude: 42.35, longitude: -71.06, location_type: 0, platform_code: null, platform_name: platformName, vehicle_type: 1, wheelchair_boarding: 1 },
  relationships: { parent_station: rel('stop', parent) },
});
const station = (id: string, name: string): Resource => ({
  type: 'stop',
  id,
  attributes: { name, latitude: 42.35, longitude: -71.06, location_type: 1, platform_code: null, platform_name: null, vehicle_type: null, wheelchair_boarding: 1 },
  relationships: { parent_station: rel('stop', null) },
});

export const v3Stops: { data: Resource[]; included: Resource[] } = {
  data: [
    platform('70075', 'Park Street', 'place-pktrm', 'Ashmont/Braintree'),
    platform('70076', 'Park Street', 'place-pktrm', 'Alewife'),
    platform('70077', 'Downtown Crossing', 'place-dwnxg', 'Ashmont/Braintree'),
    platform('70078', 'Downtown Crossing', 'place-dwnxg', 'Alewife'),
    platform('70101', 'Quincy Center', 'place-qnctr', 'Braintree'),
  ],
  included: [station('place-pktrm', 'Park Street'), station('place-dwnxg', 'Downtown Crossing'), station('place-qnctr', 'Quincy Center')],
};

/** `include=representative_trip.stops,route.line&fields[stop]=` — included stops carry only ids. */
export function v3RoutePatterns(withStops = true): { data: Resource[]; included: Resource[] } {
  const trip = (id: string, headsign: string, dir: 0 | 1, stops: string[]): Resource => ({
    type: 'trip',
    id,
    attributes: { headsign, direction_id: dir, name: '' },
    relationships: {
      route: rel('route', 'Red'),
      route_pattern: rel('route_pattern', id === 'canonical-Red-C1-0' ? 'Red-3-0' : 'Red-3-1'),
      shape: rel('shape', id === 'canonical-Red-C1-0' ? 'canonical-933_0009' : 'canonical-933_0010'),
      ...(withStops ? { stops: rels('stop', stops) } : {}),
    },
  });
  return {
    data: [
      {
        type: 'route_pattern',
        id: 'Red-3-0',
        attributes: { canonical: true, direction_id: 0, name: 'Alewife - Braintree', sort_order: 100100000, time_desc: null, typicality: 1 },
        relationships: { representative_trip: rel('trip', 'canonical-Red-C1-0'), route: rel('route', 'Red') },
      },
      {
        type: 'route_pattern',
        id: 'Red-3-1',
        attributes: { canonical: true, direction_id: 1, name: 'Braintree - Alewife', sort_order: 100101000, time_desc: null, typicality: 1 },
        relationships: { representative_trip: rel('trip', 'canonical-Red-C1-1'), route: rel('route', 'Red') },
      },
    ],
    included: [
      trip('canonical-Red-C1-0', 'Braintree', 0, ['70075', '70077', '70101']),
      trip('canonical-Red-C1-1', 'Alewife', 1, ['70078', '70076']),
      { type: 'stop', id: '70075', attributes: {}, relationships: { parent_station: rel('stop', 'place-pktrm') } },
    ],
  };
}

/** Fallback `/trips?filter[id]&include=stops` response. */
export const v3TripsWithStops: { data: Resource[] } = {
  data: v3RoutePatterns(true).included.filter((r) => r.type === 'trip'),
};

/** `/predictions?include=trip,vehicle` at Park Street: a scheduled trip and an ADDED trip. */
export const v3Predictions: { data: Resource[]; included: Resource[] } = {
  data: [
    {
      type: 'prediction',
      id: 'prediction-77916607-70075-70',
      attributes: {
        arrival_time: '2026-10-19T00:40:30-04:00',
        departure_time: '2026-10-19T00:41:19-04:00',
        arrival_uncertainty: 60,
        departure_uncertainty: 60,
        direction_id: 0,
        last_trip: false,
        revenue: 'REVENUE',
        schedule_relationship: null,
        status: null,
        stop_sequence: 70,
        trip_headsign: null,
        update_type: 'MID_TRIP',
      },
      relationships: {
        route: rel('route', 'Red'),
        stop: rel('stop', '70075'),
        trip: rel('trip', '77916607'),
        vehicle: rel('vehicle', 'R-548C2B19'),
      },
    },
    {
      type: 'prediction',
      id: 'prediction-ADDED-1585007754-70075-70',
      attributes: {
        arrival_time: '2026-10-19T00:52:00-04:00',
        departure_time: '2026-10-19T00:52:40-04:00',
        departure_uncertainty: 120,
        direction_id: 0,
        last_trip: true,
        revenue: 'REVENUE',
        schedule_relationship: 'ADDED',
        status: null,
        stop_sequence: 70,
      },
      relationships: {
        route: rel('route', 'Red'),
        stop: rel('stop', '70075'),
        trip: rel('trip', 'ADDED-1585007754'),
        vehicle: rel('vehicle', 'R-ADDED1'),
      },
    },
  ],
  included: [
    {
      type: 'trip',
      id: '77916607',
      attributes: { headsign: 'Braintree', direction_id: 0 },
      relationships: { route: rel('route', 'Red'), route_pattern: rel('route_pattern', 'Red-3-0'), shape: rel('shape', '933_0009') },
    },
    {
      type: 'trip',
      id: 'ADDED-1585007754',
      attributes: { headsign: 'Ashmont', direction_id: 0 },
      relationships: { route: rel('route', 'Red'), route_pattern: rel('route_pattern', null), shape: rel('shape', null) },
    },
    {
      type: 'vehicle',
      id: 'R-548C2B19',
      attributes: {
        bearing: 180,
        current_status: 'STOPPED_AT',
        current_stop_sequence: 70,
        direction_id: 0,
        label: '1902',
        latitude: 42.356,
        longitude: -71.062,
        occupancy_status: null,
        updated_at: '2026-10-19T00:40:58-04:00',
        carriages: [
          { label: '1902', occupancy_status: 'MANY_SEATS_AVAILABLE', occupancy_percentage: 1 },
          { label: '1903', occupancy_status: 'FEW_SEATS_AVAILABLE', occupancy_percentage: 40 },
          { label: '1840', occupancy_status: 'FULL', occupancy_percentage: 95 },
        ],
      },
      relationships: { route: rel('route', 'Red'), stop: rel('stop', '70075'), trip: rel('trip', '77916607') },
    },
    {
      type: 'vehicle',
      id: 'R-ADDED1',
      attributes: {
        bearing: 0,
        current_status: 'IN_TRANSIT_TO',
        current_stop_sequence: 60,
        direction_id: 0,
        label: '1700',
        latitude: 42.36,
        longitude: -71.07,
        occupancy_status: null,
        updated_at: '2026-10-19T00:40:30-04:00',
        carriages: [
          { label: '1700', occupancy_status: 'NO_DATA_AVAILABLE', occupancy_percentage: null },
          { label: '1701', occupancy_status: 'NO_DATA_AVAILABLE', occupancy_percentage: null },
        ],
      },
      relationships: { route: rel('route', 'Red'), stop: rel('stop', '70074'), trip: rel('trip', 'ADDED-1585007754') },
    },
  ],
};

/** `/schedules?filter[stop]=place-pktrm&include=trip` with the scheduled trip only (no ADDED trip). */
export const v3Schedules: { data: Resource[]; included: Resource[] } = {
  data: [
    {
      type: 'schedule',
      id: 'schedule-77916607-70075-70',
      attributes: {
        arrival_time: '2026-10-19T00:38:00-04:00',
        departure_time: '2026-10-19T00:38:00-04:00',
        drop_off_type: 0,
        pickup_type: 0,
        stop_headsign: null,
        stop_sequence: 70,
      },
      relationships: { route: rel('route', 'Red'), stop: rel('stop', '70075'), trip: rel('trip', '77916607') },
    },
  ],
  included: [
    {
      type: 'trip',
      id: '77916607',
      attributes: { headsign: 'Braintree', direction_id: 0 },
      relationships: { route: rel('route', 'Red'), route_pattern: rel('route_pattern', 'Red-3-0') },
    },
  ],
};

export const v3Alerts: { data: Resource[] } = {
  data: [
    {
      type: 'alert',
      id: '1037420',
      attributes: {
        active_period: [{ start: '2026-10-07T15:05:00-04:00', end: null }],
        cause: 'UNKNOWN_CAUSE',
        description: 'Affected stations:\r\nRiverside',
        effect: 'STATION_CLOSURE',
        header: 'Riverside closed',
        informed_entity: [
          { stop: '70161', direction_id: 0, route_type: 0, route: 'Green-D', activities: ['BOARD', 'EXIT', 'RIDE'] },
          { stop: 'place-river', route_type: 0, route: 'Green-D', activities: ['BOARD'] },
        ],
        lifecycle: 'ONGOING',
        severity: 7,
        timeframe: 'ongoing',
        updated_at: '2026-10-07T15:07:07-04:00',
        url: null,
      },
    },
  ],
};
