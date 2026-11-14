import { Channel, LiveEvent, StreamSource } from "../core/types";
import { parseM3UPlaylist } from "../parsers/m3u.parser";
import { DrmHelper } from "../parsers/drm.helper";
import { AbstractBaseProvider, DecryptionError, ProviderMetadata } from "./base.provider";
import { createDecipheriv } from "node:crypto";

/**
 * SXR3 Sponge & Stream Cipher Constants from `SportzxCryptoUtils.dex` (`SportzxProvider.cs3`)
 * Note: Dalvik `filled-new-array {v2, v3, v4, v0}` encodes register indices `[2, 3, 4, 0]`:
 *   [0] = 0x53585233 ("SXR3")
 *   [1] = 0x9e3779b9 (golden ratio)
 *   [2] = 0x7d3ca820
 *   [3] = 0xc2b2ae3d
 */
const SXR_CONSTS = new Uint32Array([0x53585233, 0x9e3779b9, 0x7d3ca820, 0xc2b2ae3d]);
const CTX_HASH = Buffer.from(
  "1676ec7db4771b0d826d70369b579684b182d2c0133be041bdd55f5d6d79a98b",
  "hex"
);
const V3_PEPPER = Buffer.from(
  "b1657de309d6e790607a5c4ee7d1af4853f571857dc965e65cb56743923a4579",
  "hex"
);
const V3_SXR_LABEL = Buffer.from("SXR3/kdf", "utf8");

function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function sxrQr(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl32(s[d] ^ s[a], 13);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl32(s[b] ^ s[c], 17);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl32(s[d] ^ s[a], 9);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl32(s[b] ^ s[c], 25);
}

function sxrPermute(s: Uint32Array): void {
  for (let i = 0; i < 10; i++) {
    sxrQr(s, 0, 4, 8, 12);
    sxrQr(s, 1, 5, 9, 13);
    sxrQr(s, 2, 6, 10, 14);
    sxrQr(s, 3, 7, 11, 15);
    sxrQr(s, 0, 5, 10, 15);
    sxrQr(s, 1, 6, 11, 12);
    sxrQr(s, 2, 7, 8, 13);
    sxrQr(s, 3, 4, 9, 14);
  }
}

function getU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

function putU32LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
  buf[offset + 2] = (val >>> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

class SxrSponge {
  private readonly state = new Uint32Array(16);
  private readonly buf = new Uint8Array(32);
  private pos = 0;

  constructor() {
    for (let i = 0; i < 16; i++) {
      this.state[i] = Math.imul(0x9e3779b9, i + 1) >>> 0;
    }
  }

  private absorbBlock(data: Uint8Array, offset: number): void {
    for (let i = 0; i < 8; i++) {
      this.state[i] = (this.state[i] ^ getU32LE(data, offset + i * 4)) >>> 0;
    }
    sxrPermute(this.state);
  }

  absorb(data: Uint8Array): void {
    let off = 0;
    let rem = data.length;
    if (this.pos > 0) {
      const take = Math.min(32 - this.pos, rem);
      this.buf.set(data.subarray(0, take), this.pos);
      this.pos += take;
      off += take;
      rem -= take;
      if (this.pos === 32) {
        this.absorbBlock(this.buf, 0);
        this.pos = 0;
      }
    }
    while (rem >= 32) {
      this.absorbBlock(data, off);
      off += 32;
      rem -= 32;
    }
    if (rem > 0) {
      this.buf.set(data.subarray(off, off + rem), 0);
      this.pos = rem;
    }
  }

  squeeze(outLen: number): Buffer {
    this.buf[this.pos] = 0x80;
    for (let i = this.pos + 1; i < 32; i++) {
      this.buf[i] = 0;
    }
    this.absorbBlock(this.buf, 0);
    this.pos = 0;

    const out = Buffer.alloc(outLen);
    let off = 0;
    while (off < outLen) {
      const block = new Uint8Array(32);
      for (let i = 0; i < 8; i++) {
        putU32LE(block, i * 4, this.state[i]);
      }
      const take = Math.min(32, outLen - off);
      out.set(block.subarray(0, take), off);
      off += take;
      if (off < outLen) {
        sxrPermute(this.state);
      }
    }
    return out;
  }
}

function sxrPrf(key: Uint8Array, data: Uint8Array, outLen: number): Buffer {
  const sp = new SxrSponge();
  sp.absorb(key);
  sp.absorb(data);
  return sp.squeeze(outLen);
}

function sxrDerive(salt: Uint8Array): { encWords: Uint32Array; macKey: Buffer } {
  const buf = Buffer.alloc(88);
  V3_SXR_LABEL.copy(buf, 0);
  CTX_HASH.copy(buf, 8);
  V3_PEPPER.copy(buf, 40);
  Buffer.from(salt).copy(buf, 72);

  const sp = new SxrSponge();
  sp.absorb(buf);
  const prk = sp.squeeze(32);

  const k1 = sxrPrf(prk, new Uint8Array([1]), 32);
  const macKey = sxrPrf(prk, new Uint8Array([2]), 32);

  const encWords = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    encWords[i] = getU32LE(k1, i * 4);
  }
  return { encWords, macKey };
}

