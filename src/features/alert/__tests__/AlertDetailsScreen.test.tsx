import { act } from 'react-test-renderer';

import type { Alert } from '@/mbta/model/types';
import { createBuilder } from '@/mbta/testing/builders';
import { redLine } from '@/mbta/testing/fixtures';
import { textOf, waitForText, withScreen } from '@/mbta/testing/render';
import { easternInstant } from '@/mbta/time/eastern';

import { AlertDetailsScreen } from '../AlertDetailsScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = jest.requireActual('react-native');
  const Icon = () => <Text>{''}</Text>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (h: unknown) => mockPush(h),
    back: jest.fn(),
    canGoBack: () => true,
    canDismiss: () => true,
    dismissAll: () => mockDismissAll(),
    replace: (h: unknown) => mockReplace(h),
  },
  useIsFocused: () => true,
}));

const b = createBuilder();
redLine(b);
const mockGlobal = b.global();
const mockShuttle: Alert = b.alert({
  id: 'a1',
  effect: 'SHUTTLE',
  cause: 'MAINTENANCE',
  header: 'Shuttle buses replace Red Line service between Harvard and Park Street.',
  description: 'Line one.\nLine two.',
  url: 'https://example.org/alert',
  activePeriods: [{ start: easternInstant(2026, 10, 19, 20, 0), end: easternInstant(2099, 1, 1, 3, 0) }],
  informedEntities: [b.entity({ routeId: 'Red', stopId: 'place-harsq-0' }), b.entity({ routeId: 'Red', stopId: 'place-pktrm-0' })],
});

jest.mock('@/mbta/global/globalData', () => ({
  useGlobalData: () => ({ data: mockGlobal, status: 'ready', error: null, refresh: () => {} }),
}));
jest.mock('@/mbta/live/useAlerts', () => ({
  useAlerts: () => ({ data: [mockShuttle], error: null, updatedAt: Date.now(), stale: false, refreshing: false, refresh: async () => {}, byId: { a1: mockShuttle } }),
}));
const mockFetchAlert = jest.fn<Promise<Alert | null>, [string]>();
jest.mock('@/mbta/api/endpoints', () => ({ fetchAlert: (id: string) => mockFetchAlert(id) }));

afterEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissAll.mockClear();
});

describe('AlertDetailsScreen (smoke)', () => {
  it('renders effect, cause, period, stops, description and the planner link', async () => {
    await withScreen(<AlertDetailsScreen alertId="a1" />, async (screen) => {
      const text = textOf(screen);
      expect(text).toContain('Shuttle bus');
      expect(text).toContain('Maintenance');
      expect(text).toContain('Mon, Oct 19, 8:00 PM');
      expect(text).toContain('Harvard');
      expect(text).toContain('Park Street');
      expect(text).toContain('Line one.\nLine two.');
      expect(mockFetchAlert).not.toHaveBeenCalled();
      act(() => screen.root.findAll((n) => n.props.accessibilityRole === 'button' && textOf(n) === 'Plan around this')[0].props.onPress());
      // Plan is a tab: the pushed alert page is dismissed and the root replaced.
      expect(mockDismissAll).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/plan');
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  it('falls back to /alerts/{id} and says when an alert has ended', async () => {
    mockFetchAlert.mockResolvedValue(null);
    await withScreen(<AlertDetailsScreen alertId="expired" />, async (screen) => {
      await waitForText(screen, 'This alert has ended');
      expect(mockFetchAlert).toHaveBeenCalledWith('expired');
    });
  });
});
