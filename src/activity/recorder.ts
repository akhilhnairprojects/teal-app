/**
 * The activity recorder (spec §3.3): idle → acquiring → recording ⇄ paused → finished. Fixes come from
 * the location hub, pass the GPS filter, and become TrackPoints; live stats use the server's segment
 * rules. Foreground only in Expo Go, so the screen is kept awake and background gaps are reported.
 * The in-progress recording is saved every 15 s so it can be recovered after a crash or kill.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getAuthState } from '@/backend/auth';
import type { BackendError, Result } from '@/backend/errors';
import { recordPath } from '@/features/shell/routes';
import { readCache, removeCache, writeCache } from '@/lib/cache';
import { distanceMeters } from '@/lib/geo';
import { uuidv4 } from '@/lib/id';
import { encodePolyline } from '@/lib/polyline';
import { clearActiveMode, setActiveMode } from '@/state/activeModes';

import { createGpsFilter, FILTER_CONFIG, type GpsFilter } from './filter';
import { formatDistanceM, getUnits } from './format';
import { acquireFixes, canTrackInBackground, type HubError } from './locationHub';
import { computeTrackMetrics, recentPath, SEGMENT_RULES } from './metrics';
import { saveNewActivity, type LocalActivity } from './store';
import { syncPending } from './sync';
import type { ActivityKind, LatLng, LiveStats, RawFix, TrackPoint } from './types';

export type RecorderPhase = 'idle' | 'acquiring' | 'recording' | 'paused' | 'finished';
export type RecorderWarning =
  | 'foregroundOnly'
  | 'backgroundGap'
  | 'vehicleSegment'
  | 'poorGps'
  | 'permissionDenied'
  | 'servicesOff'
  /** Paused with no GPS lease (a resumed recording whose GPS could not start); Resume retries. */
  | 'gpsStopped';

export type RecorderSnapshot = {
  phase: RecorderPhase;
  kind: ActivityKind | null;
  localId: string | null;
  startedAt: number | null;
  stats: LiveStats;
  recentPath: LatLng[];
  groupSessionId: string | null;
  backgroundGapMs: number;
  warnings: RecorderWarning[];
};

export const RECORDER = {
  keepAwakeTag: 'teal-recorder',
  acquireTimeoutMs: 30_000,
  acquireAccuracyM: 20,
  persistEveryMs: 15_000,
  chunkSize: 300,
  publishEveryMs: 1_000,
  pathEveryMs: 5_000,
  pathMaxPoints: 500,
  paceWindowMs: 10_000,
  minDistanceM: 100,
  minDurationMs: 60_000,
} as const;

export const REC_HEADER_KEY = 'teal.rec.inprogress.v1';
export const recChunkKey = (n: number) => `${REC_HEADER_KEY}.${n}`;
const REC_VERSION = 1;

type Header = {
  localId: string;
  kind: ActivityKind;
  startedAt: number;
  groupSessionId: string | null;
  chunks: number;
  points: number;
  backgroundGapMs: number;
};

const EMPTY_STATS: LiveStats = {
  elapsedMs: 0,
  movingMs: 0,
  distanceM: 0,
  excludedM: 0,
  currentPaceSecPerKm: null,
  avgPaceSecPerKm: null,
  autoPaused: false,
  gpsQuality: 'none',
  vehicleSuspected: false,
};

const IDLE: RecorderSnapshot = {
  phase: 'idle',
  kind: null,
  localId: null,
  startedAt: null,
  stats: EMPTY_STATS,
  recentPath: [],
  groupSessionId: null,
  backgroundGapMs: 0,
  warnings: [],
};

// --- runtime state -----------------------------------------------------------------------

let snapshot: RecorderSnapshot = IDLE;
const listeners = new Set<(s: RecorderSnapshot) => void>();

