/**
 * In-memory stand-in for the Supabase client, for tests only (no network). Use it by replacing the
 * client module:
 *
 *   jest.mock('@/backend/client', () => jest.requireActual('@/backend/testing/mockSupabase').mockClientModule());
 *   import { mockSupabase } from '@/backend/testing/mockSupabase';
 *   mockSupabase.onRpc('get_my_profile', () => ({ data: {...} }));
 *
 * RPC handlers return `{ data }` or `{ error }` (or throw, to simulate a network failure). Auth calls
 * are jest.fn()s with sensible defaults; `emitAuth` drives `onAuthStateChange` listeners. `from()`
 * returns a chainable, awaitable query whose rows come from `setTable`. Realtime channels record what
 * was sent and let tests deliver broadcast, presence and postgres_changes events.
 */
import type { TealSupabase } from '../client';

type RpcReply = { data?: unknown; error?: unknown };
type RpcHandler = (args: Record<string, unknown>) => RpcReply | Promise<RpcReply>;
type AuthListener = (event: string, session: MockSession | null) => void;
export type MockSession = { user: { id: string; email?: string }; access_token: string };

type ChannelHandler = { type: string; filter: Record<string, unknown>; cb: (payload: unknown) => void };

export type MockChannel = {
  topic: string;
  opts: unknown;
  handlers: ChannelHandler[];
  sent: unknown[];
  tracked: unknown[];
  subscribed: boolean;
  removed: boolean;
  presence: Record<string, unknown[]>;
  /** Deliver an event to handlers of `type` ('broadcast', 'presence', 'postgres_changes') matching `event`. */
  emit(type: string, event: string, payload: unknown): void;
  on(type: string, filter: Record<string, unknown>, cb: (payload: unknown) => void): MockChannel;
  subscribe(cb?: (status: string) => void): MockChannel;
  send(msg: unknown): Promise<string>;
  track(state: unknown): Promise<string>;
  untrack(): Promise<string>;
  presenceState(): Record<string, unknown[]>;
  unsubscribe(): Promise<string>;
};

function createChannel(topic: string, opts: unknown): MockChannel {
  const ch: MockChannel = {
    topic,
    opts,
    handlers: [],
    sent: [],
    tracked: [],
    subscribed: false,
    removed: false,
    presence: {},
    emit(type, event, payload) {
      for (const h of ch.handlers) {
        if (h.type !== type) continue;
        const want = h.filter.event;
        if (want !== undefined && want !== '*' && want !== event) continue;
        h.cb(payload);
      }
    },
    on(type, filter, cb) {
      ch.handlers.push({ type, filter, cb });
      return ch;
    },
    subscribe(cb) {
      ch.subscribed = true;
      cb?.('SUBSCRIBED');
      return ch;
    },
    async send(msg) {
      ch.sent.push(msg);
      return 'ok';
    },
    async track(state) {
      ch.tracked.push(state);
      return 'ok';
    },
    async untrack() {
      return 'ok';
    },
    presenceState() {
      return ch.presence;
    },
    async unsubscribe() {
      ch.subscribed = false;
      return 'ok';
    },
  };
  return ch;
}

/** A chainable query: every builder method returns itself; awaiting it yields `{ data, error }`. */
function createQuery(rows: () => unknown[], error: () => unknown) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: Record<string, unknown> = { calls };
  for (const m of ['select', 'eq', 'neq', 'is', 'in', 'order', 'limit', 'lt', 'gt', 'gte', 'lte', 'range', 'filter', 'match']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const err = error();
    return Promise.resolve(err ? { data: null, error: err } : { data: rows(), error: null }).then(resolve, reject);
  };
  return q;
}

