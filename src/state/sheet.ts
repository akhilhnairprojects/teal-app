/** Screens ask the shell (WP1) to move the bottom sheet; the shell subscribes and snaps. */
import { useEffect, useRef } from 'react';

export type SheetDetent = 'collapsed' | 'half' | 'full';

const listeners = new Set<(d: SheetDetent) => void>();

export function requestSheetDetent(d: SheetDetent): void {
  listeners.forEach((l) => l(d));
}

/** Subscribe to detent requests (shell only). The latest `cb` is always called. */
export function useSheetDetentRequests(cb: (d: SheetDetent) => void): void {
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    const listener = (d: SheetDetent) => ref.current(d);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
