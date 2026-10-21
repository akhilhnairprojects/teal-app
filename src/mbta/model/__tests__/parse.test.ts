import { assembleGlobalData, tripsMissingStops } from '@/mbta/global/globalData';
import { recommendCar } from '@/mbta/rules/vehicle';
import { buildUpcomingTrips, display, headsign } from '@/mbta/rules/upcomingTrip';
import { v3Alerts, v3Predictions, v3RoutePatterns, v3Routes, v3Schedules, v3Stops, v3TripsWithStops } from '@/mbta/testing/v3Fixtures';

import { parseAlert, parsePredictionsDocument, parseRoutePattern, parseSchedulesDocument, resolveParentId } from '../parse';

const NOW = Date.parse('2026-10-19T00:40:00-04:00');
const global = () => assembleGlobalData({ routes: v3Routes, patterns: v3RoutePatterns(), stops: v3Stops }, NOW);

describe('V3 parsers', () => {
  it('assembles global data: colors with #, platform -> parent families, ordered pattern stops', () => {
    const g = global();
    expect(g.routes.Red).toMatchObject({ color: '#DA291C', textColor: '#FFFFFF', type: 1, lineId: 'line-Red', directionNames: ['South', 'North'] });
    expect(g.lines['line-Red'].longName).toBe('Red Line');
    expect(g.stops['70075'].parentStationId).toBe('place-pktrm');
    expect(g.stops['place-pktrm'].childStopIds).toEqual(['70075', '70076']);
    expect(g.patterns['Red-3-0']).toMatchObject({ typicality: 'typical', canonical: true, representativeTripId: 'canonical-Red-C1-0' });
    expect(g.trips['canonical-Red-C1-0'].stopIds).toEqual(['70075', '70077', '70101']);
    expect(g.trips['canonical-Red-C1-0'].shapeId).toBe('canonical-933_0009');
    expect(g.patternIdsByStop['70075']).toEqual(['Red-3-0']);
    expect(g.patternIdsByStop['70076']).toEqual(['Red-3-1']);
    expect(g.serviceDate).toBe('2026-10-18');
  });

  it('falls back to /trips when route patterns lack stops relationships', () => {
    const patterns = v3RoutePatterns(false);
    expect(tripsMissingStops(patterns)).toEqual(['canonical-Red-C1-0', 'canonical-Red-C1-1']);
    const g = assembleGlobalData({ routes: v3Routes, patterns, stops: v3Stops, trips: v3TripsWithStops.data }, NOW);
    expect(g.trips['canonical-Red-C1-1'].stopIds).toEqual(['70078', '70076']);
    expect(g.patternIdsByStop['70078']).toEqual(['Red-3-1']);
    expect(tripsMissingStops(v3RoutePatterns(true))).toEqual([]);
  });

  it('treats a null/zero typicality as unknown (shown as typical by the rules)', () => {
    const p = parseRoutePattern({ type: 'route_pattern', id: 'x', attributes: { typicality: 0, direction_id: 1 }, relationships: {} });
    expect(p).toMatchObject({ typicality: null, directionId: 1, routeId: '', representativeTripId: '' });
  });

  it('parses predictions with trips and vehicles; maps platforms to parents through global data', () => {
    const g = global();
    const live = parsePredictionsDocument(v3Predictions);
    expect(live.predictions).toHaveLength(2);
    const [first, added] = live.predictions;
    expect(first).toMatchObject({
      stopId: '70075',
      tripId: '77916607',
      routeId: 'Red',
      stopSequence: 70,
      revenue: true,
      departureUncertainty: 60,
      departureTime: Date.parse('2026-10-19T00:41:19-04:00'),
      vehicleId: 'R-548C2B19',
    });
    expect(resolveParentId(g.stops, first.stopId)).toBe('place-pktrm');
    expect(resolveParentId(g.stops, 'unknown-stop')).toBe('unknown-stop');
    expect(added).toMatchObject({ scheduleRelationship: 'ADDED', lastTrip: true });
    expect(live.trips['77916607']).toMatchObject({ headsign: 'Braintree', routePatternId: 'Red-3-0', stopIds: null });
    expect(live.vehicles['R-548C2B19'].carriages.map((c) => [c.sequence, c.occupancyStatus])).toEqual([
      [1, 'MANY_SEATS_AVAILABLE'],
      [2, 'FEW_SEATS_AVAILABLE'],
      [3, 'FULL'],
    ]);
  });

  it('joins schedules to predictions by parent stop; ADDED trips have no schedule', () => {
    const g = global();
    const live = parsePredictionsDocument(v3Predictions);
    const schedules = parseSchedulesDocument(v3Schedules);
    const trips = buildUpcomingTrips(g, schedules, live, { stopIds: ['place-pktrm'] }, { now: NOW });
    expect(trips.map((t) => [t.trip.id, t.schedule?.id ?? null, t.prediction?.id ?? null])).toEqual([
      ['77916607', 'schedule-77916607-70075-70', 'prediction-77916607-70075-70'],
      ['ADDED-1585007754', null, 'prediction-ADDED-1585007754-70075-70'],
    ]);
    const added = trips[1];
    expect(headsign(added)).toBe('Ashmont');
    expect(display(added, NOW, 1, 'nearby', true)).toEqual({ kind: 'minutes', minutes: 12, last: true });
    // The stopped vehicle at its platform makes the scheduled trip boarding.
    expect(display(trips[0], NOW, 1, 'nearby', false)).toEqual({ kind: 'boarding', last: false });
  });

  it('carriages with NO_DATA_AVAILABLE give no car recommendation; real data does', () => {
    const live = parsePredictionsDocument(v3Predictions);
    expect(recommendCar(live.vehicles['R-ADDED1'].carriages)).toBeNull();
    expect(recommendCar(live.vehicles['R-548C2B19'].carriages)?.label).toBe('Board car 1 of 3');
  });

  it('parses alerts (effects, activities, periods)', () => {
    const a = parseAlert(v3Alerts.data[0]);
    expect(a).toMatchObject({ id: '1037420', effect: 'STATION_CLOSURE', cause: 'UNKNOWN_CAUSE', severity: 7, lifecycle: 'ONGOING' });
    expect(a.activePeriods).toEqual([{ start: Date.parse('2026-10-07T15:05:00-04:00'), end: null }]);
    expect(a.informedEntities[0]).toEqual({
      activities: ['BOARD', 'EXIT', 'RIDE'],
      routeId: 'Green-D',
      routeType: 0,
      directionId: 0,
      stopId: '70161',
      tripId: null,
      facilityId: null,
    });
    expect(a.informedEntities[1].directionId).toBeNull();
  });
});
