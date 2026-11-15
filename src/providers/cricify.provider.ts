import { Channel, LiveEvent, StreamSource } from "../core/types";
import { parseM3UPlaylist } from "../parsers/m3u.parser";
import { DrmHelper } from "../parsers/drm.helper";
import { EnvelopeCrypto } from "../parsers/envelope-crypto";
import { AbstractBaseProvider, DecryptionError, ProviderMetadata } from "./base.provider";
import { createDecipheriv } from "node:crypto";

/**
 * Cricify Provider Adapter
 * Reproduces the CloudStream 3 `CricifyProvider` (Kotlin/Dex) implementation:
 *  - Dynamic Firebase Remote Config resolution (`963020218535` / `com.cricfy.tv`, keys `cric_api2` / `cric_api1`)
 *  - Live fallback domains from `FirebaseRemoteConfigFetcher.dex` (`cftkhffmgf147.top`, `cfymarkscanjiostar80.top`, `cfyhljddgbkkufh82.top`)
 *  - Primary AES-128-CBC (`3hHzxYAgSGI8/ham` / `UqCvkvjecEIz842V`), Dex Secondary (`MqeYGCT4AYKoHKrT` / `oHKrTQuPx8zl8oJ+`),
 *    Legacy Secondary (`1514925786399479` / `1696747751010409`), and Embedded Envelope decryption
 *  - Live events from `/categories/live-events.txt` + per-slug `/channels/{slug}.txt` stream resolution
 *  - Curated M3U mirrors from `ProviderManager.kt` (`fancode.m3u`, `jevents_live.m3u`, `ALL.m3u`, `sports.m3u`)
 */
export class CricifyProvider extends AbstractBaseProvider {
  readonly metadata: ProviderMetadata = {
    id: "cricify",
    name: "Cricify Live",
    version: "2.5.0",
    enabled: true,
    categories: ["Cricket", "Football", "Sports"],
  };

  // Primary Key & IV from Cricify CryptoUtils.kt (Base64 decoded)
  private readonly primaryKey = Buffer.from("3hHzxYAgSGI8/ham", "utf8");
  private readonly primaryIv = Buffer.from("UqCvkvjecEIz842V", "utf8");

  // Dex Secondary Key & IV from CricifyProvider.cs3 classes.dex
  private readonly dexSecondaryKey = Buffer.from("MqeYGCT4AYKoHKrT", "utf8");
  private readonly dexSecondaryIv = Buffer.from("oHKrTQuPx8zl8oJ+", "utf8");

  // Legacy Secondary Key & IV from Cricify CryptoUtils.kt source
  private readonly secondaryKey = Buffer.from("1514925786399479", "utf8");
  private readonly secondaryIv = Buffer.from("1696747751010409", "utf8");

  // Exact fallback base URLs extracted from CricifyProvider.cs3 classes.dex
  private readonly fallbackBaseUrls = [
    "https://cftkhffmgf147.top",
    "https://cfymarkscanjiostar80.top",
    "https://cfyhljddgbkkufh82.top",
  ];

  // Curated M3U playlists from CricifyProvider/src/main/kotlin/com/cncverse/ProviderManager.kt
  private readonly m3uMirrors = [
    "https://github.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/raw/main/ALL.m3u",
    "https://iptv-org.github.io/iptv/categories/sports.m3u",
    "https://raw.githubusercontent.com/Jitendra-unatti/fancode/refs/heads/main/data/fancode.m3u",
  ];

  private cachedBaseUrl: string | null = null;
  private baseUrlExpiresAt = 0;

