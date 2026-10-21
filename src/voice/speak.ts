/**
 * Spoken updates (text-to-speech) for hands-busy moments like riding: the chosen dock and any
 * re-route are read aloud when the setting is on. Uses `expo-speech`, which works in Expo Go.
 * The on/off choice is remembered on the phone; default on.
 */
import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { readCache, writeCache } from '@/lib/cache';

const KEY = 'teal.voice.spoken';
const VERSION = 1;

let enabled = true;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded) return;
  loaded = true;
  void readCache<boolean>(KEY, VERSION).then((hit) => {
    if (hit && typeof hit.value === 'boolean' && hit.value !== enabled) {
      enabled = hit.value;
      listeners.forEach((l) => l());
    }
  });
}

export function spokenUpdatesEnabled(): boolean {
  load();
  return enabled;
}

export function setSpokenUpdates(on: boolean): void {
  enabled = on;
  void writeCache(KEY, VERSION, on);
  if (!on) void Speech.stop();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  load();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useSpokenUpdates(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, spokenUpdatesEnabled, spokenUpdatesEnabled), setSpokenUpdates];
}

/** Read a short update aloud (replacing anything still being spoken). No-op when off or on web. */
export function speakUpdate(text: string): void {
  if (Platform.OS === 'web' || !spokenUpdatesEnabled() || !text.trim()) return;
  void Speech.stop();
  Speech.speak(text, { language: 'en-US', rate: 1.0 });
}

/** Test helper. */
export function resetSpokenUpdatesForTests(on = true): void {
  enabled = on;
  loaded = true;
  listeners.clear();
}
