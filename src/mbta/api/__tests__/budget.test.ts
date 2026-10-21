import { parseRateHeaders, RequestBudget } from '../budget';
import { MbtaApiError } from '../errors';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

describe('RequestBudget', () => {
  let now = 1_000_000;
  const clock = () => now;

  // Every budget is reset after its test so its window timer (up to a minute, real time) cannot
  // keep the worker alive.
  const budgets: RequestBudget[] = [];
  const make = (o: ConstructorParameters<typeof RequestBudget>[0]) => {
    const b = new RequestBudget(o);
    budgets.push(b);
    return b;
  };

  beforeEach(() => {
    now = 1_000_000;
  });
  afterEach(() => budgets.splice(0).forEach((b) => b.reset()));

  it('shares one fetch between duplicate keys', async () => {
    const budget = make({ limit: 20, now: clock });
    const d = deferred<string>();
    const task = jest.fn(() => d.promise);
    const a = budget.run('https://x/predictions?a', 'foreground', task);
    const b = budget.run('https://x/predictions?a', 'background', task);
    expect(task).toHaveBeenCalledTimes(1);
    d.resolve('data');
    await expect(a).resolves.toBe('data');
    await expect(b).resolves.toBe('data');
    // Once settled, the same key fetches again.
    budget.run('https://x/predictions?a', 'foreground', async () => 'again');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defers background and static requests when remaining ≤ 3, but runs foreground', async () => {
    jest.useFakeTimers();
    try {
      const budget = make({ limit: 20, now: clock });
      budget.observe({ limit: 20, remaining: 3, resetAt: now + 30_000 });
      const background = jest.fn(async () => 'bg');
      const foreground = jest.fn(async () => 'fg');
      const bgPromise = budget.run('bg', 'background', background);
      budget.run('static', 'static', async () => 's');
      await expect(budget.run('fg', 'foreground', foreground)).resolves.toBe('fg');
      expect(background).not.toHaveBeenCalled();
      expect(budget.queuedCount).toBe(2);

      // After the window resets the deferred work runs.
      now += 31_000;
      jest.advanceTimersByTime(31_000);
      await expect(bgPromise).resolves.toBe('bg');
      expect(background).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('429 marks the limiter as limited until reset and rejects queued requests', async () => {
    const budget = make({ limit: 20, now: clock, maxConcurrent: 1 });
    const first = deferred<string>();
    const running = budget.run('a', 'foreground', () => first.promise);
    const queued = budget.run('b', 'background', async () => 'never');
    const resetAt = now + 45_000;
    budget.markRateLimited(resetAt);
    await expect(queued).rejects.toEqual(new MbtaApiError({ kind: 'rateLimited', resetAt }));
    expect(budget.getSnapshot()).toEqual({ limited: true, resetAt, remaining: 0 });

    // New requests fail fast while limited, without running the task.
    const task = jest.fn(async () => 'x');
    await expect(budget.run('c', 'foreground', task)).rejects.toMatchObject({ detail: { kind: 'rateLimited', resetAt } });
    expect(task).not.toHaveBeenCalled();

    first.resolve('done');
    await expect(running).resolves.toBe('done');

    now = resetAt + 1;
    await expect(budget.run('c', 'foreground', task)).resolves.toBe('x');
    expect(budget.getSnapshot().limited).toBe(false);
  });

  it('defaults the 429 block to one window when the reset header is missing', () => {
    const budget = make({ limit: 20, now: clock });
    budget.markRateLimited(null);
    expect(budget.getSnapshot()).toMatchObject({ limited: true, resetAt: now + 60_000 });
  });

  it('counts locally before any headers and stops at zero', async () => {
    const budget = make({ limit: 2, now: clock, reserve: 0 });
    await budget.run('1', 'foreground', async () => 1);
    await budget.run('2', 'foreground', async () => 2);
    const third = jest.fn(async () => 3);
    void budget.run('3', 'foreground', third);
    await flush();
    expect(third).not.toHaveBeenCalled();
    expect(budget.getSnapshot().remaining).toBe(0);
  });

  it('prioritises foreground over background in the queue', async () => {
    const budget = make({ limit: 20, now: clock, maxConcurrent: 1 });
    const gate = deferred<void>();
    const order: string[] = [];
    void budget.run('gate', 'foreground', () => gate.promise);
    const bg = budget.run('bg', 'background', async () => order.push('bg'));
    const fg = budget.run('fg', 'foreground', async () => order.push('fg'));
    gate.resolve();
    await Promise.all([bg, fg]);
    expect(order).toEqual(['fg', 'bg']);
  });

  it('aborting one caller does not cancel the shared request for others', async () => {
    const budget = make({ limit: 20, now: clock });
    const d = deferred<string>();
    let taskSignal: AbortSignal | null = null;
    const task = (s: AbortSignal) => {
      taskSignal = s;
      return d.promise;
    };
    const c1 = new AbortController();
    const p1 = budget.run('k', 'foreground', task, c1.signal);
    const p2 = budget.run('k', 'foreground', task);
    c1.abort();
    await expect(p1).rejects.toMatchObject({ detail: { kind: 'aborted' } });
    expect(taskSignal!.aborted).toBe(false);
    d.resolve('ok');
    await expect(p2).resolves.toBe('ok');
  });

  it('parses x-ratelimit headers (reset is epoch seconds)', () => {
    const h: Record<string, string> = { 'x-ratelimit-limit': '20', 'x-ratelimit-remaining': '17', 'x-ratelimit-reset': '1792386720' };
    expect(parseRateHeaders((n) => h[n] ?? null)).toEqual({ limit: 20, remaining: 17, resetAt: 1792386720_000 });
    expect(parseRateHeaders(() => null)).toEqual({ limit: null, remaining: null, resetAt: null });
  });
});
