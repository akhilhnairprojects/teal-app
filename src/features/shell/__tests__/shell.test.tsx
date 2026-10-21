import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getNearbyPosition, resetMapCenter } from '@/features/map/mapCenter';
import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';
import { requestSheetDetent } from '@/state/sheet';

import { AppShell } from '../AppShell';
import { SheetChrome } from '../SheetChrome';
import { SheetTabs } from '../SheetTabs';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

// The shared mock (jest.setup.ts) lacks `__esModule`, so a default import resolves to the whole
// module object; re-export it as an ES module here.
jest.mock('@gorhom/bottom-sheet', () => ({ __esModule: true, ...jest.requireActual('@gorhom/bottom-sheet/mock') }));

const mockPathname = { current: '/' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canDismiss: jest.fn(() => false), dismissAll: jest.fn() },
  usePathname: () => mockPathname.current,
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
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
  useGlobalData: () => ({ data: mockGlobal.current, status: 'ready', error: null, refresh: jest.fn() }),
  useRailShapes: () => ({}),
}));

const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock; replace: jest.Mock; canDismiss: jest.Mock; dismissAll: jest.Mock } };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

const mounted: ReactTestRenderer[] = [];
async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>);
  });
  mounted.push(r);
  return r;
}

beforeEach(() => {
  mockPathname.current = '/';
  router.push.mockClear();
  router.replace.mockClear();
  router.dismissAll.mockClear();
  router.canDismiss.mockReturnValue(false);
  resetMapCenter();
  const b = createBuilder();
  redLine(b);
  mockGlobal.current = b.global();
});

afterEach(() => {
  act(() => mounted.splice(0).forEach((r) => r.unmount()));
});

describe('AppShell', () => {
  it('mounts the map, the sheet chrome and the routed content', async () => {
    const r = await render(
      <AppShell>
        <Text>route content</Text>
      </AppShell>,
    );
    expect(r.root.findByProps({ testID: 'teal-map' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'sheet-chrome' })).toBeTruthy();
    expect(r.root.findAllByType(Text).some((t) => t.props.children === 'route content')).toBe(true);
    // Location permission denied -> Park Street fallback shared with Nearby.
    expect(getNearbyPosition()).toMatchObject({ status: 'ready', source: 'fallback' });
    // A detent request from a screen doesn't throw.
    act(() => requestSheetDetent('collapsed'));
  });

  it('draws every station and opens the stop page when one is tapped', async () => {
    const r = await render(
      <AppShell>
        <Text>content</Text>
      </AppShell>,
    );
    const markers = r.root.findAll((n) => typeof n.props.identifier === 'string' && n.props.identifier.startsWith('place-'));
    // One marker element per station (filter out host duplicates by identifier).
    expect(new Set(markers.map((m) => m.props.identifier)).size).toBe(11);
    act(() => markers.find((m) => m.props.identifier === 'place-jfk')!.props.onPress());
    expect(router.push).toHaveBeenCalledWith('/stop/place-jfk');
  });
});

describe('SheetTabs / SheetChrome', () => {
  it('renders four tabs and the Move tab navigates to the Move hub', async () => {
    const r = await render(<SheetTabs />);
    const tabs = r.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('sheet-tab-'));
    // One entry per tab (filter out host duplicates of the same element).
    expect([...new Set(tabs.map((n) => n.props.testID))]).toEqual([
      'sheet-tab-nearby',
      'sheet-tab-plan',
      'sheet-tab-favorites',
      'sheet-tab-move',
    ]);
    act(() => r.root.findByProps({ testID: 'sheet-tab-move' }).props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/move');
  });

  it('keeps the chrome on the Move page', async () => {
    mockPathname.current = '/move';
    const r = await render(<SheetChrome />);
    expect(r.root.findAllByProps({ testID: 'sheet-chrome' }).length).toBeGreaterThan(0);
  });

  it('switches top-level routes with replace', async () => {
    const r = await render(<SheetTabs />);
    act(() => r.root.findByProps({ testID: 'sheet-tab-plan' }).props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/plan');
    act(() => r.root.findByProps({ testID: 'sheet-tab-favorites' }).props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/favorites');
    // The active tab is a no-op.
    router.replace.mockClear();
    act(() => r.root.findByProps({ testID: 'sheet-tab-nearby' }).props.onPress());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('dismisses pushed pages before switching, so tab pages never stack', async () => {
    router.canDismiss.mockReturnValue(true);
    const r = await render(<SheetTabs />);
    act(() => r.root.findByProps({ testID: 'sheet-tab-favorites' }).props.onPress());
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/favorites');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens search and about from the chrome', async () => {
    const r = await render(<SheetChrome />);
    act(() => r.root.findByProps({ testID: 'sheet-search' }).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/search');
    act(() => r.root.findByProps({ testID: 'sheet-more' }).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/more');
  });

  it('hides the search bar and tabs on pushed pages', async () => {
    mockPathname.current = '/stop/place-jfk';
    const r = await render(<SheetChrome />);
    expect(r.root.findAllByProps({ testID: 'sheet-chrome' })).toHaveLength(0);
  });
});