let phase: RecorderPhase = 'idle';
let kind: ActivityKind = 'run';
let localId: string | null = null;
let startedAt: number | null = null;
let groupSessionId: string | null = null;
let points: TrackPoint[] = [];
/** Counted distance up to each point (segment rules), for the pace window. */
let cum: number[] = [];
let totals = { distanceM: 0, excludedM: 0, movingMs: 0 };
let warnings = new Set<RecorderWarning>();
let backgroundGapMs = 0;
let filter: GpsFilter | null = null;
let release: (() => void) | null = null;
let lastFix: { accuracy: number | null; at: number } | null = null;
let vehicleSuspected = false;
let autoPause = { paused: false, belowSince: null as number | null, aboveSince: null as number | null };
let pausedTotalMs = 0;
let pausedAt: number | null = null;
let backgroundSince: number | null = null;
let path: LatLng[] = [];
let pathAt = 0;
let persistedFullChunks = 0;
let lastPublish = 0;

/** A GPS re-acquisition in progress (resume after a failed recovery), so taps don't stack. */
let reacquiring: Promise<Result<void>> | null = null;

let acquireTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setInterval> | null = null;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove(): void } | null = null;

const err = (message: string): BackendError => ({ code: 'unknown', message, retryable: false });

function gpsQuality(now: number): LiveStats['gpsQuality'] {
  if (!lastFix || now - lastFix.at > 10_000 || lastFix.accuracy === null) return 'none';
  if (lastFix.accuracy <= 10) return 'good';
  if (lastFix.accuracy <= 20) return 'fair';
  return 'poor';
}

/**
 * Counted distance and duration between the points of the last 10 s before `tNow` (ms since start).
 * Keepalives (every 5 s, zero distance) keep the window current while standing still.
 */
function windowSpeed(tNow: number): { d: number; dt: number } {
  if (points.length === 0) return { d: 0, dt: 0 };
  const from = tNow - RECORDER.paceWindowMs;
  const lastIdx = points.length - 1;
  if (points[lastIdx].t < from) return { d: 0, dt: 0 };
  let i = lastIdx;
  while (i > 0 && points[i - 1].t >= from) i--;
  return { d: cum[lastIdx] - cum[i], dt: Math.max(0, points[lastIdx].t - points[i].t) };
}

function liveStats(now: number): LiveStats {
  const activeMs = startedAt === null ? 0 : Math.max(0, now - startedAt - pausedTotalMs - (pausedAt !== null ? now - pausedAt : 0));
  const tNow = startedAt === null ? 0 : now - startedAt;
  const w = windowSpeed(tNow);
  const current = w.d >= 5 && w.dt > 0 ? w.dt / 1000 / (w.d / 1000) : null;
  const avg = totals.distanceM >= 10 && totals.movingMs > 0 ? totals.movingMs / 1000 / (totals.distanceM / 1000) : null;
  return {
    elapsedMs: activeMs,
    movingMs: totals.movingMs,
    distanceM: totals.distanceM,
    excludedM: totals.excludedM,
    currentPaceSecPerKm: current,
    avgPaceSecPerKm: avg,
    autoPaused: autoPause.paused,
    gpsQuality: gpsQuality(now),
    vehicleSuspected,
  };
}

function buildSnapshot(now: number): RecorderSnapshot {
  if (phase === 'idle') return { ...IDLE, warnings: [...warnings] };
  if (now - pathAt >= RECORDER.pathEveryMs || path.length === 0) {
    path = recentPath(points, RECORDER.pathMaxPoints);
    pathAt = now;
  }
  return {
    phase,
    kind,
    localId,
    startedAt,
    stats: liveStats(now),
    recentPath: path,
    groupSessionId,
    backgroundGapMs,
    warnings: [...warnings],
  };
}

function publishNow() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  const now = Date.now();
  lastPublish = now;
  snapshot = buildSnapshot(now);
  if (phase === 'acquiring' || phase === 'recording' || phase === 'paused') {
    const label =
      phase === 'acquiring' ? '● Starting recording' : `● ${phase === 'paused' ? 'Paused' : 'Recording'} · ${formatDistanceM(totals.distanceM, getUnits())}`;
    setActiveMode({ id: 'recording', label, href: recordPath({ kind, sessionId: groupSessionId }) });
  }
  listeners.forEach((l) => l(snapshot));
}

/** Publish at most once a second while recording. */
function schedulePublish() {
  if (publishTimer) return;
  const wait = Math.max(0, RECORDER.publishEveryMs - (Date.now() - lastPublish));
  publishTimer = setTimeout(publishNow, wait);
}

