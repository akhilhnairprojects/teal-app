/**
 * Upload queue for recorded activities (spec §3.4). Serial; backoff 30 s, 2 min, 10 min, 1 h.
 * The server's summary replaces local metrics on success. `invalid_payload`, `invalid_time` and
 * `overlap` are final (rejected, never retried); `too_fast` (the speed guard) deletes the activity on
 * this phone too, so it can't count anywhere; everything else is retried. Activities recorded
 * while signed out (`ownerUserId: null`) wait until the user agrees to attach them.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { getAuthState, subscribeAuth, type AuthState } from '@/backend/auth';
import type { BackendErrorCode } from '@/backend/errors';
import { rpc } from '@/backend/rpc';

import {
  getLocalPoints,
  getActivityIndex,
  listLocalActivities,
  parseServerActivity,
  pruneSyncedPoints,
  removeLocalActivity,
  subscribeActivities,
  updateLocalActivity,
  type LocalActivity,
  type ServerActivity,
} from './store';

export const SYNC_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000] as const;
const FINAL_CODES: ReadonlySet<BackendErrorCode> = new Set(['invalid_payload', 'invalid_time', 'overlap']);

export type SyncReason = 'finish' | 'foreground' | 'signIn' | 'manual';
export type SyncSummary = { synced: number; rejected: number; failed: number };

let running: Promise<SyncSummary> | null = null;
let rerun = false;
let syncing = false;
let lastError: BackendErrorCode | null = null;
const statusListeners = new Set<() => void>();
const publishStatus = () => statusListeners.forEach((l) => l());

const signedInUser = (s: AuthState = getAuthState()): string | null => (s.status === 'signedIn' ? s.userId : null);

export const backoffFor = (attempts: number): number => SYNC_BACKOFF_MS[Math.min(Math.max(attempts, 1), SYNC_BACKOFF_MS.length) - 1];

/** The submit_activity payload for an activity and its points (t rebased so the first point is 0). */
export function buildSubmitPayload(a: LocalActivity, points: readonly { t: number; lat: number; lon: number }[]) {
  const t0 = points.length ? points[0].t : 0;
  const startedAt = a.startedAt + t0;
  const endedAt = points.length ? a.startedAt + points[points.length - 1].t : a.endedAt;
  return {
    client_id: a.localId,
    kind: a.kind,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    share_route: a.shareRoute,
    points: points.map((p) => [p.t - t0, p.lat, p.lon]),
  };
}

/** Local metrics replaced by the server's authoritative values. */
function applyServer(a: LocalActivity, s: ServerActivity): LocalActivity {
  return {
    ...a,
    shareRoute: s.shareRoute,
    metrics: {
      ...a.metrics,
      distanceM: s.distanceM,
      excludedM: s.excludedM,
      elapsedMs: s.elapsedMs,
      movingMs: s.movingMs,
      efforts: s.efforts,
      isLoop: s.isLoop,
    },
    sync: { state: 'synced', attempts: a.sync.attempts + 1, nextAttemptAt: null, lastError: null, server: s },
  };
}

function due(a: LocalActivity, me: string, reason: SyncReason, now: number): boolean {
  if (a.ownerUserId !== me) return false;
  if (a.sync.state !== 'local' && a.sync.state !== 'pending' && a.sync.state !== 'syncing') return false;
  return reason === 'manual' || a.sync.nextAttemptAt === null || a.sync.nextAttemptAt <= now;
}

async function uploadOne(a: LocalActivity): Promise<'synced' | 'rejected' | 'failed'> {
  await updateLocalActivity(a.localId, (x) => ({ ...x, sync: { ...x.sync, state: 'syncing' } }));
  const points = await getLocalPoints(a.localId);
  if (!points || points.length < 2) {
    await updateLocalActivity(a.localId, (x) => ({ ...x, sync: { ...x.sync, state: 'rejected', lastError: 'invalid_payload', nextAttemptAt: null } }));
    lastError = 'invalid_payload';
    return 'rejected';
  }
  const r = await rpc('submit_activity', { p: buildSubmitPayload(a, points) });
  const server = r.ok ? parseServerActivity(r.value) : null;
  if (server) {
    await updateLocalActivity(a.localId, (x) => applyServer(x, server));
    return 'synced';
  }
  const code: BackendErrorCode = r.ok ? 'unknown' : r.error.code;
  lastError = code;
  if (code === 'too_fast') {
    await removeLocalActivity(a.localId);
    return 'rejected';
  }
  if (FINAL_CODES.has(code)) {
    await updateLocalActivity(a.localId, (x) => ({
      ...x,
      sync: { ...x.sync, state: 'rejected', attempts: x.sync.attempts + 1, nextAttemptAt: null, lastError: code },
    }));
    return 'rejected';
  }
  await updateLocalActivity(a.localId, (x) => {
    const attempts = x.sync.attempts + 1;
    return { ...x, sync: { ...x.sync, state: 'pending', attempts, nextAttemptAt: Date.now() + backoffFor(attempts), lastError: code } };
  });
  return 'failed';
}

