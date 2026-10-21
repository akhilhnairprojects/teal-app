/**
 * "Run together" sessions (spec §2.4 Sessions) and their realtime channel. The channel is private
 * (`session:<id>`, allowed for members of the session's group while it isn't ended) and carries
 * distance, time and state only: never coordinates.
 */
import type { ActivityKind } from '@/activity/types';
import { getAuthState } from '@/backend/auth';
import { getSupabase } from '@/backend/client';
import { fail, ok, type Result } from '@/backend/errors';
import { int, isObj, listOf, nullable, num, numeric, oneOf, str, timestamp, uuid } from '@/backend/parse';
import { rpc } from '@/backend/rpc';

export type GroupSession = {
  id: string;
  groupId: string;
  title: string;
  kind: ActivityKind;
  status: 'open' | 'live' | 'ended';
  createdBy: string | null;
  startsAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  participants: { userId: string; nickname: string; color: number; joinedAt: string }[];
};

export type SessionResult = {
  userId: string;
  nickname: string;
  color: number;
  activityStatus: 'valid' | 'flagged' | null;
  distanceM: number | null;
  movingMs: number | null;
  elapsedMs: number | null;
  best1kMs: number | null;
  best5kMs: number | null;
};

export type LiveProgress = { userId: string; distanceM: number; elapsedMs: number; state: 'recording' | 'paused' | 'finished'; at: number };

const kindOf = oneOf<ActivityKind>(['run', 'bike']);
const sessionStatusOf = oneOf<GroupSession['status']>(['open', 'live', 'ended']);
const activityStatusOf = oneOf<'valid' | 'flagged'>(['valid', 'flagged']);
const progressStateOf = oneOf<LiveProgress['state']>(['recording', 'paused', 'finished']);

function parseParticipant(v: unknown): GroupSession['participants'][number] | null {
  if (!isObj(v)) return null;
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const joinedAt = timestamp(v.joined_at);
  if (!userId || !nickname || color === null || !joinedAt) return null;
  return { userId, nickname, color, joinedAt };
}

export function parseGroupSession(v: unknown): GroupSession | null {
  if (!isObj(v)) return null;
  const id = uuid(v.id);
  const groupId = uuid(v.group_id);
  const title = str(v.title);
  const kind = kindOf(v.kind);
  const status = sessionStatusOf(v.status);
  const createdBy = nullable(v.created_by, uuid);
  const startsAt = nullable(v.starts_at, timestamp);
  const startedAt = nullable(v.started_at, timestamp);
  const endedAt = nullable(v.ended_at, timestamp);
  const participants = listOf(v.participants, parseParticipant);
  if (!id || !groupId || !title || !kind || !status || !participants) return null;
  if (createdBy === undefined || startsAt === undefined || startedAt === undefined || endedAt === undefined) return null;
  return { id, groupId, title, kind, status, createdBy, startsAt, startedAt, endedAt, participants };
}

export function parseSessionResult(v: unknown): SessionResult | null {
  if (!isObj(v)) return null;
  const userId = uuid(v.user_id);
  const nickname = str(v.nickname);
  const color = int(v.color);
  const activityStatus = nullable(v.activity_status, activityStatusOf);
  const distanceM = nullable(v.distance_m, numeric);
  const movingMs = nullable(v.moving_ms, int);
  const elapsedMs = nullable(v.elapsed_ms, int);
  const best1kMs = nullable(v.best_1k_ms, int);
  const best5kMs = nullable(v.best_5k_ms, int);
  if (!userId || !nickname || color === null) return null;
  if ([activityStatus, distanceM, movingMs, elapsedMs, best1kMs, best5kMs].some((x) => x === undefined)) return null;
  return {
    userId,
    nickname,
    color,
    activityStatus: activityStatus ?? null,
    distanceM: distanceM ?? null,
    movingMs: movingMs ?? null,
    elapsedMs: elapsedMs ?? null,
    best1kMs: best1kMs ?? null,
    best5kMs: best5kMs ?? null,
  };
}

const voidResult = (r: Result<unknown>): Result<void> => (r.ok ? ok(undefined) : r);

/** Create a session in a group (at most 3 open per group); returns its id. */
export async function createSession(groupId: string, o: { title: string; kind: ActivityKind; startsAt?: string | null }): Promise<Result<string>> {
  const r = await rpc('create_group_session', { p_group: groupId, p_title: o.title.trim(), p_kind: o.kind, p_starts_at: o.startsAt ?? null });
  if (!r.ok) return r;
  const id = uuid(r.value);
  return id ? ok(id) : fail('unknown');
}

