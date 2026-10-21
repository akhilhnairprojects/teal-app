/**
 * Recent sessions of one group. There is no RPC for this list, so it reads `group_sessions`
 * directly (RLS: group members only), like the inbox does, and parses with the sessions module's
 * parser. Participants are not part of the list; the session page loads them.
 */
import { getSupabase } from '@/backend/client';
import { fail, ok, toBackendError, type Result } from '@/backend/errors';
import { isObj, listOf } from '@/backend/parse';
import { parseGroupSession, type GroupSession } from '@/social/sessions';

const COLUMNS = 'id,group_id,title,kind,status,created_by,starts_at,started_at,ended_at';

export async function listGroupSessions(groupId: string, limit = 10): Promise<Result<GroupSession[]>> {
  const sb = getSupabase();
  if (!sb) return fail('not_configured');
  try {
    const { data, error } = await sb.from('group_sessions').select(COLUMNS).eq('group_id', groupId).order('created_at', { ascending: false }).limit(limit);
    if (error) return { ok: false, error: toBackendError(error) };
    const rows = listOf(data, (v) => (isObj(v) ? parseGroupSession({ ...v, participants: [] }) : null));
    return rows ? ok(rows) : fail('unknown');
  } catch (e) {
    return { ok: false, error: toBackendError(e) };
  }
}
