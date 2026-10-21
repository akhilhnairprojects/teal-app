/**
 * Total parsers for RPC output (spec §4 parsing rule). Input is `unknown`; a field of the wrong type
 * makes its row parse to null, and list parsers drop such rows instead of casting them.
 */

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
export const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** Postgres bigint and numeric may arrive as strings; accept finite numeric strings too. */
export function numeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** 'YYYY-MM-DD' (Postgres date). */
export const isoDay = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** A timestamptz string that Date can parse, kept as the original string. */
export const timestamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null);

/** `undefined`/`null` → null (present and valid → the value; present and invalid → undefined, i.e. reject). */
export function nullable<T>(v: unknown, p: (v: unknown) => T | null): T | null | undefined {
  if (v === null || v === undefined) return null;
  const out = p(v);
  return out === null ? undefined : out;
}

/** One of a fixed set of string literals. */
export function oneOf<T extends string>(values: readonly T[]): (v: unknown) => T | null {
  return (v) => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null);
}

/** Parse each element, dropping the ones that fail. A non-array is null. */
export function listOf<T>(v: unknown, p: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const row of v) {
    const parsed = p(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** An array of strings (other elements dropped). */
export const strings = (v: unknown): string[] | null => listOf(v, str);
