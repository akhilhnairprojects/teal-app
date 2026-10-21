/**
 * The bike parking session (spec G1): one at a time, kept at module scope so it keeps re-checking
 * docks while the rider looks at other pages (the shell shows a "Parking → dock" pill).
 *
 * While the app is in the foreground it polls Bluebikes every 45 s, evaluates on location fixes
 * (for arrival), keeps the screen awake (tag `teal-parking`) and re-routes with a haptic and a
 * local notification. In the background it stops polling and schedules a reminder at ETA − 2 min,
 * cancelled when Teal comes back. A failed fetch keeps the last data and shows a banner.
 * Never logs coordinates.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { acquireFixes, type HubError } from '@/activity/locationHub';
import type { RawFix } from '@/activity/types';
import { fetchBikeStations, type BikeStation } from '@/data/bluebikes';
import { parkPath } from '@/features/shell/routes';
import { bikeMinutes, isInBostonArea, type LatLng } from '@/lib/geo';
import { cancelScheduled, ensureNotificationPermission, haptic, notifyLocal, scheduleLocal } from '@/notifications';
import { speakUpdate } from '@/voice/speak';
import type { Place } from '@/planner/types';
import { clearActiveMode, setActiveMode } from '@/state/activeModes';

import { evaluateParking, rerouteText } from './engine';
import { PARKING, type ParkingEvent, type ParkingState } from './types';

export const PARKING_KEEP_AWAKE_TAG = 'teal-parking';
/** Location fixes re-evaluate (arrival, ride time) at most this often. */
export const FIX_EVAL_MS = 3_000;
/** Fixes less accurate than this don't move the rider (a 35 m arrival needs a decent fix). */
export const MAX_FIX_ACCURACY_M = 50;
/** A background reminder never fires sooner than this after leaving Teal. */
export const MIN_REMINDER_DELAY_MS = 60_000;

export const PARKING_COPY = {
  pollNote: 'Teal re-checks docks every 45 s while it’s open.',
  fetchFailed: 'Couldn’t refresh docks. Showing the last check.',
  outsideArea: 'Bike parking works around Boston only. Pick a destination near Bluebikes.',
  unavailable: 'Bike parking is available in the iPhone app.',
  reminderTitle: 'Bike parking',
  reminder: (dock: string) => `Open Teal to re-check docks near ${dock}.`,
} as const;

export type ParkingNotice =
  | { kind: 'rerouted'; text: string; at: number }
  | { kind: 'lowDocks'; text: string; at: number }
  | { kind: 'noDocks'; text: string; at: number };

export type ParkingSnapshot = {
  state: ParkingState;
  /** The rider's last usable fix, or null (rank by destination distance only). */
  here: LatLng | null;
  locationError: HubError | null;
  /** The last refresh failed; `state.lastCheckAt` is when data last arrived. */
  fetchFailed: boolean;
  /** Dock data is older than 10 minutes. */
  staleMs: number | null;
  notice: ParkingNotice | null;
  /** Docks the developer marked full with "Simulate target full" (dev builds only). */
  simulatedFull: string[];
};

export const INITIAL_PARKING_STATE: ParkingState = {
  phase: 'choosing',
  destination: null,
  target: null,
  backup: null,
  candidates: [],
  radiusM: PARKING.searchRadiusM,
  lastCheckAt: null,
  lastSwitchAt: null,
  error: null,
};

const initialSnapshot = (): ParkingSnapshot => ({
  state: INITIAL_PARKING_STATE,
  here: null,
  locationError: null,
  fetchFailed: false,
  staleMs: null,
  notice: null,
  simulatedFull: [],
});

let snapshot: ParkingSnapshot = initialSnapshot();
let stations: BikeStation[] | null = null;
let simulatedFull = new Set<string>();
let run = 0;
let release: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove(): void } | null = null;
let reminderId: string | null = null;
let inflight: Promise<void> | null = null;
let lastFixEvalAt = 0;
let keepAwake = false;
const listeners = new Set<() => void>();

