import { act } from 'react-test-renderer';

import type { BikeStation } from '@/data/bluebikes';
import type { LatLng } from '@/lib/geo';
import { textOf, waitForText, withScreen } from '@/mbta/testing/render';
import { appleMapsCyclingUrl, appleMapsLegacyUrl, openCyclingDirections } from '@/parking/appleMaps';
import { INITIAL_PARKING_STATE, type ParkingSnapshot } from '@/parking/session';
import type { DockCandidate } from '@/parking/types';
import { getActiveMapOverlay, resetMapOverlays } from '@/state/mapOverlay';

import { bearingDegrees, checkedAgoText, compassDirection, dockDistanceText, etaText } from '../format';
import { parkingOverlay } from '../overlay';
import { ParkingScreen } from '../ParkingScreen';

jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const Icon = () => <RNText>{''}</RNText>;
  return { __esModule: true, default: Object.assign(Icon, { glyphMap: {} }) };
});
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});
jest.mock('@/notifications', () => ({ haptic: jest.fn(), notifyLocal: jest.fn(), scheduleLocal: jest.fn(), cancelScheduled: jest.fn(), ensureNotificationPermission: jest.fn() }));
jest.mock('expo-linking', () => ({ canOpenURL: jest.fn(), openURL: jest.fn(async () => true) }));
jest.mock('@/mbta/global/globalData', () => ({ useGlobalData: () => ({ data: null, status: 'loading', error: null, refresh: () => {} }) }));
const mockSnap: { current: ParkingSnapshot | null } = { current: null };
jest.mock('@/parking/session', () => {
  const actual = jest.requireActual('@/parking/session');
  return {
    ...actual,
    useParking: () => mockSnap.current,
    startParking: jest.fn(async () => ({ ok: true })),
    endParking: jest.fn(),
    refreshParking: jest.fn(async () => {}),
    simulateTargetFull: jest.fn(),
  };
});

const linking = jest.requireMock('expo-linking') as { canOpenURL: jest.Mock; openURL: jest.Mock };
const session = jest.requireMock('@/parking/session') as { endParking: jest.Mock; simulateTargetFull: jest.Mock };

const DEST: LatLng = { latitude: 42.3601, longitude: -71.0589 };
const at = (north: number, east = 0): LatLng => ({
  latitude: DEST.latitude + north / 111_320,
  longitude: DEST.longitude + east / (111_320 * Math.cos((DEST.latitude * Math.PI) / 180)),
});

const station = (id: string, p: LatLng, docks: number): BikeStation => ({
  id,
  name: `Dock ${id}`,
  location: p,
  distanceMeters: 0,
  capacity: 15,
  classicBikes: 2,
  ebikes: 1,
  openDocks: docks,
  isRenting: true,
  isReturning: true,
  rentalUrl: null,
  reportedAt: Date.now(),
});
const cand = (s: BikeStation, rideM: number, walkM: number): DockCandidate => ({ station: s, rideM, walkM, scoreMin: 5, risk: s.openDocks <= 1 ? 'critical' : 'ok' });

const TARGET = cand(station('a', at(100), 1), 1000, 100);
const BACKUP = cand(station('b', at(300), 6), 1200, 300);

function navSnap(over: Partial<ParkingSnapshot> = {}): ParkingSnapshot {
  return {
    state: {
      ...INITIAL_PARKING_STATE,
      phase: 'navigating',
      destination: { name: 'Faneuil Hall', latLng: DEST, source: 'map' },
      target: TARGET,
      backup: BACKUP,
      candidates: [TARGET, BACKUP],
      lastCheckAt: Date.now(),
    },
    here: at(-900),
    locationError: null,
    fetchFailed: false,
    staleMs: null,
    notice: null,
    simulatedFull: [],
    ...over,
  };
}

beforeEach(() => {
  resetMapOverlays();
  mockSnap.current = null;
  linking.canOpenURL.mockReset();
  linking.openURL.mockClear();
});

describe('format', () => {
  it('gives compass directions', () => {
    expect(Math.round(bearingDegrees(DEST, at(500)))).toBe(0);
    expect(compassDirection(DEST, at(500, 500))).toBe('NE');
    expect(compassDirection(DEST, at(0, -500))).toBe('W');
    expect(compassDirection(DEST, at(-500, 20))).toBe('S');
  });

  it('describes distance and direction to the dock', () => {
    expect(dockDistanceText(at(-1000), DEST)).toBe('0.6 mi N');
    expect(dockDistanceText(null, DEST)).toBeNull();
    expect(dockDistanceText(at(-10), DEST)).toBe('Here');
  });

  it('describes the ETA', () => {
    expect(etaText(TARGET, at(-900))).toBe('Ride ~7 min, then a 2 min walk');
    expect(etaText(TARGET, null)).toBe('2 min walk to your destination');
  });

  it('describes data age', () => {
    expect(checkedAgoText(null, 0)).toBe('Checking docks…');
    expect(checkedAgoText(0, 5_000)).toBe('Checked just now');
    expect(checkedAgoText(0, 40_000)).toBe('Checked 40 s ago');
    expect(checkedAgoText(0, 180_000)).toBe('Checked 3 min ago');
  });
});

