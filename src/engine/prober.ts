import { StreamCache } from "./cache";
import { RichStreamFeed, RenditionOption } from "../catalog/types";
import { parsePipeStreamUrl } from "../utils/stream-url";

export interface ManifestAudioTrack {
  groupId: string;
  name: string;
  language?: string;
  isDefault: boolean;
  channels?: string;
}

export interface ProbeResult {
  url: string;
  isAlive: boolean;
  statusCode: number;
  latencyMs: number;
  contentType: string | null;
  isFormatValid: boolean;
  manifestType?: "HLS_MASTER" | "HLS_MEDIA" | "DASH_MPD" | "BINARY_MEDIA" | "UNKNOWN";
  isLiveStream?: boolean;
  isLowLatency?: boolean;
  targetDurationSec?: number;
  segmentCount?: number;
  encryption?: "NONE" | "CLEARKEY" | "AES-128" | "SAMPLE-AES" | "CENC";
  renditions?: RenditionOption[];
  audioTracks?: ManifestAudioTrack[];
  detectedClearKeyKids?: string[];
  checkedAt: string;
}

/**
 * Pure parser for HLS Master/Media playlists and DASH MPD XML manifests.
 * Extracts real video renditions (resolution, height, bandwidth, FPS, codecs),
 * audio tracks, live status, encryption scheme, low-latency flags, target duration,
 * segment count, and ClearKey KIDs directly from raw manifest text.
 */
