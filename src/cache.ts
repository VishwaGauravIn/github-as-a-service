// ─── In-Memory Cache ────────────────────────────────────────────────────────
//
// Read-through / write-through cache that stores file content + SHA.
// Tracks GitHub SHAs so we know if a cached entry is stale.

import type { CacheEntry } from './types.js';

const DEFAULT_TTL = 60_000; // 1 minute

export class Cache {
  private store: Map<string, CacheEntry> = new Map();
  private defaultTtl: number;

  constructor(ttlMs: number = DEFAULT_TTL) {
    this.defaultTtl = ttlMs;
  }

  /**
   * Get a cached entry if it exists and is not expired.
   */
  get<T = unknown>(key: string): (CacheEntry<T> & { fresh: boolean }) | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    const fresh = now - entry.timestamp < entry.ttl;
    return { ...entry, fresh };
  }

  /**
   * Set a cache entry with an associated SHA.
   */
  set<T = unknown>(key: string, data: T, sha: string, ttlMs?: number): void {
    this.store.set(key, {
      data,
      sha,
      timestamp: Date.now(),
      ttl: ttlMs ?? this.defaultTtl,
    });
  }

  /**
   * Invalidate a specific cache key.
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate all cache keys matching a prefix.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the SHA for a cached file (used for optimistic locking).
   */
  getSha(key: string): string | null {
    const entry = this.store.get(key);
    return entry ? entry.sha : null;
  }

  /**
   * Get stats about the cache.
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
}