async function runSync(reason: SyncReason): Promise<SyncSummary> {
  const summary: SyncSummary = { synced: 0, rejected: 0, failed: 0 };
  const me = signedInUser();
  if (!me) return summary;
  syncing = true;
  publishStatus();
  try {
    const now = Date.now();
    const queue = (await listLocalActivities()).filter((a) => due(a, me, reason, now)).sort((x, y) => x.startedAt - y.startedAt);
    for (const a of queue) {
      if (signedInUser() !== me) break; // signed out mid-run
      const outcome = await uploadOne(a);
      summary[outcome] += 1;
      if (outcome === 'failed' && lastError === 'offline') break; // the rest would fail too
    }
    if (summary.synced > 0 && summary.failed === 0) lastError = null;
  } finally {
    syncing = false;
    publishStatus();
  }
  return summary;
}

/** Upload due activities of the signed-in user, one at a time. Concurrent calls share one run. */
export function syncPending(reason: SyncReason): Promise<SyncSummary> {
  if (running) {
    rerun = rerun || reason === 'manual' || reason === 'finish';
    return running;
  }
  running = runSync(reason).finally(() => {
    running = null;
    if (rerun) {
      rerun = false;
      void syncPending('manual');
    }
    scheduleRetry();
  });
  return running;
}

// --- signed-out recordings ---------------------------------------------------------------

/** Activities recorded while signed out (offered for upload after sign-in). */
export async function countUnownedActivities(): Promise<number> {
  return (await listLocalActivities()).filter((a) => a.ownerUserId === null && a.sync.state === 'local').length;
}

/** Attach signed-out recordings to the signed-in user and queue them for upload. Returns how many. */
export async function attachUnownedActivities(): Promise<number> {
  const me = signedInUser();
  if (!me) return 0;
  const unowned = (await listLocalActivities()).filter((a) => a.ownerUserId === null && a.sync.state === 'local');
  for (const a of unowned) {
    await updateLocalActivity(a.localId, (x) => ({ ...x, ownerUserId: me, sync: { ...x.sync, state: 'pending', nextAttemptAt: null } }));
  }
  if (unowned.length) void syncPending('signIn');
  return unowned.length;
}

// --- triggers ----------------------------------------------------------------------------

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let triggersActive = false;

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!triggersActive) return;
  const me = signedInUser();
  if (!me) return;
  const next = getActivityIndex()
    .filter((a) => a.ownerUserId === me && a.sync.state === 'pending' && a.sync.nextAttemptAt !== null)
    .reduce<number | null>((min, a) => (min === null || a.sync.nextAttemptAt! < min ? a.sync.nextAttemptAt! : min), null);
  if (next === null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (AppState.currentState === 'active') void syncPending('foreground');
  }, Math.max(1000, next - Date.now()));
}

/** Sync on app foreground and on sign-in; retry at the earliest backoff while open. Returns cleanup. */
export function startSyncTriggers(): () => void {
  if (Platform.OS === 'web') return () => {};
  triggersActive = true;
  let wasSignedIn = signedInUser() !== null;
  const appSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncPending('foreground');
  });
  const unsubAuth = subscribeAuth((s) => {
    const now = signedInUser(s) !== null;
    if (now && !wasSignedIn) void syncPending('signIn');
    wasSignedIn = now;
  });
  void pruneSyncedPoints().catch(() => {});
  if (wasSignedIn) void syncPending('foreground');
  return () => {
    triggersActive = false;
    appSub.remove();
    unsubAuth();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}

// --- status ------------------------------------------------------------------------------

type SyncStatus = { pending: number; syncing: boolean; lastError: BackendErrorCode | null };
let statusSnapshot: SyncStatus = { pending: 0, syncing: false, lastError: null };

function computeStatus(): SyncStatus {
  const me = signedInUser();
  const pending = getActivityIndex().filter(
    (a) => (a.ownerUserId === me || a.ownerUserId === null) && (a.sync.state === 'local' || a.sync.state === 'pending' || a.sync.state === 'syncing'),
  ).length;
  const next = { pending, syncing, lastError };
  if (next.pending !== statusSnapshot.pending || next.syncing !== statusSnapshot.syncing || next.lastError !== statusSnapshot.lastError) {
    statusSnapshot = next;
  }
  return statusSnapshot;
}

const subscribeStatus = (l: () => void) => {
  statusListeners.add(l);
  const unsubStore = subscribeActivities(l);
  const unsubAuth = subscribeAuth(() => l());
  return () => {
    statusListeners.delete(l);
    unsubStore();
    unsubAuth();
  };
};

export function useSyncStatus(): SyncStatus {
  useEffect(() => {
    void listLocalActivities();
  }, []);
  return useSyncExternalStore(subscribeStatus, computeStatus, computeStatus);
}

/** Test helper. */
export function resetSyncForTests(): void {
  running = null;
  rerun = false;
  syncing = false;
  lastError = null;
  triggersActive = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  statusSnapshot = { pending: 0, syncing: false, lastError: null };
}
