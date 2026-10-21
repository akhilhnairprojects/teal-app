import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from 'react-test-renderer';

import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';
import { textOf, waitUntil, withScreen } from '@/mbta/testing/render';
import { resetFavoritesStore } from '@/state/favorites';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';

import { StopDetailsScreen } from '../StopDetailsScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPush = jest.fn();
const mockSetParams = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: (h: unknown) => mockPush(h), setParams: (p: unknown) => mockSetParams(p), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
    useIsFocused: () => true,
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});

const MIN = 60_000;
const NOW = Date.now();
const b = createBuilder();
const red = redLine(b);
const ashmontTrip = b.tripFor(red.ashmontSouth);
const braintreeTrip = b.tripFor(red.braintreeSouth);
const carVehicle = b.vehicle({
  tripId: ashmontTrip.id,
  routeId: 'Red',
  occupancyStatus: 'FEW_SEATS_AVAILABLE',
  carriages: (['FULL', 'FULL', 'MANY_SEATS_AVAILABLE', 'STANDING_ROOM_ONLY', 'FULL', 'FULL'] as const).map((occupancyStatus, i) =>
    b.carriage({ sequence: i + 1, occupancyStatus }),
  ),
});
b.prediction({
  trip: ashmontTrip,
  stopId: 'place-pktrm-0',
  stopSequence: 30,
  arrivalTime: NOW + 4 * MIN,
  departureTime: NOW + 4 * MIN,
  vehicleId: carVehicle.id,
});
b.prediction({ trip: braintreeTrip, stopId: 'place-pktrm-0', stopSequence: 30, arrivalTime: NOW + 9 * MIN, departureTime: NOW + 9 * MIN });
const mockGlobal = b.global();
const mockLive = b.liveDepartures();

jest.mock('@/mbta/global/globalData', () => ({
  STOP_BLOCKLIST: ['place-symcl'],
  parentStationId: (g: typeof mockGlobal, id: string) => {
    let cur = id;
    while (g.stops[cur]?.parentStationId) cur = g.stops[cur].parentStationId!;
    return cur;
  },
  childStopIds: (g: typeof mockGlobal, id: string) => g.stops[id]?.childStopIds ?? [],
  useGlobalData: () => ({ data: mockGlobal, status: 'ready', error: null, refresh: () => {} }),
}));
jest.mock('@/mbta/live/useStopLiveData', () => ({
  useStopLiveData: () => ({
    predictions: { data: mockLive, error: null, updatedAt: Date.now(), stale: false, refreshing: false, refresh: async () => {} },
    schedules: { schedules: [], trips: {} },
    alerts: [],
  }),
}));

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  resetFavoritesStore();
  resetMapOverlays();
  mockPush.mockClear();
  mockSetParams.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('StopDetailsScreen (smoke)', () => {
  it('unfiltered: shows the route card and filters on a leaf tap', async () => {
    await withScreen(<StopDetailsScreen stopId="place-pktrm" filter={null} />, async (screen) => {
      const text = textOf(screen);
      expect(text).toContain('Park Street');
      expect(text).toContain('Red Line');
      expect(getActiveMapOverlay()).toEqual({ focusStopId: 'place-pktrm' });
      const leaf = screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf(n).includes('Ashmont'))[0];
      act(() => leaf.props.onPress());
      expect(mockSetParams).toHaveBeenCalledWith({ routeId: 'Red', directionId: '0' });
    });
  });

  it('filtered: shows tiles with the board-car hint, the direction picker and vehicles on the map', async () => {
    await withScreen(<StopDetailsScreen stopId="place-pktrm-0" filter={{ routeId: 'Red', directionId: 0 }} />, async (screen) => {
      const text = textOf(screen);
      expect(text).toContain('Ashmont');
      expect(text).toContain('Braintree');
      expect(screen.root.findAllByProps({ accessibilityLabel: 'Arriving in 4 minutes' }).length).toBeGreaterThan(0);
      expect(text).toContain('Board car 3');
      expect(getActiveMapOverlay()).toEqual({ routeIds: ['Red'], directionId: 0, showVehicles: true, focusStopId: 'place-pktrm' });

      const tile = screen.root.findAll((n) => n.props.accessibilityHint === 'Opens trip details')[0];
      act(() => tile.props.onPress());
      expect(mockPush).toHaveBeenCalledWith(`/trip/${encodeURIComponent(ashmontTrip.id)}?stopId=place-pktrm-0&stopSequence=30&vehicleId=${encodeURIComponent(carVehicle.id)}`);

      await act(async () => {
        screen.root.findByProps({ accessibilityLabel: 'Add to favorites' }).props.onPress();
      });
      // The favorite is saved through AsyncStorage: wait for the star to flip rather than a tick count.
      await waitUntil(() => screen.root.findAllByProps({ accessibilityLabel: 'Remove from favorites' }).length > 0, () => textOf(screen));
    });
  });

  it('shows a friendly error for an unknown stop', async () => {
    await withScreen(<StopDetailsScreen stopId="nowhere" filter={null} />, async (screen) => {
      expect(textOf(screen)).toContain('We couldn’t find this stop');
    });
  });
});
