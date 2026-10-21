/**
 * The Supabase client singleton and its app-lifecycle wiring. The session (refresh token) lives in
 * AsyncStorage [user decision, spec §6]. Tests replace this module with `testing/mockSupabase.ts`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { BACKEND_CONFIGURED, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

export type TealSupabase = SupabaseClient;

let client: TealSupabase | null | undefined;

/**
 * The shared client, or null when accounts are not configured (missing env, or web). The auth `lock`
 * option from the spec is omitted: supabase-js 2.118 deprecates it (the client coordinates refreshes
 * without a lock) and logs a warning when it is passed.
 */
export function getSupabase(): TealSupabase | null {
  if (client !== undefined) return client;
  client = BACKEND_CONFIGURED
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        // PKCE: Google sign-in returns a one-time `code` to the app's redirect URL, exchanged for the
        // session here, so tokens never travel in the URL. Email codes and Apple id tokens are unaffected.
        auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
      })
    : null;
  return client;
}

/**
 * Refresh the session only while the app is in the foreground (supabase-js guidance for React
 * Native). Session restore happens when auth first starts (`src/backend/auth.ts`). Returns cleanup.
 */
export function startBackend(): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const apply = (s: AppStateStatus) => {
    if (s === 'active') void sb.auth.startAutoRefresh();
    else void sb.auth.stopAutoRefresh();
  };
  apply(AppState.currentState);
  const sub = AppState.addEventListener('change', apply);
  return () => {
    sub.remove();
    void sb.auth.stopAutoRefresh();
  };
}
