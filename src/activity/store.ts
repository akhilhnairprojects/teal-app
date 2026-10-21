/**
 * Offline-first activity storage (spec §3.4). AsyncStorage holds an index of `LocalActivity`
 * summaries (`teal.activities.v1`) and each activity's points (`teal.activity.<id>.pts.v1`). The
 * server's `list_my_activities` adds activities from other devices. `localId` is the server client_id.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { BackendErrorCode, Result } from '@/backend/errors';
import { fail, ok } from '@/backend/errors';
import { bool, int, isObj, listOf, num, nullable, oneOf, str, strings, timestamp, uuid, isoDay } from '@/backend/parse';
import { rpc } from '@/backend/rpc';
import { readCache, writeCache } from '@/lib/cache';
import { decodePolyline } from '@/lib/polyline';

import type { TrackMetrics } from './metrics';
import type { ActivityKind, Effort, LatLng, TrackPoint } from './types';

export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'rejected';

export type ServerActivity = {
  id: string;
  clientId: string;
  kind: ActivityKind;
  status: 'valid' | 'flagged';
  flags: string[];
  startedAt: string;
  endedAt: string;
  weekStart: string;
  monthStart: string;
  distanceM: number;
  excludedM: number;
  elapsedMs: number;
  movingMs: number;
  isLoop: boolean;
  leaderboardEligible: boolean;
  shareRoute: boolean;
  groupSessionId: string | null;
  efforts: Effort[];
};

export type LocalActivity = {
  localId: string;
  kind: ActivityKind;
  startedAt: number;
  endedAt: number;
  ownerUserId: string | null;
  groupSessionId: string | null;
  shareRoute: boolean;
  metrics: TrackMetrics;
  previewPolyline: string;
  sync: { state: SyncState; attempts: number; nextAttemptAt: number | null; lastError: BackendErrorCode | null; server: ServerActivity | null };
};

export type ActivityListItem = {
  localId: string | null;
  serverId: string | null;
  kind: ActivityKind;
  startedAt: number;
  distanceM: number;
  movingMs: number;
  syncState: SyncState | 'remote';
  status: 'valid' | 'flagged' | null;
  flags: string[];
};

const INDEX_KEY = 'teal.activities.v1';
const INDEX_VERSION = 1;
const POINTS_VERSION = 1;
export const pointsKey = (localId: string) => `teal.activity.${localId}.pts.v1`;
/** Local points are deleted this long after a successful sync; the summary and preview stay. */
export const POINTS_RETENTION_MS = 30 * 24 * 3600 * 1000;

// --- parsing -----------------------------------------------------------------------------

const kindOf = oneOf<ActivityKind>(['run', 'bike']);
const statusOf = oneOf<'valid' | 'flagged'>(['valid', 'flagged']);

export function parseEffort(v: unknown): Effort | null {
  if (!isObj(v)) return null;
  const d = int(v.distance_m);
  const durationMs = int(v.duration_ms);
  const startOffsetMs = int(v.start_offset_ms);
  if ((d !== 1000 && d !== 5000 && d !== 10000) || durationMs === null || startOffsetMs === null) return null;
  return { distanceM: d, durationMs, startOffsetMs };
}

/** `activity_summary` jsonb → ServerActivity (null when any required field is malformed). */
export function parseServerActivity(v: unknown): ServerActivity | null {
  if (!isObj(v)) return null;
  const id = uuid(v.id);
  const clientId = uuid(v.client_id);
  const kind = kindOf(v.kind);
  const status = statusOf(v.status);
  const flags = strings(v.flags);
  const startedAt = timestamp(v.started_at);
  const endedAt = timestamp(v.ended_at);
  const weekStart = isoDay(v.week_start);
  const monthStart = isoDay(v.month_start);
  const distanceM = num(v.distance_m);
  const excludedM = num(v.excluded_m);
  const elapsedMs = int(v.elapsed_ms);
  const movingMs = int(v.moving_ms);
  const isLoop = bool(v.is_loop);
  const leaderboardEligible = bool(v.leaderboard_eligible);
  const shareRoute = bool(v.share_route);
  const groupSessionId = nullable(v.group_session_id, uuid);
  const efforts = listOf(v.efforts, parseEffort);
  if (
    !id || !clientId || !kind || !status || !flags || !startedAt || !endedAt || !weekStart || !monthStart ||
    distanceM === null || excludedM === null || elapsedMs === null || movingMs === null ||
    isLoop === null || leaderboardEligible === null || shareRoute === null || groupSessionId === undefined || !efforts
  ) {
    return null;
  }
  return {
    id, clientId, kind, status, flags, startedAt, endedAt, weekStart, monthStart, distanceM, excludedM, elapsedMs, movingMs,
    isLoop, leaderboardEligible, shareRoute, groupSessionId, efforts,
  };
}

