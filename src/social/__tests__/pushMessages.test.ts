/** The send-push Edge Function's pure core (supabase/functions/send-push/messages.ts). */
import {
  chunk,
  formatMiles,
  kindEnabled,
  notificationContent,
  parseTickets,
  planPush,
  resolveOutcomes,
  timingSafeEqual,
  type PendingNotification,
} from '../../../supabase/functions/send-push/messages';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_A1 = 'ExponentPushToken[aaaa1111]';
const TOKEN_A2 = 'ExpoPushToken[aaaa2222]';
const TOKEN_B = 'ExponentPushToken[bbbb]';
const ALL_ON = { overtake: true, sessions: true, friendRequests: true };

const row = (id: string, recipientId: string, kind: string, payload: unknown, attempts = 1): PendingNotification => ({ id, recipientId, kind, payload, attempts });

describe('notificationContent', () => {
  it('overtake: nickname and both weekly distances in miles', () => {
    const c = notificationContent('overtake', { actor_nickname: 'ana_runs', their_m: 22852, your_m: 22370, week_start: '2026-10-19' });
    expect(c).toEqual({ title: 'You’ve been passed', body: 'ana_runs passed you this week · 14.2 mi vs your 13.9 mi', url: '/friends' });
  });

  it('overtake accepts numeric strings and omits numbers it cannot read', () => {
    expect(notificationContent('overtake', { actor_nickname: 'ana', their_m: '1609.344', your_m: '0' })?.body).toBe('ana passed you this week · 1.0 mi vs your 0.0 mi');
    expect(notificationContent('overtake', { actor_nickname: 'ana', their_m: 'x' })?.body).toBe('ana passed you this week');
    expect(notificationContent('overtake', null)?.body).toBe('A friend passed you this week');
  });

  it('session_live links to the session; a bad id falls back to the inbox', () => {
    const c = notificationContent('session_live', { session_id: SESSION.toUpperCase(), title: 'Saturday long run', group_name: 'Fenway Striders' });
    expect(c).toEqual({ title: 'Fenway Striders: Saturday long run is starting', body: 'Open Teal to join and start recording.', url: `/session/${SESSION}` });
    expect(notificationContent('session_live', { session_id: '../../x' })?.url).toBe('/inbox');
  });

  it('friend request and accepted', () => {
    expect(notificationContent('friend_request', { actor_nickname: 'bo' })).toEqual({ title: 'Friend request', body: 'bo wants to be friends on Teal.', url: '/friends' });
    expect(notificationContent('friend_accepted', { actor_nickname: 'bo' })?.body).toBe('You and bo are now friends on Teal.');
  });

  it('carries no data beyond nicknames and numbers, and sanitises names', () => {
    const c = notificationContent('friend_request', { actor_nickname: 'bo\u0000\nx', email: 'bo@example.com', lat: 42.3 });
    expect(c?.body).toBe('bo x wants to be friends on Teal.');
    expect(JSON.stringify(c)).not.toMatch(/example\.com|42\.3/);
    expect(notificationContent('friend_request', { actor_nickname: 'x'.repeat(80) })?.body.length).toBeLessThan(80);
  });

  it('unknown kinds give null', () => {
    expect(notificationContent('chat', {})).toBeNull();
  });

  it('formats miles to one decimal', () => {
    expect(formatMiles(16093.44)).toBe('10.0 mi');
    expect(formatMiles(-5)).toBe('0.0 mi');
  });
});

describe('planPush', () => {
  it('one message per token, skips disabled kinds, records missing and invalid tokens', () => {
    const rows = [
      row('n1', A, 'overtake', { actor_nickname: 'bo', their_m: 2000, your_m: 1000 }),
      row('n2', B, 'friend_request', { actor_nickname: 'ana' }),
      row('n3', B, 'overtake', { actor_nickname: 'ana' }),
      row('n4', A, 'mystery', {}),
      row('n5', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'friend_accepted', { actor_nickname: 'ana' }),
    ];
    const tokens = new Map([
      [A, [TOKEN_A1, TOKEN_A2, 'not-a-token']],
      [B, [TOKEN_B]],
    ]);
    const prefs = new Map([
      [A, ALL_ON],
      [B, { overtake: false, sessions: true, friendRequests: true }],
    ]);
    const plan = planPush(rows, tokens, prefs);
    expect(plan.messages.map((m) => m.to)).toEqual([TOKEN_A1, TOKEN_A2, TOKEN_B]);
    expect(plan.owners).toEqual(['n1', 'n1', 'n2']);
    expect(plan.messages[0].data).toEqual({ url: '/friends' });
    expect(plan.skipped).toEqual(['n3', 'n4']);
    expect(plan.noToken).toEqual(['n5']);
    expect(plan.invalidTokens).toEqual(['not-a-token']);
  });

  it('maps every kind to its setting', () => {
    const off = { overtake: false, sessions: false, friendRequests: false };
    for (const k of ['overtake', 'session_live', 'friend_request', 'friend_accepted']) {
      expect(kindEnabled(k, off)).toBe(false);
      expect(kindEnabled(k, ALL_ON)).toBe(true);
      expect(kindEnabled(k, undefined)).toBe(true);
    }
  });
});

describe('tickets and outcomes', () => {
  const rows = [row('n1', A, 'overtake', {}, 1), row('n2', B, 'friend_request', {}, 2), row('n3', B, 'friend_accepted', {}, 5), row('n4', A, 'friend_accepted', {}, 1)];
  const plan = planPush(
    rows,
    new Map([
      [A, [TOKEN_A1, TOKEN_A2]],
      [B, [TOKEN_B]],
    ]),
    new Map(),
  );
  // messages: n1→A1, n1→A2, n2→B, n3→B, n4→A1, n4→A2

  it('parses ok, error with details, and missing tickets', () => {
    const t = parseTickets({ data: [{ status: 'ok', id: 'x' }, { status: 'error', message: 'm', details: { error: 'DeviceNotRegistered' } }, { status: 'error' }] }, 4);
    expect(t).toEqual([{ status: 'ok' }, { status: 'error', error: 'DeviceNotRegistered' }, { status: 'error', error: null }, null]);
    expect(parseTickets({ errors: [{ code: 'X' }] }, 2)).toEqual([null, null]);
  });

  it('any ok → sent; all DeviceNotRegistered → no_token; other errors retry until the 5th attempt', () => {
    const dnr = { status: 'error' as const, error: 'DeviceNotRegistered' };
    const other = { status: 'error' as const, error: 'MessageRateExceeded' };
    const out = resolveOutcomes(plan, [dnr, { status: 'ok' }, other, null, dnr, dnr], rows);
    expect(out.sent).toEqual(['n1']);
    expect(out.retry).toEqual(['n2']);
    expect(out.failed).toEqual(['n3']);
    expect(out.noToken).toEqual(['n4']);
    expect(out.deadTokens.sort()).toEqual([TOKEN_A1, TOKEN_A2].sort());
  });
});

describe('helpers', () => {
  it('chunks into groups of at most n', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('compares digests', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
