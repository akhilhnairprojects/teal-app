import { useEffect } from 'react';
import { act, type ReactTestRenderer } from 'react-test-renderer';

import { periodStart } from '@/activity/periods';
import { mockSupabase } from '@/backend/testing/mockSupabase';
import { flush, textOf, waitForText, waitUntil, withScreen } from '@/mbta/testing/render';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';
import { OWNER_COLORS } from '@/territory/api';
import { cellId } from '@/territory/grid';
import { resetTerritoryForTests, setTerritoryShown, TERRITORY_DEBOUNCE_MS, useTerritoryShown } from '@/territory/useTerritory';

import { ownerColor, withAlpha } from '../ownerColor';
import { TerritoryLayer } from '../TerritoryLayer';
import { resetLabel, squaresLabel, TERRITORY_COPY, TerritoryScreen } from '../TerritoryScreen';

jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  const Polygon = (props: { testID?: string }) => <View testID={props.testID ?? 'map-polygon'} />;
  return { __esModule: true, Polygon, default: View };
});
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    usePathname: () => '/territory',
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
    Redirect: () => null,
  };
});
jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());

const ME = '11111111-1111-4111-8111-111111111111';
const RIVAL = '22222222-2222-4222-8222-222222222222';
const PROFILE = {
  id: ME,
  nickname: 'Ana',
  color: 2,
  inviteCode: 'ABCDEFGH',
  territoryOptIn: true,
  territoryNoticeSeen: true,
  notifyOvertake: true,
  notifySessions: true,
  notifyFriendRequests: false,
  createdAt: '2026-10-20T14:00:00Z',
};
const mockAuthState: { current: Record<string, unknown> } = { current: { status: 'signedIn', userId: ME, profile: PROFILE } };
jest.mock('@/backend/auth', () => ({
  useAuth: () => mockAuthState.current,
  getAuthState: () => mockAuthState.current,
  updateMySettings: jest.fn(async () => ({ ok: true, value: {} })),
}));
const auth = jest.requireMock('@/backend/auth') as { updateMySettings: jest.Mock };

const REGION = { latitude: 42.356, longitude: -71.062, latitudeDelta: 0.02, longitudeDelta: 0.02 };

beforeEach(() => {
  mockSupabase.reset();
  resetTerritoryForTests();
  resetMapOverlays();
  auth.updateMySettings.mockClear();
  mockAuthState.current = { status: 'signedIn', userId: ME, profile: PROFILE };
});

describe('owner colors', () => {
  it('uses the profile color, or a stable pick when none is set', () => {
    expect(ownerColor(2, ME)).toBe(OWNER_COLORS[2]);
    expect(ownerColor(99, ME)).toBe(ownerColor(null, ME));
    expect(OWNER_COLORS).toContain(ownerColor(undefined, RIVAL));
    expect(withAlpha('#0D9488', 0.35)).toBe('rgba(13, 148, 136, 0.35)');
  });

  it('labels resets and squares', () => {
    expect(resetLabel('2026-10-01')).toBe('Resets Nov 1');
    expect(resetLabel('2026-12-01')).toBe('Resets Jan 1');
    expect(squaresLabel(1)).toBe('1 square');
    expect(squaresLabel(1200)).toBe('1,200 squares');
  });
});

describe('TerritoryLayer', () => {
  const shown: { current: ReturnType<typeof useTerritoryShown> | null } = { current: null };
  const record = (v: ReturnType<typeof useTerritoryShown>) => {
    shown.current = v;
  };
  function ShownProbe() {
    const v = useTerritoryShown();
    useEffect(() => record(v));
    return null;
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const advance = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await flush();
  };

  const polygons = (r: ReactTestRenderer) => r.root.findAll((n) => n.props?.testID === 'territory-rect' && n.props?.fillColor !== undefined);

  it('draws merged owner rectangles, outlines mine, and colors a missing color stably', async () => {
    mockSupabase.onRpc('get_territory', () => ({
      data: [
        { cell_id: cellId(729, 791), owner_id: ME, nickname: 'Ana', color: 2 },
        { cell_id: cellId(730, 791), owner_id: ME, nickname: 'Ana', color: 2 },
        { cell_id: cellId(729, 792), owner_id: ME, nickname: 'Ana', color: 2 },
        { cell_id: cellId(730, 792), owner_id: ME, nickname: 'Ana', color: 2 },
        { cell_id: cellId(731, 791), owner_id: RIVAL, nickname: 'Bo', color: 42 },
      ],
    }));
    await withScreen(
      <>
        <TerritoryLayer month="2026-10-01" region={REGION} />
        <ShownProbe />
      </>,
      async (r) => {
        expect(polygons(r)).toHaveLength(0);
        expect(shown.current?.loading).toBe(true);
        await advance(TERRITORY_DEBOUNCE_MS);
        const ps = polygons(r);
        expect(ps).toHaveLength(2);
        const mine = ps.find((p) => p.props.strokeWidth > 0)!;
        expect(mine.props.fillColor).toBe(withAlpha(OWNER_COLORS[2], 0.35));
        expect(mine.props.coordinates).toHaveLength(4);
        const theirs = ps.find((p) => p.props.strokeWidth === 0)!;
        expect(theirs.props.fillColor).toBe(withAlpha(ownerColor(null, RIVAL), 0.35));
        expect(shown.current).toEqual({ loading: false, truncated: false, error: null });
      },
    );
  });

  it('aggregates to 4×4 super-cells when zoomed out', async () => {
    const rows: Record<string, unknown>[] = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) rows.push({ cell_id: cellId(728 + i, 788 + j), owner_id: (i + j) % 3 ? RIVAL : ME, nickname: 'x', color: 1 });
    mockSupabase.onRpc('get_territory', () => ({ data: rows }));
    await withScreen(<TerritoryLayer month="2026-10-01" region={{ ...REGION, latitudeDelta: 0.12, longitudeDelta: 0.12 }} />, async (r) => {
      await advance(TERRITORY_DEBOUNCE_MS);
      // 8×8 cells = 2×2 super-cells, each majority RIVAL, merged into one rectangle.
      expect(polygons(r)).toHaveLength(1);
    });
  });

  it('fetches nothing when signed out', async () => {
    mockAuthState.current = { status: 'signedOut' };
    await withScreen(<TerritoryLayer month="2026-10-01" region={REGION} />, async (r) => {
      await advance(TERRITORY_DEBOUNCE_MS * 2);
      expect(mockSupabase.raw.rpc).not.toHaveBeenCalled();
      expect(polygons(r)).toHaveLength(0);
    });
  });
});