// --- index store -------------------------------------------------------------------------

let index: LocalActivity[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const publish = () => listeners.forEach((l) => l());

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (!loading) {
    loading = (async () => {
      const hit = await readCache<LocalActivity[]>(INDEX_KEY, INDEX_VERSION);
      if (!loaded) index = Array.isArray(hit?.value) ? hit!.value : [];
      loaded = true;
      publish();
    })().finally(() => {
      loading = null;
    });
  }
  await loading;
}

/** Run index mutations one at a time so concurrent writers never lose an update. */
function mutate<T>(fn: (current: LocalActivity[]) => { next: LocalActivity[]; result: T }): Promise<T> {
  const run = queue.then(async () => {
    await ensureLoaded();
    const { next, result } = fn(index);
    if (next !== index) {
      index = next;
      publish();
      await writeCache(INDEX_KEY, INDEX_VERSION, index);
    }
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export async function listLocalActivities(): Promise<LocalActivity[]> {
  await ensureLoaded();
  return index;
}

export async function getLocalActivity(localId: string): Promise<LocalActivity | null> {
  await ensureLoaded();
  return index.find((a) => a.localId === localId) ?? null;
}

/** Points are stored compactly as [t, lat, lon] triples. */
export async function getLocalPoints(localId: string): Promise<TrackPoint[] | null> {
  const hit = await readCache<[number, number, number][]>(pointsKey(localId), POINTS_VERSION);
  if (!hit || !Array.isArray(hit.value)) return null;
  return hit.value.map(([t, lat, lon]) => ({ t, lat, lon }));
}

export async function saveLocalPoints(localId: string, points: readonly TrackPoint[]): Promise<void> {
  await writeCache(pointsKey(localId), POINTS_VERSION, points.map((p) => [p.t, p.lat, p.lon]));
}

/** Store a new activity and its points. */
export async function saveNewActivity(a: LocalActivity, points: readonly TrackPoint[]): Promise<void> {
  await saveLocalPoints(a.localId, points);
  await mutate((cur) => ({ next: [a, ...cur.filter((x) => x.localId !== a.localId)], result: undefined }));
}

/** Replace one activity with `fn(current)`; returns the new value, or null when it doesn't exist. */
export function updateLocalActivity(localId: string, fn: (a: LocalActivity) => LocalActivity): Promise<LocalActivity | null> {
  return mutate((cur) => {
    const i = cur.findIndex((a) => a.localId === localId);
    if (i < 0) return { next: cur, result: null };
    const updated = fn(cur[i]);
    const next = [...cur];
    next[i] = updated;
    return { next, result: updated };
  });
}

export async function removeLocalActivity(localId: string): Promise<void> {
  await mutate((cur) => ({ next: cur.filter((a) => a.localId !== localId), result: undefined }));
  try {
    await AsyncStorage.removeItem(pointsKey(localId));
  } catch {
    // ignore
  }
}

/** Delete local points 30 days after a successful sync (the summary and preview polyline stay). */
export async function pruneSyncedPoints(now = Date.now()): Promise<number> {
  await ensureLoaded();
  let pruned = 0;
  for (const a of index) {
    if (a.sync.state !== 'synced' || now - a.endedAt < POINTS_RETENTION_MS) continue;
    try {
      const key = pointsKey(a.localId);
      if ((await AsyncStorage.getItem(key)) !== null) {
        await AsyncStorage.removeItem(key);
        pruned++;
      }
    } catch {
      // ignore
    }
  }
  return pruned;
}

const PREFIXES_TO_WIPE = ['teal.activit', 'teal.rec', 'sb-'];

/** "Delete my data": every activity, in-progress recording and Supabase auth key on this device. */
export async function wipeLocalUserData(): Promise<void> {
  await queue;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter((k) => PREFIXES_TO_WIPE.some((p) => k.startsWith(p)));
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch {
    // ignore
  }
  index = [];
  loaded = true;
  remote = [];
  publish();
}

/** Test helper: forget the in-memory index (storage is untouched). */
export function resetActivityStoreForTests(): void {
  index = [];
  loaded = false;
  loading = null;
  queue = Promise.resolve();
  remote = [];
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getIndex = () => index;
const getLoaded = () => loaded;

export function subscribeActivities(l: () => void): () => void {
  return subscribe(l);
}

/** The current in-memory index (load it first with `listLocalActivities`). */
export function getActivityIndex(): LocalActivity[] {
  return index;
}

// --- list (local ∪ server) ---------------------------------------------------------------

let remote: ServerActivity[] = [];

export function toListItem(a: LocalActivity): ActivityListItem {
  const s = a.sync.server;
  return {
    localId: a.localId,
    serverId: s?.id ?? null,
    kind: a.kind,
    startedAt: a.startedAt,
    distanceM: s?.distanceM ?? a.metrics.distanceM,
    movingMs: s?.movingMs ?? a.metrics.movingMs,
    syncState: a.sync.state,
    status: s?.status ?? null,
    flags: s?.flags ?? [],
  };
}

/** Local activities plus server-only ones (matched by client id), newest first. */
export function mergeActivityLists(local: readonly LocalActivity[], server: readonly ServerActivity[]): ActivityListItem[] {
  const localIds = new Set(local.map((a) => a.localId));
  const items = local.map(toListItem);
  for (const s of server) {
    if (localIds.has(s.clientId)) continue;
    items.push({
      localId: null,
      serverId: s.id,
      kind: s.kind,
      startedAt: Date.parse(s.startedAt),
      distanceM: s.distanceM,
      movingMs: s.movingMs,
      syncState: 'remote',
      status: s.status,
      flags: s.flags,
    });
  }
  return items.sort((a, b) => b.startedAt - a.startedAt);
}

async function fetchRemote(): Promise<void> {
  const r = await rpc('list_my_activities', { p_before: null, p_limit: 100 });
  if (!r.ok) return; // signed out, offline or not configured: local only
  remote = listOf(r.value, parseServerActivity) ?? [];
  publish();
}

const getRemote = () => remote;

export function useActivities(): { ready: boolean; items: ActivityListItem[]; refresh(): Promise<void> } {
  const local = useSyncExternalStore(subscribe, getIndex, getIndex);
  const server = useSyncExternalStore(subscribe, getRemote, getRemote);
  const ready = useSyncExternalStore(subscribe, getLoaded, getLoaded);
  const refresh = useCallback(async () => {
    await ensureLoaded();
    await fetchRemote();
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const items = useMemo(() => mergeActivityLists(local, server), [local, server]);
  return { ready, items, refresh };
}

// --- server actions ----------------------------------------------------------------------

async function patchServer(server: ServerActivity): Promise<void> {
  await ensureLoaded();
  const local = index.find((a) => a.localId === server.clientId);
  if (local) await updateLocalActivity(local.localId, (a) => ({ ...a, shareRoute: server.shareRoute, sync: { ...a.sync, server } }));
  if (remote.some((s) => s.id === server.id)) {
    remote = remote.map((s) => (s.id === server.id ? server : s));
    publish();
  }
}

/** Share or unshare the trimmed public route of a synced activity. */
export async function setActivitySharing(serverId: string, share: boolean): Promise<Result<ServerActivity>> {
  const r = await rpc('set_activity_sharing', { p_activity: serverId, p_share: share });
  if (!r.ok) return r;
  const server = parseServerActivity(r.value);
  if (!server) return fail('unknown');
  await patchServer(server);
  return ok(server);
}

/** Delete an activity on the server (when synced) and on this device. */
export async function deleteActivity(item: { localId: string | null; serverId: string | null }): Promise<Result<void>> {
  await ensureLoaded();
  const local = item.localId ? index.find((a) => a.localId === item.localId) : undefined;
  const serverId = item.serverId ?? local?.sync.server?.id ?? null;
  if (serverId) {
    const r = await rpc('delete_activity', { p_activity: serverId });
    if (!r.ok && r.error.code !== 'not_found') return r;
    if (remote.some((s) => s.id === serverId)) {
      remote = remote.filter((s) => s.id !== serverId);
      publish();
    }
  }
  if (item.localId) await removeLocalActivity(item.localId);
  return ok(undefined);
}

/** The owner's full stored trace, or null when it has expired (180 days) or is gone. */
export async function fetchMyTrack(serverId: string): Promise<Result<LatLng[] | null>> {
  const r = await rpc('get_my_activity_track', { p_activity: serverId });
  if (!r.ok) return r;
  if (r.value === null) return ok(null);
  const encoded = str(r.value);
  return encoded === null ? fail('unknown') : ok(decodePolyline(encoded, 5));
}
