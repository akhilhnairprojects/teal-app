/**
 * The foreground fallback for alerts (spec §3.5). While Teal is in the foreground and signed in, it
 * listens for new inbox rows (realtime INSERTs, RLS-filtered) and re-reads unread rows whenever the
 * app returns to the foreground. New rows become local notifications only when remote push is not
 * `available`, so a device that gets the real push never sees the same alert twice.
 *
 * Rows already unread at the first read after start (or sign-in) are taken as known: the Move hub's
 * inbox badge shows them, and a burst of old banners on launch would be noise.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { getAuthState, subscribeAuth } from '@/backend/auth';
import { getPushAvailability, notifyLocal } from '@/notifications';

import { notificationContent } from '../../supabase/functions/send-push/messages';
import { fetchInbox, subscribeInboxInserts, type InboxItem } from './inbox';

export const INBOX_WATCHER = {
  /** Local banners shown for one read at most (the rest wait in the inbox). */
  maxLocalPerBatch: 3,
  fetchLimit: 50,
} as const;

let refCount = 0;
let stopRunning: (() => void) | null = null;

/** Start the watcher (idempotent, reference-counted). Returns its stop function. No-op on web. */
export function startInboxWatcher(): () => void {
  if (Platform.OS === 'web') return () => {};
  refCount += 1;
  if (!stopRunning) stopRunning = run();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    refCount -= 1;
    if (refCount === 0 && stopRunning) {
      stopRunning();
      stopRunning = null;
    }
  };
}

function run(): () => void {
  const seen = new Set<string>();
  let userId: string | null = null;
  let seeded = false;
  let generation = 0;
  let active = AppState.currentState === 'active';
  let unsubscribeInserts: (() => void) | null = null;

  const deliver = (items: readonly InboxItem[]) => {
    const fresh = items.filter((i) => i.readAt === null && !seen.has(i.id));
    for (const i of fresh) seen.add(i.id);
    if (fresh.length === 0 || getPushAvailability() === 'available') return;
    for (const item of fresh.slice(0, INBOX_WATCHER.maxLocalPerBatch)) {
      const content = notificationContent(item.kind, item.payload);
      if (content) void notifyLocal(content);
    }
  };

  const refresh = async () => {
    if (!userId || !active) return;
    const gen = generation;
    const r = await fetchInbox(INBOX_WATCHER.fetchLimit);
    if (!r.ok || gen !== generation) return;
    if (!seeded) {
      seeded = true;
      for (const i of r.value) seen.add(i.id);
      return;
    }
    deliver(r.value);
  };

  const stopInserts = () => {
    unsubscribeInserts?.();
    unsubscribeInserts = null;
  };

  const apply = () => {
    const auth = getAuthState();
    const nextUser = auth.status === 'signedIn' ? auth.userId : null;
    if (nextUser !== userId) {
      stopInserts();
      seen.clear();
      seeded = false;
      generation += 1;
      userId = nextUser;
    }
    if (userId && active) {
      if (!unsubscribeInserts) unsubscribeInserts = subscribeInboxInserts((item) => deliver([item]));
      void refresh();
    } else {
      stopInserts();
    }
  };

  const onAppState = (s: AppStateStatus) => {
    const next = s === 'active';
    if (next === active) return;
    active = next;
    apply();
  };

  const appSub = AppState.addEventListener('change', onAppState);
  const unsubscribeAuth = subscribeAuth(() => apply());
  apply();

  return () => {
    generation += 1;
    appSub.remove();
    unsubscribeAuth();
    stopInserts();
  };
}
