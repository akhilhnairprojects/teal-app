import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { resetMapCenter, setUserLocation } from '@/features/map/mapCenter';
import type { PlanResult } from '@/planner/types';

import { dockBikesText, dockParkingText, durationText, leaveText, modeSummary, uncertaintyText, weatherText } from '../format';
import { PlannerScreen } from '../PlannerScreen';
import { planKey } from '../usePlan';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (h: unknown) => mockPush(h), back: jest.fn(), replace: jest.fn() },
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(cb, [cb]),
}));

const mockNet = (() => {
  const { buildNetwork } = jest.requireActual('@/planner/__fixtures__/network');
  return buildNetwork();
})();
jest.mock('@/mbta/global/globalData', () => {
  const { resolveParentId } = jest.requireActual('@/mbta/model/parse');
  return {
    STOP_BLOCKLIST: ['place-symcl'],
    parentStationId: (g: { stops: Record<string, never> }, id: string) => resolveParentId(g.stops, id),
    childStopIds: (g: { stops: Record<string, { childStopIds: string[] }> }, id: string) => g.stops[id]?.childStopIds ?? [],
    useGlobalData: () => ({ data: mockNet.global, status: 'ready', error: null, refresh: () => {} }),
    useRailShapes: () => null,
  };
});
// The planner must not look up the location itself: it reads the shell's shared location.
const mockLocation = { requestForegroundPermissionsAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(), getCurrentPositionAsync: jest.fn() };
// Delegate lazily: the factory runs before `mockLocation` is initialized.
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: () => mockLocation.requestForegroundPermissionsAsync(),
  getLastKnownPositionAsync: () => mockLocation.getLastKnownPositionAsync(),
  getCurrentPositionAsync: () => mockLocation.getCurrentPositionAsync(),
  Accuracy: { Balanced: 3 },
}));

const mockPlan: { result: PlanResult | null } = { result: null };
jest.mock('../usePlan', () => ({
  ...jest.requireActual('../usePlan'),
  usePlan: () => ({
    data: mockPlan.result,
    error: null,
    updatedAt: 0,
    stale: false,
    refreshing: false,
    refresh: async () => {},
    ready: true,
  }),
}));

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 19, 16, 0);

const textOf = (r: ReactTestRenderer) =>
  r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .filter((t) => /[A-Za-z0-9]/.test(t))
    .join(' | ');

describe('planner format', () => {
  it('formats durations, leave times, docks and uncertainty', () => {
    const itin = { departTime: NOW + 3 * MIN, arriveTime: NOW + 28 * MIN } as PlanResult['itineraries'][number];
    expect(durationText(itin, NOW)).toBe('28 min');
    expect(leaveText(NOW, NOW)).toBe('Leave now');
    expect(leaveText(NOW + 4 * MIN, NOW)).toBe('Leave in 4 min');
    expect(leaveText(NOW + 90 * MIN, NOW)).toBe('Leave at 1:30 PM');
    const dock = { stationId: 'a', name: 'A', latLng: { latitude: 0, longitude: 0 }, bikes: 3, ebikes: 1, docks: 1, rentalUrl: null };
    expect(dockBikesText(dock)).toBe('3 bikes (1 e-bike)');
    expect(dockParkingText(dock)).toBe('1 open dock to park');
    expect(uncertaintyText(60)).toBeNull();
    expect(uncertaintyText(360)).toBe('Departure time may shift by about 6 min');
    expect(
      weatherText({ fetchedAt: 0, temperatureF: 54.6, shortForecast: 'Light Rain', precipProbability: 40, windMph: 3, bikeAdvisory: 'caution', reason: null }),
    ).toBe('55°F · Light Rain · 40% precip');
  });

  it('keys plans by place, not time', () => {
    const a = { name: 'A', latLng: { latitude: 42.1, longitude: -71.1 }, source: 'map' as const };
    const b = { name: 'B', latLng: { latitude: 42.2, longitude: -71.2 }, source: 'station' as const, stopId: 'place-x' };
    expect(planKey({ origin: a, destination: b })).toBe(planKey({ origin: { ...a, name: 'renamed' }, destination: b }));
    expect(planKey({ origin: a, destination: b })).not.toBe(planKey({ origin: b, destination: a }));
    expect(planKey(null)).toBeNull();
  });
});