function appendPoint(p: TrackPoint) {
  const prev = points[points.length - 1];
  if (prev && p.t <= prev.t) return; // never emit non-increasing times (the server rejects them)
  points.push(p);
  if (!prev) {
    cum.push(0);
    return;
  }
  const rules = SEGMENT_RULES[kind];
  const dt = p.t - prev.t;
  const d = distanceMeters({ latitude: prev.lat, longitude: prev.lon }, { latitude: p.lat, longitude: p.lon });
  const speed = d / (dt / 1000);
  if (dt <= rules.maxGapMs && speed <= rules.capMps) {
    totals.distanceM += d;
    if (speed >= rules.movingMps) totals.movingMs += dt;
  } else if (dt <= rules.maxGapMs) {
    totals.excludedM += d;
  }
  cum.push(totals.distanceM);
}

function updateAutoPause(now: number) {
  if (startedAt === null) return;
  const cfg = FILTER_CONFIG[kind];
  const w = windowSpeed(now - startedAt);
  const speed = w.dt > 0 ? w.d / (w.dt / 1000) : 0;
  if (!autoPause.paused) {
    autoPause.aboveSince = null;
    if (speed < cfg.pauseMps) {
      autoPause.belowSince ??= now;
      if (now - autoPause.belowSince >= cfg.pauseAfterMs) autoPause.paused = true;
    } else {
      autoPause.belowSince = null;
    }
  } else {
    autoPause.belowSince = null;
    if (speed > cfg.resumeMps) {
      autoPause.aboveSince ??= now;
      if (now - autoPause.aboveSince >= cfg.resumeAfterMs) autoPause.paused = false;
    } else {
      autoPause.aboveSince = null;
    }
  }
}

function beginRecording(at: number) {
  startedAt = at;
  filter = createGpsFilter(kind, at);
  phase = 'recording';
  warnings.delete('poorGps');
  if (acquireTimer) clearTimeout(acquireTimer);
  acquireTimer = null;
  if (persistTimer) clearInterval(persistTimer);
  persistTimer = setInterval(() => void persist(), RECORDER.persistEveryMs);
  publishNow();
}

function onFix(fix: RawFix) {
  const now = Date.now();
  lastFix = { accuracy: fix.accuracy, at: now };
  if (phase === 'acquiring') {
    if (fix.accuracy !== null && fix.accuracy <= RECORDER.acquireAccuracyM) beginRecording(Math.min(fix.timestamp, now));
    else {
      schedulePublish();
      return;
    }
  }
  if (phase !== 'recording' || !filter) {
    schedulePublish();
    return;
  }
  const r = filter.push(fix, now);
  vehicleSuspected = r.vehicleSuspected;
  if (r.vehicleSuspected) warnings.add('vehicleSegment');
  if (r.point) appendPoint(r.point);
  updateAutoPause(now);
  schedulePublish();
}

function onAppState(s: AppStateStatus) {
  const now = Date.now();
  if (s === 'background') {
    backgroundSince ??= now;
    void persist();
  } else if (s === 'active' && backgroundSince !== null) {
    const gap = now - backgroundSince;
    backgroundSince = null;
    if ((phase === 'recording' || phase === 'acquiring') && gap > 0) {
      backgroundGapMs += gap;
      warnings.add('backgroundGap');
      publishNow();
    }
  }
}

function startRuntime(): void {
  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppState);
  void activateKeepAwakeAsync(RECORDER.keepAwakeTag).catch(() => {});
}

function stopRuntime(): void {
  release?.();
  release = null;
  appStateSub?.remove();
  appStateSub = null;
  for (const t of [acquireTimer, publishTimer]) if (t) clearTimeout(t);
  if (persistTimer) clearInterval(persistTimer);
  acquireTimer = publishTimer = null;
  persistTimer = null;
  try {
    void Promise.resolve(deactivateKeepAwake(RECORDER.keepAwakeTag)).catch(() => {});
  } catch {
    // not active
  }
  clearActiveMode('recording');
}

