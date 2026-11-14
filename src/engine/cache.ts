interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
  updatedAt: number;
  byteSize: number;
  etag: string;
}

export interface CacheOptions<T> {
  defaultTtlMs?: number;
  defaultSwrMs?: number;
  maxEntries?: number;
  maxBytes?: number;
  sizeCalculator?: (value: T) => number;
}

export interface CacheStats {
  size: number;
  maxEntries: number;
  currentBytes: number;
  maxBytes?: number;
  hits: number;
  misses: number;
  staleServed: number;
  coalescedRequests: number;
  evictions: number;
  hitRate: number;
}

export class StreamCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private defaultTtlMs: number;
  private defaultSwrMs: number;
  private maxEntries: number;
  private maxBytes?: number;
  private sizeCalculator?: (value: T) => number;
  private currentBytes = 0;
  private versionCounter = 0;

  private hits = 0;
  private misses = 0;
  private staleServed = 0;
  private coalescedRequests = 0;
  private evictions = 0;

  constructor(
    defaultTtlMsOrOptions: number | CacheOptions<T> = 60000,
    maxEntries: number = 500
  ) {
    if (typeof defaultTtlMsOrOptions === "object") {
      this.defaultTtlMs = defaultTtlMsOrOptions.defaultTtlMs ?? 60000;
      this.defaultSwrMs = defaultTtlMsOrOptions.defaultSwrMs ?? 0;
      this.maxEntries = defaultTtlMsOrOptions.maxEntries ?? 500;
      this.maxBytes = defaultTtlMsOrOptions.maxBytes;
      this.sizeCalculator = defaultTtlMsOrOptions.sizeCalculator;
    } else {
      this.defaultTtlMs = defaultTtlMsOrOptions;
      this.defaultSwrMs = 0;
      this.maxEntries = maxEntries;
    }
  }

  set(key: string, value: T, ttlMs?: number, swrMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const swr = swrMs ?? this.defaultSwrMs;
    const itemBytes = this.sizeCalculator ? this.sizeCalculator(value) : 0;

    // If key already exists, deduct old bytes first
    const existing = this.store.get(key);
    if (existing) {
      this.currentBytes -= existing.byteSize;
    }

    // LRU count eviction
    while (this.store.size >= this.maxEntries && !this.store.has(key) && this.store.size > 0) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        const oldEntry = this.store.get(oldestKey);
        if (oldEntry) this.currentBytes -= oldEntry.byteSize;
        this.store.delete(oldestKey);
        this.evictions++;
      }
    }

    // LRU byte-size eviction
    if (this.maxBytes && this.maxBytes > 0) {
      while (this.currentBytes + itemBytes > this.maxBytes && this.store.size > 0) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey !== undefined) {
          const oldEntry = this.store.get(oldestKey);
          if (oldEntry) this.currentBytes -= oldEntry.byteSize;
          this.store.delete(oldestKey);
          this.evictions++;
        } else {
          break;
        }
      }
    }

    // Delete and re-set to mark as recently used
    this.store.delete(key);
    this.currentBytes += itemBytes;
    const now = Date.now();
    this.versionCounter = (this.versionCounter + 1) % 1_000_000;
    const etag = `W/"${key}-${now.toString(36)}-${this.versionCounter.toString(36)}"`;
    this.store.set(key, {
      value,
      expiresAt: now + ttl,
      staleUntil: now + ttl + swr,
      updatedAt: now,
      byteSize: itemBytes,
      etag,
    });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.misses++;
      return null;
    }

    // Refresh LRU order on access
    this.store.delete(key);
    this.store.set(key, entry);

    this.hits++;
    return entry.value;
  }

  getStale(key: string): T | null {
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  getEtag(key: string): string | null {
    const entry = this.store.get(key);
    return entry ? entry.etag : null;
  }

  /**
   * Singleflight request coalescing + optional Stale-While-Revalidate (SWR) to prevent cache stampedes.
   * If a fetch is already in flight for the given key, concurrent callers share the exact same promise.
   * If swrMs > 0 and the entry is between expiresAt and staleUntil, returns stale data in 0ms while refreshing in background.
   */
  async getOrFetch(key: string, fetcher: () => Promise<T>, ttlMs?: number, swrMs?: number): Promise<T> {
    const entry = this.store.get(key);
    const now = Date.now();

    if (entry && now <= entry.expiresAt) {
      this.store.delete(key);
      this.store.set(key, entry);
      this.hits++;
      return entry.value;
    }

    const effectiveSwr = swrMs ?? this.defaultSwrMs;
    const staleDeadline = entry ? Math.max(entry.staleUntil, entry.expiresAt + effectiveSwr) : 0;

    if (entry && effectiveSwr > 0 && now <= staleDeadline) {
      this.hits++;
      this.staleServed++;
      if (!this.inflight.has(key)) {
        const bgPromise = (async () => {
          try {
            const fresh = await fetcher();
            this.set(key, fresh, ttlMs, effectiveSwr);
            return fresh;
          } catch {
            return entry.value;
          } finally {
            this.inflight.delete(key);
          }
        })();
        this.inflight.set(key, bgPromise);
      }
      return entry.value;
    }

    this.misses++;
    const running = this.inflight.get(key);
    if (running) {
      this.coalescedRequests++;
      return running;
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        this.set(key, result, ttlMs, effectiveSwr);
        return result;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (entry) {
      this.currentBytes -= entry.byteSize;
      return this.store.delete(key);
    }
    return false;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
    this.currentBytes = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      currentBytes: this.currentBytes,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      staleServed: this.staleServed,
      coalescedRequests: this.coalescedRequests,
      evictions: this.evictions,
      hitRate: total > 0 ? Math.round((this.hits / total) * 10000) / 100 : 100,
    };
  }
}
