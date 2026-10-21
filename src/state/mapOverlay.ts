/**
 * What the map should emphasise, declared by the focused screen. Screens call `useMapOverlay`;
 * the map (WP1) reads `useActiveMapOverlay`. The most recently focused owner wins; blurring
 * removes that owner's overlay.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import type { DirectionId, LatLng } from '@/mbta/model/types';

export type ItineraryOverlay = {
  legs: { mode: 'walk' | 'bike' | 'transit'; color: string; coordinates: LatLng[] }[];
  markers: { kind: 'origin' | 'destination' | 'dock' | 'station'; latLng: LatLng; label: string }[];
};

/** A drawn track (live recording, activity detail, featured route). At most 500 points. */
export type TrackOverlay = { id: string; coordinates: LatLng[]; color: string; width?: number; dashed?: boolean };

export type MapOverlay = {
  routeIds?: string[];
  directionId?: DirectionId;
  showVehicles?: boolean;
  selectedVehicleId?: string | null;
  focusStopId?: string | null;
  itinerary?: ItineraryOverlay | null;
  fitTo?: LatLng[] | null;
  /** Tracks drawn by TrackLayer. */
  tracks?: TrackOverlay[] | null;
  /** Territory for a month; the layer fetches its own cells (never put cells in the overlay). */
  territory?: { month: string; highlightUserId?: string | null } | null;
  /** Follow the user's location (forces the location dot on). */
  followUser?: boolean;
};

type Entry = { owner: string; overlay: MapOverlay; json: string };

let stack: Entry[] = [];
let active: MapOverlay | null = null;
const listeners = new Set<() => void>();

function publish() {
  const next = stack.length ? stack[stack.length - 1].overlay : null;
  if (next === active) return;
  active = next;
  listeners.forEach((l) => l());
}

/** Set (or replace) an owner's overlay and make it the active one. Unchanged JSON is a no-op. */
export function setMapOverlay(owner: string, overlay: MapOverlay | null): void {
  if (overlay === null) {
    clearMapOverlay(owner);
    return;
  }
  const json = JSON.stringify(overlay);
  const top = stack[stack.length - 1];
  if (top && top.owner === owner && top.json === json) return;
  const existing = stack.find((e) => e.owner === owner);
  stack = stack.filter((e) => e.owner !== owner);
  stack.push({ owner, overlay: existing && existing.json === json ? existing.overlay : overlay, json });
  publish();
}

export function clearMapOverlay(owner: string): void {
  const before = stack.length;
  stack = stack.filter((e) => e.owner !== owner);
  if (stack.length !== before) publish();
}

export function getActiveMapOverlay(): MapOverlay | null {
  return active;
}

/** Test helper. */
export function resetMapOverlays() {
  stack = [];
  publish();
}

/**
 * Declare this screen's overlay while it is focused (cleared on blur). The store compares by
 * JSON, but callers should still memoise `overlay` so the focus effect does not re-run each render.
 */
export function useMapOverlay(owner: string, overlay: MapOverlay | null): void {
  useFocusEffect(
    useCallback(() => {
      setMapOverlay(owner, overlay);
      return () => clearMapOverlay(owner);
    }, [owner, overlay]),
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The overlay of the most recently focused screen, for the map only. */
export function useActiveMapOverlay(): MapOverlay | null {
  return useSyncExternalStore(subscribe, getActiveMapOverlay, getActiveMapOverlay);
}
