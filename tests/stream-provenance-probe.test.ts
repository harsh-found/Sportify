import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import app from "../src/index";
import { aggregatorService } from "../src/services/aggregator.service";

describe("Stream Provenance Prober Integration", () => {
  beforeAll(async () => {
    aggregatorService.stopBackgroundRefresh();
    await app.request("/api/catalog");
  }, 20000);

  afterAll(() => {
    aggregatorService.stopBackgroundRefresh();
  });

  test("GET /api/stream/:fixtureKey?probe=true probes stream feeds and returns ranking", async () => {
    const catalogRes = await app.request("/api/catalog");
    const catalogData = (await catalogRes.json()) as any;

    if (catalogData.fixtures && catalogData.fixtures.length > 0) {
      const fixtureKey = catalogData.fixtures[0].canonicalKey;
      const res = await app.request(`/api/stream/${encodeURIComponent(fixtureKey)}?probe=true`);
      expect(res.status).toBe(200);

      const streamData = (await res.json()) as any;
      expect(streamData.success).toBe(true);
      expect(Array.isArray(streamData.feeds)).toBe(true);

      if (streamData.feeds.length > 0) {
        const topFeed = streamData.feeds[0];
        expect(topFeed.streamId).toBeDefined();
        expect(topFeed.network).toBeDefined();
        expect(topFeed.network.edgeProxyFallbackUrl).toContain("/api/proxy?url=");
      }
    }
  }, 15000);

  test("GET /api/stream attaches backup mirror in edgeProxyFallbackUrl for multi-feeds", async () => {
    const catalogRes = await app.request("/api/catalog");
    const catalogData = (await catalogRes.json()) as any;

    // Find a fixture with 2 or more feeds (e.g. Formula 1)
    const multiFeedFixture = catalogData.fixtures.find((f: any) => f.streamMetadata?.totalWorkingFeeds >= 2);
    if (multiFeedFixture) {
      const res = await app.request(`/api/stream/${encodeURIComponent(multiFeedFixture.canonicalKey)}`);
      const streamData = (await res.json()) as any;
      if (streamData.feeds && streamData.feeds.length >= 2) {
        const feed0 = streamData.feeds[0];
        expect(feed0.network.edgeProxyFallbackUrl).toContain("&fallback=");
      }
    }
  });
});