describe('TerritoryScreen', () => {
  const standings = (month: string) => [
    { rank: 1, user_id: RIVAL, nickname: 'Bo', color: 4, cells: 120, is_me: false },
    { rank: 2, user_id: ME, nickname: 'Ana', color: 2, cells: 64, is_me: true },
  ].map((r) => ({ ...r, cells: month === '2026-11-01' ? r.cells + 1000 : r.cells }));

  beforeEach(() => {
    mockSupabase.onRpc('get_territory_standings', (a) => ({ data: standings(String(a.p_month)) }));
    mockSupabase.setTable('territory_champions', [{ rank: 1, user_id: RIVAL, cells: 300, profiles: { nickname: 'Bo', color: 4 } }]);
  });

  it('shows standings, my count, the reset date, champions, the legend and how to claim', async () => {
    const month = periodStart('month', Date.now());
    await withScreen(<TerritoryScreen month={null} />, async (r) => {
      await waitForText(r, 'You hold 64 squares', 'Bo', '120 squares', 'Ana (you)', '300 squares');
      const text = textOf(r);
      expect(text).toContain(resetLabel(month));
      expect(text).toContain(TERRITORY_COPY.howTo);
      expect(text).toContain(TERRITORY_COPY.legend);
      expect(text).not.toContain(TERRITORY_COPY.optedOutTitle);
      expect(getActiveMapOverlay()).toEqual({ territory: { month, highlightUserId: null } });
      expect(mockSupabase.raw.rpc).toHaveBeenCalledWith('get_territory_standings', { p_month: month, p_limit: 50 });

      act(() => setTerritoryShown({ loading: false, truncated: true, error: null }));
      expect(textOf(r)).toContain(TERRITORY_COPY.truncated);
    });
    expect(getActiveMapOverlay()).toBeNull();
  });

  it('explains territory and turns it back on when opted out', async () => {
    mockAuthState.current = { status: 'signedIn', userId: ME, profile: { ...PROFILE, territoryOptIn: false } };
    await withScreen(<TerritoryScreen month={null} />, async (r) => {
      await waitForText(r, TERRITORY_COPY.optedOutTitle, TERRITORY_COPY.optedOutBody);
      await act(async () => r.root.findByProps({ testID: 'territory-turn-on' }).props.onPress());
      expect(auth.updateMySettings).toHaveBeenCalledWith({ territoryOptIn: true, territoryNoticeSeen: true });
    });
  });

  it('shows a past month without a reset date', async () => {
    await withScreen(<TerritoryScreen month="2026-09-01" />, async (r) => {
      await waitForText(r, 'September 2026', 'You held 64 squares');
      expect(textOf(r)).not.toContain('Resets');
      expect(getActiveMapOverlay()?.territory?.month).toBe('2026-09-01');
    });
  });

  it('switches to the new month when the month rolls over while open', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-01T03:59:30Z') }); // Oct 31, 23:59:30 ET
    try {
      await withScreen(<TerritoryScreen month={null} />, async (r) => {
        await waitUntil(() => textOf(r).includes('You hold 64 squares'), () => textOf(r));
        expect(getActiveMapOverlay()?.territory?.month).toBe('2026-10-01');
        expect(textOf(r)).toContain('Resets Nov 1');
        await act(async () => {
          jest.advanceTimersByTime(60_000);
        });
        await waitUntil(() => textOf(r).includes('You hold 1,064 squares'), () => textOf(r));
        expect(getActiveMapOverlay()?.territory?.month).toBe('2026-11-01');
        expect(textOf(r)).toContain('Resets Dec 1');
        expect(textOf(r)).toContain('October 2026 champions');
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