describe('parkingOverlay', () => {
  const colors = { walk: '#777', bike: '#0a0' };

  it('draws a bike leg to the dock and a walk leg to the destination, following the rider', () => {
    const snap = navSnap();
    const o = parkingOverlay(snap.state, snap.here, colors)!;
    expect(o.followUser).toBe(true);
    expect(o.fitTo).toBeUndefined();
    expect(o.itinerary!.legs.map((l) => l.mode)).toEqual(['bike', 'walk']);
    expect(o.itinerary!.legs[1].coordinates).toEqual([TARGET.station.location, DEST]);
    expect(o.itinerary!.markers.map((m) => m.kind)).toEqual(['destination', 'dock']);
  });

  it('frames dock and destination without a location', () => {
    const snap = navSnap({ here: null });
    const o = parkingOverlay(snap.state, null, colors)!;
    expect(o.followUser).toBeUndefined();
    expect(o.fitTo).toEqual([DEST, TARGET.station.location]);
    expect(o.itinerary!.legs.map((l) => l.mode)).toEqual(['walk']);
  });

  it('is empty before a destination is chosen', () => {
    expect(parkingOverlay(INITIAL_PARKING_STATE, null, colors)).toBeNull();
  });
});

describe('Apple Maps handoff', () => {
  it('opens cycling directions to the dock', async () => {
    linking.canOpenURL.mockResolvedValue(true);
    await expect(openCyclingDirections(DEST)).resolves.toBe(true);
    expect(linking.openURL).toHaveBeenCalledWith('https://maps.apple.com/directions?destination=42.360100,-71.058900&mode=cycling');
  });

  it('falls back to the legacy URL when the new one cannot open', async () => {
    linking.canOpenURL.mockImplementation(async (u: string) => u === appleMapsLegacyUrl(DEST));
    await expect(openCyclingDirections(DEST)).resolves.toBe(true);
    expect(linking.openURL).toHaveBeenCalledWith('http://maps.apple.com/?daddr=42.360100,-71.058900&dirflg=w');
    expect(linking.openURL).not.toHaveBeenCalledWith(appleMapsCyclingUrl(DEST));
  });

  it('reports failure when nothing opens', async () => {
    linking.canOpenURL.mockRejectedValue(new Error('no'));
    await expect(openCyclingDirections(DEST)).resolves.toBe(false);
  });
});

describe('ParkingScreen', () => {
  const params = { toName: null, toLat: null, toLon: null };

  it('asks for a destination when no session is running', async () => {
    mockSnap.current = { ...navSnap(), state: INITIAL_PARKING_STATE };
    await withScreen(<ParkingScreen params={params} />, async (r) => {
      await waitForText(r, 'Find a dock', 'Riding a Bluebike?', 'every 45 s');
      expect(r.root.findByProps({ testID: 'park-destination-input' })).toBeTruthy();
      expect(getActiveMapOverlay()).toBeNull();
    });
  });

  it('offers a destination passed in the link', async () => {
    mockSnap.current = { ...navSnap(), state: INITIAL_PARKING_STATE };
    await withScreen(<ParkingScreen params={{ toName: 'Fenway', toLat: 42.3467, toLon: -71.0972 }} />, async (r) => {
      await waitForText(r, 'Park near Fenway?');
    });
  });

  it('shows the target dock, backup, banners and actions while navigating', async () => {
    mockSnap.current = navSnap({ notice: { kind: 'rerouted', text: 'Dock full. Now heading to Dock a, +2 min', at: 0 }, fetchFailed: true });
    await withScreen(<ParkingScreen params={params} />, async (r) => {
      await waitForText(r, 'To Faneuil Hall', 'Dock a', '1 dock · 3 bikes · Almost full', '0.6 mi N · Ride ~7 min, then a 2 min walk', 'Backup: Dock b · 6 docks · 3 bikes');
      const text = textOf(r);
      expect(text).toContain('Dock full. Now heading to Dock a, +2 min');
      expect(text).toContain('Couldn’t refresh docks');
      expect(text).toContain('Open in Apple Maps');
      expect(getActiveMapOverlay()?.followUser).toBe(true);
      await act(async () => r.root.findByProps({ testID: 'park-simulate-full' }).props.onPress());
      expect(session.simulateTargetFull).toHaveBeenCalled();
      await act(async () => r.root.findByProps({ testID: 'park-end' }).props.onPress());
      expect(session.endParking).toHaveBeenCalled();
    });
  });

  it('shows arrival', async () => {
    const snap = navSnap();
    mockSnap.current = { ...snap, state: { ...snap.state, phase: 'arrived' } };
    await withScreen(<ParkingScreen params={params} />, async (r) => {
      await waitForText(r, 'You’re at Dock a', 'about a 2 min walk to Faneuil Hall');
    });
  });
});