function sxrBlock(encWords: Uint32Array, counter: number, nonceWords: Uint32Array): Uint8Array {
  const state = new Uint32Array(16);
  state.set(SXR_CONSTS, 0);
  state.set(encWords, 4);
  state[12] = counter >>> 0;
  state.set(nonceWords, 13);

  const working = new Uint32Array(state);
  sxrPermute(working);

  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    putU32LE(out, i * 4, (working[i] + state[i]) >>> 0);
  }
  return out;
}

/**
 * Sportzx Provider Adapter
 * Implements `SportzxCryptoUtils.dex` and `SportzxFirebaseFetcher.kt` from `SportzxProvider.cs3`:
 *  - Dynamic Firebase Remote Config resolution (`234785582029` / `com.sportzxtv.app`)
 *  - Live fallback domains (`https://world.playfy.stream`, `https://android.onlystream.stream`)
 *  - V3 `SXR3` ChaCha20-variant sponge stream cipher & 128-bit MAC tag verification (`decryptV3`)
 *  - Legacy Fallback 1 AES-128-CBC + Fallback 2 AppPassword AES-128-CBC
 *  - Multi-mirror playlist failover
 */
export class SportzxProvider extends AbstractBaseProvider {
  readonly metadata: ProviderMetadata = {
    id: "sportzx",
    name: "Sportzx",
    version: "1.5.0",
    enabled: true,
    categories: ["Football", "Cricket", "Basketball", "Motorsport", "Sports"],
  };

  // Fallback 1 Key & IV from SportzxCryptoUtils.kt
  // Base64("OFVXZmd0ZXdANmw5NUwyPQ==") -> "8UWfdtew@6l95L2="
  private readonly fallbackKey1 = Buffer.from("385557666474657740366c39354c323d", "hex");
  // Base64("MWlSSCFLJnR6M2hiJWJTdw==") -> "1iRH!K&tz3hb%bSw"
  private readonly fallbackIv1 = Buffer.from("31695248214b26747a33686225625377", "hex");

  // Fallback 2 Key & IV from SportzxCryptoUtils.kt
  // Base64("NmF5Sjdqb0BhbyNweFZjJQ==") -> "6ayJ7jo@ao#pxVc%"
  private readonly fallbackKey2 = Buffer.from("6ayJ7jo@ao#pxVc%", "utf-8");
  // Base64("SHNqSlRDQTdqSnp0cEwydw==") -> "HsjJTCA7jJztpL2w"
  private readonly fallbackIv2 = Buffer.from("HsjJTCA7jJztpL2w", "utf-8");

  private readonly fallbackBaseUrls = [
    "https://world.playfy.stream",
    "https://android.onlystream.stream",
  ];

  private cachedDynamicBaseUrl: string | null = null;
  private dynamicUrlExpiresAt = 0;

  private readonly m3uMirrors = [
    "https://raw.githubusercontent.com/Jitendra-unatti/fancode/refs/heads/main/data/fancode.m3u",
    "https://github.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/raw/main/ALL.m3u",
    "https://iptv-org.github.io/iptv/categories/sports.m3u",
  ];

  /**
   * Decrypts Sportzx V3 `SXR3` sponge stream cipher payload (`0x03 || salt[16] || nonce[12] || tag[16] || ciphertext`)
   */
  public decryptV3(input: string): string {
    let b64 = input.trim();
    if (b64.startsWith("{")) {
      const parsed = JSON.parse(b64);
      if (typeof parsed.data === "string") {
        b64 = parsed.data.trim();
      }
    }

    const normalized = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    const blob = Buffer.from(normalized, "base64");
    if (blob.length < 45 || blob[0] !== 3) {
      throw new DecryptionError(this.metadata.id, "Sportzx-V3-SXR3");
    }

    const salt = blob.subarray(1, 17);
    const nonce = blob.subarray(17, 29);
    const tag = blob.subarray(29, 45);
    const ct = blob.subarray(45);

    const { encWords, macKey } = sxrDerive(salt);

    const macSp = new SxrSponge();
    macSp.absorb(macKey);
    macSp.absorb(blob.subarray(0, 29));
    macSp.absorb(ct);
    const expectedTag = macSp.squeeze(16);

    let diff = 0;
    for (let i = 0; i < 16; i++) {
      diff |= tag[i] ^ expectedTag[i];
    }
    if (diff !== 0) {
      throw new DecryptionError(this.metadata.id, "Sportzx-V3-MAC-Mismatch");
    }

    const nonceWords = new Uint32Array(3);
    for (let i = 0; i < 3; i++) {
      nonceWords[i] = getU32LE(nonce, i * 4);
    }

    const pt = Buffer.alloc(ct.length);
    let off = 0;
    let counter = 1;
    while (off < ct.length) {
      const ks = sxrBlock(encWords, counter++, nonceWords);
      const take = Math.min(64, ct.length - off);
      for (let i = 0; i < take; i++) {
        pt[off + i] = ct[off + i] ^ ks[i];
      }
      off += take;
    }

    return pt.toString("utf8").trim();
  }

