/**
 * Modes that keep running while the user browses other pages (recording, bike parking). The shell's
 * ActiveModePills row reads these and links back to each mode's page.
 */
import type { Href } from 'expo-router';
import { useSyncExternalStore } from 'react';

export type ActiveMode = { id: 'recording' | 'parking'; label: string; href: Href };

let modes: ActiveMode[] = [];
const listeners = new Set<() => void>();

const publish = () => listeners.forEach((l) => l());

/** Add or replace the mode with this id. Unchanged values are a no-op. */
export function setActiveMode(m: ActiveMode): void {
  const existing = modes.find((x) => x.id === m.id);
  if (existing && existing.label === m.label && existing.href === m.href) return;
  modes = existing ? modes.map((x) => (x.id === m.id ? m : x)) : [...modes, m];
  publish();
}

export function clearActiveMode(id: ActiveMode['id']): void {
  if (!modes.some((m) => m.id === id)) return;
  modes = modes.filter((m) => m.id !== id);
  publish();
}

export function getActiveModes(): ActiveMode[] {
  return modes;
}

/** Test helper. */
export function resetActiveModes(): void {
  modes = [];
  publish();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useActiveModes(): ActiveMode[] {
  return useSyncExternalStore(subscribe, getActiveModes, getActiveModes);
}