export function parseManifestContent(
  manifestText: string,
  fallbackFormat: "HLS" | "DASH" = "HLS",
  baseUrl = ""
): {
  manifestType: "HLS_MASTER" | "HLS_MEDIA" | "DASH_MPD" | "UNKNOWN";
  isLiveStream: boolean;
  isLowLatency: boolean;
  targetDurationSec?: number;
  segmentCount: number;
  encryption: "NONE" | "CLEARKEY" | "AES-128" | "SAMPLE-AES" | "CENC";
  renditions: RenditionOption[];
  audioTracks: ManifestAudioTrack[];
  detectedClearKeyKids: string[];
} {
  const text = (manifestText || "").trim();
  const renditions: RenditionOption[] = [];
  const audioTracks: ManifestAudioTrack[] = [];
  const detectedClearKeyKids = new Set<string>();

  if (!text) {
    return {
      manifestType: "UNKNOWN",
      isLiveStream: false,
      isLowLatency: false,
      segmentCount: 0,
      encryption: "NONE",
      renditions,
      audioTracks,
      detectedClearKeyKids: [],
    };
  }

  // 1. HLS Playlist (#EXTM3U)
  if (text.includes("#EXTM3U") || text.includes("#EXT-X-STREAM-INF") || text.includes("#EXTINF")) {
    const isMaster = text.includes("#EXT-X-STREAM-INF");
    const isLiveStream = !text.includes("#EXT-X-ENDLIST");
    const isLowLatency =
      text.includes("#EXT-X-PART-INF") ||
      text.includes("#EXT-X-SERVER-CONTROL") ||
      text.includes("#EXT-X-PRELOAD-HINT");

    let targetDurationSec: number | undefined;
    const tdMatch = text.match(/#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)/i);
    if (tdMatch) {
      targetDurationSec = Math.round(Number(tdMatch[1]));
    }

    const extInfMatches = text.match(/#EXTINF:/g);
    const segmentCount = extInfMatches ? extInfMatches.length : 0;

    let encryption: "NONE" | "CLEARKEY" | "AES-128" | "SAMPLE-AES" | "CENC" = "NONE";
    const keyLines = text.match(/#EXT-X-(?:SESSION-)?KEY:[^\r\n]+/gi) || [];
    for (const kl of keyLines) {
      const methodMatch = kl.match(/METHOD=([A-Z0-9-]+)/i);
      if (methodMatch && methodMatch[1]) {
        const m = methodMatch[1].toUpperCase();
        if (m === "AES-128") encryption = "AES-128";
        else if (m.includes("SAMPLE-AES")) encryption = "SAMPLE-AES";
      }
      const kidHex = kl.match(/KEYID=0x([0-9a-fA-F]{32})/i);
      if (kidHex && kidHex[1]) {
        detectedClearKeyKids.add(kidHex[1].toLowerCase());
        encryption = "CLEARKEY";
      }
    }

    // Extract #EXT-X-MEDIA:TYPE=AUDIO
    const mediaRegex = /#EXT-X-MEDIA:([^\r\n]+)/g;
    let mediaMatch: RegExpExecArray | null;
    while ((mediaMatch = mediaRegex.exec(text)) !== null) {
      const attrs = mediaMatch[1];
      if (!/TYPE=AUDIO/i.test(attrs)) continue;
      const groupId = attrs.match(/GROUP-ID="([^"]+)"/i)?.[1] || "audio";
      const name = attrs.match(/NAME="([^"]+)"/i)?.[1] || "Default Audio";
      const language = attrs.match(/LANGUAGE="([^"]+)"/i)?.[1];
      const channels = attrs.match(/CHANNELS="([^"]+)"/i)?.[1];
      const isDefault = /DEFAULT=YES/i.test(attrs);
      audioTracks.push({ groupId, name, language, isDefault, channels });
    }

    // Extract #EXT-X-KEY ClearKey KIDs if present
    const keyRegex = /KEYFORMAT="[^"]*clearkey[^"]*"[^\r\n]*URI="data:text\/plain;base64,([^"]+)"/gi;
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRegex.exec(text)) !== null) {
      detectedClearKeyKids.add(keyMatch[1]);
      encryption = "CLEARKEY";
    }

    // Extract #EXT-X-STREAM-INF renditions
    const streamInfRegex = /#EXT-X-STREAM-INF:([^\r\n]+)(?:\r?\n([^\r\n#]+))?/g;
    let match: RegExpExecArray | null;
    const seenLabels = new Set<string>();

    while ((match = streamInfRegex.exec(text)) !== null) {
      const attrs = match[1];
      const nextLineUri = (match[2] || "").trim();
      const bwMatch = attrs.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);
      const resMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
      const fpsMatch = attrs.match(/FRAME-RATE=([\d.]+)/i);
      const codecsMatch = attrs.match(/CODECS="([^"]+)"/i);

      const bitrate = bwMatch ? Number(bwMatch[1]) : undefined;
      const bandwidthKbps = bitrate ? Math.round(bitrate / 1000) : undefined;
      const width = resMatch ? Number(resMatch[1]) : undefined;
      const height = resMatch ? Number(resMatch[2]) : undefined;
      const fps = fpsMatch ? Math.round(Number(fpsMatch[1])) : undefined;
      const codec = codecsMatch ? codecsMatch[1] : undefined;

      const label = height
        ? `${height}p`
        : bandwidthKbps
          ? `${Math.round(bandwidthKbps / 100) * 100}kbps`
          : "Auto";

      const dedupeKey = `${label}-${bandwidthKbps || 0}`;
      if (seenLabels.has(dedupeKey)) continue;
      seenLabels.add(dedupeKey);

      let renditionUrl = baseUrl;
      if (nextLineUri) {
        if (nextLineUri.startsWith("http://") || nextLineUri.startsWith("https://")) {
          renditionUrl = nextLineUri;
        } else if (baseUrl) {
          try {
            renditionUrl = new URL(nextLineUri, baseUrl).toString();
          } catch {
            renditionUrl = baseUrl;
          }
        } else {
          renditionUrl = nextLineUri;
        }
      }

      renditions.push({
        id: `hls-${label.toLowerCase()}-${bandwidthKbps || 0}`,
        qualityTag: label,
        label,
        resolution: width && height ? `${width}x${height}` : undefined,
        height,
        bandwidthKbps,
        bitrate,
        fps,
        codec,
        isDefault: false,
        url: renditionUrl,
      });
    }

    renditions.sort((a, b) => (b.height || b.bandwidthKbps || 0) - (a.height || a.bandwidthKbps || 0));
    if (renditions.length > 0) {
      renditions[0].isDefault = true;
    }

    return {
      manifestType: isMaster ? "HLS_MASTER" : "HLS_MEDIA",
      isLiveStream,
      isLowLatency,
      targetDurationSec,
      segmentCount,
      encryption,
      renditions,
      audioTracks,
      detectedClearKeyKids: Array.from(detectedClearKeyKids),
    };
  }

  // 2. DASH MPD XML (<MPD ...>)
  if (text.includes("<MPD") || text.includes("urn:mpeg:dash") || text.includes("<Representation")) {
    const isLiveStream = /type\s*=\s*["']dynamic["']/i.test(text);
    const isLowLatency =
      /availabilityTimeOffset/i.test(text) || /ServiceDescription/i.test(text);

    let targetDurationSec: number | undefined;
    const durMatch =
      text.match(/maxSegmentDuration\s*=\s*["']PT(\d+(?:\.\d+)?)S["']/i) ||
      text.match(/minimumUpdatePeriod\s*=\s*["']PT(\d+(?:\.\d+)?)S["']/i);
    if (durMatch) {
      targetDurationSec = Math.round(Number(durMatch[1]));
    }

    // Extract cenc:default_KID
    const kidRegex = /default_KID\s*=\s*["']([0-9a-fA-F-]{32,36})["']/gi;
    let kidMatch: RegExpExecArray | null;
    while ((kidMatch = kidRegex.exec(text)) !== null) {
      detectedClearKeyKids.add(kidMatch[1].replace(/-/g, "").toLowerCase());
    }

    let encryption: "NONE" | "CLEARKEY" | "AES-128" | "SAMPLE-AES" | "CENC" = "NONE";
    if (
      /e2719d58-a985-b3c9-781a-b030af78d30e/i.test(text) ||
      /org\.w3\.clearkey/i.test(text) ||
      detectedClearKeyKids.size > 0
    ) {
      encryption = "CLEARKEY";
    } else if (/ContentProtection/i.test(text)) {
      encryption = "CENC";
    }

    // Extract DASH audio AdaptationSet tracks
    const adaptRegex = /<AdaptationSet\b([^>]+)>/gi;
    let adaptMatch: RegExpExecArray | null;
    while ((adaptMatch = adaptRegex.exec(text)) !== null) {
      const attrs = adaptMatch[1];
      const isAudio =
        /\bmimeType\s*=\s*["']audio\//i.test(attrs) ||
        /\bcontentType\s*=\s*["']audio["']/i.test(attrs);
      if (!isAudio) continue;
      const lang = attrs.match(/\blang\s*=\s*["']([^"']+)["']/i)?.[1];
      const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || `audio-${audioTracks.length + 1}`;
      audioTracks.push({
        groupId: id,
        name: lang ? `Audio (${lang})` : "Default Audio",
        language: lang,
        isDefault: audioTracks.length === 0,
      });
    }

    // Extract <Representation ...> tags
    const repRegex = /<Representation\b([^>]+)>/gi;
    let repMatch: RegExpExecArray | null;
    const seenHeights = new Set<string>();

    while ((repMatch = repRegex.exec(text)) !== null) {
      const attrs = repMatch[1];
      const widthMatch = attrs.match(/\bwidth\s*=\s*["'](\d+)["']/i);
      const heightMatch = attrs.match(/\bheight\s*=\s*["'](\d+)["']/i);
      const bwMatch = attrs.match(/\bbandwidth\s*=\s*["'](\d+)["']/i);
      const fpsMatch = attrs.match(/\bframeRate\s*=\s*["'](\d+)(?:\/(\d+))?["']/i);
      const codecsMatch = attrs.match(/\bcodecs\s*=\s*["']([^"']+)["']/i);
      const mimeMatch = attrs.match(/\bmimeType\s*=\s*["']([^"']+)["']/i);

      if (mimeMatch && /audio/i.test(mimeMatch[1])) continue;
      if (codecsMatch && /^mp4a|^ac-3|^ec-3|^opus/i.test(codecsMatch[1]) && !heightMatch) continue;

      const width = widthMatch ? Number(widthMatch[1]) : undefined;
      const height = heightMatch ? Number(heightMatch[1]) : undefined;
      const bitrate = bwMatch ? Number(bwMatch[1]) : undefined;
      const bandwidthKbps = bitrate ? Math.round(bitrate / 1000) : undefined;
      let fps: number | undefined;
      if (fpsMatch) {
        const num = Number(fpsMatch[1]);
        const den = fpsMatch[2] ? Number(fpsMatch[2]) : 1;
        fps = den > 0 ? Math.round(num / den) : num;
      }
      const codec = codecsMatch ? codecsMatch[1] : undefined;

      if (!height && !bandwidthKbps) continue;

      const label = height ? `${height}p` : `${bandwidthKbps}kbps`;
      const dedupeKey = `${label}-${bandwidthKbps || 0}`;
      if (seenHeights.has(dedupeKey)) continue;
      seenHeights.add(dedupeKey);

      renditions.push({
        id: `dash-${label.toLowerCase()}-${bandwidthKbps || 0}`,
        qualityTag: label,
        label,
        resolution: width && height ? `${width}x${height}` : undefined,
        height,
        bandwidthKbps,
        bitrate,
        fps,
        codec,
        isDefault: false,
        url: baseUrl ? `${baseUrl}#quality=${label}` : `#quality=${label}`,
      });
    }

    renditions.sort((a, b) => (b.height || b.bandwidthKbps || 0) - (a.height || a.bandwidthKbps || 0));
    if (renditions.length > 0) {
      renditions[0].isDefault = true;
    }

    const segTimelineMatches = text.match(/<S\b/gi);
    const segmentCount = segTimelineMatches ? segTimelineMatches.length : 0;

    return {
      manifestType: "DASH_MPD",
      isLiveStream,
      isLowLatency,
      targetDurationSec,
      segmentCount,
      encryption,
      renditions,
      audioTracks,
      detectedClearKeyKids: Array.from(detectedClearKeyKids),
    };
  }

  return {
    manifestType: fallbackFormat === "DASH" ? "DASH_MPD" : "UNKNOWN",
    isLiveStream: false,
    isLowLatency: false,
    segmentCount: 0,
    encryption: "NONE",
    renditions,
    audioTracks,
    detectedClearKeyKids: [],
  };
}

export class StreamProber {
  private probeCache = new StreamCache<ProbeResult>({
    defaultTtlMs: 45_000, // 45s TTL for stream health probes
    defaultSwrMs: 90_000,
    maxEntries: 500,
  });

  private readonly defaultUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  /**
   * Probes a single stream URL using a lightweight GET request with AbortSignal
   * to verify manifest liveness, measure initial edge latency, and parse real
   * HLS/DASH video renditions, audio tracks, encryption, and ClearKey KIDs from the first 24KB.
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
        manifestType: "UNKNOWN",
        renditions: [],
        audioTracks: [],
        detectedClearKeyKids: [],
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
            manifestType: "UNKNOWN",
            renditions: [],
            audioTracks: [],
            detectedClearKeyKids: [],
            checkedAt: new Date().toISOString(),
          };
        }

        // Read up to 24KB (24576 bytes) to capture full DASH MPDs and multi-variant HLS manifests
        let firstChunk = "";
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let bytesRead = 0;
          while (bytesRead < 24576) {
            const { value, done } = await reader.read();
            if (done || !value) break;
            firstChunk += decoder.decode(value, { stream: true });
            bytesRead += value.byteLength;
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
        const parsedManifest = parseManifestContent(
          firstChunk,
          isDash || contentType?.includes("dash+xml") ? "DASH" : "HLS",
          response.url || cleanUrl
        );

        return {
          url: cleanUrl,
          isAlive: true,
          statusCode,
          latencyMs,
          contentType,
          isFormatValid,
          manifestType:
            parsedManifest.manifestType !== "UNKNOWN"
              ? parsedManifest.manifestType
              : isBinaryMedia
                ? "BINARY_MEDIA"
                : "UNKNOWN",
          isLiveStream: parsedManifest.isLiveStream,
          isLowLatency: parsedManifest.isLowLatency,
          targetDurationSec: parsedManifest.targetDurationSec,
          segmentCount: parsedManifest.segmentCount,
          encryption: parsedManifest.encryption,
          renditions: parsedManifest.renditions,
          audioTracks: parsedManifest.audioTracks,
          detectedClearKeyKids: parsedManifest.detectedClearKeyKids,
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
          manifestType: "UNKNOWN",
          renditions: [],
          audioTracks: [],
          detectedClearKeyKids: [],
          checkedAt: new Date().toISOString(),
        };
      }
    });
  }

  /**
   * Deeply inspects an HLS or DASH manifest URL for on-demand diagnostics (`GET /api/streams/inspect`).
   */
  async inspectManifest(
    rawUrl: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 3500
  ): Promise<ProbeResult> {
    return this.probeStream(rawUrl, customHeaders, timeoutMs);
  }

  /**
   * Probes an array of RichStreamFeeds with bounded concurrency (max 6 parallel probes),
   * adjusts reliabilityScore based on real HTTP status and latency, replaces synthetic renditions
   * with real manifest-discovered renditions when available, attaches `health` telemetry,
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

        const discoveredRenditions =
          probe.renditions && probe.renditions.length > 0 ? probe.renditions : feed.renditions;

        probedFeeds[idx] = {
          ...feed,
          renditions: discoveredRenditions,
          reliabilityScore: adjustedScore,
          health: {
            isAlive: probe.isAlive,
            latencyMs: probe.latencyMs,
            statusCode: probe.statusCode,
            lastChecked: probe.checkedAt,
          },
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
