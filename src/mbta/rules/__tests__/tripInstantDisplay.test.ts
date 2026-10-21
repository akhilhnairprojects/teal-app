// Golden cases ported from mbta/mobile_app shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/model/TripInstantDisplayTest.kt @8c49ac5 (MIT). See THIRD_PARTY_NOTICES.md.
// Kotlin's parametric `any…()` values are expanded into explicit loops; a null route type is
// treated as subway (0/1), which is what the Kotlin code does with it.
import type { RouteType } from '@/mbta/model/types';
import { build } from '@/mbta/testing/builders';

import { departureText, tripInstantDisplay, type DisplayContext } from '../tripInstantDisplay';

const S = 1000;
const MIN = 60 * S;
const ALL_CONTEXTS: DisplayContext[] = ['nearby', 'stopDetailsUnfiltered', 'stopDetailsFiltered', 'tripDetails'];
const NON_TRIP_DETAILS: DisplayContext[] = ['nearby', 'stopDetailsUnfiltered', 'stopDetailsFiltered'];
const ALL_TYPES: RouteType[] = [0, 1, 2, 3, 4];
const SUBWAY: RouteType[] = [0, 1];
const SCHEDULE_BASED: RouteType[] = [2, 4];
const NON_SCHEDULE_BASED: RouteType[] = [0, 1, 3];
const BOOLS = [true, false];

const NOW = Date.UTC(2026, 9, 19, 16, 0, 0);

type Args = Parameters<typeof tripInstantDisplay>[0];
const run = (a: Partial<Args> & { routeType: RouteType; context: DisplayContext }) =>
  tripInstantDisplay({ prediction: null, schedule: null, vehicle: null, now: NOW, lastTrip: false, alert: null, ...a });

function each<T>(values: T[], fn: (v: T) => void) {
  values.forEach(fn);
}