describe('PlannerScreen', () => {
  beforeAll(async () => {
    const { planTrip } = jest.requireActual('@/planner/engine');
    const { pred, trip, bikeStation } = jest.requireActual('@/planner/__fixtures__/network');
    trip(mockNet, 'N1', 'Red', 1, 'Alewife');
    const vehicle = mockNet.b.vehicle({
      id: 'R-1',
      carriages: [
        mockNet.b.carriage({ sequence: 1, occupancyStatus: 'FULL', occupancyPercentage: 90 }),
        mockNet.b.carriage({ sequence: 2, occupancyStatus: 'MANY_SEATS_AVAILABLE', occupancyPercentage: 5 }),
      ],
    });
    const predictions = [
      pred(mockNet, 'N1', 'place-dwnxg-R1', 140, { dep: NOW + 3 * MIN, vehicleId: 'R-1' }),
      pred(mockNet, 'N1', 'place-harsq-R1', 190, { arr: NOW + 15 * MIN }),
    ];
    mockPlan.result = await planTrip(
      {
        origin: { name: 'Current location', latLng: { latitude: 42.3555, longitude: -71.0602 }, source: 'current' },
        destination: { name: 'Harvard', latLng: { latitude: 42.3734, longitude: -71.1189 }, source: 'station', stopId: 'place-harsq' },
        departAt: NOW,
      },
      {
        global: mockNet.global,
        alerts: [],
        now: () => NOW,
        fetchPredictions: async () => ({ predictions, trips: { ...mockNet.b.objects.trips }, vehicles: { 'R-1': vehicle } }),
        fetchSchedulesForTrip: async () => ({ schedules: [], trips: {} }),
        fetchSchedulesWindow: async () => ({ schedules: [], trips: {} }),
        fetchBikeStations: async () => [bikeStation('dtx', 42.3557, -71.0604), bikeStation('harvard', 42.3737, -71.1185, { docks: 3 })],
        fetchWeather: async () => ({ fetchedAt: NOW, temperatureF: 58, shortForecast: 'Sunny', precipProbability: 2, windMph: 4, bikeAdvisory: 'ok', reason: null }),
      },
    );
  });

  afterEach(() => resetMapCenter());

  it('shows the station from the link as destination, the options, and a leg timeline with the car to board', async () => {
    setUserLocation({ status: 'ready', coords: { latitude: 42.3555, longitude: -71.0602 }, source: 'device' });
    let r: ReactTestRenderer;
    await act(async () => {
      r = create(<PlannerScreen params={{ toStopId: 'place-harsq' }} />);
    });
    try {
      const text = textOf(r!);
      expect(text).toContain('Current location');
      expect(text).toContain('Harvard');
      expect(text).toContain('Good biking weather');
      expect(text).toContain('Fastest');
      expect(r!.root.findAllByProps({ testID: 'itinerary-transit' }).length).toBeGreaterThan(0);
      expect(r!.root.findAllByProps({ testID: 'itinerary-bike' }).length).toBeGreaterThan(0);

      const card = r!.root.findAll((n) => n.props.testID === 'itinerary-transit' && typeof n.props.onPress === 'function')[0];
      await act(async () => {
        card.props.onPress();
      });
      const detail = textOf(r!);
      expect(detail).toContain('Board at Downtown Crossing');
      expect(detail).toContain('Board car 2 of 2');
      expect(detail).toContain('Arrive at Harvard');
      expect(modeSummary(mockPlan.result!.itineraries.find((i) => i.kind === 'transit')!, mockNet.global)).toBe('Red Line');
    } finally {
      await act(async () => r!.unmount());
    }
  });

  it('plans from the shell location: the demo fallback is Park Street, with no second location request', async () => {
    setUserLocation({ status: 'ready', coords: { latitude: 42.3564, longitude: -71.0624 }, source: 'fallback', reason: 'Demo' });
    let r: ReactTestRenderer;
    await act(async () => {
      r = create(<PlannerScreen params={{ toStopId: 'place-harsq' }} />);
    });
    try {
      expect(r!.root.findByProps({ accessibilityLabel: 'From: Park Street. Double tap to change.' })).toBeTruthy();
      expect(textOf(r!)).not.toContain('Current location');
      expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
      // A later shell update (e.g. a device fix) reaches the open planner.
      await act(async () => setUserLocation({ status: 'ready', coords: { latitude: 42.3555, longitude: -71.0602 }, source: 'device' }));
      expect(r!.root.findByProps({ accessibilityLabel: 'From: Current location. Double tap to change.' })).toBeTruthy();
    } finally {
      await act(async () => r!.unmount());
    }
  });
});
