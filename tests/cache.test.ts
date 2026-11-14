import { describe, expect, it } from "bun:test";
import { StreamCache } from "../src/engine/cache";

describe("StreamCache", () => {
  it("caches values and obeys TTL expiration", async () => {
    const cache = new StreamCache<string>(50); // 50ms TTL
    cache.set("key1", "val1");
    expect(cache.get("key1")).toBe("val1");

    await new Promise((r) => setTimeout(r, 65));
    expect(cache.get("key1")).toBeNull();
  });

  it("returns stale value when requested if allowStale is true", async () => {
    const cache = new StreamCache<string>(30);
    cache.set("key1", "val1");

    await new Promise((r) => setTimeout(r, 45));
    expect(cache.get("key1")).toBeNull();
    expect(cache.getStale("key1")).toBe("val1");
  });

  it("enforces LRU eviction when capacity is exceeded", () => {
    const cache = new StreamCache<string>(60000, 3); // Max 3 items
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // Access 'a' so 'b' becomes least recently used
    expect(cache.get("a")).toBe("1");

    // Insert 4th item, 'b' should be evicted
    cache.set("d", "4");

    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe("1");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
    expect(cache.getStats().evictions).toBe(1);
  });

  it("prevents cache stampedes via singleflight request coalescing", async () => {
    const cache = new StreamCache<string>(60000);
    let fetchCount = 0;

    const mockFetcher = async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 20));
      return "coalesced_data";
    };

    // Fire 5 concurrent requests for the exact same key
    const results = await Promise.all([
      cache.getOrFetch("concurrent_key", mockFetcher),
      cache.getOrFetch("concurrent_key", mockFetcher),
      cache.getOrFetch("concurrent_key", mockFetcher),
      cache.getOrFetch("concurrent_key", mockFetcher),
      cache.getOrFetch("concurrent_key", mockFetcher),
    ]);

    // All callers must receive the data
    for (const res of results) {
      expect(res).toBe("coalesced_data");
    }

    // Upstream fetcher MUST only have been executed exactly once!
    expect(fetchCount).toBe(1);
  });

  it("enforces byte-aware LRU eviction when maxBytes is reached", () => {
    const cache = new StreamCache<string>({
      defaultTtlMs: 60000,
      maxEntries: 10,
      maxBytes: 100, // 100 bytes budget
      sizeCalculator: (s) => Buffer.byteLength(s, "utf-8"),
    });

    const chunk40 = "A".repeat(40); // 40 bytes
    cache.set("item1", chunk40);
    cache.set("item2", chunk40);
    expect(cache.getStats().currentBytes).toBe(80);

    // Adding 3rd item with 40 bytes will exceed 100 bytes (80 + 40 = 120 > 100)
    // item1 should be evicted to make room
    cache.set("item3", chunk40);
    expect(cache.get("item1")).toBeNull();
    expect(cache.get("item2")).toBe(chunk40);
    expect(cache.get("item3")).toBe(chunk40);
    expect(cache.getStats().currentBytes).toBe(80);
    expect(cache.getStats().evictions).toBe(1);
  });

  it("supports Stale-While-Revalidate (SWR) instant stale serving with background refresh and weak ETag generation", async () => {
    const cache = new StreamCache<string>({
      defaultTtlMs: 30,
      defaultSwrMs: 200,
    });

    cache.set("swr_key", "v1_initial");
    const etag1 = cache.getEtag("swr_key");
    expect(etag1).toStartWith('W/"');

    // Wait for primary TTL (30ms) to expire while remaining within SWR window (200ms)
    await new Promise((r) => setTimeout(r, 45));

    let refreshed = false;
    const immediateResult = await cache.getOrFetch("swr_key", async () => {
      await new Promise((r) => setTimeout(r, 20));
      refreshed = true;
      return "v2_refreshed";
    });

    // Must return stale value immediately without blocking on the 20ms fetcher
    expect(immediateResult).toBe("v1_initial");
    expect(cache.getStats().staleServed).toBe(1);

    // Wait for background revalidation to finish
    await new Promise((r) => setTimeout(r, 35));
    expect(refreshed).toBe(true);
    expect(cache.get("swr_key")).toBe("v2_refreshed");
    expect(cache.getEtag("swr_key")).not.toBe(etag1);
  });
});

