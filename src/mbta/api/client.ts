import { useSyncExternalStore } from 'react';

import { parseRateHeaders, RequestBudget, type RequestPriority } from './budget';
import { KEYED_LIMIT, KEYLESS_LIMIT, MBTA_API_KEY, MBTA_BASE_URL } from './config';
import { MbtaApiError, type MbtaErrorDetail } from './errors';

export { MbtaApiError };
export type { MbtaErrorDetail, RequestPriority };

export type ResourceIdentifier = { type: string; id: string };
export type Relationship = { data: ResourceIdentifier | ResourceIdentifier[] | null };
export type Resource<A = Record<string, unknown>> = {
  type: string;
  id: string;
  attributes: A;
  relationships?: Record<string, Relationship>;
};
export type JsonApiDocument<A> = { data: Resource<A>[] | Resource<A>; included?: Resource[] };
/** e.g. `{ 'filter[stop]': ['place-pktrm', '70075'], include: 'trip' }`; arrays are comma-joined. */
export type MbtaQuery = Record<string, string | number | readonly (string | number)[] | undefined>;
export type IncludedIndex = { get(type: string, id: string): Resource | undefined };
export type MbtaResponse<A> = { doc: JsonApiDocument<A>; included: IncludedIndex; lastModified: string | null };

export const HAS_API_KEY: boolean = MBTA_API_KEY !== null;

/** The app-wide request budget. Exported for tests and for the live hooks. */
export const mbtaBudget = new RequestBudget({ limit: HAS_API_KEY ? KEYED_LIMIT : KEYLESS_LIMIT });

/** Build a query string; keys and values are percent-encoded, list values joined with commas. */
export function buildQuery(query: MbtaQuery | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined) continue;
    const list = Array.isArray(value) ? value : [value as string | number];
    parts.push(`${encodeURIComponent(key)}=${list.map((v) => encodeURIComponent(String(v))).join(',')}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export function mbtaUrl(path: string, query?: MbtaQuery): string {
  return `${MBTA_BASE_URL}${path.startsWith('/') ? path : `/${path}`}${buildQuery(query)}`;
}

export function indexIncluded(included: Resource[] | undefined): IncludedIndex {
  const map = new Map<string, Resource>();
  for (const r of included ?? []) map.set(`${r.type}:${r.id}`, r);
  return { get: (type, id) => map.get(`${type}:${id}`) };
}

function isDocument(x: unknown): x is JsonApiDocument<unknown> {
  return typeof x === 'object' && x !== null && 'data' in x;
}

/**
 * GET a V3 JSON:API document through the request budget. Throws `MbtaApiError`.
 * A 304 (with `ifModifiedSince`) resolves to an empty document with `lastModified` preserved;
 * callers that send `ifModifiedSince` must treat `doc.data` of `[]` plus the same
 * `lastModified` as "unchanged".
 */
export function mbtaGet<A = Record<string, unknown>>(
  path: string,
  query?: MbtaQuery,
  opts: { signal?: AbortSignal; priority?: RequestPriority; ifModifiedSince?: string } = {},
): Promise<MbtaResponse<A>> {
  const url = mbtaUrl(path, query);
  const key = opts.ifModifiedSince ? `${url}#ims=${opts.ifModifiedSince}` : url;
  return mbtaBudget.run(
    key,
    opts.priority ?? 'foreground',
    async (signal) => {
      const headers: Record<string, string> = { accept: 'application/vnd.api+json' };
      if (MBTA_API_KEY) headers['x-api-key'] = MBTA_API_KEY;
      if (opts.ifModifiedSince) headers['if-modified-since'] = opts.ifModifiedSince;

      let res: Response;
      try {
        res = await fetch(url, { headers, signal });
      } catch (e) {
        if (signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
          throw new MbtaApiError({ kind: 'aborted' });
        }
        throw new MbtaApiError({ kind: 'network', message: e instanceof Error ? e.message : String(e) });
      }

      const get = (name: string) => res.headers?.get?.(name) ?? null;
      const rate = parseRateHeaders(get);
      mbtaBudget.observe(rate);

      if (res.status === 429) {
        mbtaBudget.markRateLimited(rate.resetAt);
        throw new MbtaApiError({ kind: 'rateLimited', resetAt: mbtaBudget.getSnapshot().resetAt ?? Date.now() + 60_000 });
      }
      const lastModified = get('last-modified');
      if (res.status === 304) {
        return { doc: { data: [] }, included: indexIncluded(undefined), lastModified: lastModified ?? opts.ifModifiedSince ?? null };
      }
      if (!res.ok) throw new MbtaApiError({ kind: 'http', status: res.status });

      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        throw new MbtaApiError({ kind: 'parse', message: e instanceof Error ? e.message : 'invalid JSON' });
      }
      if (!isDocument(json)) throw new MbtaApiError({ kind: 'parse', message: 'missing data' });
      const doc = json as JsonApiDocument<A>;
      return { doc, included: indexIncluded(doc.included), lastModified };
    },
    opts.signal,
  );
}

/** The single related id of a to-one relationship, or null. */
export function relId(r: Resource, name: string): string | null {
  const data = r.relationships?.[name]?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id;
}

/** The related ids of a to-many relationship (or the one id of a to-one), in order. */
export function relIds(r: Resource, name: string): string[] {
  const data = r.relationships?.[name]?.data;
  if (!data) return [];
  return Array.isArray(data) ? data.map((d) => d.id) : [data.id];
}

/** Resources of a document as a list, whether `data` is one resource or many. */
export function dataList<A>(doc: JsonApiDocument<A>): Resource<A>[] {
  return Array.isArray(doc.data) ? doc.data : [doc.data];
}

export function useRateLimitState(): { limited: boolean; resetAt: number | null; remaining: number | null } {
  return useSyncExternalStore(mbtaBudget.subscribe, mbtaBudget.getSnapshot, mbtaBudget.getSnapshot);
}
