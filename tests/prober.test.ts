import { describe, expect, test } from "bun:test";
import { StreamProber, streamProber } from "../src/engine/prober";
import { RichStreamFeed } from "../src/catalog/types";

describe("Active Stream Health Prober & Latency Canary", () => {
  test("handles non-HTTP or pseudo-schemes gracefully without throwing", async () => {
    const result = await streamProber.probeStream("livxow://pro/dummy.txt");
    expect(result.isAlive).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.isFormatValid).toBe(false);
  });

  test("handles unreachable dead URLs cleanly", async () => {
    const result = await streamProber.probeStream("https://127.0.0.1:59999/dead-stream.m3u8");
    expect(result.isAlive).toBe(false);
    expect(result.statusCode).toBe(0);
  });

  test("probes and verifies a mock live HLS stream", async () => {
    // Start temporary local server to simulate live stream
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/live.m3u8")) {
          return new Response("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nseg1.ts\n", {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    const prober = new StreamProber();
    const liveResult = await prober.probeStream(`http://localhost:${server.port}/live.m3u8`);
    expect(liveResult.isAlive).toBe(true);
    expect(liveResult.statusCode).toBe(200);
    expect(liveResult.isFormatValid).toBe(true);
    expect(liveResult.latencyMs).toBeGreaterThanOrEqual(0);

    const deadResult = await prober.probeStream(`http://localhost:${server.port}/dead.m3u8`);
    expect(deadResult.isAlive).toBe(false);
    expect(deadResult.statusCode).toBe(404);

    server.stop();
  });

  test("probeFeedsBatch dynamically demotes dead streams and prioritizes alive streams", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/good.m3u8")) {
          return new Response("#EXTM3U\n#EXT-X-VERSION:3\n", {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response("Forbidden", { status: 403 });
      },
    });

    const mockFeeds: any[] = [
      {
        streamId: "feed_dead_1",
        channelName: "Bad Feed",
        channelGroup: "Sports",
        priorityTier: "primary",
        reliabilityScore: 95,
        language: { code: "eng", name: "English", badge: "ENG" },
        protocol: "hls",
        network: {
          masterPlaylistUrl: `http://localhost:${server.port}/bad.m3u8`,
          edgeProxyFallbackUrl: "/api/proxy",
        },
        provenance: { isMultiSource: false, primaryProvider: "test", mirroredProviders: [], sourceList: [], attributionBadge: "Test" },
        hasPreParsedRenditions: true,
        renditions: [],
      },
      {
        streamId: "feed_live_2",
        channelName: "Good Live Feed",
        channelGroup: "Sports",
        priorityTier: "backup",
        reliabilityScore: 80,
        language: { code: "eng", name: "English", badge: "ENG" },
        protocol: "hls",
        network: {
          masterPlaylistUrl: `http://localhost:${server.port}/good.m3u8`,
          edgeProxyFallbackUrl: "/api/proxy",
        },
        provenance: { isMultiSource: false, primaryProvider: "test", mirroredProviders: [], sourceList: [], attributionBadge: "Test" },
        hasPreParsedRenditions: true,
        renditions: [],
      },
    ];

    const prober = new StreamProber();
    const rankedFeeds = await prober.probeFeedsBatch(mockFeeds);

    // The good feed should now be promoted to the top!
    expect(rankedFeeds[0].streamId).toBe("feed_live_2");
    expect(rankedFeeds[0].reliabilityScore).toBeGreaterThanOrEqual(82);

    // The dead feed should be demoted
    expect(rankedFeeds[1].streamId).toBe("feed_dead_1");
    expect(rankedFeeds[1].priorityTier).toBe("fallback");
    expect(rankedFeeds[1].reliabilityScore).toBeLessThanOrEqual(20);

    server.stop();
  });
});
