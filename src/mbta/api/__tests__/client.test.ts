import { v3Alerts, v3Predictions } from '@/mbta/testing/v3Fixtures';

import { buildQuery, HAS_API_KEY, mbtaBudget, mbtaGet, relId, relIds } from '../client';
import { fetchAlert, fetchAlerts, fetchPredictionsForStops, fetchSchedulesWindow } from '../endpoints';

type MockInit = { status?: number; body?: unknown; headers?: Record<string, string> };
function response({ status = 200, body = { data: [] }, headers = {} }: MockInit) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
    json: async () => body,
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  mbtaBudget.reset();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterAll(() => mbtaBudget.reset());

describe('MBTA client', () => {
  it('builds sorted, encoded queries with comma-joined lists', () => {
    expect(buildQuery({ 'filter[stop]': ['place-pktrm', '70075'], include: 'trip', skip: undefined })).toBe(
      '?filter%5Bstop%5D=place-pktrm,70075&include=trip',
    );
    expect(buildQuery({})).toBe('');
  });

  it('runs without an API key in tests and sends no x-api-key header', async () => {
    expect(HAS_API_KEY).toBe(false);
    fetchMock.mockResolvedValueOnce(response({ body: v3Alerts, headers: { 'x-ratelimit-remaining': '18', 'x-ratelimit-reset': '2000000000' } }));
    const alerts = await fetchAlerts();
    expect(alerts.map((a) => a.id)).toEqual(['1037420']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api-v3.mbta.com/alerts?filter%5Broute_type%5D=0,1');
    expect(init.headers['x-api-key']).toBeUndefined();
    expect(mbtaBudget.getSnapshot()).toEqual({ limited: false, resetAt: 2_000_000_000_000, remaining: 18 });
  });

  it('accepts parent stations in filter[stop] and parses predictions', async () => {
    fetchMock.mockResolvedValueOnce(response({ body: v3Predictions }));
    const live = await fetchPredictionsForStops(['place-pktrm'], { routeIds: ['Red'], directionId: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api-v3.mbta.com/predictions?filter%5Bdirection_id%5D=0&filter%5Broute%5D=Red&filter%5Broute_type%5D=0,1&filter%5Bstop%5D=place-pktrm&include=trip%2Cvehicle',
    );
    expect(live.predictions).toHaveLength(2);
    expect(Object.keys(live.vehicles)).toEqual(['R-548C2B19', 'R-ADDED1']);
  });

  it('passes min_time/max_time past 24:00 through untouched', async () => {
    fetchMock.mockResolvedValueOnce(response({}));
    await fetchSchedulesWindow({ stopIds: ['place-dwnxg', 'place-harsq'], routeIds: ['Red'], directionId: 1, date: '2026-10-18', minTime: '24:30', maxTime: '25:15' });
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('filter%5Bmin_time%5D=24%3A30');
    expect(url).toContain('filter%5Bmax_time%5D=25%3A15');
    expect(url).toContain('filter%5Bdate%5D=2026-10-18');
  });

  it('turns a 429 into rateLimited and blocks further calls until reset', async () => {
    const reset = Math.floor(Date.now() / 1000) + 40;
    fetchMock.mockResolvedValueOnce(response({ status: 429, headers: { 'x-ratelimit-reset': String(reset), 'x-ratelimit-remaining': '0' } }));
    await expect(mbtaGet('/alerts')).rejects.toMatchObject({ detail: { kind: 'rateLimited', resetAt: reset * 1000 } });
    expect(mbtaBudget.getSnapshot()).toMatchObject({ limited: true, resetAt: reset * 1000 });
    await expect(mbtaGet('/predictions')).rejects.toMatchObject({ detail: { kind: 'rateLimited' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP, network and parse failures to error details', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 503 }));
    await expect(mbtaGet('/alerts')).rejects.toMatchObject({ detail: { kind: 'http', status: 503 } });
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(mbtaGet('/alerts?x')).rejects.toMatchObject({ detail: { kind: 'network', message: 'Network request failed' } });
    fetchMock.mockResolvedValueOnce({ ...response({}), json: async () => ({ nope: true }) });
    await expect(mbtaGet('/alerts?y')).rejects.toMatchObject({ detail: { kind: 'parse' } });
  });

  it('returns null for an expired alert (404)', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 404 }));
    await expect(fetchAlert('gone')).resolves.toBeNull();
  });

  it('dedupes identical in-flight URLs into one fetch', async () => {
    fetchMock.mockResolvedValue(response({ body: v3Alerts }));
    const [a, b] = await Promise.all([fetchAlerts(), fetchAlerts({ priority: 'background' })]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads relationship ids', () => {
    const r = { type: 'trip', id: 't', attributes: {}, relationships: { route: { data: { type: 'route', id: 'Red' } }, stops: { data: [{ type: 'stop', id: 'a' }, { type: 'stop', id: 'b' }] } } };
    expect(relId(r, 'route')).toBe('Red');
    expect(relId(r, 'stops')).toBeNull();
    expect(relIds(r, 'stops')).toEqual(['a', 'b']);
    expect(relIds(r, 'missing')).toEqual([]);
  });
});