  private async getBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl && Date.now() < this.baseUrlExpiresAt) {
      return this.cachedBaseUrl;
    }

    const entries = await this.fetchFirebaseRemoteConfig({
      projectIdOrNumber: "963020218535",
      apiKey: "AIzaSyAh9jkEU0E_UYxH0m_BKAt-uUSTiTPqhb8",
      appId: "1:963020218535:android:47ec53252c64fb3c9c7b82",
      packageName: "com.cricfy.tv",
    });

    if (entries) {
      const dynamicUrl =
        entries.cric_api2 || entries.cric_api1 || entries.api_url || entries.base_url;
      if (dynamicUrl && dynamicUrl.startsWith("http")) {
        this.cachedBaseUrl = dynamicUrl.replace(/\/$/, "");
        this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
        return this.cachedBaseUrl;
      }
    }

    return this.fallbackBaseUrls[0];
  }

  private tryAesCbcDecrypt(rawBuffer: Buffer, key: Buffer, iv: Buffer): string | null {
    try {
      const decipher = createDecipheriv("aes-128-cbc", key, iv);
      const decrypted = Buffer.concat([decipher.update(rawBuffer), decipher.final()]);
      const text = decrypted.toString("utf8").trim();
      if (text.startsWith("{") || text.startsWith("[") || text.startsWith("#EXTM3U")) {
        return text;
      }
    } catch {
      // Ignore cipher mismatch
    }
    return null;
  }

  /**
    * Decrypts a Cricify encrypted payload using:
    *  1. Plaintext JSON / M3U check
    *  2. Primary AES-128-CBC key
    *  3. Dex Secondary AES-128-CBC key
    *  4. Legacy Secondary AES-128-CBC key
    *  5. Embedded Envelope AES-256-CBC cipher (`EnvelopeCrypto`)
    */
  public decryptPayload(encryptedText: string): string {
    const clean = encryptedText.trim();
    if (clean.startsWith("{") || clean.startsWith("[") || clean.startsWith("#EXTM3U")) {
      return clean;
    }

    try {
      const rawBuffer = Buffer.from(clean.replace(/\s+/g, ""), "base64");
      if (rawBuffer.length > 0 && rawBuffer.length % 16 === 0) {
        const primaryOut = this.tryAesCbcDecrypt(rawBuffer, this.primaryKey, this.primaryIv);
        if (primaryOut) return primaryOut;

        const dexSecondaryOut = this.tryAesCbcDecrypt(
          rawBuffer,
          this.dexSecondaryKey,
          this.dexSecondaryIv
        );
        if (dexSecondaryOut) return dexSecondaryOut;

        const secondaryOut = this.tryAesCbcDecrypt(rawBuffer, this.secondaryKey, this.secondaryIv);
        if (secondaryOut) return secondaryOut;
      }
    } catch {
      // Fall through to EnvelopeCrypto
    }

    const envelopeDecrypted = EnvelopeCrypto.decryptContent(clean);
    if (envelopeDecrypted !== clean) {
      return envelopeDecrypted;
    }

    throw new DecryptionError(this.metadata.id, "AES-128-CBC");
  }

  /**
   * Parses Cricify date format `"yyyy/MM/dd HH:mm:ss Z"` or ISO strings into epoch ms.
   */
  private parseCricifyEpochMs(dateStr?: string | null): number | null {
    if (!dateStr || typeof dateStr !== "string") return null;
    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    // Normalize "2026/11/10 14:00:00 +0000" -> "2026-11-10T14:00:00+00:00"
    const match = trimmed.match(
      /^(\d{4})[/-](\d{2})[/-](\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*([+-]\d{2}):?(\d{2}))?$/
    );
    if (match) {
      const [, y, m, d, time, tzH, tzM] = match;
      const tz = tzH && tzM ? `${tzH}:${tzM}` : "Z";
      const parsed = Date.parse(`${y}-${m}-${d}T${time}${tz}`);
      if (!Number.isNaN(parsed)) return parsed;
    }

    const fallback = Date.parse(trimmed);
    return Number.isNaN(fallback) ? null : fallback;
  }

  /**
   * Resolves stream sources for a Cricify channel/event slug from `/channels/{slug}.txt`
   */
  private async fetchSlugStreams(
    baseUrl: string,
    slug: string,
    eventTitle: string
  ): Promise<StreamSource[]> {
    try {
      const res = await this.safeFetch(`${baseUrl}/channels/${slug}.txt`, {
        headers: { "User-Agent": "okhttp/4.12.0" },
        timeoutMs: 4000,
        ignoreCircuitBreaker: true,
      });
      const rawText = await res.text();
      const decrypted = this.decryptPayload(rawText);
      const parsed = JSON.parse(decrypted);
      const streamUrls = Array.isArray(parsed)
        ? parsed
        : parsed.streamUrls || parsed.formats || parsed.streams || [];

      const sources: StreamSource[] = [];
      for (const s of streamUrls) {
        const rawUrl = s.link || s.webLink || s.url || "";
        if (!rawUrl) continue;
        const src = await this.buildStreamSourceFromEntry({
          id: `cricify_${slug}_${sources.length}`,
          rawUrl,
          tokenApi: s.tokenApi,
          quality: s.title || s.quality || "1080p",
          title: s.title || eventTitle,
          referer: s.referer,
          origin: s.origin,
          userAgent: s.userAgent,
          drmScheme: s.drmScheme,
          drmLicense: s.api || s.drmLicense,
        });
        if (src) {
          sources.push(src);
        }
      }
      return sources;
    } catch {
      return [];
    }
  }

  private sanitizeOptionalField(val: unknown): string | undefined {
    if (typeof val !== "string") return undefined;
    const trimmed = val.trim();
    if (!trimmed || trimmed === "null" || trimmed === "nulln" || trimmed === "o" || trimmed === "undefined") {
      return undefined;
    }
    return trimmed;
  }

  private sanitizeOptionalUrl(val: unknown): string | undefined {
    const clean = this.sanitizeOptionalField(val);
    if (!clean || !/^https?:\/\//i.test(clean)) return undefined;
    return clean;
  }

  async fetchEvents(): Promise<LiveEvent[]> {
    this.checkCircuitBreaker();
    const primaryUrl = await this.getBaseUrl();
    const urlsToTry = [primaryUrl, ...this.fallbackBaseUrls.filter((u) => u !== primaryUrl)];

    for (const base of urlsToTry) {
      const endpoints = [`${base}/categories/live-events.txt`, `${base}/cats.txt`];
      for (const endpoint of endpoints) {
        try {
          const response = await this.safeFetch(endpoint, {
            headers: { "User-Agent": "okhttp/4.12.0" },
            ignoreCircuitBreaker: true,
          });
          const rawText = await response.text();
          let decryptedText = rawText;

          try {
            decryptedText = this.decryptPayload(rawText);
          } catch {
            decryptedText = EnvelopeCrypto.decryptContent(rawText);
          }

          if (decryptedText.trim().startsWith("{") || decryptedText.trim().startsWith("[")) {
            const parsed = JSON.parse(decryptedText);
            const eventsList = Array.isArray(parsed)
              ? parsed
              : parsed.data || parsed.events || parsed.categories || parsed.channels || [];

            if (!Array.isArray(eventsList) || eventsList.length === 0) continue;

            // Skip /cats.txt if it only contains category/country folders without eventInfo or inline streams
            const hasRealEvents = eventsList.some(
              (it: any) =>
                Boolean(it?.eventInfo) ||
                Boolean(it?.slug) ||
                Array.isArray(it?.formats) ||
                Array.isArray(it?.streams) ||
                Array.isArray(it?.links)
            );
            if (!hasRealEvents) continue;

            this.cachedBaseUrl = base;
            this.activeBaseUrl = base;
            this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
            this.recordSuccess();

            const liveEvents: LiveEvent[] = [];
            const pendingSlugLookups: Array<{
              eventObj: LiveEvent;
              slug: string;
            }> = [];

            for (const item of eventsList) {
              const info = item.eventInfo || item;
              const slug = item.slug || item.id || item.cat_id;
              const teamA = String(info.teamA || "").trim();
              const teamB = String(info.teamB || "").trim();
              const eventName = this.sanitizeOptionalField(info.eventName);

              let title =
                this.sanitizeOptionalField(item.title) ||
                eventName ||
                this.sanitizeOptionalField(item.name) ||
                "Live Match";

              if (teamA && teamB) {
                if (teamA.toLowerCase() === teamB.toLowerCase()) {
                  title = eventName && !/^(motorsports?|boxing|cricket|football|sports?)$/i.test(eventName)
                    ? eventName
                    : teamA;
                } else if (!title.toLowerCase().includes(" vs ")) {
                  title =
                    eventName && !/^(motorsports?|boxing|cricket|football|sports?)$/i.test(eventName)
                      ? `${teamA} vs ${teamB} (${eventName})`
                      : `${teamA} vs ${teamB}`;
                }
              }

              const startMs = this.parseCricifyEpochMs(info.startTime || item.startTime);
              const endMs = this.parseCricifyEpochMs(info.endTime || item.endTime);
              const nowMs = Date.now();

              let status: "LIVE" | "UPCOMING" | "ENDED" = "LIVE";
              if (startMs && endMs) {
                if (nowMs < startMs - 15 * 60 * 1000) {
                  status = "UPCOMING";
                } else if (nowMs > endMs) {
                  status = "ENDED";
                } else {
                  status = "LIVE";
                }
              }

              const sources: StreamSource[] = [];
              const formats = item.formats || item.links || item.streams || item.streamUrls || [];
              if (Array.isArray(formats)) {
                for (const f of formats) {
                  if (!f || typeof f !== "object") continue;
                  const rawLink = f.webLink || f.url || f.link || "";
                  if (!rawLink) continue;
                  const src = await this.buildStreamSourceFromEntry({
                    id: `cricify_${slug || liveEvents.length}_${sources.length}`,
                    rawUrl: rawLink,
                    tokenApi: f.tokenApi,
                    quality: f.title || f.quality || "1080p",
                    title: f.title || title,
                    referer: f.referer,
                    origin: f.origin,
                    userAgent: f.userAgent,
                    drmScheme: f.drmScheme,
                    drmLicense: f.api || f.drmLicense,
                  });
                  if (src) {
                    sources.push(src);
                  }
                }
              }

              const teamAFlag = this.sanitizeOptionalUrl(info.teamAFlag);
              const teamBFlag = this.sanitizeOptionalUrl(info.teamBFlag);
              const eventBanner = this.sanitizeOptionalUrl(info.eventBanner);
              const eventType = this.sanitizeOptionalField(info.eventType);
              const isHot =
                info.isHot === "1" ||
                info.isHot === true ||
                item.isHot === "1" ||
                item.isHot === true;
              const priority = typeof item.priority === "number" ? item.priority : undefined;

              let poster =
                this.sanitizeOptionalUrl(info.eventLogo) ||
                this.sanitizeOptionalUrl(item.image) ||
                this.sanitizeOptionalUrl(item.logo) ||
                eventBanner;

              if (!poster && teamA && teamB) {
                // Matches LiveEventsProvider.kt generateMatchCardUrl()
                poster = `https://live-card-png.cricify.workers.dev/?title=${encodeURIComponent(
                  `${eventType || info.eventCat || "Cricket"} | ${eventName || "Live"}`
                )}&teamA=${encodeURIComponent(teamA)}&flagA=${encodeURIComponent(
                  teamAFlag || ""
                )}&teamB=${encodeURIComponent(teamB)}&flagB=${encodeURIComponent(
                  teamBFlag || ""
                )}&time=${encodeURIComponent(String(info.startTime || "LIVE"))}`;
              } else if (!poster) {
                poster = teamAFlag;
              }

              const formatHints: Array<{ title: string; logo?: string }> = [];
              if (Array.isArray(item.formatsNew)) {
                for (const fn of item.formatsNew) {
                  if (fn && typeof fn === "object" && fn.title) {
                    formatHints.push({
                      title: String(fn.title).trim(),
                      logo: this.sanitizeOptionalUrl(fn.logo),
                    });
                  }
                }
              } else if (Array.isArray(item.formats)) {
                for (const f of item.formats) {
                  if (typeof f === "string" && f.trim()) {
                    formatHints.push({ title: f.trim() });
                  }
                }
              }

              const slugStr = slug ? String(slug).trim() : `${liveEvents.length}`;
              const deferredSource: StreamSource = {
                id: `cricify_${slugStr}_deferred`,
                provider: this.metadata.id,
                quality: "1080p",
                title: formatHints[0]?.title || title,
                format: "HLS",
                streamUrl: `cricify://${slugStr}`,
                status: "ONLINE",
              };

              const eventObj: LiveEvent = {
                id: `cricify_${slugStr}`,
                title,
                category:
                  info.eventCat ||
                  info.eventCategory ||
                  item.cat ||
                  item.category ||
                  "Cricket",
                status,
                poster,
                teamAFlag,
                teamBFlag,
                eventBanner,
                eventType,
                isHot,
                priority,
                formatHints: formatHints.length > 0 ? formatHints : undefined,
                startTime: startMs ? new Date(startMs).toISOString() : info.startTime,
                endTime: endMs ? new Date(endMs).toISOString() : info.endTime,
                competition: eventName || undefined,
                lastUpdated: new Date().toISOString(),
                sources: sources.length > 0 ? sources : [deferredSource],
              };

              liveEvents.push(eventObj);

              if (sources.length === 0 && slugStr && pendingSlugLookups.length < 16) {
                pendingSlugLookups.push({ eventObj, slug: slugStr });
              }
            }

            if (pendingSlugLookups.length > 0) {
              await Promise.allSettled(
                pendingSlugLookups.map(async ({ eventObj, slug }) => {
                  const resolved = await this.fetchSlugStreams(base, slug, eventObj.title);
                  if (resolved.length > 0) {
                    eventObj.sources = resolved;
                  }
                })
              );
            }

            if (liveEvents.length > 0) {
              this.lastEventsExtracted = liveEvents.length;
              return liveEvents;
            }
          }
        } catch {
          // Try next endpoint / base URL
        }
      }
    }

    // Fallback: convert M3U channels into LiveEvents
    const channels = await this.fetchChannels();
    const fallbackEvents = channels
      .filter((ch) => {
        const lower = `${ch.name} ${ch.category}`.toLowerCase();
        return (
          lower.includes("vs") ||
          lower.includes("cricket") ||
          lower.includes("live") ||
          lower.includes("sport") ||
          lower.includes("ipl") ||
          lower.includes("psl")
        );
      })
      .map((ch, idx) => ({
        id: `cricify_ev_${idx}_${Buffer.from(ch.name).toString("hex").slice(0, 8)}`,
        title: ch.name,
        category: ch.category,
        status: "LIVE" as const,
        poster: ch.logo,
        lastUpdated: new Date().toISOString(),
        sources: ch.sources,
      }));
    this.lastEventsExtracted = fallbackEvents.length;
    return fallbackEvents;
  }

  async fetchChannels(): Promise<Channel[]> {
    for (const url of this.m3uMirrors) {
      try {
        const response = await this.safeFetch(url, {
          ignoreCircuitBreaker: true,
          timeoutMs: 4000,
        });
        const rawText = await response.text();
        let decryptedText = rawText;

        if (!rawText.trim().startsWith("#EXTM3U")) {
          try {
            decryptedText = this.decryptPayload(rawText);
          } catch {
            continue;
          }
        }

        const parsedItems = parseM3UPlaylist(decryptedText);
        if (parsedItems.length > 0) {
          const channels = parsedItems.slice(0, 80).map((item, idx) => {
            const source: StreamSource = {
              id: `cricify_src_${idx}`,
              provider: this.metadata.id,
              quality: item.title.includes("1080") ? "1080p" : "720p",
              title: item.title,
              format: item.format,
              streamUrl: item.streamUrl,
              headers: item.headers,
              drm: item.drm,
              status: "ONLINE",
            };
            source.fingerprint = DrmHelper.generateFingerprint(source);

            return {
              id: `cricify_ch_${idx}`,
              name: item.title,
              logo: item.logo,
              category: item.group || "Sports",
              group: item.group || "Live TV",
              sources: [source],
            };
          });
          this.lastChannelsExtracted = channels.length;
          return channels;
        }
      } catch {
        // Try next mirror
      }
    }

    return [];
  }

  async resolveAllStreams(id: string): Promise<StreamSource[]> {
    let slug = "";
    if (id.startsWith("cricify://")) {
      slug = id.replace(/^cricify:\/\//, "").trim();
    } else if (id.startsWith("cricify_")) {
      slug = id.replace(/^cricify_/, "").replace(/_deferred$/, "").trim();
    }
    if (slug) {
      const baseUrl = await this.getBaseUrl();
      const slugSources = await this.fetchSlugStreams(baseUrl, slug, slug);
      if (slugSources.length > 0) {
        return slugSources;
      }
    }
    return [];
  }

  async resolveStream(id: string): Promise<StreamSource | null> {
    const all = await this.resolveAllStreams(id);
    if (all.length > 0) return all[0];

    const events = await this.fetchEvents();
    const foundEvent = events.find((e) => e.id === id);
    if (foundEvent && foundEvent.sources.length > 0) {
      return foundEvent.sources[0];
    }

    const channels = await this.fetchChannels();
    const foundCh = channels.find((c) => c.id === id);
    return foundCh?.sources[0] || null;
  }
}
