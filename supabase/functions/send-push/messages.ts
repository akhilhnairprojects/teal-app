/**
 * Push content and Expo ticket handling for the `send-push` Edge Function (spec §2.8).
 *
 * Pure TypeScript with no imports, so Deno runs it, Jest tests it, and the app reuses
 * `notificationContent` for the inbox and its foreground fallback (one owner for the copy).
 * Payloads hold nicknames and numbers only. Nothing here logs.
 */

export type NotificationKind = 'overtake' | 'session_live' | 'friend_request' | 'friend_accepted';

export type NotificationContent = { title: string; body: string; url: string };

/** One claimed `notifications` row. `attempts` already counts this delivery attempt. */
export type PendingNotification = { id: string; recipientId: string; kind: string; payload: unknown; attempts: number };

/** The recipient's notify_* settings (profile_private). */
export type NotifyPrefs = { overtake: boolean; sessions: boolean; friendRequests: boolean };

export type ExpoMessage = { to: string; title: string; body: string; data: { url: string } };

export type ExpoTicket = { status: 'ok' } | { status: 'error'; error: string | null };

export type PushPlan = {
  messages: ExpoMessage[];
  /** The notification id behind each message, in the same order. */
  owners: string[];
  /** Notifications whose recipient has no usable token. */
  noToken: string[];
  /** Notifications not pushed: unknown kind, unreadable payload, or the recipient turned the kind off. */
  skipped: string[];
  /** Stored tokens that are not Expo push tokens (deleted, like DeviceNotRegistered). */
  invalidTokens: string[];
};

export type PushOutcome = {
  sent: string[];
  noToken: string[];
  /** Left pending for the sweep (attempts already incremented). */
  retry: string[];
  failed: string[];
  /** Tokens Expo reported as DeviceNotRegistered. */
  deadTokens: string[];
};

export const MAX_PUSH_ATTEMPTS = 5;
export const EXPO_CHUNK_SIZE = 100;

const METERS_PER_MILE = 1609.344;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

/** '14.2 mi' (miles are Teal's default units, decision O4). */
export function formatMiles(m: number): string {
  return `${(Math.max(0, m) / METERS_PER_MILE).toFixed(1)} mi`;
}

function field(payload: unknown, key: string): unknown {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>)[key] : undefined;
}

/** A display name from a payload: control characters removed, spaces collapsed, at most `max` characters. */
function displayName(v: unknown, max = 40): string | null {
  if (typeof v !== 'string') return null;
  const printable = Array.from(v, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : ch;
  }).join('');
  const s = printable.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

