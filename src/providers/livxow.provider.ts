import { Channel, LiveEvent, StreamSource } from "../core/types";
import { parseM3UPlaylist } from "../parsers/m3u.parser";
import { AbstractBaseProvider, DecryptionError, ProviderMetadata } from "./base.provider";
import { createDecipheriv } from "node:crypto";

/**
 * LivXow Provider Adapter
 * Faithfully reproduces `LivXowCryptoUtils.kt`, `LivXowFirebaseFetcher.kt`, and `LivXowProviderManager.kt`
 * from `LivXowProvider.cs3`:
 *  - Dynamic Firebase Remote Config resolution (`459539398637` / `com.livxow.tv`)
 *  - Substitution cipher (`SUB_FROM` -> `SUB_TO`) + AES-128-CBC (`M8mkKlNL75K4nl15` / `kN7m5Kl1pN5nk4xK`)
 *  - Fallback AES-128-CBC (`L7l15M8mkKlN75K4` / `xK1kN7m5Kl1pN5nk`)
 *  - Nested wrapper parsing (`[{"event": "<inner JSON>"}]` and `[{"cat": "<inner JSON>"}]`)
 */
export class LivXowProvider extends AbstractBaseProvider {
  readonly metadata: ProviderMetadata = {
    id: "livxow",
    name: "LivXow Live",
    version: "1.3.0",
    enabled: true,
    categories: ["Cricket", "Football", "Sports", "Live TV"],
  };

  private readonly fallbackBaseUrls = [
    "https://hsueuekaiwhhe.shop",
    "https://welalagaa.site",
    "https://sohaidoegeve2.shop",
  ];

  // Primary Substitution Map from LivXowCryptoUtils.kt
  private readonly subFrom = "fFgGjJkKaApPbBmMoOzZeEnNcCdDrRqQtTvVuUxXhHiIwWyYlLsS";
  private readonly subTo = "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ";
  private readonly substitutionMap: Map<string, string>;

  // Primary AES Key & IV ("M8mkKlNL75K4nl15" / "kN7m5Kl1pN5nk4xK")
  private readonly primaryKey = Buffer.from("M8mkKlNL75K4nl15", "utf-8");
  private readonly primaryIv = Buffer.from("kN7m5Kl1pN5nk4xK", "utf-8");

  // Fallback AES Key & IV ("L7l15M8mkKlN75K4" / "xK1kN7m5Kl1pN5nk")
  private readonly fallbackKey = Buffer.from("L7l15M8mkKlN75K4", "utf-8");
  private readonly fallbackIv = Buffer.from("xK1kN7m5Kl1pN5nk", "utf-8");

  private cachedBaseUrl: string | null = null;
  private baseUrlExpiresAt = 0;

  constructor() {
    super();
    this.defaultUserAgent = "okhttp/4.9.2";
    this.substitutionMap = new Map<string, string>();
    for (let i = 0; i < this.subFrom.length; i++) {
      this.substitutionMap.set(this.subFrom[i], this.subTo[i]);
    }
  }

