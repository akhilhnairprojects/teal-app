import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { GlobalData } from '@/mbta/global/globalData';
import { createBuilder } from '@/mbta/testing/builders';
import { greenLine, redLine } from '@/mbta/testing/fixtures';
import { resetRecentsStore } from '@/state/recents';

import { SearchScreen } from '../SearchScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
let mockParams: { q?: string } = {};
jest.mock('expo-router', () => ({
  router: {
    push: (h: unknown) => mockPush(h),
    back: jest.fn(),
    canGoBack: () => true,
    canDismiss: () => true,
    dismissAll: () => mockDismissAll(),
    replace: (h: unknown) => mockReplace(h),
    setParams: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));

const b = createBuilder();
redLine(b);
greenLine(b);
const fullGlobal = b.global();
let mockGlobal: GlobalData | null = fullGlobal;
// Minimal stand-in (requireActual would re-enter this mock through shapes.ts).
jest.mock('@/mbta/global/globalData', () => ({
  STOP_BLOCKLIST: ['place-symcl'],
  parentStationId: (g: GlobalData, id: string) => g.stops[id]?.parentStationId ?? id,
  useGlobalData: () => ({ data: mockGlobal, status: mockGlobal ? 'ready' : 'loading', error: null, refresh: () => {} }),
}));

const textOf = (r: ReactTestRenderer) =>
  r.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .filter((t) => /[A-Za-z0-9]/.test(t))
    .join(' | ');

let r: ReactTestRenderer | null = null;
async function render() {
  await act(async () => {
    r = create(<SearchScreen />);
  });
  return r!;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  resetRecentsStore();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissAll.mockClear();
  mockParams = {};
  mockGlobal = fullGlobal;
});
afterEach(() => {
  act(() => r?.unmount());
  r = null;
  jest.useRealTimers();
});

describe('SearchScreen (smoke)', () => {
  it('shows a spinner before global data loads', async () => {
    mockGlobal = null;
    const screen = await render();
    expect(screen.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('shows results after the debounce, with a plan row; tapping a station opens it', async () => {
    const screen = await render();
    expect(textOf(screen)).toContain('Find a station or line');
    act(() => screen.root.findByType(TextInput).props.onChangeText('park'));
    expect(textOf(screen)).not.toContain('Park Street');
    act(() => jest.advanceTimersByTime(300));
    const text = textOf(screen);
    expect(text).toContain('Plan a trip to ‘park’');
    expect(text).toContain('Park Street');
    const station = screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf({ root: n } as ReactTestRenderer).startsWith('Park Street'))[0];
    await act(async () => station.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/stop/place-pktrm');
    const plan = screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf({ root: n } as ReactTestRenderer).startsWith('Plan a trip'))[0];
    mockPush.mockClear();
    act(() => plan.props.onPress());
    // Plan is a tab: Search is dismissed and the root replaced, never a pushed second tab page.
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/plan?q=park');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('expands a line into its stations', async () => {
    mockParams = { q: 'gl b' };
    const screen = await render();
    expect(textOf(screen)).toContain('Green Line B');
    const line = screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf({ root: n } as ReactTestRenderer).endsWith('Green Line B'))[0];
    act(() => line.props.onPress());
    expect(textOf(screen)).toContain('Boston College');
  });
});
