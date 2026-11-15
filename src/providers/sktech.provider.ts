import { Channel, LiveEvent, StreamSource } from "../core/types";
import { parseM3UPlaylist } from "../parsers/m3u.parser";
import { AbstractBaseProvider, DecryptionError, ProviderMetadata } from "./base.provider";
import { createDecipheriv } from "node:crypto";

/**
 * SKTech Provider Adapter
 * Faithfully reproduces `SKLiveCryptoUtils.kt`, `FirebaseRemoteConfigFetcher.kt`, and `ProviderManager.kt`
 * from `SKTechProvider.cs3`:
 *  - Dynamic Firebase Remote Config resolution (`330162934410` / `com.live.sktechtv`)
 *  - `decryptLegacy`: `LOOKUP_TABLE_D` custom Base64 -> UTF-8 decode -> reverse -> Base64 -> AES-128-CBC (`l2l5kB7xC5qP1rK1` / `p1K5nP7uB8hH1l19`)
 *  - `decryptV23`: Base64 -> adjacent byte-pair swap -> reverse -> Base64 -> AES-128-CBC (`V9LQR42pNKc7smaX` / `d2WT1lR4ckEvUsdk`)
 *  - `decryptFallbackB` & `decryptFallbackC` & `preprocessResponse` (64-char hex header strip)
 *  - Nested wrapper parsing (`[{"event": "<inner JSON>"}]` and `[{"cat": "<inner JSON>"}]`)
 */
export class SKTechProvider extends AbstractBaseProvider {
  readonly metadata: ProviderMetadata = {
    id: "sktech",
    name: "SKTech Sports",
    version: "2.5.0",
    enabled: true,
    categories: ["Cricket", "Football", "Sports", "Live TV"],
  };

  private readonly fallbackBaseUrls = [
    "https://kk001-a17.pages.dev",
    "https://welalagaa.site",
    "https://matkeritnagurorxbxb.store",
  ];

  // Lookup Table D from SKLiveCryptoUtils.kt
  private readonly lookupTableD =
    "\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\b\t\n\u000B\u000C\r\u000E\u000F" +
    "\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F" +
    " !\"#$%&'()*+,-./" +
    "0123456789:;<=>?" +
    "@EGMNKABUVCDYHLI" +
    "FPOZQSRWTXJ[\\]^_" +
    "`egmnkabuvcdyhli" +
    "fpozqsrwtxj{|}~\u007F";

  // Legacy & Fallback C Key/IV ("6c326c356b4237784335715031724b31" / "70314b356e50377542386848316c3139")
  private readonly legacyAndFallbackCKey = Buffer.from("l2l5kB7xC5qP1rK1", "utf-8");
  private readonly legacyAndFallbackCIv = Buffer.from("p1K5nP7uB8hH1l19", "utf-8");

  // V23 Key/IV from SKTechProvider.cs3 classes.dex
  private readonly v23DexKey = Buffer.from("V9LQR42pNKc7smaX", "utf-8");
  private readonly v23DexIv = Buffer.from("d2WT1lR4ckEvUsdk", "utf-8");

  // Fallback B Key/IV from SKTechProvider.cs3 classes.dex
  private readonly fallbackBDexKey = Buffer.from("I=4dkwPiOuROD+pD", "utf-8");
  private readonly fallbackBDexIv = Buffer.from("ST00ZGt3UGlPdVJP", "utf-8");

  // Additional compatibility keys
  private readonly primaryKey = Buffer.from("YTBiMWMyZDNlNGY1ZzZoNw==", "base64");
  private readonly primaryIv = Buffer.from("aThqOWsMDFsMm0zbjRvNQ==", "base64");
  private readonly primarySubFrom = "xXyYzZaAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwW";
  private readonly primarySubTo = "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ";

  private readonly fallbackBKey = Buffer.from("ZEs3c1A5bVgycVc1ZVI4dA==", "base64");
  private readonly fallbackBIv = Buffer.from("ZkczEo2a0wwelg0Y1YxYg==", "base64");
  private readonly fallbackBSubFrom = "pPqQrRsStTuUvVwWxXyYzZaAbBcCdDeEfFgGhHiIjJkKlLmMnNoO";
  private readonly fallbackBSubTo = "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ";

  private cachedBaseUrl: string | null = null;
  private baseUrlExpiresAt = 0;

  constructor() {
    super();
    this.defaultUserAgent = "okhttp/4.12.0";
  }