  private async getBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl && Date.now() < this.baseUrlExpiresAt) {
      return this.cachedBaseUrl;
    }

    const entries = await this.fetchFirebaseRemoteConfig({
      projectIdOrNumber: "459539398637",
      apiKey: "AIzaSyBIfjXqlm2QLLctnTUQUNK9j9Kf2ybS7yw",
      appId: "1:459539398637:android:96270124df48971af131e4",
      packageName: "com.livxow.tv",
    });

    if (entries) {
      const dynamicUrl =
        entries.api_url || entries.base_url || entries.livxow_api || entries.domain;
      if (dynamicUrl && dynamicUrl.startsWith("http")) {
        this.cachedBaseUrl = dynamicUrl.replace(/\/$/, "");
        this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
        return this.cachedBaseUrl;
      }
    }

    return this.fallbackBaseUrls[0];
  }

  public decryptLivXow(encryptedData: string): string {
    const cleanInput = encryptedData.replace(/\s+/g, "");
    if (
      cleanInput.startsWith("{") ||
      cleanInput.startsWith("[") ||
      cleanInput.startsWith("#EXTM3U")
    ) {
      return encryptedData.trim();
    }

    try {
      let substituted = "";
      for (let i = 0; i < cleanInput.length; i++) {
        const ch = cleanInput[i];
        substituted += this.substitutionMap.get(ch) ?? ch;
      }

      const padded =
        substituted.length % 4 !== 0
          ? substituted + "=".repeat(4 - (substituted.length % 4))
          : substituted;
      const decodedBytes = Buffer.from(padded, "base64");
      const decipher = createDecipheriv("aes-128-cbc", this.primaryKey, this.primaryIv);
      const decrypted = Buffer.concat([decipher.update(decodedBytes), decipher.final()]);
      return decrypted.toString("utf-8").trim();
    } catch {
      try {
        const decodedBytes = Buffer.from(cleanInput, "base64");
        const decipher = createDecipheriv("aes-128-cbc", this.fallbackKey, this.fallbackIv);
        const decrypted = Buffer.concat([decipher.update(decodedBytes), decipher.final()]);
        return decrypted.toString("utf-8").trim();
      } catch (err) {
        throw new DecryptionError(this.metadata.id, "LivXow-Substitution-AES", err);
      }
    }
  }

  private async fetchWithDomainFailover(path: string, isSubResource = false): Promise<string> {
    if (!isSubResource) {
      this.checkCircuitBreaker();
    }

    const primaryBase = await this.getBaseUrl();
    const bases = isSubResource
      ? [primaryBase]
      : [primaryBase, ...this.fallbackBaseUrls.filter((u) => u !== primaryBase)];

    let lastErr: unknown;
    for (const base of bases) {
      try {
        const res = await this.safeFetch(`${base}/${path.replace(/^\//, "")}`, {
          ignoreCircuitBreaker: true,
        });
        const encText = await res.text();
        const decrypted = this.decryptLivXow(encText);
        this.cachedBaseUrl = base;
        this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
        if (!isSubResource) {
          this.recordSuccess();
        }
        return decrypted;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!isSubResource) {
      this.recordFailure();
    }
    throw lastErr || new Error("LivXow domain failover exhausted");
  }

  async fetchEvents(): Promise<LiveEvent[]> {
    try {
      const decText = await this.fetchWithDomainFailover("events.txt");
      const rawList = JSON.parse(decText);

      if (!Array.isArray(rawList)) {
        return [];
      }

      const liveEvents: LiveEvent[] = [];

      for (let i = 0; i < rawList.length; i++) {
        const item = rawList[i];
        let ev = item;
        if (typeof item?.event === "string" && item.event.trim()) {
          try {
            ev = JSON.parse(item.event);
          } catch {
            continue;
          }
        }

        if (ev.visible === false) continue;

        const teamA = (ev.teamAName || ev.teamA || "").trim();
        const teamB = (ev.teamBName || ev.teamB || "").trim();
        const eventName = (ev.eventName || ev.title || "").trim();
        const matchPart =
          ev.match ||
          (teamA && teamB && teamA !== teamB
            ? `${teamA} vs ${teamB}`
            : teamA || eventName || "Live Event");
        const fullTitle =
          eventName && !matchPart.toLowerCase().includes(eventName.toLowerCase())
            ? `${eventName} (${matchPart})`
            : matchPart;

        const linkPath = (ev.links || "").trim();
        if (!linkPath && !fullTitle) continue;

        const eventId = `livxow_${Buffer.from(linkPath || fullTitle, "utf-8").toString(
          "base64url"
        )}`;

        const source: StreamSource = {
          id: `${eventId}_src`,
          provider: this.metadata.id,
          quality: "1080p",
          format: "DASH",
          streamUrl: `livxow://${linkPath || fullTitle}`,
          status: "ONLINE",
        };

        liveEvents.push({
          id: eventId,
          title: fullTitle,
          category: ev.category || ev.cat || "Sports",
          status: "LIVE",
          poster: ev.eventLogo || ev.teamAFlag,
          startTime: ev.date && ev.time ? `${ev.date} ${ev.time}` : undefined,
          endTime: ev.end_date && ev.end_time ? `${ev.end_date} ${ev.end_time}` : undefined,
          competition: eventName || undefined,
          lastUpdated: new Date().toISOString(),
          sources: [source],
        });
      }

      return liveEvents;
    } catch (error) {
      this.logError("Failed to fetch events from LivXow", error);
      return [];
    }
  }

  async fetchChannels(): Promise<Channel[]> {
    try {
      let decText: string;
      try {
        decText = await this.fetchWithDomainFailover("categories.txt");
      } catch {
        decText = await this.fetchWithDomainFailover("cats.txt");
      }

      const rawList = JSON.parse(decText);
      if (!Array.isArray(rawList)) {
        return [];
      }

      const channels: Channel[] = [];
      for (let idx = 0; idx < rawList.length; idx++) {
        const item = rawList[idx];
        let cat = item;
        if (typeof item?.cat === "string" && item.cat.trim()) {
          try {
            cat = JSON.parse(item.cat);
          } catch {
            continue;
          }
        }

        if (cat.visible === false) continue;

        const linkPath = (cat.api || cat.links || "").trim();
        if (!linkPath) continue;

        const chId = `livxow_cat_${Buffer.from(linkPath, "utf-8").toString("base64url")}`;
        channels.push({
          id: chId,
          name: cat.name || cat.title || `LivXow Channel ${idx + 1}`,
          logo: cat.logo,
          category: "Live TV",
          sources: [
            {
              id: `${chId}_src`,
              provider: this.metadata.id,
              quality: "1080p",
              format: "DASH",
              streamUrl: linkPath.startsWith("http") ? linkPath : `livxow://${linkPath}`,
              status: "ONLINE",
            },
          ],
        });
      }

      return channels;
    } catch (error) {
      this.logError("Failed to fetch channels from LivXow", error);
      return [];
    }
  }

  async resolveStream(id: string): Promise<StreamSource | null> {
    const all = await this.resolveAllStreams(id);
    return all[0] || null;
  }

  async resolveAllStreams(id: string): Promise<StreamSource[]> {
    try {
      let relativeLink = "";
      if (id.startsWith("livxow://")) {
        relativeLink = id.replace("livxow://", "");
      } else if (id.startsWith("livxow_cat_")) {
        const b64 = id.replace("livxow_cat_", "").replace(/_src$/, "");
        relativeLink = Buffer.from(b64, "base64url").toString("utf-8");
      } else if (id.startsWith("livxow_")) {
        const b64 = id.replace("livxow_", "").replace(/_src$/, "");
        relativeLink = Buffer.from(b64, "base64url").toString("utf-8");
      } else {
        return [];
      }

      if (!relativeLink) return [];

      let decText: string;
      try {
        decText = await this.fetchWithDomainFailover(relativeLink, true);
      } catch {
        if (!relativeLink.endsWith(".txt")) {
          decText = await this.fetchWithDomainFailover(`${relativeLink}.txt`, true);
        } else {
          return [];
        }
      }

      let streams: any[] = [];
      try {
        const parsed = JSON.parse(decText);
        streams = Array.isArray(parsed)
          ? parsed
          : parsed.streams || parsed.streamUrls || parsed.links || parsed.data || [];
      } catch {
        const m3uItems = parseM3UPlaylist(decText);
        if (m3uItems.length > 0) {
          return m3uItems.map((item, idx) => ({
            id: `${id}_m3u_${idx}`,
            provider: this.metadata.id,
            quality: item.title.includes("1080") ? "1080p" : "720p",
            title: item.title,
            format: item.format,
            streamUrl: item.streamUrl,
            drm: item.drm,
            headers: item.headers,
            status: "ONLINE",
          }));
        }
      }

      const resolvedSources: StreamSource[] = [];
      for (let i = 0; i < streams.length; i++) {
        let target = streams[i];
        if (typeof target?.channel === "string") {
          try {
            target = JSON.parse(target.channel);
          } catch {
            continue;
          }
        }
        const src = await this.buildStreamSourceFromEntry({
          id: `${id}_resolved_${i}`,
          rawUrl: target.link || target.url || target.m3u8 || "",
          tokenApi: target.tokenApi,
          quality: target.name || target.title || "1080p",
          title: target.name || target.title,
          formatHint: target.type,
          referer: target.referer,
          origin: target.origin,
          userAgent: target.userAgent,
          drmScheme: target.drmScheme || (target.api || target.link_key ? "clearkey" : undefined),
          drmLicense: target.drmLicense || target.api || target.link_key,
        });
        if (src) {
          resolvedSources.push(src);
        }
      }

      return resolvedSources;
    } catch (error) {
      this.logError(`Failed to resolve LivXow streams for ${id}`, error);
      return [];
    }
  }
}
