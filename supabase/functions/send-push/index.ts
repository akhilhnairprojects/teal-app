/**
 * send-push (spec §2.8): delivers pending `notifications` rows as Expo push notifications.
 *
 * Called by Postgres (`private.dispatch_push`, through pg_net) with `{ ids }` and the header
 * `x-teal-push-secret`; a body without `ids` sweeps every pending row instead. Deployed with
 * `verify_jwt: false` because it checks the shared secret (env TEAL_PUSH_SECRET, same value as the
 * Vault secret `teal_push_secret`). Optional env EXPO_ACCESS_TOKEN is sent as a bearer token.
 *
 * Flow: claim rows (bump push_attempts only where it is unchanged, so overlapping calls never send a
 * row twice) → read the recipients' tokens and notify settings → POST to Expo in chunks of 100 →
 * record each row's push_state from its tickets and delete DeviceNotRegistered tokens.
 * Logs counts only: never tokens, nicknames or ids.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

import {
  chunk,
  EXPO_CHUNK_SIZE,
  MAX_PUSH_ATTEMPTS,
  parseTickets,
  planPush,
  resolveOutcomes,
  timingSafeEqual,
  type ExpoTicket,
  type NotifyPrefs,
  type PendingNotification,
} from './messages.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_ROWS = 500;
/** Ids per `.in()` filter, keeping PostgREST URLs short. */
const IN_CHUNK = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Counts = { claimed: number; sent: number; noToken: number; skipped: number; retry: number; failed: number; tokensRemoved: number };

type PendingRow = { id: string; recipient_id: string; kind: string; payload: unknown; push_attempts: number };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The secret (service-role) key: the new `SUPABASE_SECRET_KEYS` dictionary first, then the legacy key. */
function serviceKey(): string | null {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dict) {
    try {
      const keys = JSON.parse(dict) as Record<string, unknown>;
      if (typeof keys.default === 'string' && keys.default) return keys.default;
      const first = Object.values(keys).find((v): v is string => typeof v === 'string' && v !== '');
      if (first) return first;
    } catch {
      // Fall through to the legacy variable.
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || null;
}

/** Constant-time check: compare SHA-256 digests, so neither length nor content leaks through timing. */
async function secretMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

/** `ids` from the request body: null means "sweep everything pending". */
async function requestedIds(req: Request): Promise<string[] | null> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  const ids = typeof body === 'object' && body !== null ? (body as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids)) return null;
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))].slice(0, MAX_ROWS);
}

async function selectPending(sb: SupabaseClient, ids: string[] | null): Promise<PendingRow[]> {
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const base = () =>
    sb
      .from('notifications')
      .select('id,recipient_id,kind,payload,push_attempts')
      .eq('push_state', 'pending')
      .lt('push_attempts', MAX_PUSH_ATTEMPTS)
      .gt('created_at', since)
      .order('created_at', { ascending: true });
  const rows: PendingRow[] = [];
  if (ids === null) {
    const { data, error } = await base().limit(MAX_ROWS);
    if (error) throw new Error('select_pending');
    rows.push(...((data ?? []) as PendingRow[]));
  } else {
    for (const part of chunk(ids, IN_CHUNK)) {
      const { data, error } = await base().in('id', part);
      if (error) throw new Error('select_pending');
      rows.push(...((data ?? []) as PendingRow[]));
    }
  }
  return rows;
}

/** Claim rows by bumping push_attempts from the value we read; rows another call claimed first drop out. */
async function claim(sb: SupabaseClient, rows: PendingRow[]): Promise<PendingNotification[]> {
  const byAttempts = new Map<number, PendingRow[]>();
  for (const r of rows) byAttempts.set(r.push_attempts, [...(byAttempts.get(r.push_attempts) ?? []), r]);
  const claimed: PendingNotification[] = [];
  for (const [attempts, group] of byAttempts) {
    for (const part of chunk(group, IN_CHUNK)) {
      const { data, error } = await sb
        .from('notifications')
        .update({ push_attempts: attempts + 1 })
        .in('id', part.map((r) => r.id))
        .eq('push_attempts', attempts)
        .eq('push_state', 'pending')
        .select('id');
      if (error) throw new Error('claim');
      const won = new Set(((data ?? []) as { id: string }[]).map((d) => d.id));
      for (const r of part) {
        if (won.has(r.id)) claimed.push({ id: r.id, recipientId: r.recipient_id, kind: r.kind, payload: r.payload, attempts: attempts + 1 });
      }
    }
  }
  return claimed;
}