function resetRun(): void {
  phase = 'idle';
  localId = null;
  startedAt = null;
  groupSessionId = null;
  points = [];
  cum = [];
  totals = { distanceM: 0, excludedM: 0, movingMs: 0 };
  warnings = new Set();
  backgroundGapMs = 0;
  filter = null;
  lastFix = null;
  vehicleSuspected = false;
  autoPause = { paused: false, belowSince: null, aboveSince: null };
  pausedTotalMs = 0;
  pausedAt = null;
  backgroundSince = null;
  path = [];
  pathAt = 0;
  persistedFullChunks = 0;
  reacquiring = null;
}

// --- persistence -------------------------------------------------------------------------

async function persist(): Promise<void> {
  if (!localId || startedAt === null) return;
  const full = Math.floor(points.length / RECORDER.chunkSize);
  const chunks = Math.ceil(points.length / RECORDER.chunkSize);
  // Append-only: full chunks are written once; the partial last chunk is rewritten each time.
  for (let n = persistedFullChunks; n < chunks; n++) {
    const slice = points.slice(n * RECORDER.chunkSize, (n + 1) * RECORDER.chunkSize).map((p) => [p.t, p.lat, p.lon]);
    await writeCache(recChunkKey(n), REC_VERSION, slice);
  }
  persistedFullChunks = full;
  const header: Header = { localId, kind, startedAt, groupSessionId, chunks, points: points.length, backgroundGapMs };
  await writeCache(REC_HEADER_KEY, REC_VERSION, header);
}

async function readHeader(): Promise<Header | null> {
  const hit = await readCache<Header>(REC_HEADER_KEY, REC_VERSION);
  const h = hit?.value;
  if (!h || typeof h.localId !== 'string' || (h.kind !== 'run' && h.kind !== 'bike') || typeof h.startedAt !== 'number') return null;
  return h;
}

async function readPersistedPoints(h: Header): Promise<TrackPoint[]> {
  const out: TrackPoint[] = [];
  for (let n = 0; n < h.chunks; n++) {
    const hit = await readCache<[number, number, number][]>(recChunkKey(n), REC_VERSION);
    if (!hit || !Array.isArray(hit.value)) break;
    for (const [t, lat, lon] of hit.value) out.push({ t, lat, lon });
  }
  return out;
}

async function clearPersisted(): Promise<void> {
  const h = await readHeader();
  const chunks = Math.max(h?.chunks ?? 0, Math.ceil(points.length / RECORDER.chunkSize));
  for (let n = 0; n < chunks; n++) await removeCache(recChunkKey(n));
  await removeCache(REC_HEADER_KEY);
}

// --- finishing ---------------------------------------------------------------------------

async function saveRecorded(o: {
  localId: string;
  kind: ActivityKind;
  startedAt: number;
  groupSessionId: string | null;
  points: TrackPoint[];
  shareRoute: boolean;
}): Promise<LocalActivity | { discarded: 'tooShort' }> {
  if (o.points.length < 2) return { discarded: 'tooShort' };
  // Rebase so the first point is t = 0 (the server requires it).
  const t0 = o.points[0].t;
  const rebased = t0 === 0 ? o.points : o.points.map((p) => ({ ...p, t: p.t - t0 }));
  const metrics = computeTrackMetrics(rebased, o.kind);
  if (metrics.distanceM < RECORDER.minDistanceM || metrics.elapsedMs < RECORDER.minDurationMs) return { discarded: 'tooShort' };
  const auth = getAuthState();
  const owner = auth.status === 'signedIn' ? auth.userId : null;
  const start = o.startedAt + t0;
  const activity: LocalActivity = {
    localId: o.localId,
    kind: o.kind,
    startedAt: start,
    endedAt: start + rebased[rebased.length - 1].t,
    ownerUserId: owner,
    groupSessionId: o.groupSessionId,
    shareRoute: o.shareRoute,
    metrics,
    previewPolyline: encodePolyline(recentPath(rebased, 300)),
    sync: { state: owner ? 'pending' : 'local', attempts: 0, nextAttemptAt: null, lastError: null, server: null },
  };
  await saveNewActivity(activity, rebased);
  if (owner) void syncPending('finish');
  return activity;
}

