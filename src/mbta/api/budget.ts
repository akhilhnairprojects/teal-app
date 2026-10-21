import { MAX_CONCURRENT, RATE_WINDOW_MS, RESERVE_REQUESTS } from './config';
import { MbtaApiError } from './errors';

export type RequestPriority = 'foreground' | 'background' | 'static';

export type RateLimitSnapshot = { limited: boolean; resetAt: number | null; remaining: number | null };

/** Rate-limit headers as numbers; `resetAt` is epoch ms. */
export type RateHeaders = { limit: number | null; remaining: number | null; resetAt: number | null };

const PRIORITY_RANK: Record<RequestPriority, number> = { foreground: 0, background: 1, static: 2 };

type Waiter<T> = {
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type Job = {
  key: string;
  priority: RequestPriority;
  seq: number;
  task: (signal: AbortSignal) => Promise<unknown>;
  waiters: Waiter<unknown>[];
  controller: AbortController;
  started: boolean;
};

export type BudgetOptions = {
  /** Requests per window before the server says otherwise (20 keyless, 1000 keyed). */
  limit: number;
  now?: () => number;
  maxConcurrent?: number;
  reserve?: number;
};

/**
 * Client-side request scheduler for the MBTA API: one priority queue, in-flight de-duplication
 * by key (URL), and a token bucket seeded from `x-ratelimit-*` headers. When few requests remain
 * only foreground work runs; after a 429 everything is rejected until the window resets.
 */
export class RequestBudget {
  private readonly limit: number;
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly reserve: number;

  private queue: Job[] = [];
  private inFlight = new Map<string, Job>();
  private running = 0;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private remaining: number | null = null;
  private resetAt: number | null = null;
  private limitedUntil: number | null = null;

  private listeners = new Set<() => void>();
  private snapshot: RateLimitSnapshot = { limited: false, resetAt: null, remaining: null };

  constructor(opts: BudgetOptions) {
    this.limit = opts.limit;
    this.now = opts.now ?? Date.now;
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT;
    this.reserve = opts.reserve ?? RESERVE_REQUESTS;
  }

  // --- external store -------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RateLimitSnapshot => this.snapshot;

  private publish() {
    const limited = this.isLimited();
    const next: RateLimitSnapshot = {
      limited,
      resetAt: limited ? this.limitedUntil : this.resetAt,
      remaining: this.remaining,
    };
    const prev = this.snapshot;
    if (prev.limited === next.limited && prev.resetAt === next.resetAt && prev.remaining === next.remaining) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  // --- accounting -----------------------------------------------------------------------

  private rollWindow() {
    const now = this.now();
    if (this.limitedUntil !== null && now >= this.limitedUntil) this.limitedUntil = null;
    if (this.resetAt !== null && now >= this.resetAt) {
      this.resetAt = null;
      this.remaining = null;
    }
  }

  isLimited(): boolean {
    return this.limitedUntil !== null && this.now() < this.limitedUntil;
  }

  /** Record `x-ratelimit-*` headers from a response. */
  observe(h: RateHeaders) {
    if (h.resetAt !== null) this.resetAt = h.resetAt;
    if (h.remaining !== null) this.remaining = h.remaining;
    this.publish();
  }

  /** A 429 arrived: block until reset (or one window from now) and reject everything queued. */
  markRateLimited(resetAt: number | null) {
    const until = resetAt !== null && resetAt > this.now() ? resetAt : this.now() + RATE_WINDOW_MS;
    this.limitedUntil = until;
    this.resetAt = until;
    this.remaining = 0;
    const error = new MbtaApiError({ kind: 'rateLimited', resetAt: until });
    const queued = this.queue;
    this.queue = [];
    for (const job of queued) this.settle(job, error, false);
    this.publish();
    this.armTimer();
  }

  private consumeToken() {
    if (this.remaining === null) {
      // No headers seen this window yet: count locally from the default limit.
      this.remaining = this.limit;
      this.resetAt ??= this.now() + RATE_WINDOW_MS;
    }
    this.remaining = Math.max(0, this.remaining - 1);
  }

  // --- scheduling -----------------------------------------------------------------------

  /**
   * Run `task` under the budget. Calls with the same key while one is queued or in flight share
   * its result. Each caller's `signal` only detaches that caller; the shared request is aborted
   * once no caller is waiting.
   */
  run<T>(key: string, priority: RequestPriority, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.rollWindow();
    if (signal?.aborted) return Promise.reject(new MbtaApiError({ kind: 'aborted' }));
    if (this.isLimited()) {
      return Promise.reject(new MbtaApiError({ kind: 'rateLimited', resetAt: this.limitedUntil! }));
    }

    let job = this.inFlight.get(key);
    if (!job) {
      job = {
        key,
        priority,
        seq: this.seq++,
        task,
        waiters: [],
        controller: new AbortController(),
        started: false,
      };
      this.inFlight.set(key, job);
      this.queue.push(job);
    } else if (!job.started && PRIORITY_RANK[priority] < PRIORITY_RANK[job.priority]) {
      job.priority = priority;
    }

    const promise = new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => this.detach(job!, waiter as Waiter<unknown>);
        signal.addEventListener('abort', waiter.onAbort);
      }
      job!.waiters.push(waiter as Waiter<unknown>);
    });
    this.pump();
    return promise;
  }

  private detach(job: Job, waiter: Waiter<unknown>) {
    job.waiters = job.waiters.filter((w) => w !== waiter);
    waiter.reject(new MbtaApiError({ kind: 'aborted' }));
    if (job.waiters.length > 0) return;
    if (!job.started) {
      this.queue = this.queue.filter((j) => j !== job);
      this.inFlight.delete(job.key);
    } else {
      job.controller.abort();
    }
  }

  private settle(job: Job, result: unknown, ok: boolean) {
    if (this.inFlight.get(job.key) === job) this.inFlight.delete(job.key);
    for (const w of job.waiters) {
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      if (ok) w.resolve(result);
      else w.reject(result);
    }
    job.waiters = [];
  }

  private canDispatch(job: Job): boolean {
    if (this.remaining === null) return true;
    if (this.remaining <= 0) return false;
    if (this.remaining <= this.reserve && job.priority !== 'foreground') return false;
    return true;
  }

  private pump() {
    this.rollWindow();
    if (this.isLimited()) return;
    this.queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.seq - b.seq);
    let deferred = false;
    for (const job of [...this.queue]) {
      if (this.running >= this.maxConcurrent) break;
      if (!this.canDispatch(job)) {
        deferred = true;
        continue;
      }
      this.queue = this.queue.filter((j) => j !== job);
      this.start(job);
    }
    if (deferred) this.armTimer();
    this.publish();
  }

  private start(job: Job) {
    job.started = true;
    this.running++;
    this.consumeToken();
    job
      .task(job.controller.signal)
      .then(
        (value) => this.settle(job, value, true),
        (error) => this.settle(job, error, false),
      )
      .finally(() => {
        this.running--;
        this.pump();
      });
  }

  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    const at = this.limitedUntil ?? this.resetAt;
    if (at === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.rollWindow();
      this.publish();
      this.pump();
    }, Math.max(0, at - this.now()) + 50);
  }

  /** Number of queued (not started) jobs; for tests and diagnostics. */
  get queuedCount(): number {
    return this.queue.length;
  }

  /** Test helper: drop all state. */
  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.inFlight.clear();
    this.running = 0;
    this.remaining = null;
    this.resetAt = null;
    this.limitedUntil = null;
    this.publish();
  }
}

/** Parse `x-ratelimit-*` headers; `x-ratelimit-reset` is epoch seconds. */
export function parseRateHeaders(get: (name: string) => string | null): RateHeaders {
  const num = (name: string) => {
    const raw = get(name);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const reset = num('x-ratelimit-reset');
  return {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    resetAt: reset === null ? null : reset * 1000,
  };
}