export async function joinSession(id: string): Promise<Result<void>> {
  return voidResult(await rpc('join_group_session', { p_session: id }));
}

/** Creator or group owner: go live (notifies members who opted in) or end. */
export async function setSessionStatus(id: string, s: 'live' | 'ended'): Promise<Result<void>> {
  return voidResult(await rpc('set_group_session_status', { p_session: id, p_status: s }));
}

export async function getSession(id: string): Promise<Result<GroupSession>> {
  const r = await rpc('get_group_session', { p_session: id });
  if (!r.ok) return r;
  const s = parseGroupSession(r.value);
  return s ? ok(s) : fail('unknown');
}

export async function fetchSessionResults(id: string): Promise<Result<SessionResult[]>> {
  const r = await rpc('get_session_results', { p_session: id });
  if (!r.ok) return r;
  const rows = listOf(r.value, parseSessionResult);
  return rows ? ok(rows) : fail('unknown');
}

/** A progress broadcast, keeping only the allowed fields (anything else, e.g. coordinates, is dropped). */
export function parseLiveProgress(v: unknown): LiveProgress | null {
  if (!isObj(v)) return null;
  const userId = uuid(v.userId);
  const distanceM = num(v.distanceM);
  const elapsedMs = num(v.elapsedMs);
  const state = progressStateOf(v.state);
  const at = num(v.at);
  if (!userId || distanceM === null || elapsedMs === null || !state || at === null) return null;
  return { userId, distanceM, elapsedMs, state, at };
}

type ChannelLike = {
  on(type: string, filter: Record<string, unknown>, cb: (payload: unknown) => void): ChannelLike;
  subscribe(cb?: (status: string) => void): ChannelLike;
  send(msg: unknown): Promise<unknown>;
  track(state: unknown): Promise<unknown>;
  presenceState(): Record<string, unknown[]>;
};

/** User ids present on the channel, from the presence state's `userId` fields. */
export function presenceUserIds(state: Record<string, unknown[]>): string[] {
  const ids = new Set<string>();
  for (const metas of Object.values(state)) {
    for (const m of metas ?? []) {
      const id = isObj(m) ? uuid(m.userId) : null;
      if (id) ids.add(id);
    }
  }
  return [...ids].sort();
}

export function openSessionChannel(
  sessionId: string,
  h: { onProgress(p: LiveProgress): void; onPresence(userIds: string[]): void; onStatus(s: 'live' | 'ended'): void },
): { sendProgress(p: Omit<LiveProgress, 'userId' | 'at'>): void; sendStatus(s: 'live' | 'ended'): void; close(): Promise<void> } {
  const sb = getSupabase();
  const auth = getAuthState();
  const me = auth.status === 'signedIn' ? auth.userId : null;
  if (!sb || !me) return { sendProgress: () => {}, sendStatus: () => {}, close: async () => {} };

  const channel = sb.channel(`session:${sessionId}`, { config: { private: true, presence: { key: me } } }) as unknown as ChannelLike;
  const payloadOf = (msg: unknown) => (isObj(msg) ? msg.payload : undefined);
  channel
    .on('broadcast', { event: 'progress' }, (msg) => {
      const p = parseLiveProgress(payloadOf(msg));
      if (p) h.onProgress(p);
    })
    .on('broadcast', { event: 'status' }, (msg) => {
      const p = payloadOf(msg);
      const s = isObj(p) ? p.status : null;
      if (s === 'live' || s === 'ended') h.onStatus(s);
    })
    .on('presence', { event: 'sync' }, () => h.onPresence(presenceUserIds(channel.presenceState())))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ userId: me }).catch(() => {});
    });

  let closed = false;
  return {
    sendProgress(p) {
      if (closed) return;
      const payload: LiveProgress = { userId: me, distanceM: p.distanceM, elapsedMs: p.elapsedMs, state: p.state, at: Date.now() };
      void channel.send({ type: 'broadcast', event: 'progress', payload }).catch(() => {});
    },
    sendStatus(s) {
      if (closed) return;
      void channel.send({ type: 'broadcast', event: 'status', payload: { status: s } }).catch(() => {});
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await sb.removeChannel(channel as never);
      } catch {
        // already gone
      }
    },
  };
}