export function createMockSupabase() {
  const rpcHandlers = new Map<string, RpcHandler>();
  const tables = new Map<string, unknown[]>();
  const tableErrors = new Map<string, unknown>();
  const authListeners = new Set<AuthListener>();
  const channels: MockChannel[] = [];
  const state = { session: null as MockSession | null };

  const auth = {
    getSession: jest.fn(async () => ({ data: { session: state.session }, error: null })),
    onAuthStateChange: jest.fn((cb: AuthListener) => {
      authListeners.add(cb);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
    }),
    signInWithOtp: jest.fn(async (_args: unknown) => ({ data: {}, error: null as unknown })),
    verifyOtp: jest.fn(async (_args: unknown) => ({ data: { session: state.session }, error: null as unknown })),
    signInWithIdToken: jest.fn(async (_args: unknown) => ({ data: { user: state.session?.user ?? null, session: state.session }, error: null as unknown })),
    signInWithOAuth: jest.fn(async (_args: unknown) => ({ data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' as string | null }, error: null as unknown })),
    exchangeCodeForSession: jest.fn(async (_code: string) => ({ data: { user: state.session?.user ?? null, session: state.session }, error: null as unknown })),
    signOut: jest.fn(async () => {
      state.session = null;
      authListeners.forEach((l) => l('SIGNED_OUT', null));
      return { error: null };
    }),
    startAutoRefresh: jest.fn(async () => {}),
    stopAutoRefresh: jest.fn(async () => {}),
  };

  const rpc = jest.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const h = rpcHandlers.get(fn);
    if (!h) return { data: null, error: { code: 'PGRST202', message: `no mock for ${fn}` } };
    const reply = await h(args);
    return { data: reply.data ?? null, error: reply.error ?? null };
  });

  const client = {
    rpc,
    auth,
    from: jest.fn((table: string) => createQuery(() => tables.get(table) ?? [], () => tableErrors.get(table))),
    channel: jest.fn((topic: string, opts?: unknown) => {
      const ch = createChannel(topic, opts);
      channels.push(ch);
      return ch;
    }),
    removeChannel: jest.fn(async (ch: MockChannel) => {
      ch.removed = true;
      ch.subscribed = false;
      return 'ok';
    }),
  };

  return {
    /** When false, `getSupabase()` returns null (accounts unavailable). */
    configured: true,
    client: client as unknown as TealSupabase,
    raw: client,
    channels,
    onRpc(fn: string, h: RpcHandler) {
      rpcHandlers.set(fn, h);
    },
    /** Make `fn` fail with a P0001 server error carrying `code`. */
    rpcError(fn: string, code: string) {
      rpcHandlers.set(fn, () => ({ error: { code: 'P0001', message: code, details: null, hint: null } }));
    },
    setTable(table: string, rows: unknown[], error?: unknown) {
      tables.set(table, rows);
      if (error) tableErrors.set(table, error);
      else tableErrors.delete(table);
    },
    setSession(session: MockSession | null) {
      state.session = session;
    },
    /** Deliver an auth event ('SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION', 'TOKEN_REFRESHED') to listeners. */
    emitAuth(event: string, session: MockSession | null) {
      state.session = session;
      authListeners.forEach((l) => l(event, session));
    },
    reset() {
      rpcHandlers.clear();
      tables.clear();
      tableErrors.clear();
      authListeners.clear();
      channels.splice(0);
      state.session = null;
      this.configured = true;
      rpc.mockClear();
      client.from.mockClear();
      client.channel.mockClear();
      client.removeChannel.mockClear();
      Object.values(auth).forEach((f) => f.mockClear());
    },
  };
}

export type MockSupabaseControl = ReturnType<typeof createMockSupabase>;

/** The shared instance used by `mockClientModule()`. */
export const mockSupabase: MockSupabaseControl = createMockSupabase();

/** Factory result for `jest.mock('@/backend/client', ...)`. */
export function mockClientModule() {
  return {
    __esModule: true,
    getSupabase: () => (mockSupabase.configured ? mockSupabase.client : null),
    startBackend: () => () => {},
  };
}

/** A signed-in session for a test user id. */
export const mockSession = (id: string): MockSession => ({ user: { id }, access_token: 'test-access-token' });