function hubWarning(e: HubError): RecorderWarning | null {
  return e === 'permissionDenied' ? 'permissionDenied' : e === 'servicesOff' ? 'servicesOff' : null;
}

function hubErrorCopy(e: HubError): BackendError {
  if (e === 'permissionDenied') return { code: 'forbidden', message: 'Teal needs location access to record. You can turn it on in Settings.', retryable: false };
  if (e === 'servicesOff') return err('Location Services are off. Turn them on in Settings to record.');
  return err('GPS isn’t available on this device.');
}

async function acquire(): Promise<HubError | null> {
  const lease = await acquireFixes('recorder', onFix, { precision: 'fitness' });
  if (!lease.ok) return lease.error;
  release = lease.release;
  return null;
}

const OK: Result<void> = { ok: true, value: undefined };
const GPS_WARNINGS: readonly RecorderWarning[] = ['permissionDenied', 'servicesOff', 'gpsStopped'];

/** Stay paused without GPS: say why (permission, services, or just stopped) so Resume can retry. */
function holdWithoutGps(e: HubError): Result<void> {
  if (phase !== 'paused') {
    phase = 'paused';
    pausedAt = Date.now();
  }
  for (const w of GPS_WARNINGS) warnings.delete(w);
  warnings.add('gpsStopped');
  const w = hubWarning(e);
  if (w) warnings.add(w);
  publishNow();
  return { ok: false, error: hubErrorCopy(e) };
}

/** Resume a paused recording that has no GPS lease: acquire GPS first; only then record. */
function resumeWithoutLease(): Promise<Result<void>> {
  reacquiring ??= (async () => {
    const run = localId;
    const hubError = await acquire();
    if (run !== localId || phase !== 'paused') {
      // Finished or discarded while waiting: give the lease back.
      if (!hubError && phase !== 'recording') {
        release?.();
        release = null;
      }
      return OK;
    }
    if (hubError) return holdWithoutGps(hubError);
    for (const w of GPS_WARNINGS) warnings.delete(w);
    if (pausedAt !== null) pausedTotalMs += Date.now() - pausedAt;
    pausedAt = null;
    startRuntime();
    beginRecording(startedAt ?? Date.now());
    return OK;
  })().finally(() => {
    reacquiring = null;
  });
  return reacquiring;
}

// --- public API --------------------------------------------------------------------------