async function recipientsData(sb: SupabaseClient, userIds: string[]) {
  const tokens = new Map<string, string[]>();
  const prefs = new Map<string, NotifyPrefs>();
  for (const part of chunk(userIds, IN_CHUNK)) {
    const t = await sb.from('push_tokens').select('token,user_id').in('user_id', part);
    if (t.error) throw new Error('select_tokens');
    for (const row of (t.data ?? []) as { token: string; user_id: string }[]) {
      tokens.set(row.user_id, [...(tokens.get(row.user_id) ?? []), row.token]);
    }
    const p = await sb.from('profile_private').select('user_id,notify_overtake,notify_sessions,notify_friend_requests').in('user_id', part);
    if (p.error) throw new Error('select_prefs');
    for (const row of (p.data ?? []) as { user_id: string; notify_overtake: boolean; notify_sessions: boolean; notify_friend_requests: boolean }[]) {
      prefs.set(row.user_id, { overtake: row.notify_overtake, sessions: row.notify_sessions, friendRequests: row.notify_friend_requests });
    }
  }
  return { tokens, prefs };
}

/** POST messages to Expo in chunks; a failed chunk leaves its tickets null (retried later). */
async function sendToExpo(messages: unknown[]): Promise<(ExpoTicket | null)[]> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const tickets: (ExpoTicket | null)[] = [];
  for (const part of chunk(messages, EXPO_CHUNK_SIZE)) {
    let parsed: (ExpoTicket | null)[] = part.map(() => null);
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(part) });
      const body: unknown = await res.json().catch(() => null);
      if (res.ok) parsed = parseTickets(body, part.length);
    } catch {
      // Network failure: the rows stay pending and the sweep retries them.
    }
    tickets.push(...parsed);
  }
  return tickets;
}

async function setState(sb: SupabaseClient, ids: string[], state: 'sent' | 'no_token' | 'failed' | 'skipped') {
  for (const part of chunk(ids, IN_CHUNK)) {
    const { error } = await sb.from('notifications').update({ push_state: state }).in('id', part);
    if (error) throw new Error('update_state');
  }
}

async function deliver(sb: SupabaseClient, ids: string[] | null): Promise<Counts> {
  const counts: Counts = { claimed: 0, sent: 0, noToken: 0, skipped: 0, retry: 0, failed: 0, tokensRemoved: 0 };
  if (ids !== null && ids.length === 0) return counts;
  const claimed = await claim(sb, await selectPending(sb, ids));
  counts.claimed = claimed.length;
  if (claimed.length === 0) return counts;

  const { tokens, prefs } = await recipientsData(sb, [...new Set(claimed.map((c) => c.recipientId))]);
  const plan = planPush(claimed, tokens, prefs);
  const tickets = plan.messages.length > 0 ? await sendToExpo(plan.messages) : [];
  const out = resolveOutcomes(plan, tickets, claimed);

  const noToken = [...plan.noToken, ...out.noToken];
  await setState(sb, out.sent, 'sent');
  await setState(sb, noToken, 'no_token');
  await setState(sb, plan.skipped, 'skipped');
  await setState(sb, out.failed, 'failed');
  const removeTokens = [...new Set([...out.deadTokens, ...plan.invalidTokens])];
  for (const part of chunk(removeTokens, IN_CHUNK)) {
    const { error } = await sb.from('push_tokens').delete().in('token', part);
    if (error) throw new Error('delete_tokens');
  }

  counts.sent = out.sent.length;
  counts.noToken = noToken.length;
  counts.skipped = plan.skipped.length;
  counts.retry = out.retry.length;
  counts.failed = out.failed.length;
  counts.tokensRemoved = removeTokens.length;
  return counts;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const expected = Deno.env.get('TEAL_PUSH_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const key = serviceKey();
  if (!expected || !url || !key) {
    console.error('send-push: not configured');
    return json(503, { error: 'not_configured' });
  }
  if (!(await secretMatches(req.headers.get('x-teal-push-secret') ?? '', expected))) return json(401, { error: 'unauthorized' });

  const ids = await requestedIds(req);
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const counts = await deliver(sb, ids);
    console.log(`send-push: ${JSON.stringify(counts)}`);
    return json(200, counts);
  } catch (e) {
    // Our own stage names only: other messages (PostgREST, fetch) could echo ids or tokens.
    const stage = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'unknown';
    console.error(`send-push: failed at ${stage}`);
    return json(500, { error: 'internal' });
  }
});
