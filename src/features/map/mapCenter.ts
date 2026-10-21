/**
 * Where Nearby looks: the user's location, or the map center once the user pans the map
 * [MA §3.2]. Programmatic camera moves never switch the source. "Back to my location" resets it
 * and asks the map to re-center.
 *
 * Apple Maps does not report whether a region change came from a gesture (`isGesture` is
 * Google-only), so the map reports touch movement with `noteMapTouchMove()` and the next settled
 * region is treated as a user pan.
 */
import { useSyncExternalStore } from 'react';

import type { LocationState } from '@/hooks/useLocation';
import { distanceMeters, type LatLng } from '@/lib/geo';

/** Pans shorter than this (from the current Nearby position) are ignored as jitter. */
export const MIN_PAN_METERS = 75;

export type NearbyPosition =
  | { status: 'locating' }
  | { status: 'ready'; position: LatLng; source: 'device' | 'fallback' | 'map'; reason?: string };

type State = {
  user: LocationState;
  mapCenter: LatLng | null;
  /** Bumped by `backToMyLocation`; the map re-centers when it changes. */
  recenterSeq: number;
};

let state: State = { user: { status: 'locating' }, mapCenter: null, recenterSeq: 0 };
let position: NearbyPosition = derive(state);
let dragged = false;
const listeners = new Set<() => void>();

function derive(s: State): NearbyPosition {
  if (s.mapCenter) return { status: 'ready', position: s.mapCenter, source: 'map' };
  if (s.user.status === 'locating') return { status: 'locating' };
  return { status: 'ready', position: s.user.coords, source: s.user.source, reason: s.user.reason };
}

function update(next: Partial<State>) {
  state = { ...state, ...next };
  position = derive(state);
  listeners.forEach((l) => l());
}

/** The shell forwards the one-shot device location (or its Park Street fallback). */
export function setUserLocation(user: LocationState): void {
  if (user === state.user) return;
  update({ user });
}

/** The user is dragging or pinching the map. */
export function noteMapTouchMove(): void {
  dragged = true;
}

/** The app is about to move the camera itself; the next settled region is not a user pan. */
export function noteProgrammaticMove(): void {
  dragged = false;
}

/**
 * The map finished moving. Switches Nearby to the map center only for a user gesture
 * (`isGesture` when the provider reports it, else touch movement since the last settle) that
 * moved at least `MIN_PAN_METERS` from the current position.
 */
export function onMapRegionSettled(center: LatLng, isGesture?: boolean): void {
  const gesture = isGesture ?? dragged;
  dragged = false;
  if (!gesture) return;
  const current = position.status === 'ready' ? position.position : null;
  if (current && distanceMeters(current, center) < MIN_PAN_METERS) return;
  update({ mapCenter: { latitude: center.latitude, longitude: center.longitude } });
}

/** Return Nearby to the user's location and ask the map to re-center on it. */
export function backToMyLocation(): void {
  update({ mapCenter: null, recenterSeq: state.recenterSeq + 1 });
}

export function getNearbyPosition(): NearbyPosition {
  return position;
}

export function getUserLocation(): LocationState {
  return state.user;
}

export function getRecenterSeq(): number {
  return state.recenterSeq;
}

/** Test helper. */
export function resetMapCenter(): void {
  dragged = false;
  update({ user: { status: 'locating' }, mapCenter: null, recenterSeq: 0 });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useNearbyPosition(): NearbyPosition {
  return useSyncExternalStore(subscribe, getNearbyPosition, getNearbyPosition);
}

export function useUserLocation(): LocationState {
  return useSyncExternalStore(subscribe, getUserLocation, getUserLocation);
}

export function useRecenterSeq(): number {
  return useSyncExternalStore(subscribe, getRecenterSeq, getRecenterSeq);
}