  private async getBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl && Date.now() < this.baseUrlExpiresAt) {
      return this.cachedBaseUrl;
    }

    const entries = await this.fetchFirebaseRemoteConfig({
      projectIdOrNumber: "330162934410",
      apiKey: "AIzaSyClGjK1EBL-ZLbCoep1z5QSmwMyHshimSk",
      appId: "1:330162934410:android:0d81c4732e3d206d6cd373",
      packageName: "com.live.sktechtv",
    });

    if (entries) {
      const dynamicUrl =
        entries.api_url || entries.base_url || entries.sktech_api || entries.domain;
      if (dynamicUrl && dynamicUrl.startsWith("http")) {
        this.cachedBaseUrl = dynamicUrl.replace(/\/$/, "");
        this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
        return this.cachedBaseUrl;
      }
    }

    return this.fallbackBaseUrls[0];
  }

  private customToStandardBase64(customB64: string): string {
    let out = "";
    for (let i = 0; i < customB64.length; i++) {
      const code = customB64.charCodeAt(i);
      out += code < this.lookupTableD.length ? this.lookupTableD[code] : customB64[i];
    }
    return out;
  }

  private substitute(input: string, from: string, to: string): string {
    const map = new Map<string, string>();
    for (let i = 0; i < from.length; i++) {
      map.set(from[i], to[i]);
    }
    let out = "";
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      out += map.get(ch) ?? ch;
    }
    return out;
  }

  private tryAesDecrypt(b64Data: string, key: Buffer, iv: Buffer): string | null {
    try {
      if (key.length !== 16 || iv.length !== 16) return null;
      const clean = b64Data.replace(/\s+/g, "");
      const padded =
        clean.length % 4 !== 0 ? clean + "=".repeat(4 - (clean.length % 4)) : clean;
      const decodedBytes = Buffer.from(padded, "base64");
      if (decodedBytes.length === 0 || decodedBytes.length % 16 !== 0) return null;
      const decipher = createDecipheriv("aes-128-cbc", key, iv);
      const decrypted = Buffer.concat([decipher.update(decodedBytes), decipher.final()]);
      const str = decrypted.toString("utf-8").trim();
      if (str.startsWith("[") || str.startsWith("{") || str.startsWith("#EXTM3U")) {
        return str;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Implements `decryptLegacy` from `SKLiveCryptoUtils.kt`:
   *  1. `customToStandardBase64` (`LOOKUP_TABLE_D`)
   *  2. `Base64.decode` -> UTF-8 string
   *  3. `.reverse()`
   *  4. `Base64.decode` -> AES-128-CBC (`l2l5kB7xC5qP1rK1` / `p1K5nP7uB8hH1l19`)
   */
  public decryptLegacyLookup(encryptedData: string): string | null {
    try {
      const standardB64 = this.customToStandardBase64(encryptedData);
      const padded1 =
        standardB64.length % 4 !== 0
          ? standardB64 + "=".repeat(4 - (standardB64.length % 4))
          : standardB64;
      const decodedStr = Buffer.from(padded1, "base64").toString("utf-8").trim();
      const reversedStr = decodedStr.split("").reverse().join("");
      return this.tryAesDecrypt(reversedStr, this.legacyAndFallbackCKey, this.legacyAndFallbackCIv);
    } catch {
      return null;
    }
  }

  /**
   * Implements `decryptV23` from `SKLiveCryptoUtils.kt`:
   *  1. `Base64.decode`
   *  2. Swap adjacent byte pairs `(i, i+1)`
   *  3. Reverse byte array
   *  4. `Base64.decode` -> AES-128-CBC (`V9LQR42pNKc7smaX` / `d2WT1lR4ckEvUsdk`)
   */
  public decryptV23(encryptedData: string): string | null {
    try {
      const padded =
        encryptedData.length % 4 !== 0
          ? encryptedData + "=".repeat(4 - (encryptedData.length % 4))
          : encryptedData;
      const inner = Buffer.from(padded, "base64");
      for (let i = 0; i < inner.length - 1; i += 2) {
        const tmp = inner[i];
        inner[i] = inner[i + 1];
        inner[i + 1] = tmp;
      }
      inner.reverse();
      const innerB64 = inner.toString("utf-8").trim();
      return this.tryAesDecrypt(innerB64, this.v23DexKey, this.v23DexIv);
    } catch {
      return null;
    }
  }

  /**
   * Strips optional 64-character hex integrity prefix (`preprocessResponse` in `SKLiveCryptoUtils.kt`).
   */
  public preprocessResponse(response: string): string {
    const trimmed = response.trim();
    if (trimmed.length <= 64) return trimmed;
    const prefix = trimmed.slice(0, 64);
    if (/^[0-9a-fA-F]{64}$/.test(prefix)) {
      return trimmed.slice(64).trim();
    }
    if (trimmed.startsWith("BA@GBA@GBA@GBA@G")) {
      return trimmed.slice(64).trim();
    }
    return trimmed;
  }

  public decryptPayload(rawResponse: string): string {
    const cleanInput = this.preprocessResponse(rawResponse).replace(/\s+/g, "");

    if (
      cleanInput.startsWith("[") ||
      cleanInput.startsWith("{") ||
      cleanInput.startsWith("#EXTM3U")
    ) {
      return rawResponse.trim();
    }

    // 1. SKLiveCryptoUtils.decryptLegacy (LOOKUP_TABLE_D + Base64 + Reverse + Base64 + AES)
    const resLegacyLookup = this.decryptLegacyLookup(cleanInput);
    if (resLegacyLookup) return resLegacyLookup;

    // 2. SKLiveCryptoUtils.decryptLegacy on Base64-unwrapped input
    try {
      const unwrapped = Buffer.from(cleanInput, "base64").toString("utf-8").trim();
      const resUnwrapped = this.decryptLegacyLookup(unwrapped);
      if (resUnwrapped) return resUnwrapped;
    } catch {
      // Ignore
    }

    // 3. SKLiveCryptoUtils.decryptV23 (Byte-swap + Reverse + AES)
    const resV23 = this.decryptV23(cleanInput);
    if (resV23) return resV23;

    // 4. Fallback C (Direct AES-128-CBC with l2l5kB7xC5qP1rK1 / p1K5nP7uB8hH1l19)
    const resC = this.tryAesDecrypt(
      cleanInput,
      this.legacyAndFallbackCKey,
      this.legacyAndFallbackCIv
    );
    if (resC) return resC;

    // 5. Fallback B Dex Key (Direct or substituted)
    const resBDex = this.tryAesDecrypt(cleanInput, this.fallbackBDexKey, this.fallbackBDexIv);
    if (resBDex) return resBDex;

    // 6. Primary V25 (Substitution + AES)
    const subPrimary = this.substitute(cleanInput, this.primarySubFrom, this.primarySubTo);
    const resPrimary = this.tryAesDecrypt(subPrimary, this.primaryKey, this.primaryIv);
    if (resPrimary) return resPrimary;

    // 7. Fallback B (Substitution + AES)
    const subB = this.substitute(cleanInput, this.fallbackBSubFrom, this.fallbackBSubTo);
    const resB = this.tryAesDecrypt(subB, this.fallbackBKey, this.fallbackBIv);
    if (resB) return resB;

    throw new DecryptionError(this.metadata.id, "SKTech-MultiPass-AES");
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
        const decrypted = this.decryptPayload(encText);
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
    throw lastErr || new Error("SKTech domain failover exhausted");
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

        const eventId = `sktech_b64_${Buffer.from(linkPath || fullTitle, "utf-8").toString(
          "base64url"
        )}`;

        const pointerUri = `sktech://${linkPath || fullTitle}`;
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

        const eventObj: LiveEvent = {
          id: eventId,
          title: fullTitle,
          category: ev.category || ev.cat || "Sports",
          status: "LIVE",
          poster,
          teamAFlag,
          teamBFlag,
          eventBanner,
          eventType,
          isHot,
          priority,
          formatHints: formatHints.length > 0 ? formatHints : undefined,
          startTime: ev.date && ev.time ? `${ev.date} ${ev.time}` : undefined,
          endTime: ev.end_date && ev.end_time ? `${ev.end_date} ${ev.end_time}` : undefined,
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

      return liveEvents;
    } catch (error) {
      this.logError("Failed to fetch events from SKTech", error);
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

        const chId = `sktech_cat_b64_${Buffer.from(linkPath, "utf-8").toString("base64url")}`;
        channels.push({
          id: chId,
          name: cat.name || cat.title || `SKTech Channel ${idx + 1}`,
          logo: cat.logo,
          category: "Live TV",
          sources: [
            {
              id: `${chId}_src`,
              provider: this.metadata.id,
              quality: "1080p",
              format: "DASH",
              streamUrl: linkPath.startsWith("http") ? linkPath : `sktech://${linkPath}`,
              status: "ONLINE",
            },
          ],
        });
      }

      return channels;
    } catch (error) {
      this.logError("Failed to fetch channels from SKTech", error);
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
      if (id.startsWith("sktech://")) {
        relativeLink = id.replace("sktech://", "");
      } else if (id.startsWith("sktech_cat_b64_")) {
        const b64 = id.replace("sktech_cat_b64_", "").replace(/_src$/, "");
        relativeLink = Buffer.from(b64, "base64url").toString("utf-8");
      } else if (id.startsWith("sktech_b64_")) {
        const b64 = id.replace("sktech_b64_", "").replace(/_src$/, "");
        relativeLink = Buffer.from(b64, "base64url").toString("utf-8");
      } else if (id.startsWith("sktech_cat_")) {
        relativeLink = id.replace("sktech_cat_", "").replace(/_src$/, "").replace(/_/g, "/");
      } else if (id.startsWith("sktech_")) {
        relativeLink = id.replace("sktech_", "").replace(/_src$/, "").replace(/_/g, "/");
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
          });
        })
      );

      return built.filter((s): s is StreamSource => s !== null);
    } catch (error) {
      this.logError(`Failed to resolve SKTech streams for ${id}`, error);
      return [];
    }
  }
}
