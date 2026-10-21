import { AppState, type AppStateStatus } from 'react-native';

import type { RawFix } from '@/activity/types';
import type { BikeStation } from '@/data/bluebikes';
import type { LatLng } from '@/lib/geo';
import type { Place } from '@/planner/types';
import { getActiveModes, resetActiveModes } from '@/state/activeModes';

import {
  endParking,
  getParkingSnapshot,
  MIN_REMINDER_DELAY_MS,
  PARKING_KEEP_AWAKE_TAG,
  refreshParking,
  resetParkingForTests,
  simulateTargetFull,
  startParking,
} from '../session';
import { PARKING } from '../types';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) }));
jest.mock('@/data/bluebikes', () => ({ fetchBikeStations: jest.fn() }));
jest.mock('@/notifications', () => ({
  haptic: jest.fn(),
  notifyLocal: jest.fn(async () => {}),
  scheduleLocal: jest.fn(async () => 'reminder-1'),
  cancelScheduled: jest.fn(async () => {}),
  ensureNotificationPermission: jest.fn(async () => 'granted'),
}));
const mockHub: { listener: ((f: RawFix) => void) | null; release: jest.Mock; error: string | null } = { listener: null, release: jest.fn(), error: null };
jest.mock('@/activity/locationHub', () => ({
  acquireFixes: jest.fn(async (_owner: string, listener: (f: RawFix) => void) => {
    if (mockHub.error) return { ok: false, error: mockHub.error };
    mockHub.listener = listener;
    return { ok: true, mode: 'foreground', release: mockHub.release };
  }),
}));

const bluebikes = jest.requireMock('@/data/bluebikes') as { fetchBikeStations: jest.Mock };
const notif = jest.requireMock('@/notifications') as Record<'haptic' | 'notifyLocal' | 'scheduleLocal' | 'cancelScheduled', jest.Mock>;
const keepAwake = jest.requireMock('expo-keep-awake') as { activateKeepAwakeAsync: jest.Mock; deactivateKeepAwake: jest.Mock };
const hub = jest.requireMock('@/activity/locationHub') as { acquireFixes: jest.Mock };

const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);
const DEST: LatLng = { latitude: 42.3601, longitude: -71.0589 };
const PLACE: Place = { name: 'Faneuil Hall', latLng: DEST, source: 'map' };
const at = (north: number): LatLng => ({ latitude: DEST.latitude + north / 111_320, longitude: DEST.longitude });

function dock(id: string, north: number, docks = 8): BikeStation {
  return {
    id,
    name: `Dock ${id}`,
    location: at(north),
    distanceMeters: 0,
    capacity: 15,
    classicBikes: 3,
    ebikes: 0,
    openDocks: docks,
    isRenting: true,
    isReturning: true,
    rentalUrl: null,
    reportedAt: Date.now(),
  };
}

