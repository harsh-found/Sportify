import { describe, expect, test } from "bun:test";
import {
  normalizeUnicodeText,
  detectSport,
  parseEventEntities,
  buildRichStreamFeeds,
} from "../src/catalog/normalizer";
import { StreamSource } from "../src/core/types";
import { parseManifestContent } from "../src/engine/prober";
import { isCustomProviderScheme } from "../src/routes/proxy.route";
import app from "../src/index";

describe("Sportify v1.3.0 — Extraction, Normalization & Playback Intelligence", () => {
  test("normalizeUnicodeText folds diacritics and non-ASCII characters cleanly", () => {
    expect(normalizeUnicodeText("Türkiye")).toBe("Turkiye");
    expect(normalizeUnicodeText("Curaçao")).toBe("Curacao");
    expect(normalizeUnicodeText("São Paulo FC")).toBe("Sao Paulo FC");
    expect(normalizeUnicodeText("Fenerbahçe İK")).toBe("Fenerbahce IK");
    expect(normalizeUnicodeText("Łódź & Bodø/Glimt")).toBe("Lodz & Bodo/Glimt");
  });

  test("parseEventEntities preserves multi-nation European matchups with diacritics", () => {
    const parsed = parseEventEntities("France vs Türkiye - UEFA Nations League");
    expect(parsed.teams).not.toBeNull();
    expect(parsed.teams?.teamA.code).toBe("FRA");
    expect(parsed.teams?.teamB.code).toBe("TUR");
    expect(parsed.cleanTitle).toBe("France vs Turkiye");
  });

  test("detectSport accurately classifies cycling, women's club football, snooker, and darts", () => {
    expect(detectSport("Other", "Tour De France 2026 - Stage 14")).toBe("cycling");
    expect(detectSport("Other", "Giro d'Italia - Mountain Stage")).toBe("cycling");
    expect(detectSport("Other", "West Ham United vs Charlton Athletic WFC")).toBe("football");
    expect(detectSport("Other", "World Snooker Championship Crucible")).toBe("snooker");
    expect(detectSport("Other", "PDC World Darts Ally Pally")).toBe("darts");
  });

  test("buildRichStreamFeeds computes playbackCompatibility matrix and recommendedPlayer", () => {
    const sources: StreamSource[] = [
      {
        provider: "cricify",
        streamUrl: "https://cdn.example.com/live/sony5/manifest.mpd",
        quality: "1080p",
        title: "Sony Sports Ten 5 FHD (DASH ClearKey)",
        format: "DASH",
        drm: {
          type: "clearkey",
          clearKeys: [
            {
              kid: "00112233445566778899aabbccddeeff",
              key: "ffeeddccbbaa99887766554433221100",
            },
          ],
        },
        headers: {
          "User-Agent": "okhttp/4.12.0",
          Authorization: "Bearer secret123",
        },
      },
      {
        provider: "sportzx",
        streamUrl: "https://cdn.example.com/live/sky/master.m3u8",
        quality: "1080p",
        title: "Sky Sports Main Event 1080p",
        format: "HLS",
      },
    ];

    const feeds = buildRichStreamFeeds(sources);
    expect(feeds.length).toBe(2);

    const dashFeed = feeds.find((f) => f.protocol === "dash")!;
    expect(dashFeed).toBeDefined();
    expect(dashFeed.playbackCompatibility?.requiresClearKeyDrm).toBe(true);
    expect(dashFeed.playbackCompatibility?.requiresCustomHeaders).toBe(true);
    expect(dashFeed.playbackCompatibility?.webShakaDash).toBe(true);
    expect(dashFeed.playbackCompatibility?.webHlsJs).toBe(false);
    expect(dashFeed.playbackCompatibility?.safariNativeHls).toBe(false);
    expect(dashFeed.playbackCompatibility?.recommendedPlayer).toBe("shaka-player");
    expect(dashFeed.network.edgeProxyFallbackUrl).toContain("auth=");

    const hlsFeed = feeds.find((f) => f.protocol === "hls")!;
    expect(hlsFeed).toBeDefined();
    expect(hlsFeed.playbackCompatibility?.requiresClearKeyDrm).toBe(false);
    expect(hlsFeed.playbackCompatibility?.webHlsJs).toBe(true);
    expect(hlsFeed.playbackCompatibility?.safariNativeHls).toBe(true);
    expect(hlsFeed.playbackCompatibility?.recommendedPlayer).toBe("hls.js");
  });

  test("parseManifestContent extracts 24KB deep HLS & DASH telemetry (encryption, LL-HLS, targetDuration, segmentCount)", () => {
    const hlsContent = [
      "#EXTM3U",
      "#EXT-X-VERSION:6",
      "#EXT-X-TARGETDURATION:4",
      "#EXT-X-PART-INF:PART-TARGET=1.000",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/key.bin"',
      '#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080,FRAME-RATE=59.94,CODECS="avc1.64002a,mp4a.40.2",AUDIO="aud1"',
      "chunklist_1080p.m3u8",
      "#EXTINF:4.000,",
      "seg1.ts",
      "#EXTINF:4.000,",
      "seg2.ts",
    ].join("\n");

    const hlsMeta = parseManifestContent(hlsContent, "HLS", "https://cdn.example.com/master.m3u8");
    expect(hlsMeta.renditions[0]?.resolution).toBe("1920x1080");
    expect(hlsMeta.renditions[0]?.fps).toBe(60);
    expect(hlsMeta.renditions[0]?.codec).toContain("avc1.64002a");
    expect(hlsMeta.encryption).toBe("AES-128");
    expect(hlsMeta.isLowLatency).toBe(true);
    expect(hlsMeta.targetDurationSec).toBe(4);
    expect(hlsMeta.segmentCount).toBe(2);

    const dashContent = `<?xml version="1.0" encoding="UTF-8"?>
      <MPD type="dynamic" availabilityStartTime="2026-04-17T00:00:00Z" minimumUpdatePeriod="PT2S">
        <Period>
          <AdaptationSet mimeType="video/mp4" codecs="hev1.1.6.L120.90" width="3840" height="2160" frameRate="50">
            <ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e" value="ClearKey1.0"/>
            <SegmentTemplate availabilityTimeOffset="1.5" duration="2000" timescale="1000"/>
            <Representation id="v_4k" bandwidth="14500000" width="3840" height="2160" frameRate="50"/>
          </AdaptationSet>
          <AdaptationSet mimeType="audio/mp4" codecs="ec-3" lang="en">
            <Representation id="a_en" bandwidth="192000"/>
          </AdaptationSet>
        </Period>
      </MPD>`;

    const dashMeta = parseManifestContent(dashContent, "DASH", "https://cdn.example.com/manifest.mpd");
    expect(dashMeta.renditions[0]?.resolution).toBe("3840x2160");
    expect(dashMeta.renditions[0]?.fps).toBe(50);
    expect(dashMeta.encryption).toBe("CLEARKEY");
    expect(dashMeta.isLowLatency).toBe(true);
    expect(dashMeta.targetDurationSec).toBe(2);
    expect(dashMeta.audioTracks.length).toBe(1);
    expect(dashMeta.audioTracks[0]?.language).toBe("en");
  });

  test("isCustomProviderScheme supports all 6 custom CS3 schemes in Edge Proxy", () => {
    expect(isCustomProviderScheme("playztv://channel/123")).toBe(true);
    expect(isCustomProviderScheme("livxow://match/456")).toBe(true);
    expect(isCustomProviderScheme("sktech://event/789")).toBe(true);
    expect(isCustomProviderScheme("sportzx://stream/abc")).toBe(true);
    expect(isCustomProviderScheme("playfy://match/def")).toBe(true);
    expect(isCustomProviderScheme("cricify://channel/ghi")).toBe(true);
    expect(isCustomProviderScheme("https://cdn.example.com/master.m3u8")).toBe(false);
  });

  test("GET /api/openapi.json and /docs serve v1.4.0 specification and interactive portal", async () => {
    const specRes = await app.request("/api/openapi.json");
    expect(specRes.status).toBe(200);
    const spec = (await specRes.json()) as {
      info: { version: string };
      paths: Record<string, unknown>;
    };
    expect(spec.info.version).toBe("1.4.0");
    expect(spec.paths["/api/stream/{fixtureKey}"]).toBeDefined();

    const docsRes = await app.request("/docs");
    expect(docsRes.status).toBe(200);
    const html = await docsRes.text();
    expect(html.includes("v1.4.0")).toBe(true);
    expect(html.includes("#0E0E10")).toBe(true);
    expect(html.includes("#10B981")).toBe(true);
  });
});
