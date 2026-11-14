import { describe, expect, test } from "bun:test";
import { StreamProber, streamProber, parseManifestContent } from "../src/engine/prober";
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

  test("parseManifestContent extracts real video renditions and audio tracks from HLS Master playlist", () => {
    const hlsMaster = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",NAME="English",LANGUAGE="eng",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",NAME="Hindi",LANGUAGE="hin",DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=6200000,RESOLUTION=1920x1080,FRAME-RATE=50.000,CODECS="avc1.64002a,mp4a.40.2",AUDIO="aud1"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720,FRAME-RATE=50.000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud1"
720p/index.m3u8
`;
    const parsed = parseManifestContent(hlsMaster, "HLS", "https://cdn.example.com/live/master.m3u8");
    expect(parsed.manifestType).toBe("HLS_MASTER");
    expect(parsed.isLiveStream).toBe(true);
    expect(parsed.renditions.length).toBe(2);
    expect(parsed.renditions[0].qualityTag).toBe("1080p");
    expect(parsed.renditions[0].resolution).toBe("1920x1080");
    expect(parsed.renditions[0].bandwidthKbps).toBe(6200);
    expect(parsed.renditions[0].fps).toBe(50);
    expect(parsed.renditions[0].url).toBe("https://cdn.example.com/live/1080p/index.m3u8");
    expect(parsed.renditions[1].qualityTag).toBe("720p");
    expect(parsed.audioTracks.map((a) => a.language)).toEqual(["eng", "hin"]);
  });

  test("parseManifestContent extracts representations and ClearKey KIDs from DASH MPD XML", () => {
    const dashMpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" type="dynamic">
  <Period id="0">
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="1994b1df-7dfd-2e8a-8d7b-9bf3fb900285"/>
      <Representation id="v1080" width="1920" height="1080" bandwidth="5500000" frameRate="60/1" codecs="avc1.640028"/>
      <Representation id="v540" width="960" height="540" bandwidth="1800000" frameRate="30" codecs="avc1.4d401f"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="eng"/>
  </Period>
</MPD>`;
    const parsed = parseManifestContent(dashMpd, "DASH", "https://cdn.example.com/live/manifest.mpd");
    expect(parsed.manifestType).toBe("DASH_MPD");
    expect(parsed.isLiveStream).toBe(true);
    expect(parsed.detectedClearKeyKids).toContain("1994b1df7dfd2e8a8d7b9bf3fb900285");
    expect(parsed.renditions.length).toBe(2);
    expect(parsed.renditions[0].qualityTag).toBe("1080p");
    expect(parsed.renditions[0].fps).toBe(60);
    expect(parsed.renditions[1].qualityTag).toBe("540p");
    expect(parsed.audioTracks.map((a) => a.language)).toContain("eng");
  });
});

