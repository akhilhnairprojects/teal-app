import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';

import { MbtaApiError } from '@/mbta/api/errors';

import { clearPollCache, POLL, usePolling, type Polled } from '../usePolling';

function Probe({ k, fetcher, onRender, intervalMs = 1_000 }: { k: string | null; fetcher: (s: AbortSignal) => Promise<number>; onRender: (p: Polled<number>) => void; intervalMs?: number }) {
  const p = usePolling(k, fetcher, { intervalMs });
  onRender(p);
  return <Text>{String(p.data)}</Text>;
}

describe('usePolling', () => {
  const mounted: ReturnType<typeof create>[] = [];
  async function mount(el: React.ReactElement) {
    let r!: ReturnType<typeof create>;
    await act(async () => {
      r = create(el);
    });
    mounted.push(r);
    return r;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    clearPollCache();
  });
  afterEach(() => {
    act(() => mounted.splice(0).forEach((r) => r.unmount()));
    jest.useRealTimers();
  });

  it('fetches immediately, polls on the interval, keeps data on error and works outside a navigator', async () => {
    let n = 0;
    const fetcher = jest.fn(async () => {
      n++;
      if (n === 3) throw new MbtaApiError({ kind: 'rateLimited', resetAt: 123 });
      return n;
    });
    let last!: Polled<number>;
    await mount(<Probe k="a" fetcher={fetcher} onRender={(p) => (last = p)} />);
    expect(last.data).toBe(1);
    expect(last.updatedAt).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(last.data).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(last.data).toBe(2);
    expect(last.error).toEqual({ kind: 'rateLimited', resetAt: 123 });
    expect(last.stale).toBe(false);
  });

  it('does nothing for a null key and resets data on key change', async () => {
    const fetcher = jest.fn(async () => 7);
    let last!: Polled<number>;
    let r!: ReturnType<typeof create>;
    await act(async () => {
      r = create(<Probe k={null} fetcher={fetcher} onRender={(p) => (last = p)} />);
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(last.data).toBeNull();
    await act(async () => {
      r.update(<Probe k="b" fetcher={fetcher} onRender={(p) => (last = p)} />);
    });
    expect(last.data).toBe(7);
    const slow = jest.fn(() => new Promise<number>(() => {}));
    await act(async () => {
      r.update(<Probe k="c" fetcher={slow} onRender={(p) => (last = p)} />);
    });
    expect(last.data).toBeNull();
    act(() => r.unmount());
  });

  it('a remount within the interval shows the last data at once and waits out the interval', async () => {
    let n = 0;
    const fetcher = jest.fn(async () => ++n);
    let last!: Polled<number>;
    const first = await mount(<Probe k="tab" fetcher={fetcher} onRender={(p) => (last = p)} intervalMs={30_000} />);
    expect(last.data).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    act(() => first.unmount()); // tab switch

    await mount(<Probe k="tab" fetcher={fetcher} onRender={(p) => (last = p)} intervalMs={30_000} />);
    expect(fetcher).toHaveBeenCalledTimes(1); // no request spent on the remount
    expect(last.data).toBe(1);
    expect(last.updatedAt).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(19_999);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(last.data).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('a remount after the interval refetches at once but keeps showing the last data meanwhile', async () => {
    const fetcher = jest.fn(async () => 1);
    let last!: Polled<number>;
    const first = await mount(<Probe k="old" fetcher={fetcher} onRender={(p) => (last = p)} intervalMs={1_000} />);
    act(() => first.unmount());
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    let resolve!: (n: number) => void;
    const slow = jest.fn(() => new Promise<number>((res) => (resolve = res)));
    await mount(<Probe k="old" fetcher={slow} onRender={(p) => (last = p)} intervalMs={1_000} />);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(last.data).toBe(1);
    expect(last.refreshing).toBe(true);
    await act(async () => resolve(9));
    expect(last.data).toBe(9);
    expect(last.refreshing).toBe(false);
  });

  it('a key change shows the cached data of that key', async () => {
    let last!: Polled<number>;
    const r = await mount(<Probe k="x" fetcher={async () => 1} onRender={(p) => (last = p)} intervalMs={60_000} />);
    await act(async () => {
      r.update(<Probe k="y" fetcher={async () => 2} onRender={(p) => (last = p)} intervalMs={60_000} />);
    });
    expect(last.data).toBe(2);
    const never = jest.fn(() => new Promise<number>(() => {}));
    await act(async () => {
      r.update(<Probe k="x" fetcher={never} onRender={(p) => (last = p)} intervalMs={60_000} />);
    });
    expect(last.data).toBe(1);
    expect(never).not.toHaveBeenCalled();
  });

  it('uses slower keyless intervals', () => {
    expect(POLL).toEqual({ stopPredictionsMs: 30_000, alertsMs: 120_000, vehiclesMs: 30_000, tripMs: 30_000, planMs: 60_000 });
  });
});
