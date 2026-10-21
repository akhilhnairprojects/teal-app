import { act } from 'react-test-renderer';

import { MbtaApiError } from '@/mbta/api/errors';
import { clearPollCache } from '@/mbta/live/usePolling';
import type { LiveDepartures, OccupancyStatus, ScheduleSet, Trip } from '@/mbta/model/types';
import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';
import { textOf, waitForText, withScreen } from '@/mbta/testing/render';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';

import { TripDetailsScreen } from '../TripDetailsScreen';
import { clearTripCache } from '../useTripDetails';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: (h: unknown) => mockPush(h), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
    useIsFocused: () => true,
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});

const MIN = 60_000;
const NOW = Date.now();
const b = createBuilder();
const red = redLine(b);
const mockGlobal = b.global();

jest.mock('@/mbta/global/globalData', () => ({
  STOP_BLOCKLIST: ['place-symcl'],
  parentStationId: (_g: unknown, id: string) => id,
  useGlobalData: () => ({ data: mockGlobal, status: 'ready', error: null, refresh: () => {} }),
}));
jest.mock('@/mbta/live/useAlerts', () => ({
  useAlerts: () => ({ data: [], error: null, updatedAt: Date.now(), stale: false, refreshing: false, refresh: async () => {}, byId: {} }),
}));

const mockApi = {
  predictions: jest.fn<Promise<LiveDepartures>, [string]>(),
  schedules: jest.fn<Promise<ScheduleSet>, [string]>(),
  trip: jest.fn<Promise<Trip>, [string]>(),
};
jest.mock('@/mbta/api/endpoints', () => ({
  fetchPredictionsForTrip: (id: string) => mockApi.predictions(id),
  fetchSchedulesForTrip: (id: string) => mockApi.schedules(id),
  fetchTrip: (id: string) => mockApi.trip(id),
}));

const platforms = mockGlobal.trips[red.ashmontSouth.representativeTripId].stopIds!;

/** A southbound Ashmont trip with predictions at its first four stops and an optional vehicle. */
function scenario(o: { vehicle?: 'cars' | 'noData' | 'other' | null; added?: boolean }) {
  const s = createBuilder('s');
  const trip = { ...b.tripFor(red.ashmontSouth), id: `trip-${Math.random()}` };
  const cars = (list: OccupancyStatus[]) => list.map((occupancyStatus, i) => s.carriage({ sequence: i + 1, occupancyStatus }));
  const vehicle =
    o.vehicle === 'cars'
      ? s.vehicle({
          tripId: trip.id,
          stopId: platforms[1],
          currentStatus: 'IN_TRANSIT_TO',
          currentStopSequence: 20,
          occupancyStatus: 'FEW_SEATS_AVAILABLE',
          carriages: cars(['FULL', 'FULL', 'MANY_SEATS_AVAILABLE', 'STANDING_ROOM_ONLY', 'FULL', 'FULL']),
        })
      : o.vehicle === 'noData'
        ? s.vehicle({ tripId: trip.id, stopId: platforms[1], currentStopSequence: 20, carriages: cars(['NO_DATA_AVAILABLE', 'NO_DATA_AVAILABLE']) })
        : o.vehicle === 'other'
          ? s.vehicle({ tripId: 'previous-trip', stopId: platforms[0], currentStatus: 'STOPPED_AT' })
          : null;
  const schedules = platforms.slice(0, 4).map((stopId, i) =>
    s.schedule({ trip, stopId, stopSequence: (i + 1) * 10, arrivalTime: NOW + (i + 1) * 3 * MIN, departureTime: NOW + (i + 1) * 3 * MIN }),
  );
  const predictions = schedules.map((sc) =>
    s.predictionFor(sc, {
      arrivalTime: sc.arrivalTime,
      departureTime: sc.departureTime,
      vehicleId: vehicle?.id ?? null,
      directionId: 0,
      scheduleRelationship: o.added ? 'ADDED' : null,
    }),
  );
  mockApi.predictions.mockResolvedValue({ predictions, trips: { [trip.id]: trip }, vehicles: vehicle ? { [vehicle.id]: vehicle } : {} });
  mockApi.schedules.mockResolvedValue(o.added ? { schedules: [], trips: {} } : { schedules, trips: { [trip.id]: trip } });
  mockApi.trip.mockResolvedValue({ ...trip, stopIds: platforms });
  return { trip, vehicle };
}

