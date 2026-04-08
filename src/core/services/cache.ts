/**
 * Simple in-memory TTL cache for service-layer data.
 *
 * Keys are network-scoped by convention (callers include network in the key).
 * Expired entries are lazily evicted on read.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Get a cached value. Returns `undefined` if missing or expired.
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/**
 * Set a cache value with a TTL in milliseconds.
 */
export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Invalidate a single cache key.
 */
export function cacheInvalidate(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all cache keys matching a prefix (e.g. "markets:" to clear all market caches).
 */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