/** A non-negative distance in metres (Postgres numeric may arrive as a string). */
function meters(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Title, body and in-app route for a notification, or null for an unknown kind. `url` is always one
 * of the routes the app's tap router accepts (`/friends`, `/inbox`, `/session/<id>`).
 */
export function notificationContent(kind: string, payload: unknown): NotificationContent | null {
  switch (kind) {
    case 'overtake': {
      const nick = displayName(field(payload, 'actor_nickname')) ?? 'A friend';
      const theirs = meters(field(payload, 'their_m'));
      const yours = meters(field(payload, 'your_m'));
      const numbers = theirs !== null && yours !== null ? ` · ${formatMiles(theirs)} vs your ${formatMiles(yours)}` : '';
      return { title: 'You’ve been passed', body: `${nick} passed you this week${numbers}`, url: '/friends' };
    }
    case 'session_live': {
      const group = displayName(field(payload, 'group_name')) ?? 'Your group';
      const title = displayName(field(payload, 'title'), 60) ?? 'A group run';
      const id = field(payload, 'session_id');
      const url = typeof id === 'string' && UUID_RE.test(id) ? `/session/${id.toLowerCase()}` : '/inbox';
      return { title: `${group}: ${title} is starting`, body: 'Open Teal to join and start recording.', url };
    }
    case 'friend_request': {
      const nick = displayName(field(payload, 'actor_nickname')) ?? 'Someone';
      return { title: 'Friend request', body: `${nick} wants to be friends on Teal.`, url: '/friends' };
    }
    case 'friend_accepted': {
      const nick = displayName(field(payload, 'actor_nickname')) ?? 'Someone';
      return { title: 'New friend', body: `You and ${nick} are now friends on Teal.`, url: '/friends' };
    }
    default:
      return null;
  }
}

/** Whether the recipient's settings allow pushing this kind (no settings row: allowed). */
export function kindEnabled(kind: string, prefs: NotifyPrefs | undefined): boolean {
  if (!prefs) return true;
  if (kind === 'overtake') return prefs.overtake;
  if (kind === 'session_live') return prefs.sessions;
  if (kind === 'friend_request' || kind === 'friend_accepted') return prefs.friendRequests;
  return false;
}

export const isExpoPushToken = (t: string): boolean => EXPO_TOKEN_RE.test(t);

/** One message per (notification, token). */
export function planPush(
  rows: readonly PendingNotification[],
  tokensByUser: ReadonlyMap<string, readonly string[]>,
  prefsByUser: ReadonlyMap<string, NotifyPrefs>,
): PushPlan {
  const plan: PushPlan = { messages: [], owners: [], noToken: [], skipped: [], invalidTokens: [] };
  const invalid = new Set<string>();
  for (const row of rows) {
    const content = notificationContent(row.kind, row.payload);
    if (!content || !kindEnabled(row.kind, prefsByUser.get(row.recipientId))) {
      plan.skipped.push(row.id);
      continue;
    }
    const tokens = (tokensByUser.get(row.recipientId) ?? []).filter((t) => {
      if (isExpoPushToken(t)) return true;
      invalid.add(t);
      return false;
    });
    if (tokens.length === 0) {
      plan.noToken.push(row.id);
      continue;
    }
    for (const to of tokens) {
      plan.messages.push({ to, title: content.title, body: content.body, data: { url: content.url } });
      plan.owners.push(row.id);
    }
  }
  plan.invalidTokens = [...invalid];
  return plan;
}

export function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * The tickets in an Expo push response (`{ data: [...] }`, one per message, in order). Missing or
 * malformed entries are null, which counts as a retryable error.
 */
export function parseTickets(response: unknown, count: number): (ExpoTicket | null)[] {
  const data = field(response, 'data');
  const list = Array.isArray(data) ? data : [];
  const out: (ExpoTicket | null)[] = [];
  for (let i = 0; i < count; i++) {
    const t = list[i];
    const status = field(t, 'status');
    if (status === 'ok') out.push({ status: 'ok' });
    else if (status === 'error') {
      const e = field(field(t, 'details'), 'error');
      out.push({ status: 'error', error: typeof e === 'string' ? e : null });
    } else out.push(null);
  }
  return out;
}

/**
 * Per notification: any ok ticket → sent; every ticket DeviceNotRegistered → no_token (and those
 * tokens are deleted); otherwise an error → failed at `maxAttempts`, else retried by the sweep.
 */
export function resolveOutcomes(
  plan: PushPlan,
  tickets: readonly (ExpoTicket | null)[],
  rows: readonly PendingNotification[],
  maxAttempts = MAX_PUSH_ATTEMPTS,
): PushOutcome {
  const out: PushOutcome = { sent: [], noToken: [], retry: [], failed: [], deadTokens: [] };
  const byId = new Map<string, { ok: boolean; otherError: boolean }>();
  const dead = new Set<string>();
  plan.owners.forEach((id, i) => {
    const s = byId.get(id) ?? { ok: false, otherError: false };
    const t = tickets[i] ?? null;
    if (t?.status === 'ok') s.ok = true;
    else if (t?.status === 'error' && t.error === 'DeviceNotRegistered') dead.add(plan.messages[i].to);
    else s.otherError = true;
    byId.set(id, s);
  });
  const attempts = new Map(rows.map((r) => [r.id, r.attempts]));
  for (const [id, s] of byId) {
    if (s.ok) out.sent.push(id);
    else if (!s.otherError) out.noToken.push(id);
    else if ((attempts.get(id) ?? maxAttempts) >= maxAttempts) out.failed.push(id);
    else out.retry.push(id);
  }
  out.deadTokens = [...dead];
  return out;
}

/** Compare two equal-length digests without an early exit (length differences return false). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
