/**
 * In-Memory Cache Utility
 *
 * Provides a simple TTL-based caching mechanism for frequently accessed data.
 * Useful for caching dashboard stats, configuration, and other read-heavy data.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheOptions {
  /** Default TTL in milliseconds */
  defaultTtlMs?: number;
  /** Maximum number of entries to store */
  maxEntries?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  hitRate: number;
}

export class MemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTtlMs: number;
  private maxEntries: number;
  private debug: boolean;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs || 5000; // 5 seconds default
    this.maxEntries = options.maxEntries || 1000;
    this.debug = options.debug || false;
  }

  /**
   * Get a value from the cache
   * @returns The cached value or undefined if not found/expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.misses++;
      this.log(`MISS: ${key}`);
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      this.log(`EXPIRED: ${key}`);
      return undefined;
    }

    this.hits++;
    this.log(`HIT: ${key}`);
    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional TTL in milliseconds (overrides default)
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    // Enforce max entries limit with LRU-like eviction
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + (ttlMs || this.defaultTtlMs),
    };

    this.cache.set(key, entry);
    this.log(`SET: ${key} (TTL: ${ttlMs || this.defaultTtlMs}ms)`);
  }

  /**
   * Get a value from cache, or compute and cache it if not found
   * @param key Cache key
   * @param computeFn Function to compute the value if not cached
   * @param ttlMs Optional TTL in milliseconds
   */
  async getOrSet<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await computeFn();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Synchronous version of getOrSet
   */
  getOrSetSync<T>(key: string, computeFn: () => T, ttlMs?: number): T {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = computeFn();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.log(`DELETE: ${key}`);
    }
    return deleted;
  }

  /**
   * Delete all keys matching a pattern (prefix match)
   */
  deletePattern(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.log(`DELETE PATTERN: ${pattern} (${count} keys)`);
    return count;
  }

  /**
   * Invalidate cache entries based on a predicate function
   */
  invalidateWhere(predicate: (key: string, entry: CacheEntry<unknown>) => boolean): number {
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (predicate(key, entry)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.log(`CLEAR: ${size} entries removed`);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get remaining TTL for a key in milliseconds
   */
  getTtl(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : null;
  }

  /**
   * Evict oldest entries to make room for new ones
   */
  private evictOldest(): void {
    // Find and remove the oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.log(`EVICT: ${oldestKey} (oldest entry)`);
    }
  }

  /**
   * Cleanup expired entries (call periodically to prevent memory bloat)
   */
  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }

    this.log(`CLEANUP: ${count} expired entries removed`);
    return count;
  }

  /**
   * Start automatic cleanup at a specified interval
   */
  startAutoCleanup(intervalMs = 60000): NodeJS.Timeout {
    return setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[Cache] ${message}`);
    }
  }
}

// Singleton instance for global cache
let globalCache: MemoryCache | null = null;

/**
 * Get the global cache instance
 */
export function getCache(options?: CacheOptions): MemoryCache {
  if (!globalCache) {
    globalCache = new MemoryCache(options);
  }
  return globalCache;
}

/**
 * Create a new cache instance (for isolated caching)
 */
export function createCache(options?: CacheOptions): MemoryCache {
  return new MemoryCache(options);
}

// Cache key generators for common patterns
export const CacheKeys = {
  dashboardStats: () => 'dashboard:stats',
  projectStats: (projectId: string) => `project:${projectId}:stats`,
  projectTimeline: (projectId: string, limit?: number) =>
    `project:${projectId}:timeline:${limit || 'all'}`,
  agentStats: (agentId: string) => `agent:${agentId}:stats`,
  promptList: (agentType: string) => `prompts:${agentType}:list`,
  promptStats: (agentType: string) => `prompts:${agentType}:stats`,
};
