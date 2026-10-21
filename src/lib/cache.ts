import AsyncStorage from '@react-native-async-storage/async-storage';

/** What is stored under each cache key. `v` is the schema version of `value`. */
export type CacheEnvelope<T> = { v: number; fetchedAt: number; value: T };

export type CacheHit<T> = {
  value: T;
  fetchedAt: number;
  /** False when the entry is past its TTL or fails the caller's freshness check; callers may still render it. */
  fresh: boolean;
};

export type ReadOptions<T> = {
  /** Entries older than this are returned with `fresh: false`. Omit for no TTL. */
  ttlMs?: number;
  now?: number;
  /** Extra invalidation, e.g. "same service date". Returning false marks the entry stale. */
  isFresh?: (envelope: CacheEnvelope<T>) => boolean;
};

function isEnvelope(x: unknown): x is CacheEnvelope<unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as CacheEnvelope<unknown>).v === 'number' &&
    typeof (x as CacheEnvelope<unknown>).fetchedAt === 'number' &&
    'value' in x
  );
}

/**
 * Read a versioned envelope. A missing key, unreadable storage, corrupt JSON or a different
 * schema version all count as a miss (a version mismatch also deletes the old entry).
 */
export async function readCache<T>(key: string, version: number, opts: ReadOptions<T> = {}): Promise<CacheHit<T> | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isEnvelope(parsed)) return null;
  if (parsed.v !== version) {
    await removeCache(key);
    return null;
  }
  const envelope = parsed as CacheEnvelope<T>;
  const now = opts.now ?? Date.now();
  const withinTtl = opts.ttlMs == null || now - envelope.fetchedAt < opts.ttlMs;
  const fresh = withinTtl && (opts.isFresh ? opts.isFresh(envelope) : true);
  return { value: envelope.value, fetchedAt: envelope.fetchedAt, fresh };
}

/** Write a versioned envelope. Storage failures are swallowed; the cache is best-effort. */
export async function writeCache<T>(key: string, version: number, value: T, fetchedAt = Date.now()): Promise<void> {
  const envelope: CacheEnvelope<T> = { v: version, fetchedAt, value };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota or serialization failure: the app keeps working from the network.
  }
}

export async function removeCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Small, stable string hash (FNV-1a) for building cache keys from URLs. */
export function hashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