describe('TripInstantDisplay', () => {
  it('status is non-null', () => {
    each(BOOLS, (lastTrip) =>
      each([0, 1, 3, 4] as RouteType[], (routeType) =>
        each(ALL_CONTEXTS, (context) =>
          expect(run({ prediction: build.prediction({ status: 'Custom Text' }), routeType, context, lastTrip })).toEqual({
            kind: 'overridden',
            text: 'Custom Text',
            last: lastTrip,
          }),
        ),
      ),
    );
  });

  it('commuter rail status is non-null and prediction is in past', () => {
    const predictionTime = NOW - 3 * MIN;
    const prediction = build.prediction({ departureTime: predictionTime, status: 'Custom Text' });
    each(BOOLS, (lastTrip) => {
      each(['nearby', 'stopDetailsUnfiltered'] as DisplayContext[], (context) =>
        expect(run({ prediction, routeType: 2, context, lastTrip })).toEqual({ kind: 'time', predictionTime, last: lastTrip, headline: true }),
      );
      expect(run({ prediction, routeType: 2, context: 'stopDetailsFiltered', lastTrip })).toEqual({
        kind: 'timeWithStatus',
        predictionTime,
        status: 'Custom Text',
        last: lastTrip,
        headline: true,
      });
      expect(run({ prediction, routeType: 2, context: 'tripDetails', lastTrip })).toEqual({
        kind: 'time',
        predictionTime,
        last: lastTrip,
        headline: false,
      });
    });
  });

  it('commuter rail status is non-null and prediction time null and schedule in past', () => {
    const scheduleTime = NOW - 3 * MIN;
    const prediction = build.prediction({ status: 'Custom Text' });
    const schedule = build.schedule({ departureTime: scheduleTime });
    each(['nearby', 'stopDetailsUnfiltered', 'tripDetails'] as DisplayContext[], (context) =>
      expect(run({ prediction, schedule, routeType: 2, context, lastTrip: false })).toEqual({
        kind: 'scheduleTimeWithStatusRow',
        scheduledTime: scheduleTime,
        status: 'Custom Text',
      }),
    );
    each(ALL_CONTEXTS, (context) =>
      expect(run({ prediction, schedule, routeType: 2, context, lastTrip: true })).toEqual({
        kind: 'scheduleTimeWithStatusColumn',
        scheduledTime: scheduleTime,
        status: 'Custom Text',
        last: true,
        headline: context !== 'tripDetails',
      }),
    );
    each(BOOLS, (lastTrip) =>
      expect(run({ prediction, schedule, routeType: 2, context: 'stopDetailsFiltered', lastTrip })).toEqual({
        kind: 'scheduleTimeWithStatusColumn',
        scheduledTime: scheduleTime,
        status: 'Custom Text',
        last: lastTrip,
        headline: true,
      }),
    );
  });

  it('scheduled trip skipped', () => {
    each(BOOLS, (lastTrip) =>
      each(ALL_CONTEXTS, (context) =>
        expect(
          run({
            prediction: build.prediction({ scheduleRelationship: 'SKIPPED' }),
            schedule: build.schedule({ departureTime: NOW + 15 * MIN }),
            routeType: 1,
            context,
            lastTrip,
          }),
        ).toEqual({ kind: 'skipped', scheduledTime: NOW + 15 * MIN }),
      ),
    );
  });

  it('unscheduled trip skipped', () => {
    each(ALL_CONTEXTS, (context) =>
      expect(run({ prediction: build.prediction({ scheduleRelationship: 'SKIPPED' }), routeType: 1, context })).toEqual({ kind: 'hidden' }),
    );
  });

  it('departure_time and arrival_time are null', () => {
    each(ALL_CONTEXTS, (context) => {
      expect(run({ prediction: build.prediction({ departureTime: null, arrivalTime: null }), routeType: 1, context })).toEqual({ kind: 'hidden' });
      expect(run({ schedule: build.schedule({ departureTime: null, arrivalTime: null }), routeType: 1, context })).toEqual({ kind: 'hidden' });
    });
  });

  it('departure_time is null but arrival_time exists', () => {
    each(BOOLS, (lastTrip) => {
      each(NON_TRIP_DETAILS, (context) => {
        expect(run({ prediction: build.prediction({ arrivalTime: NOW + 3 * MIN }), routeType: 1, context, lastTrip })).toEqual({ kind: 'hidden' });
        expect(run({ schedule: build.schedule({ arrivalTime: NOW + 3 * MIN }), routeType: 1, context, lastTrip })).toEqual({ kind: 'hidden' });
      });
      each(NON_SCHEDULE_BASED, (routeType) => {
        expect(run({ prediction: build.prediction({ arrivalTime: NOW + 3 * MIN }), routeType, context: 'tripDetails', lastTrip })).toEqual({
          kind: 'time',
          predictionTime: NOW + 3 * MIN,
          last: lastTrip,
          headline: false,
        });
        expect(run({ schedule: build.schedule({ arrivalTime: NOW + 3 * MIN }), routeType, context: 'tripDetails', lastTrip })).toEqual({
          kind: 'scheduleTime',
          scheduledTime: NOW + 3 * MIN,
          last: lastTrip,
          headline: false,
        });
      });
    });
  });

  it('schedule instead of prediction', () => {
    each(BOOLS, (lastTrip) =>
      each(NON_TRIP_DETAILS, (context) => {
        expect(run({ schedule: build.schedule({ departureTime: NOW + 15 * MIN }), routeType: 3, context, lastTrip })).toEqual({
          kind: 'scheduleMinutes',
          minutes: 15,
          last: lastTrip,
        });
        expect(run({ schedule: build.schedule({ departureTime: NOW + 75 * MIN }), routeType: 3, context, lastTrip })).toEqual({
          kind: 'scheduleTime',
          scheduledTime: NOW + 75 * MIN,
          last: lastTrip,
          headline: false,
        });
      }),
    );
  });

  it('schedule rounding', () => {
    each(NON_TRIP_DETAILS, (context) => {
      expect(run({ schedule: build.schedule({ departureTime: NOW + 59.4999 * MIN }), routeType: 3, context })).toEqual({
        kind: 'scheduleMinutes',
        minutes: 59,
        last: false,
      });
      expect(run({ schedule: build.schedule({ departureTime: NOW + 59.5 * MIN }), routeType: 3, context })).toEqual({
        kind: 'scheduleTime',
        scheduledTime: NOW + 59.5 * MIN,
        last: false,
        headline: false,
      });
    });
  });

  it('departure_time in the past', () => {
    each(ALL_CONTEXTS, (context) =>
      expect(run({ prediction: build.prediction({ departureTime: NOW - 2 * S }), routeType: 1, context })).toEqual({ kind: 'hidden' }),
    );
  });

  it('seconds less than 0', () => {
    each(BOOLS, (lastTrip) =>
      each(NON_TRIP_DETAILS, (context) =>
        expect(
          run({ prediction: build.prediction({ arrivalTime: NOW - 2 * S, departureTime: NOW + 10 * S }), routeType: 1, context, lastTrip }),
        ).toEqual({ kind: 'arriving', last: lastTrip }),
      ),
    );
  });

  const stoppedVehicle = (stopId: string, tripId: string, status: 'STOPPED_AT' | 'INCOMING_AT' = 'STOPPED_AT') =>
    build.vehicle({ currentStatus: status, stopId, tripId });

  it('boarding', () => {
    const vehicle = stoppedVehicle('12345', 'trip1');
    each(BOOLS, (lastTrip) =>
      each(NON_TRIP_DETAILS, (context) =>
        expect(
          run({
            prediction: build.prediction({ departureTime: NOW + 10 * S, stopId: '12345', tripId: 'trip1', vehicleId: vehicle.id }),
            vehicle,
            routeType: 1,
            context,
            lastTrip,
          }),
        ).toEqual({ kind: 'boarding', last: lastTrip }),
      ),
    );
  });

  it('still boarding if prediction in past', () => {
    const vehicle = stoppedVehicle('12345', 'trip1');
    each(NON_TRIP_DETAILS, (context) =>
      expect(
        run({
          prediction: build.prediction({ departureTime: NOW - 10 * S, stopId: '12345', tripId: 'trip1', vehicleId: vehicle.id }),
          vehicle,
          routeType: 1,
          context,
        }),
      ).toEqual({ kind: 'boarding', last: false }),
    );
  });

  it('not boarding when stopped at stop but more than 90 seconds until departure', () => {
    const vehicle = stoppedVehicle('12345', 'trip1');
    each(NON_SCHEDULE_BASED, (routeType) =>
      each(NON_TRIP_DETAILS, (context) =>
        expect(
          run({
            prediction: build.prediction({ departureTime: NOW + 95 * S, stopId: '12345', tripId: 'trip1', vehicleId: vehicle.id }),
            vehicle,
            routeType,
            context,
          }),
        ).toEqual({ kind: 'minutes', minutes: 2, last: false }),
      ),
    );
  });

  it('boarding when subway stopped at stop but arrival is in the past and more than 90 seconds until departure', () => {
    const vehicle = stoppedVehicle('12345', 'trip1');
    each(SUBWAY, (routeType) =>
      each(NON_TRIP_DETAILS, (context) =>
        expect(
          run({
            prediction: build.prediction({
              arrivalTime: NOW - 5 * S,
              departureTime: NOW + 95 * S,
              stopId: '12345',
              tripId: 'trip1',
              vehicleId: vehicle.id,
            }),
            vehicle,
            routeType,
            context,
          }),
        ).toEqual({ kind: 'boarding', last: false }),
      ),
    );
  });

  it('not boarding', () => {
    const cases = [stoppedVehicle('12345', 'trip1', 'INCOMING_AT'), stoppedVehicle('67890', 'trip1'), stoppedVehicle('12345', 'trip2')];
    for (const vehicle of cases) {
      each(ALL_CONTEXTS, (context) =>
        expect(
          run({
            prediction: build.prediction({ departureTime: NOW + 10 * S, stopId: '12345', tripId: 'trip1', vehicleId: vehicle.id }),
            vehicle,
            routeType: 1,
            context,
          }).kind,
        ).not.toBe('boarding'),
      );
    }
  });

  it('seconds less than 30', () => {
    each(NON_TRIP_DETAILS, (context) => {
      expect(run({ prediction: build.prediction({ arrivalTime: NOW + 10 * S, departureTime: NOW + 20 * S }), routeType: 1, context })).toEqual({
        kind: 'arriving',
        last: false,
      });
      expect(run({ prediction: build.prediction({ departureTime: NOW + 15 * S }), routeType: 1, context })).toEqual({ kind: 'arriving', last: false });
    });
  });

  it('arriving when prediction arrival in the past and departure more than 30 seconds away', () => {
    each(NON_TRIP_DETAILS, (context) =>
      expect(run({ prediction: build.prediction({ arrivalTime: NOW - 10 * S, departureTime: NOW + 40 * S }), routeType: 1, context })).toEqual({
        kind: 'arriving',
        last: false,
      }),
    );
  });

  it('seconds less than 60 outside trip details', () => {
    each(NON_TRIP_DETAILS, (context) => {
      expect(run({ prediction: build.prediction({ arrivalTime: NOW + 45 * S, departureTime: NOW + 50 * S }), routeType: 1, context })).toEqual({
        kind: 'approaching',
        last: false,
      });
      expect(run({ prediction: build.prediction({ departureTime: NOW + 40 * S }), routeType: 1, context })).toEqual({ kind: 'approaching', last: false });
    });
  });

  it('seconds less than 60 in trip details', () => {
    expect(run({ prediction: build.prediction({ arrivalTime: NOW + 45 * S, departureTime: NOW + 50 * S }), routeType: 1, context: 'tripDetails' })).toEqual({
      kind: 'time',
      predictionTime: NOW + 45 * S,
      last: false,
      headline: false,
    });
    expect(run({ prediction: build.prediction({ departureTime: NOW + 40 * S }), routeType: 1, context: 'tripDetails' })).toEqual({
      kind: 'time',
      predictionTime: NOW + 40 * S,
      last: false,
      headline: false,
    });
  });

  it('minutes in the distant future', () => {
    each(BOOLS, (lastTrip) =>
      each(NON_TRIP_DETAILS, (context) => {
        expect(
          run({ prediction: build.prediction({ arrivalTime: NOW + 61 * MIN, departureTime: NOW + 62 * MIN }), routeType: 1, context, lastTrip }),
        ).toEqual({ kind: 'minutes', minutes: 61, last: lastTrip });
        each(NON_SCHEDULE_BASED, (routeType) =>
          expect(run({ prediction: build.prediction({ departureTime: NOW + 99 * MIN }), routeType, context, lastTrip })).toEqual({
            kind: 'minutes',
            minutes: 99,
            last: lastTrip,
          }),
        );
        each(SCHEDULE_BASED, (routeType) =>
          expect(run({ prediction: build.prediction({ departureTime: NOW + 99 * MIN }), routeType, context, lastTrip })).toEqual({
            kind: 'time',
            predictionTime: NOW + 99 * MIN,
            last: lastTrip,
            headline: true,
          }),
        );
      }),
    );
  });

  it('time with status', () => {
    const predictionTime = NOW + 2 * MIN;
    each(BOOLS, (lastTrip) =>
      expect(
        run({ prediction: build.prediction({ status: 'All aboard', departureTime: predictionTime }), routeType: 2, context: 'stopDetailsFiltered', lastTrip }),
      ).toEqual({ kind: 'timeWithStatus', predictionTime, status: 'All aboard', last: lastTrip, headline: true }),
    );
  });

  it('time with schedule early', () => {
    const predictionTime = NOW + 2 * MIN;
    const scheduledTime = NOW + 5 * MIN;
    expect(
      run({
        prediction: build.prediction({ departureTime: predictionTime }),
        schedule: build.schedule({ departureTime: scheduledTime }),
        routeType: 2,
        context: 'stopDetailsFiltered',
      }),
    ).toEqual({ kind: 'timeWithSchedule', predictionTime, scheduledTime, last: false, headline: true });
  });

  it('time with schedule late', () => {
    const predictionTime = NOW + 2 * MIN;
    const scheduledTime = NOW - 5 * MIN;
    expect(
      run({
        prediction: build.prediction({ departureTime: predictionTime }),
        schedule: build.schedule({ departureTime: scheduledTime }),
        routeType: 2,
        context: 'stopDetailsFiltered',
      }),
    ).toEqual({ kind: 'timeWithSchedule', predictionTime, scheduledTime, last: false, headline: true });
  });

  it('minutes less than 20 outside trip details', () => {
    const cases: [number, number][] = [
      [89 * S, 1],
      [90 * S, 2],
      [149 * S, 2],
      [150 * S, 3],
      [209 * S, 3],
      [45 * MIN, 45],
    ];
    each(NON_TRIP_DETAILS, (context) => {
      each(NON_SCHEDULE_BASED, (routeType) => {
        for (const [offset, minutes] of cases) {
          expect(run({ prediction: build.prediction({ departureTime: NOW + offset }), routeType, context })).toEqual({ kind: 'minutes', minutes, last: false });
        }
      });
      each(SCHEDULE_BASED, (routeType) =>
        expect(run({ prediction: build.prediction({ departureTime: NOW + 45 * MIN }), routeType, context })).toEqual({
          kind: 'time',
          predictionTime: NOW + 45 * MIN,
          last: false,
          headline: true,
        }),
      );
    });
  });

  it('minutes less than 20 in trip details', () => {
    for (const offset of [90 * S, 149 * S, 45 * MIN]) {
      expect(run({ prediction: build.prediction({ departureTime: NOW + offset }), routeType: 1, context: 'tripDetails' })).toEqual({
        kind: 'time',
        predictionTime: NOW + offset,
        last: false,
        headline: false,
      });
    }
  });

  const cancelled = () => build.prediction({ scheduleRelationship: 'CANCELLED', arrivalTime: null, departureTime: null });

  it('scheduled trip cancelled', () => {
    expect(run({ prediction: cancelled(), schedule: build.schedule({ departureTime: NOW + 15 * MIN }), routeType: 3, context: 'stopDetailsFiltered' })).toEqual({
      kind: 'cancelled',
      scheduledTime: NOW + 15 * MIN,
    });
  });

  it('scheduled trip cancelled in past is hidden', () => {
    expect(run({ prediction: cancelled(), schedule: build.schedule({ departureTime: NOW - 15 * MIN }), routeType: 3, context: 'stopDetailsFiltered' })).toEqual({
      kind: 'hidden',
    });
  });

  it('cancelled subway trip is hidden', () => {
    expect(run({ prediction: cancelled(), schedule: build.schedule({ departureTime: NOW + 15 * MIN }), routeType: 0, context: 'stopDetailsFiltered' })).toEqual({
      kind: 'hidden',
    });
  });

  it('cancelled trip is hidden in other contexts', () => {
    each(['nearby', 'stopDetailsUnfiltered', 'tripDetails'] as DisplayContext[], (context) =>
      expect(run({ prediction: cancelled(), schedule: build.schedule({ departureTime: NOW + 15 * MIN }), routeType: 3, context })).toEqual({ kind: 'hidden' }),
    );
  });

  it('cancelled trip shown for CR and Ferry in all contexts', () => {
    each(SCHEDULE_BASED, (routeType) =>
      each(ALL_CONTEXTS, (context) =>
        expect(run({ prediction: cancelled(), schedule: build.schedule({ departureTime: NOW + 15 * MIN }), routeType, context })).toEqual({
          kind: 'cancelled',
          scheduledTime: NOW + 15 * MIN,
        }),
      ),
    );
  });

  it('departure times are shown instead of arrival times for Ferry and Commuter Rail', () => {
    each(NON_TRIP_DETAILS, (context) =>
      expect(run({ prediction: build.prediction({ arrivalTime: NOW + 10 * MIN, departureTime: NOW + 15 * MIN }), routeType: 2, context })).toEqual({
        kind: 'time',
        predictionTime: NOW + 15 * MIN,
        last: false,
        headline: true,
      }),
    );
  });

  it('arrival times are show instead of departure times for Ferry and Commuter Rail on trip details', () => {
    expect(run({ prediction: build.prediction({ arrivalTime: NOW + 10 * MIN, departureTime: NOW + 15 * MIN }), routeType: 2, context: 'tripDetails' })).toEqual({
      kind: 'time',
      predictionTime: NOW + 10 * MIN,
      last: false,
      headline: false,
    });
  });

  // UpcomingTripTest `scheduled trip shuttle`: an alert naming the trip turns CR into Shuttle.
  it('scheduled trip shuttle (alert on the trip)', () => {
    const alert = build.alert({ effect: 'SHUTTLE' });
    each([2, 4] as RouteType[], (routeType) =>
      each(NON_TRIP_DETAILS, (context) =>
        expect(run({ prediction: build.prediction(), schedule: build.schedule({ departureTime: NOW + 15 * MIN }), routeType, context, alert })).toEqual({
          kind: 'shuttle',
          scheduledTime: NOW + 15 * MIN,
        }),
      ),
    );
  });

  it.each(ALL_TYPES)('never throws for route type %s with empty data', (routeType) => {
    each(ALL_CONTEXTS, (context) => expect(run({ routeType, context })).toEqual({ kind: 'hidden' }));
  });
});

