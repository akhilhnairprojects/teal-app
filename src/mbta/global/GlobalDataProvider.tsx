import { useEffect, type ReactNode } from 'react';

import { startGlobalData } from './globalData';

/**
 * Starts the app-wide global-data load at mount (cached first, then network if stale).
 * `useGlobalData()` works anywhere below it; it also starts loading on its own, so the provider
 * only moves the first fetch earlier.
 */
export function GlobalDataProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void startGlobalData();
  }, []);
  return <>{children}</>;
}
