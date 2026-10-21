import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { noteMapTouchMove, onMapRegionSettled, resetMapCenter, setUserLocation } from '@/features/map/mapCenter';
import type { LiveDepartures } from '@/mbta/model/types';
import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';

import { liveLabel } from '../liveLabel';
import { NearbyScreen } from '../NearbyScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canDismiss: () => false, dismissAll: jest.fn() },
  usePathname: () => '/',
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
}));

const mockGlobal: { current: unknown } = { current: null };
// Minimal stand-in: requireActual would re-enter this mock through shapes.ts (circular import).
type MockGlobal = { stops: Record<string, { parentStationId: string | null; childStopIds: string[] }> };
jest.mock('@/mbta/global/globalData', () => ({
  STOP_BLOCKLIST: ['place-symcl'],
  parentStationId: (g: MockGlobal, id: string) => {
    let cur = id;
    while (g.stops[cur]?.parentStationId) cur = g.stops[cur].parentStationId!;
    return cur;
  },
  childStopIds: (g: MockGlobal, id: string) => g.stops[id]?.childStopIds ?? [],
  useGlobalData: () => ({ data: mockGlobal.current, status: mockGlobal.current ? 'ready' : 'loading', error: null, refresh: jest.fn() }),
  useRailShapes: () => ({}),
}));

const mockLive: { current: { data: LiveDepartures | null; updatedAt: number | null } } = { current: { data: null, updatedAt: null } };
const mockStopIds: { current: string[] | null } = { current: null };
jest.mock('@/mbta/live/useStopLiveData', () => ({
  useStopLiveData: (stopIds: string[] | null) => {
    mockStopIds.current = stopIds;
    return {
      predictions: { ...mockLive.current, error: null, stale: false, refreshing: false, refresh: jest.fn() },
      schedules: { schedules: [], trips: {} },
      alerts: [],
    };
  },
}));

jest.mock('@/data/bluebikes', () => ({
  fetchNearestBikeStations: jest.fn(async () => [
    {
      id: 'bb1',
      name: 'JFK/UMass T Stop',
      location: { latitude: 42.3207, longitude: -71.06 },
      distanceMeters: 120,
      capacity: 15,
      classicBikes: 4,
      ebikes: 1,
      openDocks: 9,
      isRenting: true,
      isReturning: true,
      rentalUrl: null,
      reportedAt: 0,
    },
  ]),
}));

const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock; replace: jest.Mock } };

const MIN = 60_000;
const JFK = { latitude: 42.3207, longitude: -71.06 };
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function textOf(r: ReactTestRenderer): string {
  return r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .filter((t) => /[A-Za-z0-9]/.test(t))
    .join(' | ');
}

const mounted: ReactTestRenderer[] = [];
async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <NearbyScreen />
      </SafeAreaProvider>,
    );
  });
  mounted.push(r);
  return r;
}

function redLineWithPredictions(now: number) {
  const b = createBuilder();
  const red = redLine(b);
  b.prediction({ trip: b.tripFor(red.ashmontSouth), stopId: red.jfk.south1.id, departureTime: now + 4 * MIN, arrivalTime: now + 4 * MIN });
  b.prediction({ trip: b.tripFor(red.braintreeSouth), stopId: red.jfk.south2.id, departureTime: now + 7 * MIN, arrivalTime: now + 7 * MIN });
  return { global: b.global(), live: b.liveDepartures() };
}

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  resetMapCenter();
  mockGlobal.current = null;
  mockLive.current = { data: null, updatedAt: null };
  mockStopIds.current = null;
});

afterEach(() => {
  act(() => mounted.splice(0).forEach((r) => r.unmount()));
});

describe('NearbyScreen', () => {
  it('shows skeleton cards while global data loads', async () => {
    setUserLocation({ status: 'ready', coords: JFK, source: 'device' });
    const r = await render();
    expect(r.root.findByProps({ testID: 'nearby-skeleton' })).toBeTruthy();
    expect(textOf(r)).toContain('Connecting…');
  });

  it('renders route cards from builder fixtures and pushes the filtered stop page', async () => {
    const now = Date.now();
    const { global, live } = redLineWithPredictions(now);
    mockGlobal.current = global;
    mockLive.current = { data: live, updatedAt: now };
    setUserLocation({ status: 'ready', coords: JFK, source: 'device' });

    const r = await render();
    const text = textOf(r);
    expect(mockStopIds.current?.sort()).toEqual(global.stops['place-jfk'].childStopIds.slice().sort());
    expect(text).toContain('Red Line');
    expect(text).toContain('JFK/UMass');
    expect(text).toContain('Ashmont');
    expect(text).toContain('Braintree');
    expect(text).toContain('Live · just now');
    expect(text).toContain('Bluebikes');
    expect(text).toContain('JFK/UMass T Stop');
    expect(text).toContain('Not affiliated with or endorsed by the MBTA');

    const leaf = r.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && n.props.style !== undefined)[0];
    act(() => leaf.props.onPress());
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/stop\/place-jfk\?routeId=Red&directionId=[01]$/));
  });

  it('shows the fallback banner and the empty state with a Plan CTA when no rail is near', async () => {
    const now = Date.now();
    mockGlobal.current = redLineWithPredictions(now).global;
    // Far west of the fixture's Red Line (> 2 mi).
    setUserLocation({ status: 'ready', coords: { latitude: 42.35, longitude: -71.3 }, source: 'fallback', reason: 'Demo' });
    const r = await render();
    const text = textOf(r);
    expect(text).toContain('Showing Park Street · Demo');
    expect(text).toContain('No T stations nearby');
    const cta = r.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function').find((n) =>
      n.findAllByType(Text).some((t) => t.props.children === 'Plan a trip'),
    )!;
    act(() => cta.props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/plan');
  });

  it('offers "Back to my location" after a map pan', async () => {
    mockGlobal.current = redLineWithPredictions(Date.now()).global;
    setUserLocation({ status: 'ready', coords: JFK, source: 'device' });
    act(() => {
      noteMapTouchMove();
      onMapRegionSettled({ latitude: 42.3564, longitude: -71.06 });
    });
    const r = await render();
    expect(textOf(r)).toContain('Showing the map area');
    // Nearby now uses Park Street's platforms.
    expect(mockStopIds.current).toEqual(expect.arrayContaining(['place-pktrm-0']));
    await act(async () => r.root.findByProps({ testID: 'nearby-back-to-me' }).props.onPress());
    expect(textOf(r)).not.toContain('Showing the map area');
  });
});

describe('liveLabel', () => {
  it('formats the badge', () => {
    expect(liveLabel(null, 0)).toBe('Connecting…');
    expect(liveLabel(1_000, 5_000)).toBe('Live · just now');
    expect(liveLabel(0, 42_000)).toBe('Live · 42s ago');
    expect(liveLabel(0, 180_000)).toBe('Live · 3m ago');
  });
});
