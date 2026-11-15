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
    version: "1.4.0",
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

  private async fetchWithDomainFailover(
    pathOrPaths: string | string[],
    isSubResource = false
  ): Promise<string> {
    if (!isSubResource) {
      this.checkCircuitBreaker();
    }

    const candidatePaths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
    const primaryBase = await this.getBaseUrl();
    const bases = isSubResource
      ? [primaryBase]
      : [primaryBase, ...this.fallbackBaseUrls.filter((u) => u !== primaryBase)];

    let lastErr: unknown;
    for (const base of bases) {
      for (const p of candidatePaths) {
        try {
          const res = await this.safeFetch(`${base}/${p.replace(/^\//, "")}`, {
            ignoreCircuitBreaker: true,
          });
          const encText = await res.text();
          const decrypted = this.decryptLivXow(encText);
          this.cachedBaseUrl = base;
          this.activeBaseUrl = base;
          this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
          if (!isSubResource) {
            this.recordSuccess();
          }
          return decrypted;
        } catch (err) {
          lastErr = err;
        }
      }
    }
    if (!isSubResource) {
      this.recordFailure(lastErr instanceof Error ? lastErr.message : "LivXow domain failover exhausted");
    }
    throw lastErr || new Error("LivXow domain failover exhausted");
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
    try {
      const decText = await this.fetchWithDomainFailover("events.txt");
      const rawList = JSON.parse(decText);

      if (!Array.isArray(rawList)) {
        return [];
      }

      const liveEvents: LiveEvent[] = [];
      const pendingLookups: Array<{ eventObj: LiveEvent; pointerUri: string }> = [];

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
        const eventName = this.sanitizeOptionalField(ev.eventName || ev.title) || "";
        const isHeadToHead = Boolean(teamA && teamB && teamA.toLowerCase() !== teamB.toLowerCase());
        const matchPart =
          this.sanitizeOptionalField(ev.match) ||
          (isHeadToHead ? `${teamA} vs ${teamB}` : eventName || teamA || "Live Event");
        const fullTitle =
          isHeadToHead && eventName && !matchPart.toLowerCase().includes(eventName.toLowerCase())
            ? `${eventName} (${matchPart})`
            : matchPart;

        const linkPath = (ev.links || "").trim();
        if (!linkPath && !fullTitle) continue;

        const eventId = `livxow_${Buffer.from(linkPath || fullTitle, "utf-8").toString(
          "base64url"
        )}`;

        const pointerUri = `livxow://${linkPath || fullTitle}`;
        const source: StreamSource = {
          id: `${eventId}_src`,
          provider: this.metadata.id,
          quality: "1080p",
          format: "DASH",
          streamUrl: pointerUri,
          status: "ONLINE",
        };

        const teamAFlag = this.sanitizeOptionalUrl(ev.teamAFlag);
        const teamBFlag = this.sanitizeOptionalUrl(ev.teamBFlag);
        const eventBanner = this.sanitizeOptionalUrl(ev.eventBanner);
        const eventType = this.sanitizeOptionalField(ev.eventType);
        const isHot = ev.isHot === "1" || ev.isHot === true;
        const priority = typeof ev.priority === "number" ? ev.priority : undefined;

        const formatHints: Array<{ title: string; logo?: string }> = [];
        const rawHints = ev.link_names || ev.formats;
        if (Array.isArray(rawHints)) {
          for (const h of rawHints) {
            if (typeof h === "string" && h.trim()) {
              formatHints.push({ title: h.trim() });
            } else if (h && typeof h === "object") {
              const t = this.sanitizeOptionalField(h.name || h.title);
              if (t) {
                formatHints.push({ title: t, logo: this.sanitizeOptionalUrl(h.logo) });
              }
            }
          }
        }

        let poster = this.sanitizeOptionalUrl(ev.eventLogo) || eventBanner;
        if (!poster && teamA && teamB) {
          poster = `https://live-card-png.cricify.workers.dev/?title=${encodeURIComponent(
            `${eventType || ev.category || "Sports"} | ${eventName || "Live"}`
          )}&teamA=${encodeURIComponent(teamA)}&flagA=${encodeURIComponent(
            teamAFlag || ""
          )}&teamB=${encodeURIComponent(teamB)}&flagB=${encodeURIComponent(
            teamBFlag || ""
          )}&time=${encodeURIComponent(ev.date && ev.time ? `${ev.date} ${ev.time}` : "LIVE")}`;
        } else if (!poster) {
          poster = teamAFlag;
        }

        const startIso = this.parseProviderDateTime(ev.date, ev.time);
        const endIso = this.parseProviderDateTime(ev.end_date, ev.end_time);
        const status = this.computeEventStatusFromTimes(startIso, endIso);

        const eventObj: LiveEvent = {
          id: eventId,
          title: fullTitle,
          category: ev.category || ev.cat || "Sports",
          status,
          poster,
          teamAFlag,
          teamBFlag,
          eventBanner,
          eventType,
          isHot,
          priority,
          formatHints: formatHints.length > 0 ? formatHints : undefined,
          startTime: startIso,
          endTime: endIso,
          competition: eventName || undefined,
          lastUpdated: new Date().toISOString(),
          sources: [source],
        };

        liveEvents.push(eventObj);

        if (linkPath && pendingLookups.length < 8) {
          pendingLookups.push({ eventObj, pointerUri });
        }
      }

      if (pendingLookups.length > 0) {
        await Promise.allSettled(
          pendingLookups.map(async ({ eventObj, pointerUri }) => {
            const resolved = await this.resolveAllStreams(pointerUri);
            if (resolved.length > 0) {
              eventObj.sources = resolved;
            }
          })
        );
      }

      this.lastEventsExtracted = liveEvents.length;
      return liveEvents;
    } catch (error) {
      this.logError("Failed to fetch events from LivXow", error);
      return [];
    }
  }

  async fetchChannels(): Promise<Channel[]> {
    try {
      const decText = await this.fetchWithDomainFailover(["categories.txt", "cats.txt"]);

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

      this.lastChannelsExtracted = channels.length;
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
      if (/^https?:\/\//i.test(id)) {
        return [
          {
            id: `${this.metadata.id}_direct`,
            provider: this.metadata.id,
            quality: "1080p",
            format: id.includes(".mpd") ? "DASH" : "HLS",
            streamUrl: id,
            status: "ONLINE",
          },
        ];
      }
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

      const built = await Promise.all(
        streams.map(async (rawItem, i) => {
          let target = rawItem;
          if (typeof target?.channel === "string") {
            try {
              target = JSON.parse(target.channel);
            } catch {
              return null;
            }
          }
          if (!target || typeof target !== "object") return null;
          return this.buildStreamSourceFromEntry({
            id: `${id}_resolved_${i}`,
            rawUrl: target.link || target.url || target.stream_url || target.m3u8 || "",
            tokenApi: target.tokenApi,
            quality: target.name || target.title || "1080p",
            title: target.name || target.title,
            formatHint: target.type,
            referer: target.referer,
            origin: target.origin,
            userAgent: target.userAgent,
            drmScheme: target.drmScheme || (target.api || target.drm || target.link_key ? "clearkey" : undefined),
            drmLicense: target.drmLicense || target.drm || target.api || target.link_key,
            extraHeaders: target.headers && typeof target.headers === "object" ? target.headers : undefined,
          });
        })
      );

      return built.filter((s): s is StreamSource => s !== null);
    } catch (error) {
      this.logError(`Failed to resolve LivXow streams for ${id}`, error);
      return [];
    }
  }
}