// Fake timers: polling and countdown intervals never fire, so nothing outlives a test.
beforeEach(() => {
  jest.useFakeTimers();
  clearTripCache();
  clearPollCache();
  resetMapOverlays();
  mockPush.mockClear();
  Object.values(mockApi).forEach((m) => m.mockReset());
});
afterEach(() => jest.useRealTimers());

describe('TripDetailsScreen (smoke)', () => {
  it('shows the vehicle status, the car diagram with "Board car N", and follows the vehicle', async () => {
    const { trip, vehicle } = scenario({ vehicle: 'cars' });
    await withScreen(<TripDetailsScreen params={{ tripId: trip.id, stopId: platforms[3], stopSequence: 40, vehicleId: vehicle!.id }} />, async (screen) => {
      await waitForText(screen, 'To Ashmont', 'Next stop');
      const text = textOf(screen);
      expect(text).toContain('Harvard');
      expect(text).toContain('Some crowding');
      expect(text).toContain('Board car 3');
      expect(text).toContain('of 6 · least crowded');
      expect(screen.root.findAllByProps({ accessibilityLabel: 'Board car 3 of 6' }).length).toBeGreaterThan(0);
      expect(getActiveMapOverlay()).toMatchObject({ routeIds: ['Red'], directionId: 0, showVehicles: true, selectedVehicleId: null });

      await act(async () => {
        screen.root.findByProps({ accessibilityLabel: 'Follow this train on the map' }).props.onPress();
      });
      expect(getActiveMapOverlay()?.selectedVehicleId).toBe(vehicle!.id);
    });
  });

  it('shows "Crowding not available" for an ADDED trip whose cars report NO_DATA', async () => {
    const { trip } = scenario({ vehicle: 'noData', added: true });
    await withScreen(<TripDetailsScreen params={{ tripId: trip.id, stopId: null, stopSequence: null, vehicleId: null }} />, async (screen) => {
      await waitForText(screen, 'Crowding not available');
      expect(textOf(screen)).not.toContain('Board car');
      expect(mockApi.trip).toHaveBeenCalledWith(trip.id);
    });
  });

  it('shows "Finishing another trip" and no crowding for a vehicle on its previous trip', async () => {
    const { trip } = scenario({ vehicle: 'other' });
    await withScreen(<TripDetailsScreen params={{ tripId: trip.id, stopId: null, stopSequence: null, vehicleId: null }} />, async (screen) => {
      await waitForText(screen, 'Finishing another trip');
      expect(textOf(screen)).not.toContain('crowd');
    });
  });

  it('shows a friendly error for an unknown trip', async () => {
    mockApi.predictions.mockResolvedValue({ predictions: [], trips: {}, vehicles: {} });
    mockApi.schedules.mockResolvedValue({ schedules: [], trips: {} });
    mockApi.trip.mockRejectedValue(new MbtaApiError({ kind: 'http', status: 404 }));
    await withScreen(<TripDetailsScreen params={{ tripId: 'gone', stopId: null, stopSequence: null, vehicleId: null }} />, async (screen) => {
      await waitForText(screen, 'We couldn’t find this trip');
    });
  });

  it('"Try again" reloads the trip schedules after a failed load, not only the predictions', async () => {
    const { trip } = scenario({ vehicle: 'cars' });
    mockApi.predictions.mockResolvedValueOnce({ predictions: [], trips: {}, vehicles: {} });
    mockApi.schedules.mockRejectedValueOnce(new MbtaApiError({ kind: 'network', message: 'offline' }));
    await withScreen(<TripDetailsScreen params={{ tripId: trip.id, stopId: null, stopSequence: null, vehicleId: null }} />, async (screen) => {
      await waitForText(screen, 'Couldn’t load this trip');
      expect(mockApi.schedules).toHaveBeenCalledTimes(1);
      const retry = screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf(n) === 'Try again')[0];
      await act(async () => retry.props.onPress());
      await waitForText(screen, 'To Ashmont', 'Next stop');
      expect(mockApi.schedules).toHaveBeenCalledTimes(2);
      expect(mockApi.predictions).toHaveBeenCalledTimes(2);
    });
  });
});