let appStateHandler: ((s: AppStateStatus) => void) | null = null;

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const fix = (p: LatLng, accuracy = 8): RawFix => ({ ...p, accuracy, speed: 4, timestamp: Date.now() });

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  resetParkingForTests();
  resetActiveModes();
  mockHub.listener = null;
  mockHub.error = null;
  mockHub.release.mockClear();
  hub.acquireFixes.mockClear();
  Object.values(notif).forEach((m) => m.mockClear());
  keepAwake.activateKeepAwakeAsync.mockClear();
  keepAwake.deactivateKeepAwake.mockClear();
  bluebikes.fetchBikeStations.mockReset();
  bluebikes.fetchBikeStations.mockImplementation(async () => [dock('a', 100), dock('b', 300)]);
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  resetParkingForTests();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('parking session', () => {
  it('starts: leases GPS, keeps the screen on, fetches docks and shows the parking pill', async () => {
    await startParking(PLACE);
    const snap = getParkingSnapshot();
    expect(snap.state.phase).toBe('navigating');
    expect(snap.state.target?.station.id).toBe('a');
    expect(snap.state.backup?.station.id).toBe('b');
    expect(snap.state.lastCheckAt).toBe(T0);
    expect(hub.acquireFixes).toHaveBeenCalledWith('parking', expect.any(Function), { precision: 'navigation' });
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith(PARKING_KEEP_AWAKE_TAG);
    expect(getActiveModes()).toEqual([{ id: 'parking', label: 'Parking → Dock a', href: '/park' }]);
  });

  it('rejects a destination outside the Boston area', async () => {
    const r = await startParking({ name: 'NYC', latLng: { latitude: 40.7128, longitude: -74.006 }, source: 'map' });
    expect(r).toEqual({ ok: false, reason: 'outsideArea' });
    expect(getParkingSnapshot().state.phase).toBe('choosing');
    expect(hub.acquireFixes).not.toHaveBeenCalled();
  });

  it('re-checks every 45 s and re-routes with a haptic and a notification when the target fills', async () => {
    await startParking(PLACE);
    expect(bluebikes.fetchBikeStations).toHaveBeenCalledTimes(1);
    bluebikes.fetchBikeStations.mockImplementation(async () => [dock('a', 100, 0), dock('b', 300)]);
    jest.advanceTimersByTime(PARKING.pollMs);
    await flush();
    expect(bluebikes.fetchBikeStations).toHaveBeenCalledTimes(2);
    const snap = getParkingSnapshot();
    expect(snap.state.target?.station.id).toBe('b');
    expect(notif.haptic).toHaveBeenCalledWith('warning');
    expect(notif.notifyLocal).toHaveBeenCalledWith({ title: 'Dock changed', body: 'Dock full. Now heading to Dock b, +3 min', url: '/park' });
    expect(snap.notice?.text).toBe('Dock full. Now heading to Dock b, +3 min');
    expect(getActiveModes()[0].label).toBe('Parking → Dock b');
  });

  it('keeps the last data and flags the failure when a fetch fails', async () => {
    await startParking(PLACE);
    bluebikes.fetchBikeStations.mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    await refreshParking();
    const snap = getParkingSnapshot();
    expect(snap.fetchFailed).toBe(true);
    expect(snap.state.target?.station.id).toBe('a');
    expect(snap.state.lastCheckAt).toBe(T0);
    expect(snap.state.error).toMatch(/Couldn’t refresh docks/);
  });

  it('reports stale data after 10 minutes without a successful check', async () => {
    await startParking(PLACE);
    bluebikes.fetchBikeStations.mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    jest.advanceTimersByTime(PARKING.pollMs * 14);
    await flush();
    expect(getParkingSnapshot().staleMs).toBeGreaterThan(PARKING.staleMs);
  });

  it('stops polling in the background, schedules a reminder, and cancels it on return', async () => {
    await startParking(PLACE);
    mockHub.listener?.(fix(at(-1500)));
    appStateHandler?.('background');
    await flush();
    expect(notif.scheduleLocal).toHaveBeenCalledTimes(1);
    const arg = notif.scheduleLocal.mock.calls[0][0] as { at: number; body: string; url: string };
    expect(arg.body).toBe('Open Teal to re-check docks near Dock a.');
    expect(arg.url).toBe('/park');
    // Ride of 1.6 km ≈ 10 min; the reminder is 2 min before the ETA.
    expect(arg.at).toBeGreaterThan(T0 + MIN_REMINDER_DELAY_MS);
    expect(arg.at).toBeLessThan(T0 + 10 * 60_000);
    jest.advanceTimersByTime(PARKING.pollMs * 3);
    await flush();
    expect(bluebikes.fetchBikeStations).toHaveBeenCalledTimes(1);
    appStateHandler?.('active');
    await flush();
    expect(notif.cancelScheduled).toHaveBeenCalledWith('reminder-1');
    expect(bluebikes.fetchBikeStations).toHaveBeenCalledTimes(2);
  });

  it('arrives from a location fix and releases GPS, keep-awake and the pill', async () => {
    await startParking(PLACE);
    mockHub.listener?.(fix(at(400)));
    jest.advanceTimersByTime(5_000);
    mockHub.listener?.(fix(at(95)));
    await flush();
    expect(getParkingSnapshot().state.phase).toBe('arrived');
    expect(notif.haptic).toHaveBeenCalledWith('success');
    expect(mockHub.release).toHaveBeenCalled();
    expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith(PARKING_KEEP_AWAKE_TAG);
    expect(getActiveModes()).toEqual([]);
    jest.advanceTimersByTime(PARKING.pollMs * 2);
    await flush();
    expect(bluebikes.fetchBikeStations).toHaveBeenCalledTimes(1);
  });

  it('ignores inaccurate fixes', async () => {
    await startParking(PLACE);
    mockHub.listener?.(fix(at(95), 200));
    expect(getParkingSnapshot().here).toBeNull();
    expect(getParkingSnapshot().state.phase).toBe('navigating');
  });

  it('works without location: ranks by destination distance and says so', async () => {
    mockHub.error = 'permissionDenied';
    await startParking(PLACE);
    const snap = getParkingSnapshot();
    expect(snap.locationError).toBe('permissionDenied');
    expect(snap.state.target?.rideM).toBe(0);
  });

  it('"Simulate target full" re-routes and keeps the dock full on later polls', async () => {
    await startParking(PLACE);
    simulateTargetFull();
    expect(getParkingSnapshot().state.target?.station.id).toBe('b');
    jest.advanceTimersByTime(PARKING.pollMs * 4);
    await flush();
    expect(getParkingSnapshot().state.target?.station.id).toBe('b');
  });

  it('ends: stops everything and resets', async () => {
    await startParking(PLACE);
    endParking();
    expect(getParkingSnapshot().state.phase).toBe('choosing');
    expect(mockHub.release).toHaveBeenCalled();
    expect(getActiveModes()).toEqual([]);
    jest.advanceTimersByTime(PARKING.pollMs * 2);
    await flush();
    expect(bluebikes.fetchBikeStations).toHaveBeenCalledTimes(1);
  });
});
