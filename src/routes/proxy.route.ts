import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";
import { StreamCache } from "../engine/cache";
import {
  inheritSignedQueryParams,
  isSafeUpstreamUrl,
  parsePipeStreamUrl,
} from "../utils/stream-url";

export const proxyRoute = new Hono();

proxyRoute.options("/", (c) => {
  return c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Accept, Origin, Referer, Authorization, Content-Type",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, X-Cache, X-Proxy-Active-Upstream",
    "Access-Control-Max-Age": "86400",
  });
});

// Micro-cache for binary video chunks (.ts, .m4s, .mp4) to shield upstreams and accelerate concurrent viewers
// Capped at 150 segments and 50MB max memory budget with byte-aware LRU eviction
const segmentMicroCache = new StreamCache<{
  buffer: ArrayBuffer;
  contentType: string;
}>({
  defaultTtlMs: 12_000, // 12 seconds TTL for live segments
  maxEntries: 150,
  maxBytes: 50 * 1024 * 1024, // 50 MB strict memory limit
  sizeCalculator: (val) => val.buffer.byteLength,
});

/**
 * Filters a DASH `.mpd` XML manifest to retain only the video `<Representation>` matching the requested quality height
 * (e.g. `1080`, `720`, `480`, `360`), while keeping all audio/subtitle AdaptationSets and ContentProtection (DRM) tags intact.
 * Also injects a `<BaseURL>` pointing to the upstream manifest's directory so relative segment paths resolve cleanly.
 */