  /**
   * Decrypts legacy Sportzx payload using Fallback 1 AES-128-CBC key/IV
   */
  public decryptFallback(encryptedBase64: string): string {
    try {
      const cleanInput = encryptedBase64.replace(/\s+/g, "");
      const decodedBytes = Buffer.from(cleanInput, "base64");
      const decipher = createDecipheriv("aes-128-cbc", this.fallbackKey1, this.fallbackIv1);
      const decrypted = Buffer.concat([decipher.update(decodedBytes), decipher.final()]);
      return decrypted.toString("utf-8").trim();
    } catch (error) {
      throw new DecryptionError(this.metadata.id, "Sportzx-Fallback-AES", error);
    }
  }

  /**
   * Decrypts legacy Sportzx payload using Fallback 2 AES-128-CBC key/IV
   */
  public decryptFallback2(encryptedBase64: string): string {
    try {
      const cleanInput = encryptedBase64.replace(/\s+/g, "");
      const decodedBytes = Buffer.from(cleanInput, "base64");
      const decipher = createDecipheriv("aes-128-cbc", this.fallbackKey2, this.fallbackIv2);
      const decrypted = Buffer.concat([decipher.update(decodedBytes), decipher.final()]);
      return decrypted.toString("utf-8").trim();
    } catch (error) {
      throw new DecryptionError(this.metadata.id, "Sportzx-Fallback2-AES", error);
    }
  }

