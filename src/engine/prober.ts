import { StreamCache } from "./cache";
import { RichStreamFeed } from "../catalog/types";
import { parsePipeStreamUrl } from "../utils/stream-url";

export interface ProbeResult {
  url: string;
  isAlive: boolean;
  statusCode: number;
  latencyMs: number;
  contentType: string | null;
  isFormatValid: boolean;
  checkedAt: string;
}

export class StreamProber {
  private probeCache = new StreamCache<ProbeResult>({
    defaultTtlMs: 45_000, // 45s TTL for stream health probes
    maxEntries: 500,
  });

  private readonly defaultUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  /**
   * Probes a single stream URL using a lightweight GET request with Range/AbortController
   * to verify manifest liveness and measure initial edge latency.
   */
  async probeStream(
    rawUrl: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 2500
  ): Promise<ProbeResult> {
    const parsed = parsePipeStreamUrl(rawUrl, customHeaders);
    const cleanUrl = parsed.cleanUrl;

    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      return {
        url: cleanUrl,
        isAlive: false,
        statusCode: 0,
        latencyMs: 0,
        contentType: null,
        isFormatValid: false,
        checkedAt: new Date().toISOString(),
      };
    }

    return this.probeCache.getOrFetch(cleanUrl, async () => {
      const start = performance.now();
      const reqHeaders: Record<string, string> = {
        "User-Agent": parsed.headers["User-Agent"] || this.defaultUserAgent,
        Accept: "*/*",
        ...parsed.headers,
      };

      try {
        const response = await fetch(cleanUrl, {
          method: "GET",
          headers: reqHeaders,
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });

        const latencyMs = Math.round(performance.now() - start);
        const statusCode = response.status;
        const contentType = response.headers.get("content-type");

        if (!response.ok && statusCode !== 206) {
          try {
            await response.body?.cancel();
          } catch {}
          return {
            url: cleanUrl,
            isAlive: false,
            statusCode,
            latencyMs,
            contentType,
            isFormatValid: false,
            checkedAt: new Date().toISOString(),
          };
        }

        // Read first 512 bytes to confirm valid HLS (#EXTM3U) or DASH (<MPD) or binary TS/MP4 segment
        let firstChunk = "";
        if (response.body) {
          const reader = response.body.getReader();
          const { value } = await reader.read();
          if (value) {
            firstChunk = new TextDecoder().decode(value.slice(0, 512));
          }
          try {
            await reader.cancel();
          } catch {}
        }

        const isHls = firstChunk.includes("#EXTM3U");
        const isDash = firstChunk.includes("<MPD") || firstChunk.includes("urn:mpeg:dash");
        const isBinaryMedia =
          (contentType?.includes("video/") ||
            contentType?.includes("application/octet-stream") ||
            contentType?.includes("mpegurl") ||
            contentType?.includes("dash+xml")) ??
          false;

        const isFormatValid = isHls || isDash || isBinaryMedia || firstChunk.length > 0;

        return {
          url: cleanUrl,
          isAlive: true,
          statusCode,
          latencyMs,
          contentType,
          isFormatValid,
          checkedAt: new Date().toISOString(),
        };
      } catch {
        const latencyMs = Math.round(performance.now() - start);
        return {
          url: cleanUrl,
          isAlive: false,
          statusCode: 0,
          latencyMs,
          contentType: null,
          isFormatValid: false,
          checkedAt: new Date().toISOString(),
        };
      }
    });
  }

  /**
   * Probes an array of RichStreamFeeds with bounded concurrency (max 6 parallel probes),
   * adjusts reliabilityScore based on real HTTP status and latency,
   * and demotes dead streams to the bottom.
   */
  async probeFeedsBatch(feeds: RichStreamFeed[], concurrency = 6): Promise<RichStreamFeed[]> {
    if (feeds.length === 0) return feeds;

    const probedFeeds: RichStreamFeed[] = new Array(feeds.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < feeds.length) {
        const idx = cursor++;
        const feed = feeds[idx];
        const probe = await this.probeStream(
          feed.network.masterPlaylistUrl,
          feed.network.headers
        );

        let adjustedScore = feed.reliabilityScore;
        if (!probe.isAlive) {
          adjustedScore = Math.max(10, adjustedScore - 75);
        } else {
          if (probe.latencyMs < 300) {
            adjustedScore = Math.min(99, adjustedScore + 4);
          } else if (probe.latencyMs < 800) {
            adjustedScore = Math.min(99, adjustedScore + 2);
          } else if (probe.latencyMs > 1800) {
            adjustedScore = Math.max(40, adjustedScore - 10);
          }
        }

        probedFeeds[idx] = {
          ...feed,
          reliabilityScore: adjustedScore,
        };
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, feeds.length) }, () => worker());
    await Promise.all(workers);

    probedFeeds.sort((a, b) => b.reliabilityScore - a.reliabilityScore);

    probedFeeds.forEach((f, idx) => {
      if (f.reliabilityScore < 35) {
        f.priorityTier = "fallback";
      } else {
        f.priorityTier = idx === 0 ? "primary" : idx <= 2 ? "backup" : "fallback";
      }
    });

    return probedFeeds;
  }

  getStats() {
    return this.probeCache.getStats();
  }
}

export const streamProber = new StreamProber();