export function filterDashMpdByQuality(
  mpdXml: string,
  baseUrl: string,
  quality?: string
): string {
  const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
  let modifiedXml = mpdXml;

  if (!modifiedXml.includes("<BaseURL>")) {
    modifiedXml = modifiedXml.replace(
      /(<MPD[^>]*>)/i,
      `$1\n  <BaseURL>${baseDir}</BaseURL>`
    );
  }

  if (!quality || quality.toLowerCase() === "auto") {
    return modifiedXml;
  }

  const targetHeight = parseInt(quality.replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(targetHeight) || targetHeight <= 0) {
    return modifiedXml;
  }

  return modifiedXml.replace(
    /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi,
    (fullMatch: string, attrs: string, innerContent: string) => {
      const isVideo =
        /contentType=["']video["']/i.test(attrs) ||
        /mimeType=["']video\//i.test(attrs) ||
        (/height=["']\d+["']/i.test(innerContent) && !/contentType=["']audio["']/i.test(attrs));

      if (!isVideo) {
        return fullMatch;
      }

      const repRegex = /<Representation\b[^>]*?(?:\/>|>[\s\S]*?<\/Representation>)/gi;
      const allReps = innerContent.match(repRegex) || [];
      if (allReps.length <= 1) {
        return fullMatch;
      }

      const parsedReps = allReps.map((repXml: string) => {
        const hMatch = repXml.match(/\bheight=["'](\d+)["']/i);
        const bwMatch = repXml.match(/\bbandwidth=["'](\d+)["']/i);
        return {
          xml: repXml,
          height: hMatch ? parseInt(hMatch[1], 10) : 0,
          bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : 0,
        };
      });

      const exactMatches = parsedReps.filter((r) => r.height === targetHeight);
      let chosenReps = exactMatches;

      if (chosenReps.length === 0) {
        const withHeight = parsedReps.filter((r) => r.height > 0);
        if (withHeight.length > 0) {
          withHeight.sort(
            (a, b) => Math.abs(a.height - targetHeight) - Math.abs(b.height - targetHeight)
          );
          const closestHeight = withHeight[0].height;
          chosenReps = withHeight.filter((r) => r.height === closestHeight);
        } else {
          return fullMatch;
        }
      }

      const nonRepContent = innerContent.replace(repRegex, "").trim();
      const keptXml = chosenReps.map((r) => r.xml).join("\n      ");

      return `<AdaptationSet${attrs}>\n      ${nonRepContent}\n      ${keptXml}\n    </AdaptationSet>`;
    }
  );
}

export function isCustomProviderScheme(url: string): boolean {
  return /^(?:playztv|livxow|sktech|sportzx|playfy|cricify):\/\//i.test(url);
}

/**
 * Filters an HLS Master Playlist (`.m3u8`) by target resolution height (e.g. `1080p`, `720p`, `480p`, `360p`),
 * stripping other `#EXT-X-STREAM-INF` variants so the player is locked to the requested quality.
 */
export function filterM3u8ByQuality(
  lines: string[],
  baseUrl: string,
  proxyPath: string,
  quality?: string,
  customReferer?: string,
  customUa?: string,
  customOrigin?: string,
  customCookie?: string,
  customAuth?: string
): string[] | null {
  if (!quality || quality.toLowerCase() === "auto") return null;

  const targetHeight = parseInt(quality.replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(targetHeight) || targetHeight <= 0) return null;

  const hasVariants = lines.some((l) => l.trim().startsWith("#EXT-X-STREAM-INF"));
  if (!hasVariants) return null;

  const headerLines: string[] = [];
  const variants: { infLine: string; uriLine: string; height: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
      const resMatch = trimmed.match(/RESOLUTION=\d+x(\d+)/i);
      const height = resMatch ? parseInt(resMatch[1], 10) : 0;

      let uriIdx = i + 1;
      while (uriIdx < lines.length && (!lines[uriIdx].trim() || lines[uriIdx].trim().startsWith("#"))) {
        uriIdx++;
      }

      if (uriIdx < lines.length) {
        variants.push({
          infLine: trimmed,
          uriLine: lines[uriIdx].trim(),
          height,
        });
        i = uriIdx;
      }
    } else if (trimmed.startsWith("#")) {
      headerLines.push(trimmed);
    }
  }

  if (variants.length === 0) return null;

  let selected = variants.filter((v) => v.height === targetHeight);
  if (selected.length === 0) {
    const withHeight = variants.filter((v) => v.height > 0);
    if (withHeight.length > 0) {
      withHeight.sort((a, b) => Math.abs(a.height - targetHeight) - Math.abs(b.height - targetHeight));
      selected = [withHeight[0]];
    } else {
      selected = variants;
    }
  }

  const buildProxyLine = (rawUri: string) => {
    const absUrl = inheritSignedQueryParams(baseUrl, new URL(rawUri, baseUrl).toString());
    let p = `${proxyPath}?url=${encodeURIComponent(absUrl)}`;
    if (customReferer) p += `&referer=${encodeURIComponent(customReferer)}`;
    if (customUa) p += `&ua=${encodeURIComponent(customUa)}`;
    if (customOrigin) p += `&origin=${encodeURIComponent(customOrigin)}`;
    if (customCookie) p += `&cookie=${encodeURIComponent(customCookie)}`;
    if (customAuth) p += `&auth=${encodeURIComponent(customAuth)}`;
    return p;
  };

  const out: string[] = [];
  for (const h of headerLines) {
    if (h.includes('URI="')) {
      out.push(
        h.replace(/URI="([^"]+)"/g, (_, uri) => {
          try {
            return `URI="${buildProxyLine(uri)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        })
      );
    } else {
      out.push(h);
    }
  }

  for (const v of selected) {
    out.push(v.infLine);
    try {
      out.push(buildProxyLine(v.uriLine));
    } catch {
      out.push(v.uriLine);
    }
  }

  return out;
}

/**
 * GET / HEAD /api/proxy
 * High-Performance Edge Stream Proxy with Multi-Mirror Automatic Failover,
 * Custom URI Resolution (all 6 providers), Dynamic Quality Filtering (DASH & HLS),
 * and Segment Micro-Caching.
 */
proxyRoute.on(["GET", "HEAD"], "/", async (c) => {
  const isHead = c.req.method === "HEAD";
  let targetUrl = c.req.query("url");
  const channelId = c.req.query("channel");
  const fallbackUrl = c.req.query("fallback");
  const qualityFilter = c.req.query("quality");
  let customReferer = c.req.query("referer");
  let customUa = c.req.query("ua");
  let customOrigin = c.req.query("origin");
  let customCookie = c.req.query("cookie");
  let customAuth = c.req.query("auth");

  // 1. Resolve by channel/event ID if `channel` query param is provided without `url`
  if (!targetUrl && channelId) {
    const resolved = await aggregatorService.resolveStream(channelId);
    if (!resolved) {
      return c.text(`Channel or stream '${channelId}' could not be resolved`, 404);
    }
    targetUrl = resolved.streamUrl;
    if (resolved.headers) {
      customReferer = customReferer || resolved.headers["Referer"] || resolved.headers["referer"];
      customUa = customUa || resolved.headers["User-Agent"] || resolved.headers["user-agent"];
      customOrigin = customOrigin || resolved.headers["Origin"] || resolved.headers["origin"];
      customCookie = customCookie || resolved.headers["Cookie"] || resolved.headers["cookie"];
      customAuth =
        customAuth || resolved.headers["Authorization"] || resolved.headers["authorization"];
    }
  }

  if (!targetUrl) {
    return c.text("Invalid or missing 'url' or 'channel' query parameter", 400);
  }

  // 2. Resolve custom provider schemes (playztv://, livxow://, sktech://, sportzx://, playfy://, cricify://) on-the-fly
  if (isCustomProviderScheme(targetUrl)) {
    const resolvedSource = await aggregatorService.resolveCustomUri(targetUrl);
    if (!resolvedSource) {
      return c.text(`Unable to resolve custom provider URI: ${targetUrl}`, 502);
    }
    targetUrl = resolvedSource.streamUrl;
    if (resolvedSource.headers) {
      customReferer =
        customReferer || resolvedSource.headers["Referer"] || resolvedSource.headers["referer"];
      customUa =
        customUa || resolvedSource.headers["User-Agent"] || resolvedSource.headers["user-agent"];
      customOrigin =
        customOrigin || resolvedSource.headers["Origin"] || resolvedSource.headers["origin"];
      customCookie =
        customCookie || resolvedSource.headers["Cookie"] || resolvedSource.headers["cookie"];
      customAuth =
        customAuth ||
        resolvedSource.headers["Authorization"] ||
        resolvedSource.headers["authorization"];
    }
  }

  // 3. Extract pipe-delimited headers & normalize %2F in path via shared utility
  const parsedTarget = parsePipeStreamUrl(targetUrl);
  targetUrl = parsedTarget.cleanUrl;
  customReferer = customReferer || parsedTarget.headers["Referer"];
  customUa = customUa || parsedTarget.headers["User-Agent"];
  customOrigin = customOrigin || parsedTarget.headers["Origin"];
  customCookie = customCookie || parsedTarget.headers["Cookie"];
  customAuth = customAuth || parsedTarget.headers["Authorization"];

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return c.text("Invalid or missing 'url' query parameter", 400);
  }

  if (!isSafeUpstreamUrl(targetUrl)) {
    return c.json(
      {
        success: false,
        error: "Blocked unsafe or private upstream URL (SSRF protection)",
      },
      400
    );
  }

  const candidateUrls: string[] = [targetUrl];
  if (fallbackUrl && (fallbackUrl.startsWith("http://") || fallbackUrl.startsWith("https://"))) {
    const cleanFallback = parsePipeStreamUrl(fallbackUrl).cleanUrl;
    if (isSafeUpstreamUrl(cleanFallback)) {
      candidateUrls.push(cleanFallback);
    }
  }

  const isBinarySegment = /\.(ts|m4s|mp4|aac|cmfv|cmfa)(\?|$)/i.test(targetUrl);
  if (isBinarySegment) {
    const cachedSegment = segmentMicroCache.get(targetUrl);
    if (cachedSegment) {
      return new Response(isHead ? null : cachedSegment.buffer, {
        status: 200,
        headers: {
          "Content-Type": cachedSegment.contentType,
          "Content-Length": String(cachedSegment.buffer.byteLength),
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "public, max-age=30",
          "X-Cache": "HIT",
        },
      });
    }
  }

  let activeUrl = targetUrl;
  let upstreamResponse: Response | null = null;
  let lastError = "Unknown upstream error";

  for (const candidate of candidateUrls) {
    try {
      const parsedTargetUrl = new URL(candidate);
      const reqHeaders: Record<string, string> = {
        "User-Agent":
          customUa ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "*/*",
        Referer: customReferer || `${parsedTargetUrl.origin}/`,
      };
      if (customOrigin) reqHeaders["Origin"] = customOrigin;
      if (customCookie) reqHeaders["Cookie"] = customCookie;
      if (customAuth) reqHeaders["Authorization"] = customAuth;

      const rangeHeader = c.req.header("range");
      if (rangeHeader) {
        reqHeaders["Range"] = rangeHeader;
      }

      const res = await fetch(candidate, {
        headers: reqHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok || res.status === 206) {
        upstreamResponse = res;
        activeUrl = candidate;
        break;
      } else {
        lastError = `Upstream HTTP ${res.status} from ${candidate}`;
        try {
          await res.body?.cancel();
        } catch {}
      }
    } catch (err: any) {
      lastError = err?.message || `Network failure connecting to ${candidate}`;
    }
  }

  if (!upstreamResponse) {
    return c.text(`Proxy failover exhausted. Last error: ${lastError}`, 502);
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  const isDashMpd =
    contentType.includes("dash+xml") ||
    activeUrl.toLowerCase().includes(".mpd") ||
    activeUrl.toLowerCase().includes("/dash/");

  if (isDashMpd) {
    const rawMpd = await upstreamResponse.text();
    const filteredMpd = filterDashMpdByQuality(rawMpd, activeUrl, qualityFilter);
    const byteLen = Buffer.byteLength(filteredMpd, "utf-8");

    return new Response(isHead ? null : filteredMpd, {
      status: 200,
      headers: {
        "Content-Type": "application/dash+xml",
        "Content-Length": String(byteLen),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Proxy-Active-Upstream": activeUrl,
      },
    });
  }

  const isM3u8 =
    contentType.includes("mpegurl") ||
    contentType.includes("m3u") ||
    activeUrl.includes(".m3u8") ||
    activeUrl.includes(".m3u");

  if (isM3u8) {
    const text = await upstreamResponse.text();
    const baseUrl = new URL(activeUrl);
    const lines = text.split(/\r?\n/);
    const proxyPath = "/api/proxy";

    const buildProxyLine = (rawUri: string) => {
      const absUrl = inheritSignedQueryParams(
        baseUrl.toString(),
        new URL(rawUri, baseUrl).toString()
      );
      let p = `${proxyPath}?url=${encodeURIComponent(absUrl)}`;
      if (customReferer) p += `&referer=${encodeURIComponent(customReferer)}`;
      if (customUa) p += `&ua=${encodeURIComponent(customUa)}`;
      if (customOrigin) p += `&origin=${encodeURIComponent(customOrigin)}`;
      if (customCookie) p += `&cookie=${encodeURIComponent(customCookie)}`;
      if (customAuth) p += `&auth=${encodeURIComponent(customAuth)}`;
      return p;
    };

    const qualityFilteredLines = filterM3u8ByQuality(
      lines,
      baseUrl.toString(),
      proxyPath,
      qualityFilter,
      customReferer,
      customUa,
      customOrigin,
      customCookie,
      customAuth
    );

    if (qualityFilteredLines) {
      const joined = qualityFilteredLines.join("\n");
      return new Response(isHead ? null : joined, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Content-Length": String(Buffer.byteLength(joined, "utf-8")),
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Proxy-Active-Upstream": activeUrl,
        },
      });
    }

    const rewritten = lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        if (trimmed.startsWith("#")) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
              try {
                return `URI="${buildProxyLine(uri)}"`;
              } catch {
                return `URI="${uri}"`;
              }
            });
          }
          return line;
        }

        try {
          return buildProxyLine(trimmed);
        } catch {
          return line;
        }
      })
      .join("\n");

    return new Response(isHead ? null : rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Content-Length": String(Buffer.byteLength(rewritten, "utf-8")),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Proxy-Active-Upstream": activeUrl,
      },
    });
  }

  if (isBinarySegment) {
    try {
      const arrayBuffer = await upstreamResponse.arrayBuffer();
      const resolvedType = contentType || "video/mp2t";
      if (arrayBuffer.byteLength < 8 * 1024 * 1024) {
        segmentMicroCache.set(targetUrl, {
          buffer: arrayBuffer,
          contentType: resolvedType,
        });
      }
      return new Response(isHead ? null : arrayBuffer, {
        status: upstreamResponse.status,
        headers: {
          "Content-Type": resolvedType,
          "Content-Length": String(arrayBuffer.byteLength),
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "public, max-age=30",
          "X-Cache": "MISS",
        },
      });
    } catch {}
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (contentType) responseHeaders.set("Content-Type", contentType);
  const contentLength = upstreamResponse.headers.get("content-length");
  if (contentLength) responseHeaders.set("Content-Length", contentLength);
  const contentRange = upstreamResponse.headers.get("content-range");
  if (contentRange) responseHeaders.set("Content-Range", contentRange);

  return new Response(isHead ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
});