function publish(next: Partial<ParkingSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function getParkingSnapshot(): ParkingSnapshot {
  return snapshot;
}

export function subscribeParking(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useParking(): ParkingSnapshot {
  return useSyncExternalStore(subscribeParking, getParkingSnapshot, getParkingSnapshot);
}

const isActive = () => snapshot.state.phase === 'navigating';

function withSimulation(list: BikeStation[]): BikeStation[] {
  if (simulatedFull.size === 0) return list;
  return list.map((s) => (simulatedFull.has(s.id) ? { ...s, openDocks: 0 } : s));
}

function updateActiveMode() {
  const target = snapshot.state.target;
  if (!isActive()) {
    clearActiveMode('parking');
    return;
  }
  setActiveMode({ id: 'parking', label: target ? `Parking → ${target.station.name}` : 'Parking · finding a dock', href: parkPath() });
}

function handleEvent(e: ParkingEvent, now: number, hadTarget: boolean) {
  switch (e.kind) {
    case 'rerouted': {
      const text = rerouteText(e, snapshot.here);
      haptic(e.reason === 'better' ? 'light' : 'warning');
      speakUpdate(text);
      void notifyLocal({ title: e.reason === 'better' ? 'Better dock' : 'Dock changed', body: text, url: String(parkPath()) });
      publish({ notice: { kind: 'rerouted', text, at: now } });
      return;
    }
    case 'lowDocks': {
      const text = `Only 1 dock left at ${e.dock.station.name}. Teal will re-route if it fills.`;
      haptic('light');
      publish({ notice: { kind: 'lowDocks', text, at: now } });
      return;
    }
    case 'noDocks': {
      if (snapshot.notice?.kind === 'noDocks') return;
      const text = 'No open docks near your destination right now. Teal keeps checking.';
      if (hadTarget) {
        haptic('warning');
        speakUpdate(text);
        void notifyLocal({ title: 'No open docks', body: text, url: String(parkPath()) });
      }
      publish({ notice: { kind: 'noDocks', text, at: now } });
      return;
    }
    case 'arrived':
      haptic('success');
      speakUpdate(`You've reached ${snapshot.state.target?.station.name ?? 'the dock'}. Dock your bike.`);
      stopRuntime();
      return;
    default:
      return;
  }
}

/** Run the engine on the last stations and the rider's position, and act on its event. */
function evaluate(now: number) {
  if (!stations || !snapshot.state.destination) return;
  const hadTarget = snapshot.state.target !== null;
  const r = evaluateParking(snapshot.state, { stations, here: snapshot.here, now });
  const checked = r.state.lastCheckAt;
  const staleMs = checked !== null && now - checked > PARKING.staleMs ? now - checked : null;
  const clearNoDocks = r.state.target && snapshot.notice?.kind === 'noDocks';
  publish({ state: r.state, staleMs, ...(clearNoDocks ? { notice: null } : {}) });
  handleEvent(r.event, now, hadTarget);
  // First dock found: say where to head, so the rider doesn't need to look at the screen.
  if (!hadTarget && r.state.target && r.event.kind !== 'rerouted') {
    speakUpdate(`Head to ${r.state.target.station.name}. ${r.state.target.station.openDocks} open ${r.state.target.station.openDocks === 1 ? 'dock' : 'docks'}.`);
  }
  updateActiveMode();
}

/** Fetch live docks now (also used by pull-to-refresh). A failure keeps the last data. */
export function refreshParking(): Promise<void> {
  if (!isActive()) return Promise.resolve();
  if (inflight) return inflight;
  const myRun = run;
  inflight = (async () => {
    try {
      const fresh = await fetchBikeStations();
      if (myRun !== run || !isActive()) return;
      stations = withSimulation(fresh);
      const now = Date.now();
      publish({ fetchFailed: false, state: { ...snapshot.state, lastCheckAt: now, error: null } });
      evaluate(now);
    } catch {
      if (myRun !== run || !isActive()) return;
      publish({ fetchFailed: true, state: { ...snapshot.state, error: PARKING_COPY.fetchFailed } });
      evaluate(Date.now());
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function onFix(fix: RawFix) {
  if (!isActive() || fix.accuracy === null || fix.accuracy > MAX_FIX_ACCURACY_M) return;
  publish({ here: { latitude: fix.latitude, longitude: fix.longitude } });
  const now = Date.now();
  if (now - lastFixEvalAt < FIX_EVAL_MS) return;
  lastFixEvalAt = now;
  evaluate(now);
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => void refreshParking(), PARKING.pollMs);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function scheduleReminder() {
  const target = snapshot.state.target;
  if (!target || reminderId) return;
  const now = Date.now();
  const rideMs = snapshot.here ? bikeMinutes(target.rideM) * 60_000 : 0;
  const at = Math.max(now + rideMs - PARKING.reminderLeadMs, now + MIN_REMINDER_DELAY_MS);
  const myRun = run;
  const id = await scheduleLocal({ title: PARKING_COPY.reminderTitle, body: PARKING_COPY.reminder(target.station.name), url: String(parkPath()), at });
  if (id && (myRun !== run || !isActive() || AppState.currentState === 'active')) void cancelScheduled(id);
  else reminderId = id;
}

function cancelReminder() {
  if (reminderId) void cancelScheduled(reminderId);
  reminderId = null;
}

function onAppState(s: AppStateStatus) {
  if (!isActive()) return;
  if (s === 'background') {
    stopPolling();
    void scheduleReminder();
  } else if (s === 'active') {
    cancelReminder();
    startPolling();
    void refreshParking();
  }
}

function startRuntime() {
  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppState);
  keepAwake = true;
  void activateKeepAwakeAsync(PARKING_KEEP_AWAKE_TAG).catch(() => {});
  startPolling();
}

function stopRuntime() {
  stopPolling();
  appStateSub?.remove();
  appStateSub = null;
  release?.();
  release = null;
  cancelReminder();
  if (keepAwake) {
    keepAwake = false;
    try {
      void Promise.resolve(deactivateKeepAwake(PARKING_KEEP_AWAKE_TAG)).catch(() => {});
    } catch {
      // not active
    }
  }
  clearActiveMode('parking');
}

export type StartParkingResult = { ok: true } | { ok: false; reason: 'outsideArea' | 'unavailable' };

/**
 * Start parking near `destination`. Asks for location and notification permission in context;
 * without location the docks are ranked by distance to the destination only.
 */
export async function startParking(destination: Place): Promise<StartParkingResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'unavailable' };
  if (!isInBostonArea(destination.latLng)) return { ok: false, reason: 'outsideArea' };
  stopRuntime();
  const myRun = ++run;
  stations = null;
  simulatedFull = new Set();
  lastFixEvalAt = 0;
  snapshot = { ...initialSnapshot(), state: { ...INITIAL_PARKING_STATE, phase: 'navigating', destination } };
  publish({});
  updateActiveMode();
  startRuntime();
  void ensureNotificationPermission();
  const lease = await acquireFixes('parking', onFix, { precision: 'navigation' });
  if (myRun !== run || !isActive()) {
    if (lease.ok) lease.release();
    return { ok: true };
  }
  if (lease.ok) release = lease.release;
  else publish({ locationError: lease.error });
  await refreshParking();
  return { ok: true };
}

/** Stop parking and forget the session. */
export function endParking(): void {
  run++;
  stopRuntime();
  stations = null;
  simulatedFull = new Set();
  snapshot = initialSnapshot();
  publish({});
}

/** Dev only ("Simulate target full"): treat the current target as full from now on and re-evaluate. */
export function simulateTargetFull(): void {
  const target = snapshot.state.target;
  if (!target || !stations || !isActive()) return;
  simulatedFull.add(target.station.id);
  stations = withSimulation(stations);
  publish({ simulatedFull: [...simulatedFull] });
  evaluate(Date.now());
}

/** Test helper. */
export function resetParkingForTests(): void {
  endParking();
  run = 0;
  inflight = null;
}
