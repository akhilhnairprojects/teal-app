/**
 * The live side of a "run together" session (spec §5 G3). It owns the one realtime channel per
 * session (supabase-js returns the existing channel for a repeated topic, so two owners would close
 * each other's channel) and fans its events out to the session page.
 *
 * While the user follows a session, it watches the recorder and broadcasts that recording's
 * distance, elapsed time and state at most once every 10 s, then one final `finished` message.
 * Coordinates are never sent. The channel stays open while following even if the session page
 * unmounts (e.g. the user is on the record screen), and closes when nothing needs it.
 */
import { getRecorderSnapshot, subscribeRecorder, type RecorderSnapshot } from '@/activity/recorder';
import { getAuthState } from '@/backend/auth';

import { openSessionChannel, type LiveProgress } from './sessions';

export const SESSION_RUNTIME = { progressEveryMs: 10_000 } as const;

export type SessionListener = {
  onProgress(p: LiveProgress): void;
  onPresence(userIds: string[]): void;
  onStatus(s: 'live' | 'ended'): void;
};

type Progress = Omit<LiveProgress, 'userId' | 'at'>;

type Follow = {
  unsubscribe: () => void;
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  latest: Progress | null;
  broadcasting: boolean;
};

type Entry = {
  handle: ReturnType<typeof openSessionChannel>;
  listeners: Set<SessionListener>;
  progress: Map<string, LiveProgress>;
  presence: string[];
  follow: Follow | null;
};

const entries = new Map<string, Entry>();

function entryFor(sessionId: string): Entry {
  const existing = entries.get(sessionId);
  if (existing) return existing;
  const entry: Entry = {
    listeners: new Set(),
    progress: new Map(),
    presence: [],
    follow: null,
    handle: openSessionChannel(sessionId, {
      onProgress: (p) => receiveProgress(entry, p),
      onPresence: (ids) => {
        entry.presence = ids;
        entry.listeners.forEach((l) => l.onPresence(ids));
      },
      onStatus: (s) => {
        entry.listeners.forEach((l) => l.onStatus(s));
        if (s === 'ended') stopFollowing(sessionId);
      },
    }),
  };
  entries.set(sessionId, entry);
  return entry;
}

function receiveProgress(entry: Entry, p: LiveProgress) {
  const prev = entry.progress.get(p.userId);
  if (prev && prev.at > p.at) return; // out of order
  entry.progress.set(p.userId, p);
  entry.listeners.forEach((l) => l.onProgress(p));
}

function closeIfUnused(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry || entry.listeners.size > 0 || entry.follow) return;
  entries.delete(sessionId);
  void entry.handle.close();
}

/** Listen to a session's live events. Returns detach. */
export function attachSession(sessionId: string, listener: SessionListener): () => void {
  const entry = entryFor(sessionId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    closeIfUnused(sessionId);
  };
}

/** The latest progress per participant (including my own broadcasts), and who is on the page. */
export function getSessionLive(sessionId: string): { progress: LiveProgress[]; presence: string[] } {
  const entry = entries.get(sessionId);
  return entry ? { progress: [...entry.progress.values()], presence: entry.presence } : { progress: [], presence: [] };
}

/** Tell members the session went live or ended (after `setSessionStatus` succeeded). */
export function broadcastSessionStatus(sessionId: string, s: 'live' | 'ended'): void {
  const entry = entries.get(sessionId);
  entry?.handle.sendStatus(s);
  if (s === 'ended') stopFollowing(sessionId);
}

function send(entry: Entry, f: Follow, p: Progress) {
  f.lastSentAt = Date.now();
  entry.handle.sendProgress(p);
  // Broadcasts don't echo to the sender, so show my own progress locally.
  const auth = getAuthState();
  if (auth.status === 'signedIn') receiveProgress(entry, { ...p, userId: auth.userId, at: f.lastSentAt });
}

function schedule(entry: Entry, f: Follow) {
  if (f.timer) return;
  const wait = f.lastSentAt + SESSION_RUNTIME.progressEveryMs - Date.now();
  if (wait <= 0) {
    if (f.latest) send(entry, f, f.latest);
    return;
  }
  f.timer = setTimeout(() => {
    f.timer = null;
    if (f.latest && entry.follow === f) send(entry, f, f.latest);
  }, wait);
}

function onSnapshot(sessionId: string, entry: Entry, f: Follow, s: RecorderSnapshot) {
  const mine = s.groupSessionId === sessionId;
  const live = mine && (s.phase === 'recording' || s.phase === 'paused');
  if (live) {
    f.broadcasting = true;
    f.latest = { distanceM: s.stats.distanceM, elapsedMs: s.stats.elapsedMs, state: s.phase === 'paused' ? 'paused' : 'recording' };
    schedule(entry, f);
    return;
  }
  // The recording for this session finished (or was discarded): one last message, then stop.
  if (f.broadcasting && (s.phase === 'finished' || s.phase === 'idle' || !mine)) {
    const last = mine && s.phase === 'finished' ? { distanceM: s.stats.distanceM, elapsedMs: s.stats.elapsedMs } : f.latest;
    if (f.timer) clearTimeout(f.timer);
    f.timer = null;
    if (last) send(entry, f, { distanceM: last.distanceM, elapsedMs: last.elapsedMs, state: 'finished' });
    stopFollowing(sessionId);
  }
}

/**
 * Broadcast this user's recording for `sessionId` (idempotent). Call it when a participant opens a
 * live session or taps "Start recording"; it stops by itself when that recording finishes.
 */
export function followRecorder(sessionId: string): void {
  const entry = entryFor(sessionId);
  if (entry.follow) return;
  const f: Follow = { unsubscribe: () => {}, lastSentAt: -Infinity, timer: null, latest: null, broadcasting: false };
  entry.follow = f;
  f.unsubscribe = subscribeRecorder((s) => {
    if (entry.follow === f) onSnapshot(sessionId, entry, f, s);
  });
  // Pick up a recording already in progress (the recorder only notifies on change).
  const now = getRecorderSnapshot();
  if (now.groupSessionId === sessionId && (now.phase === 'recording' || now.phase === 'paused')) onSnapshot(sessionId, entry, f, now);
}

export function isFollowing(sessionId: string): boolean {
  return entries.get(sessionId)?.follow != null;
}

export function stopFollowing(sessionId: string): void {
  const entry = entries.get(sessionId);
  const f = entry?.follow;
  if (!entry || !f) return;
  if (f.timer) clearTimeout(f.timer);
  f.unsubscribe();
  entry.follow = null;
  closeIfUnused(sessionId);
}

/** Test helper. */
export function resetSessionRuntimeForTests(): void {
  for (const id of [...entries.keys()]) {
    const e = entries.get(id)!;
    e.listeners.clear();
    stopFollowing(id);
    closeIfUnused(id);
  }
  entries.clear();
}