  /**
   * Unified Sportzx payload decoder (V3 SXR3 envelope + direct JSON passthrough + Fallback 1 + Fallback 2)
   */
  public decryptSportzx(rawText: string): string {
    const trimmed = rawText.trim();

    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.data === "string" && Object.keys(parsed).length === 1) {
          try {
            return this.decryptV3(parsed.data);
          } catch {
            try {
              return this.decryptFallback(parsed.data);
            } catch {
              return this.decryptFallback2(parsed.data);
            }
          }
        }
      } catch {
        // Fall through
      }
      return trimmed;
    }

    if (trimmed.startsWith("[") || trimmed.startsWith("#EXTM3U")) {
      return trimmed;
    }

    try {
      return this.decryptV3(trimmed);
    } catch {
      try {
        return this.decryptFallback(trimmed);
      } catch {
        return this.decryptFallback2(trimmed);
      }
    }
  }

  /**
   * Queries Sportzx Firebase Remote Config (Project 234785582029)
   */
  public async fetchDynamicBaseUrl(): Promise<string | null> {
    if (this.cachedDynamicBaseUrl && Date.now() < this.dynamicUrlExpiresAt) {
      return this.cachedDynamicBaseUrl;
    }

    const entries = await this.fetchFirebaseRemoteConfig({
      projectIdOrNumber: "234785582029",
      apiKey: "AIzaSyCTIFo_vw_-XrjzDeE1yG4KuAqGLchzZ0M",
      appId: "1:234785582029:android:f5f9299eaa7a0d73c93284",
      packageName: "com.sportzxtv.app",
      certSha1: "C506E5FE9C49CABD6A5AEAC643B7C3AA3C3FE9CF",
    });

    if (entries) {
      const baseUrl = entries.api_url || entries.base_url || entries.sportzx_api;
      if (baseUrl && baseUrl.startsWith("http")) {
        this.cachedDynamicBaseUrl = baseUrl.replace(/\/$/, "");
        this.dynamicUrlExpiresAt = Date.now() + 1800 * 1000;
        return this.cachedDynamicBaseUrl;
      }
    }

    return this.fallbackBaseUrls[0];
  }

  private async fetchEventChannelStreams(
    baseUrl: string,
    eventId: string | number,
    eventTitle: string
  ): Promise<StreamSource[]> {
    try {
      const res = await this.safeFetch(`${baseUrl}/channels/${eventId}.json`, {
        headers: { "User-Agent": "okhttp/4.12.0" },
        timeoutMs: 4000,
        ignoreCircuitBreaker: true,
      });
      const rawText = await res.text();
      const decText = this.decryptSportzx(rawText);
      const parsed = JSON.parse(decText);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed.streams || parsed.streamUrls || parsed.data || [];

      const sources: StreamSource[] = [];
      for (const s of list) {
        const rawUrl = typeof s === "string" ? s : s.url || s.link || s.stream_url || "";
        if (!rawUrl) continue;
        const src = await this.buildStreamSourceFromEntry({
          id: `sportzx_${eventId}_${sources.length}`,
          rawUrl,
          tokenApi: typeof s === "object" ? s.tokenApi : undefined,
          quality: (typeof s === "object" && (s.name || s.title || s.quality)) || "1080p",
          title: (typeof s === "object" && (s.name || s.title)) || eventTitle,
          referer: typeof s === "object" ? s.referer : undefined,
          origin: typeof s === "object" ? s.origin : undefined,
          userAgent: typeof s === "object" ? s.userAgent : undefined,
          drmScheme: typeof s === "object" ? s.drmScheme : undefined,
          drmLicense: typeof s === "object" ? s.api || s.drmLicense : undefined,
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

  async fetchEvents(): Promise<LiveEvent[]> {
    const dynUrl = await this.fetchDynamicBaseUrl();
    const candidates = [
      ...(dynUrl ? [dynUrl] : []),
      ...this.fallbackBaseUrls.filter((u) => u !== dynUrl),
    ];

    for (const baseUrl of candidates) {
      const endpoints = [`${baseUrl}/events.json`, `${baseUrl}/events.txt`];
      for (const endpoint of endpoints) {
        try {
          const res = await this.safeFetch(endpoint, {
            headers: { "User-Agent": "okhttp/4.12.0" },
          });
          const rawText = await res.text();
          const decText = this.decryptSportzx(rawText);
          const parsed = JSON.parse(decText);
          const eventsArray = Array.isArray(parsed) ? parsed : parsed.events || parsed.data || [];

          if (Array.isArray(eventsArray) && eventsArray.length > 0) {
            const liveEvents: LiveEvent[] = [];
            const pendingChannelLookups: Array<{
              eventObj: LiveEvent;
              eventId: string | number;
            }> = [];

            for (let idx = 0; idx < eventsArray.length; idx++) {
              const ev = eventsArray[idx];
              const meta = ev.event_meta || ev.eventInfo || {};
              const teamA = meta.teamAName || ev.teamA || "";
              const teamB = meta.teamBName || ev.teamB || "";

              let fullTitle = ev.match || ev.title || "Live Match";
              if (teamA && teamB && !fullTitle.toLowerCase().includes(" vs ")) {
                const sub = ev.sub_title || ev.title;
                fullTitle = sub ? `${teamA} vs ${teamB} (${sub})` : `${teamA} vs ${teamB}`;
              }

              const rawLinks = Array.isArray(ev.links)
                ? ev.links
                : Array.isArray(ev.streams)
                ? ev.streams
                : ev.link
                ? [{ link: ev.link }]
                : [];

              const sources: StreamSource[] = [];
              for (const s of rawLinks) {
                const rawUrl = typeof s === "string" ? s : s.link || s.url || "";
                if (!rawUrl) continue;
                const src = await this.buildStreamSourceFromEntry({
                  id: `sportzx_dyn_src_${ev.id || idx}_${sources.length}`,
                  rawUrl,
                  tokenApi: typeof s === "object" ? s.tokenApi : undefined,
                  quality: (typeof s === "object" && (s.name || s.title)) || "1080p",
                  title: (typeof s === "object" && (s.name || s.title)) || fullTitle,
                  referer: typeof s === "object" ? s.referer : undefined,
                  origin: typeof s === "object" ? s.origin : undefined,
                  userAgent: typeof s === "object" ? s.userAgent : undefined,
                  drmScheme: typeof s === "object" ? s.drmScheme : undefined,
                  drmLicense: typeof s === "object" ? s.api || s.drmLicense : undefined,
                });
                if (src) {
                  sources.push(src);
                }
              }

              const startSec = Number(meta.startTime || 0);
              const endSec = Number(meta.endTime || 0);
              const nowSec = Math.floor(Date.now() / 1000);
              let status: "LIVE" | "UPCOMING" | "ENDED" = "LIVE";
              if (startSec > 0 && endSec > 0) {
                if (nowSec < startSec - 900) status = "UPCOMING";
                else if (nowSec > endSec) status = "ENDED";
              }

              const eventObj: LiveEvent = {
                id: `sportzx_dyn_${ev.id || idx}`,
                title: fullTitle,
                category: ev.category || ev.cat || "Sports",
                status,
                poster: ev.thumb || ev.eventLogo || meta.teamAFlag || ev.teamAFlag,
                startTime:
                  startSec > 0
                    ? new Date(startSec * 1000).toISOString()
                    : ev.date && ev.time
                    ? `${ev.date} ${ev.time}`
                    : undefined,
                endTime:
                  endSec > 0
                    ? new Date(endSec * 1000).toISOString()
                    : ev.end_date && ev.end_time
                    ? `${ev.end_date} ${ev.end_time}`
                    : undefined,
                competition: ev.sub_title || ev.title || undefined,
                lastUpdated: new Date().toISOString(),
                sources,
              };

              if (sources.length > 0) {
                liveEvents.push(eventObj);
              } else if (ev.id !== undefined && pendingChannelLookups.length < 8) {
                pendingChannelLookups.push({ eventObj, eventId: ev.id });
              }
            }

            if (pendingChannelLookups.length > 0) {
              await Promise.allSettled(
                pendingChannelLookups.map(async ({ eventObj, eventId }) => {
                  const resolved = await this.fetchEventChannelStreams(
                    baseUrl,
                    eventId,
                    eventObj.title
                  );
                  if (resolved.length > 0) {
                    eventObj.sources = resolved;
                    liveEvents.push(eventObj);
                  }
                })
              );
            }

            if (liveEvents.length > 0) return liveEvents;
          }
        } catch {
          // Try next endpoint / baseUrl
        }
      }
    }

    const channels = await this.fetchChannels();
    return channels.slice(0, 30).map((ch, idx) => ({
      id: `sportzx_ev_${idx}_${Buffer.from(ch.name).toString("hex").slice(0, 6)}`,
      title: ch.name,
      category: ch.category,
      status: "LIVE",
      poster: ch.logo,
      lastUpdated: new Date().toISOString(),
      sources: ch.sources,
    }));
  }

  async fetchChannels(): Promise<Channel[]> {
    for (const mirror of this.m3uMirrors) {
      try {
        const res = await this.safeFetch(mirror);
        const text = await res.text();
        const items = parseM3UPlaylist(text);

        const sportsItems = items
          .filter((item) => {
            const g = (item.group || "").toLowerCase();
            const t = item.title.toLowerCase();
            return (
              g.includes("sport") ||
              g.includes("fancode") ||
              t.includes("sport") ||
              t.includes("vs") ||
              t.includes("cricket") ||
              t.includes("football") ||
              t.includes("f1") ||
              t.includes("ufc") ||
              t.includes("wwe") ||
              t.includes("bein") ||
              t.includes("sky") ||
              t.includes("tnt") ||
              t.includes("espn")
            );
          })
          .slice(0, 60);

        if (sportsItems.length > 0) {
          return sportsItems.map((item, idx) => {
            const source: StreamSource = {
              id: `sportzx_src_${idx}`,
              provider: this.metadata.id,
              quality: item.title.includes("1080") || item.title.includes("FHD") ? "1080p" : "720p",
              title: item.title,
              format: item.format,
              streamUrl: item.streamUrl,
              headers: item.headers,
              drm: item.drm,
              status: "ONLINE",
            };
            source.fingerprint = DrmHelper.generateFingerprint(source);

            return {
              id: `sportzx_ch_${idx}`,
              name: item.title,
              logo: item.logo,
              category: "Sports",
              group: item.group || "Sports Network",
              sources: [source],
            };
          });
        }
      } catch (err) {
        this.logWarn(`Mirror failed (${mirror}): ${(err as Error).message}`);
      }
    }

    return [];
  }

  async resolveStream(id: string): Promise<StreamSource | null> {
    if (id.startsWith("sportzx_dyn_")) {
      const eventId = id.replace(/^sportzx_dyn_/, "");
      const baseUrl = (await this.fetchDynamicBaseUrl()) || this.fallbackBaseUrls[0];
      const sources = await this.fetchEventChannelStreams(baseUrl, eventId, eventId);
      if (sources.length > 0) return sources[0];
    }

    const events = await this.fetchEvents();
    const ev = events.find((e) => e.id === id);
    if (ev && ev.sources.length > 0) return ev.sources[0];

    const channels = await this.fetchChannels();
    const ch = channels.find((c) => c.id === id);
    return ch?.sources[0] || null;
  }
}