export const recorder = {
  /** Start acquiring GPS; recording begins at the first fix within 20 m (or `resume()` to start anyway). */
  async start(o: { kind: ActivityKind; groupSessionId?: string | null }): Promise<Result<void>> {
    if (phase === 'acquiring' || phase === 'recording' || phase === 'paused') return { ok: false, error: err('A recording is already in progress.') };
    if (await readHeader()) return { ok: false, error: err('Resume or save your unfinished recording first.') };
    resetRun();
    kind = o.kind;
    groupSessionId = o.groupSessionId ?? null;
    localId = uuidv4();
    phase = 'acquiring';
    if (!canTrackInBackground()) warnings.add('foregroundOnly');
    publishNow();
    const hubError = await acquire();
    if (hubError) {
      stopRuntime();
      resetRun();
      const w = hubWarning(hubError);
      if (w) warnings.add(w);
      publishNow();
      return { ok: false, error: hubErrorCopy(hubError) };
    }
    startRuntime();
    acquireTimer = setTimeout(() => {
      if (phase !== 'acquiring') return;
      warnings.add('poorGps');
      publishNow();
    }, RECORDER.acquireTimeoutMs);
    publishNow();
    return { ok: true, value: undefined };
  },

  pause(): void {
    if (phase !== 'recording') return;
    phase = 'paused';
    pausedAt = Date.now();
    void persist();
    publishNow();
  },

  /**
   * Resume after a pause; while acquiring, start recording now despite weak GPS. When the recording
   * has no GPS (a recovered run whose GPS failed to start), GPS is acquired again first; on failure
   * it stays paused with a warning and the error is returned. Never shows "Recording" without GPS.
   */
  resume(): Promise<Result<void>> {
    if (phase === 'acquiring') {
      beginRecording(Date.now());
      return Promise.resolve(OK);
    }
    if (phase !== 'paused') return Promise.resolve(OK);
    if (release === null || filter === null) return resumeWithoutLease();
    if (pausedAt !== null) pausedTotalMs += Date.now() - pausedAt;
    pausedAt = null;
    phase = 'recording';
    publishNow();
    return Promise.resolve(OK);
  },

  /** Stop and save. Under 100 m or 60 s the recording is discarded. */
  async finish(o: { shareRoute: boolean }): Promise<LocalActivity | { discarded: 'tooShort' }> {
    if (phase !== 'recording' && phase !== 'paused' && phase !== 'acquiring') return { discarded: 'tooShort' };
    const now = Date.now();
    const finalStats = liveStats(now);
    stopRuntime();
    const result =
      localId && startedAt !== null
        ? await saveRecorded({ localId, kind, startedAt, groupSessionId, points, shareRoute: o.shareRoute })
        : ({ discarded: 'tooShort' } as const);
    await clearPersisted();
    if ('discarded' in result) {
      resetRun();
      publishNow();
      clearActiveMode('recording');
      return result;
    }
    phase = 'finished';
    snapshot = { ...buildSnapshot(now), phase: 'finished', stats: { ...finalStats, autoPaused: false } };
    path = snapshot.recentPath;
    listeners.forEach((l) => l(snapshot));
    clearActiveMode('recording');
    return result;
  },

  async discard(): Promise<void> {
    stopRuntime();
    await clearPersisted();
    resetRun();
    publishNow();
    clearActiveMode('recording');
  },

  /** An unfinished recording left by a crash or kill, if any (only while idle). */
  async pendingRecovery(): Promise<{ kind: ActivityKind; startedAt: number; points: number } | null> {
    if (phase === 'acquiring' || phase === 'recording' || phase === 'paused') return null;
    const h = await readHeader();
    return h ? { kind: h.kind, startedAt: h.startedAt, points: h.points } : null;
  },

  /**
   * Resolve an unfinished recording. 'resume' fails (and leaves the run paused, with a GPS warning,
   * so Resume on the record screen can retry) when GPS can't start.
   */
  async recover(action: 'resume' | 'save' | 'discard'): Promise<Result<void>> {
    if (phase === 'acquiring' || phase === 'recording' || phase === 'paused') return OK;
    const h = await readHeader();
    if (!h) return OK;
    const saved = await readPersistedPoints(h);
    if (action === 'discard') {
      resetRun();
      await clearPersisted();
      publishNow();
      return OK;
    }
    if (action === 'save') {
      resetRun();
      await saveRecorded({ localId: h.localId, kind: h.kind, startedAt: h.startedAt, groupSessionId: h.groupSessionId, points: saved, shareRoute: false });
      await clearPersisted();
      publishNow();
      return OK;
    }
    // Resume: continue the same recording. The time away becomes a gap (> 30 s), which isn't counted.
    resetRun();
    kind = h.kind;
    localId = h.localId;
    startedAt = h.startedAt;
    groupSessionId = h.groupSessionId;
    backgroundGapMs = h.backgroundGapMs ?? 0;
    for (const p of saved) appendPoint(p);
    persistedFullChunks = Math.floor(points.length / RECORDER.chunkSize);
    if (!canTrackInBackground()) warnings.add('foregroundOnly');
    phase = 'paused';
    pausedAt = Date.now();
    const hubError = await acquire();
    if (hubError) return holdWithoutGps(hubError);
    pausedAt = null;
    startRuntime();
    beginRecording(h.startedAt);
    return OK;
  },
};

export function getRecorderSnapshot(): RecorderSnapshot {
  return snapshot;
}

export function subscribeRecorder(l: (s: RecorderSnapshot) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const subscribeStore = (l: () => void) => subscribeRecorder(() => l());

export function useRecorder(): RecorderSnapshot {
  return useSyncExternalStore(subscribeStore, getRecorderSnapshot, getRecorderSnapshot);
}

/** Test helper: stop everything without touching storage. */
export function resetRecorderForTests(): void {
  stopRuntime();
  resetRun();
  snapshot = IDLE;
  lastPublish = 0;
  listeners.clear();
}
