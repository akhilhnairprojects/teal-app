// Cases for the port of mbta/mobile_app shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/model/stopDetailsPage/TripHeaderSpec.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// MBTA Go has no TripHeaderSpecTest; these cover each branch of getSpec plus Teal's header text.
import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';

import { tripDetailsStopListFromPieces } from '../tripDetailsStopList';
import { headerStops, headerText, showsCrowding, tripHeaderSpec } from '../tripHeaderSpec';

const MIN = 60_000;

function setup(o: { withPredictions?: boolean; vehicle?: 'onTrip' | 'atTerminal' | 'other' | null } = {}) {
  const b = createBuilder();
  const red = redLine(b);
  const now = Date.now();
  const pattern = red.ashmontSouth;
  const stopIds = b.objects.trips[pattern.representativeTripId].stopIds!;
  const trip = b.tripFor(pattern);
  const schedules = stopIds.slice(0, 4).map((stopId, i) =>
    b.schedule({ trip, stopId, stopSequence: (i + 1) * 10, arrivalTime: now + (i + 1) * 2 * MIN, departureTime: now + (i + 1) * 2 * MIN }),
  );
  if (o.withPredictions) schedules.forEach((s) => b.predictionFor(s, { arrivalTime: s.arrivalTime, departureTime: s.departureTime }));
  const vehicle =
    o.vehicle === 'onTrip'
      ? b.vehicle({ tripId: trip.id, stopId: stopIds[1], currentStatus: 'IN_TRANSIT_TO', currentStopSequence: 20 })
      : o.vehicle === 'atTerminal'
        ? b.vehicle({ tripId: trip.id, stopId: stopIds[0], currentStatus: 'STOPPED_AT', currentStopSequence: 10 })
        : o.vehicle === 'other'
          ? b.vehicle({ tripId: 'another-trip', stopId: stopIds[3], currentStatus: 'STOPPED_AT' })
          : null;
  const g = b.global();
  const list = tripDetailsStopListFromPieces(
    trip,
    { kind: 'schedules', schedules },
    o.withPredictions ? b.liveDepartures() : null,
    vehicle,
    [],
    g,
  )!;
  const { terminalStop, vehicleStop } = headerStops(g, list, vehicle);
  return { g, red, trip, list, vehicle, terminalStop, vehicleStop, stopIds };
}

describe('tripHeaderSpec', () => {
  it('is VehicleOnTrip for a vehicle serving the trip, with its stop entry', () => {
    const s = setup({ withPredictions: true, vehicle: 'onTrip' });
    const spec = tripHeaderSpec(s.trip.id, s.list, s.terminalStop, s.vehicle, s.vehicleStop, s.g);
    expect(spec).toMatchObject({ kind: 'vehicleOnTrip', atTerminal: false, stop: { id: 'place-harsq' } });
    expect(spec?.kind === 'vehicleOnTrip' && spec.entry?.stop.id).toBe(s.stopIds[1]);
    expect(headerText(spec)).toEqual({ status: 'Next stop', stopName: 'Harvard' });
    expect(showsCrowding(spec)).toBe(true);
  });

  it('is VehicleOnTrip at the terminal using the start entry, and hides crowding', () => {
    const s = setup({ withPredictions: true, vehicle: 'atTerminal' });
    const spec = tripHeaderSpec(s.trip.id, s.list, s.terminalStop, s.vehicle, s.vehicleStop, s.g);
    expect(spec).toMatchObject({ kind: 'vehicleOnTrip', atTerminal: true });
    expect(spec?.kind === 'vehicleOnTrip' && spec.entry).toBe(s.list.startTerminalEntry);
    expect(headerText(spec)).toEqual({ status: 'Waiting to depart', stopName: 'Alewife' });
    expect(showsCrowding(spec)).toBe(false);
  });

  it('is FinishingAnotherTrip when the vehicle is on a different trip', () => {
    const s = setup({ withPredictions: true, vehicle: 'other' });
    const spec = tripHeaderSpec(s.trip.id, s.list, s.terminalStop, s.vehicle, s.vehicleStop, s.g);
    expect(spec).toEqual({ kind: 'finishingAnotherTrip' });
    expect(headerText(spec).status).toBe('Finishing another trip');
    expect(showsCrowding(spec)).toBe(false);
  });

  it('is NoVehicle with predictions but no vehicle', () => {
    const s = setup({ withPredictions: true });
    const spec = tripHeaderSpec(s.trip.id, s.list, s.terminalStop, null, null, s.g);
    expect(spec).toEqual({ kind: 'noVehicle' });
    expect(headerText(spec).status).toBe('Location not available yet');
  });

  it('is Scheduled with only schedules', () => {
    const s = setup();
    const spec = tripHeaderSpec(s.trip.id, s.list, s.terminalStop, null, null, s.g);
    expect(spec).toEqual({ kind: 'scheduled', stop: s.terminalStop, entry: s.list.startTerminalEntry });
    expect(headerText(spec)).toEqual({ status: 'Scheduled to depart', stopName: 'Alewife' });
  });

  it('is null with nothing known', () => {
    const s = setup();
    const empty = { trip: s.trip, stops: [], startTerminalEntry: null };
    expect(tripHeaderSpec(s.trip.id, empty, null, null, null)).toBeNull();
    expect(headerText(null).status).toBe('Location not available yet');
  });

  it('needs the vehicle stop to report a vehicle', () => {
    const s = setup({ withPredictions: true, vehicle: 'onTrip' });
    expect(tripHeaderSpec(s.trip.id, s.list, s.terminalStop, s.vehicle, null, s.g)).toEqual({ kind: 'noVehicle' });
  });
});
