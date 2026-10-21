/**
 * The in-app inbox (spec §3.5): rows of `notifications`, read directly (RLS limits them to the
 * recipient). Payloads carry nicknames and numbers only.
 */
import { getAuthState } from '@/backend/auth';
import { getSupabase } from '@/backend/client';
import { fail, ok, toBackendError, type Result } from '@/backend/errors';
import { isObj, listOf, nullable, oneOf, str, timestamp, uuid } from '@/backend/parse';
import { rpc } from '@/backend/rpc';

export type InboxItem = {
  id: string;
  kind: 'overtake' | 'friend_request' | 'friend_accepted';
  createdAt: string;
  readAt: string | null;
  actorNickname: string | null;
  payload: Record<string, unknown>;
};

// The server also has 'session_live' (group runs); the app doesn't offer groups, so those rows are skipped.
const kindOf = oneOf<InboxItem['kind']>(['overtake', 'friend_request', 'friend_accepted']);

export function parseInboxItem(v: unknown): InboxItem | null {
  if (!isObj(v)) return null;
  const id = uuid(v.id);
  const kind = kindOf(v.kind);
  const createdAt = timestamp(v.created_at);
  const readAt = nullable(v.read_at, timestamp);
  const payload = isObj(v.payload) ? v.payload : null;
  if (!id || !kind || !createdAt || readAt === undefined || !payload) return null;
  return { id, kind, createdAt, readAt, actorNickname: str(payload.actor_nickname), payload };
}

const COLUMNS = 'id,kind,created_at,read_at,payload';

export async function fetchInbox(limit = 50): Promise<Result<InboxItem[]>> {
  const sb = getSupabase();
  if (!sb) return fail('not_configured');
  try {
    const { data, error } = await sb.from('notifications').select(COLUMNS).order('created_at', { ascending: false }).limit(limit);
    if (error) return { ok: false, error: toBackendError(error) };
    const rows = listOf(data, parseInboxItem);
    return rows ? ok(rows) : fail('unknown');
  } catch (e) {
    return { ok: false, error: toBackendError(e) };
  }
}

export async function markInboxRead(ids: string[]): Promise<Result<void>> {
  if (ids.length === 0) return ok(undefined);
  const r = await rpc('mark_notifications_read', { p_ids: ids });
  return r.ok ? ok(undefined) : r;
}

/** New inbox rows as they are inserted (realtime; RLS-filtered). Returns unsubscribe. */
export function subscribeInboxInserts(cb: (item: InboxItem) => void): () => void {
  const sb = getSupabase();
  const auth = getAuthState();
  if (!sb || auth.status !== 'signedIn') return () => {};
  const channel = sb
    .channel(`inbox:${auth.userId}`)
    .on(
      'postgres_changes' as never,
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${auth.userId}` } as never,
      (msg: unknown) => {
        const item = isObj(msg) ? parseInboxItem(msg.new) : null;
        if (item) cb(item);
      },
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel).catch(() => {});
  };
}
