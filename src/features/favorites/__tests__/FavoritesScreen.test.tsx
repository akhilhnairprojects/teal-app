import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';
import { resetFavoritesStore, toggleFavoriteStored } from '@/state/favorites';

import { FavoritesScreen } from '../FavoritesScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (h: unknown) => mockPush(h), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useIsFocused: () => true,
}));

const b = createBuilder();
redLine(b);
const mockGlobal = b.global();
// Minimal stand-in (requireActual would re-enter this mock through shapes.ts).
jest.mock('@/mbta/global/globalData', () => ({
  STOP_BLOCKLIST: ['place-symcl'],
  childStopIds: (g: typeof mockGlobal, id: string) => g.stops[id]?.childStopIds ?? [],
  useGlobalData: () => ({ data: mockGlobal, status: 'ready', error: null, refresh: () => {} }),
}));
jest.mock('@/mbta/live/useStopLiveData', () => ({
  useStopLiveData: () => ({
    predictions: { data: null, error: null, updatedAt: null, stale: false, refreshing: false, refresh: async () => {} },
    schedules: null,
    alerts: null,
  }),
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
    r = create(<FavoritesScreen />);
  });
  return r!;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFavoritesStore();
  mockPush.mockClear();
});
afterEach(() => {
  act(() => r?.unmount());
  r = null;
});

describe('FavoritesScreen (smoke)', () => {
  it('shows the empty state with a search call to action', async () => {
    const screen = await render();
    expect(textOf(screen)).toContain('No favorites yet');
    act(() => screen.root.findByProps({ accessibilityLabel: 'More' }).props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/more');
  });

  it('renders a favorite card and removes a no-longer-served favorite', async () => {
    await toggleFavoriteStored({ routeId: 'Red', stopId: 'place-pktrm', directionId: 0 });
    await toggleFavoriteStored({ routeId: 'Red', stopId: 'place-gone', directionId: 1 });
    const screen = await render();
    expect(textOf(screen)).toContain('Red Line');
    expect(textOf(screen)).toContain('No longer served');
    // Edit mode lists every favorite with its direction.
    act(() => screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf({ root: n } as ReactTestRenderer) === 'Edit')[0].props.onPress());
    expect(textOf(screen)).toContain('Red Line · Southbound to Ashmont/Braintree');
    act(() => screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf({ root: n } as ReactTestRenderer) === 'Done')[0].props.onPress());
    await act(async () => {
      screen.root.findByProps({ testID: 'remove-Red|place-gone|1' }).props.onPress();
    });
    expect(textOf(screen)).not.toContain('No longer served');
    expect(JSON.parse((await AsyncStorage.getItem('teal.favorites.v1'))!).value).toEqual([
      { routeId: 'Red', stopId: 'place-pktrm', directionId: 0 },
    ]);
  });
});
