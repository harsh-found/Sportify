interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  byteSize: number;
}

export interface CacheOptions<T> {
  defaultTtlMs?: number;
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
  evictions: number;
}

export class StreamCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private defaultTtlMs: number;
  private maxEntries: number;
  private maxBytes?: number;
  private sizeCalculator?: (value: T) => number;
  private currentBytes = 0;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    defaultTtlMsOrOptions: number | CacheOptions<T> = 60000,
    maxEntries: number = 500
  ) {
    if (typeof defaultTtlMsOrOptions === "object") {
      this.defaultTtlMs = defaultTtlMsOrOptions.defaultTtlMs ?? 60000;
      this.maxEntries = defaultTtlMsOrOptions.maxEntries ?? 500;
      this.maxBytes = defaultTtlMsOrOptions.maxBytes;
      this.sizeCalculator = defaultTtlMsOrOptions.sizeCalculator;
    } else {
      this.defaultTtlMs = defaultTtlMsOrOptions;
      this.maxEntries = maxEntries;
    }
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
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
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      byteSize: itemBytes,
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

  /**
   * Singleflight request coalescing to prevent cache stampedes.
   * If a fetch is already in flight for the given key, concurrent callers share the exact same promise.
   */
  async getOrFetch(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const running = this.inflight.get(key);
    if (running) {
      return running;
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        this.set(key, result, ttlMs);
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
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      currentBytes: this.currentBytes,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}
