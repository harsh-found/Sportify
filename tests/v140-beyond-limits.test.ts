import { describe, expect, test } from "bun:test";
import {
  isSafeUpstreamUrl,
  inheritSignedQueryParams,
  sanitizeHeadersForPublicDisplay,
} from "../src/utils/stream-url";
import { safeIsoDate, buildRichStreamFeeds } from "../src/catalog/normalizer";
import { StreamSource } from "../src/core/types";
import app from "../src/index";

describe("Sportify v1.4.0 — Engineer Beyond The Current Limits", () => {
  test("safeIsoDate parses DD/MM/YYYY, YYYY/MM/DD, timezone offsets, and Unix epochs into ISO-8601 UTC", () => {
    // DD/MM/YYYY HH:mm:ss (used by PlayZTV, LivXow, SKTech)
    expect(safeIsoDate("21/04/2026 14:30:00")).toBe("2026-04-21T14:30:00.000Z");
    expect(safeIsoDate("5/4/2026 9:05")).toBe("2026-04-05T09:05:00.000Z");

    // YYYY/MM/DD HH:mm:ss +0530 (used by Sportzx / Cricify)
    expect(safeIsoDate("2026/04/21 19:30:00 +0530")).toBe("2026-04-21T14:00:00.000Z");

    // Unix epoch seconds (10 digits) and milliseconds (13 digits)
    expect(safeIsoDate("1776781800")).toBe(new Date(1776781800 * 1000).toISOString());
    expect(safeIsoDate("1776781800000")).toBe(new Date(1776781800000).toISOString());
  });

  test("isSafeUpstreamUrl blocks SSRF vectors (loopback, RFC1918, cloud metadata) while allowing valid CDNs and CS3 schemes", () => {
    // Unsafe SSRF targets must be rejected
    expect(isSafeUpstreamUrl("http://127.0.0.1:8080/playlist.m3u8")).toBe(false);
    expect(isSafeUpstreamUrl("http://localhost:3000/health")).toBe(false);
    expect(isSafeUpstreamUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeUpstreamUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
    expect(isSafeUpstreamUrl("http://10.0.0.5/internal.m3u8")).toBe(false);
    expect(isSafeUpstreamUrl("http://172.16.10.4/stream.m3u8")).toBe(false);
    expect(isSafeUpstreamUrl("http://192.168.1.100/live.m3u8")).toBe(false);
    expect(isSafeUpstreamUrl("http://[::1]:8080/live.m3u8")).toBe(false);
    expect(isSafeUpstreamUrl("file:///etc/passwd")).toBe(false);

    // Public CDNs and CS3 custom schemes must be allowed
    expect(isSafeUpstreamUrl("https://cdn.sportify.live/hls/master.m3u8?hdnts=exp=999~hmac=abc")).toBe(true);
    expect(isSafeUpstreamUrl("cricify://channel/star-sports-1-hd")).toBe(true);
    expect(isSafeUpstreamUrl("sportzx://stream/102")).toBe(true);
    expect(isSafeUpstreamUrl("playztv://channel/55")).toBe(true);
  });

  test("GET /api/proxy and GET /api/streams/inspect reject SSRF URLs with HTTP 400 and support CORS OPTIONS preflight", async () => {
    const proxySsrf = await app.request("/api/proxy?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data"));
    expect(proxySsrf.status).toBe(400);
    const proxyBody = (await proxySsrf.json()) as any;
    expect(proxyBody.success).toBe(false);
    expect(proxyBody.error).toContain("SSRF");

    const inspectSsrf = await app.request("/api/streams/inspect?url=" + encodeURIComponent("http://127.0.0.1:3000/health"));
    expect(inspectSsrf.status).toBe(400);
    const inspectBody = (await inspectSsrf.json()) as any;
    expect(inspectBody.success).toBe(false);
    expect(inspectBody.error.code).toBe("UNSAFE_UPSTREAM_URL");

    const preflightRes = await app.request("/api/proxy", { method: "OPTIONS" });
    expect(preflightRes.status).toBe(204);
    expect(preflightRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflightRes.headers.get("Access-Control-Allow-Headers")).toContain("Range");
  });

  test("inheritSignedQueryParams propagates Akamai/Cloudflare/CloudFront CDN auth tokens to relative child playlists and segments", () => {
    const parentManifest =
      "https://edge.cdn.example.com/live/cricket/master.m3u8?hdnts=st=1700000000~exp=1700086400~acl=/*~hmac=9a8b7c&token=xyz987&t=12345";
    const childVariant = "https://edge.cdn.example.com/live/cricket/1080p/chunklist.m3u8";

    const inherited = inheritSignedQueryParams(parentManifest, childVariant);
    const parsed = new URL(inherited);
    // Signed CDN tokens are preserved
    expect(parsed.searchParams.get("hdnts")).toBe("st=1700000000~exp=1700086400~acl=/*~hmac=9a8b7c");
    expect(parsed.searchParams.get("token")).toBe("xyz987");
    // Ephemeral cache-buster `t` is not copied
    expect(parsed.searchParams.get("t")).toBeNull();

    // Different host should not receive parent host's signed tokens
    const externalKeyUrl = "https://drm-keys.otherdomain.com/key.bin";
    expect(inheritSignedQueryParams(parentManifest, externalKeyUrl)).toBe(externalKeyUrl);
  });

  test("sanitizeHeadersForPublicDisplay redacts Authorization and X-Api-Key in public JSON while preserving Cookie and edgeProxyFallbackUrl", () => {
    const rawHeaders = {
      "User-Agent": "okhttp/4.12.0",
      Referer: "https://cricfy.tv/",
      Authorization: "Bearer super_secret_jwt_token_1234567890",
      "X-Api-Key": "secret_api_key_999",
      Cookie: "hdnea=st=123~exp=456~hmac=token",
    };

    const sanitized = sanitizeHeadersForPublicDisplay(rawHeaders)!;
    expect(sanitized["User-Agent"]).toBe("okhttp/4.12.0");
    expect(sanitized["Referer"]).toBe("https://cricfy.tv/");
    expect(sanitized["Authorization"]).toContain("[REDACTED]");
    expect(sanitized["Authorization"]).not.toContain("super_secret_jwt_token_1234567890");
    expect(sanitized["X-Api-Key"]).toBe("[REDACTED]");
    expect(sanitized["Cookie"]).toBe("hdnea=st=123~exp=456~hmac=token");

    const sources: StreamSource[] = [
      {
        provider: "cricify",
        streamUrl: "https://cdn.example.com/live/match1/master.m3u8",
        quality: "1080p",
        title: "Willow HD",
        format: "HLS",
        headers: rawHeaders,
      },
    ];

    const feeds = buildRichStreamFeeds(sources);
    expect(feeds[0]?.network.headers?.Authorization).toContain("[REDACTED]");
    // The edge proxy URL still carries the encoded auth & cookie for server-side forwarding
    expect(feeds[0]?.network.edgeProxyFallbackUrl).toContain("auth=");
    expect(feeds[0]?.network.edgeProxyFallbackUrl).toContain("cookie=");
  });

  test(
    "GET /api/diagnostics returns v1.4.0 extraction coverage, deduplication efficiency, and 6-provider telemetry",
    async () => {
      const res = await app.request("/api/diagnostics");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.version).toBe("1.4.0");
      expect(body.extractionCoverage).toBeDefined();
      expect(typeof body.extractionCoverage.scheduleTimestampCoveragePct).toBe("number");
      expect(typeof body.extractionCoverage.posterCoveragePct).toBe("number");
      expect(body.deduplicationEfficiency).toBeDefined();
      expect(Array.isArray(body.providerDiagnostics)).toBe(true);
      expect(body.providerDiagnostics.length).toBe(6);

      for (const p of body.providerDiagnostics) {
        expect(p.id).toBeDefined();
        expect(p.circuitState).toBeDefined();
        expect(p.diagnostics).toBeDefined();
        expect(typeof p.diagnostics.successRatePct).toBe("number");
      }
    },
    20000
  );
});
