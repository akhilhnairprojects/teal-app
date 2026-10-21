/** Every RPC call goes through here: one place for "not configured", errors and offline mapping. */
import { getSupabase } from './client';
import { fail, ok, toBackendError, type Result } from './errors';

/** Call a Postgres function. The value is `unknown`; callers parse it with `./parse`. */
export async function rpc(fn: string, args?: Record<string, unknown>): Promise<Result<unknown>> {
  const sb = getSupabase();
  if (!sb) return fail('not_configured');
  try {
    const { data, error } = await sb.rpc(fn, args ?? {});
    if (error) return { ok: false, error: toBackendError(error) };
    return ok(data as unknown);
  } catch (e) {
    return { ok: false, error: toBackendError(e) };
  }
}

/** Map a successful Result through a parser; a value the parser rejects becomes `unknown`. */
export function mapResult<A, B>(r: Result<A>, f: (a: A) => B | null): Result<B> {
  if (!r.ok) return r;
  const v = f(r.value);
  return v === null ? fail('unknown') : ok(v);
}