describe('departureText (MA §3.1 strings)', () => {
  it('renders the fixed strings', () => {
    expect(departureText({ kind: 'boarding', last: false }).primary).toBe('BRD');
    expect(departureText({ kind: 'arriving', last: false }).primary).toBe('ARR');
    expect(departureText({ kind: 'now', last: false }).primary).toBe('Now');
    expect(departureText({ kind: 'approaching', last: false })).toMatchObject({ primary: '1 min', boldPart: '1', realtime: true });
    expect(departureText({ kind: 'minutes', minutes: 5, last: true })).toMatchObject({ primary: '5 min', boldPart: '5', last: true });
    expect(departureText({ kind: 'minutes', minutes: 65, last: false }).primary).toBe('1 hr 5 min');
    expect(departureText({ kind: 'cancelled', scheduledTime: NOW }).primary).toBe('Cancelled');
    expect(departureText({ kind: 'shuttle', scheduledTime: NOW })).toMatchObject({ primary: 'Shuttle', icon: 'bus' });
    expect(departureText({ kind: 'skipped', scheduledTime: null })).toMatchObject({ primary: 'Stop skipped', struck: null });
    expect(departureText({ kind: 'scheduleMinutes', minutes: 4, last: false }).realtime).toBe(false);
    expect(departureText({ kind: 'hidden' }).primary).toBe('');
  });

  it('formats clock times in Eastern time', () => {
    // 2026-10-19 16:00 UTC is 12:00 PM EDT.
    expect(departureText({ kind: 'time', predictionTime: NOW, last: false, headline: true }).primary).toBe('12:00 PM');
    expect(departureText({ kind: 'timeWithSchedule', predictionTime: NOW, scheduledTime: NOW - 5 * MIN, last: false, headline: false }).struck).toBe('11:55 AM');
  });
});
