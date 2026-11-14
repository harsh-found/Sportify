import { Channel, LiveEvent, StreamSource } from "../core/types";
import { parseM3UPlaylist } from "../parsers/m3u.parser";
import { DrmHelper } from "../parsers/drm.helper";
import { AbstractBaseProvider, ProviderMetadata } from "./base.provider";
import { createDecipheriv } from "node:crypto";

const MASK32 = 0xffffffffn;

function s32(x: bigint | number): bigint {
  return BigInt.asIntN(32, BigInt(x));
}

function u32(x: bigint | number): bigint {
  return BigInt.asUintN(32, BigInt(x));
}

function fnv1a32(str: string, seed: bigint): bigint {
  let h = u32(seed);
  for (let i = 0; i < str.length; i++) {
    const ch = BigInt(str.charCodeAt(i));
    h = u32((s32(h) ^ s32(ch)) * s32(0x01000193n));
  }
  return h;
}

/**
 * PlayFy TV Provider Adapter
 * Implements the exact Dalvik bytecode FNV-1a 32-bit key/IV derivation algorithm (`0x811c9dc5n` / `0x811c832an`)
 * and AES-128-CBC NoPadding decryption from `PlayFyProvider.cs3` (`com.cncverse.CryptoUtils`).
 */
export class PlayFyProvider extends AbstractBaseProvider {
  readonly metadata: ProviderMetadata = {
    id: "playfy",
    name: "PlayFy TV",
    version: "4.1.0",
    enabled: true,
    categories: ["Cricket", "Football", "Sports"],
  };

  // Extracted from PlayFyProvider.cs3 Dex bytecode
  private readonly loraSeed =
    "zH7hY9@lO=8uXk#f%mI/VvJd2G10Z5eU+L6Pi&aEbwA4scBCStQ3KyWqRjDgnoMRP";
  private readonly sigSeed = "Mc1pOdG+rjLRsO8tlGCxcBFqGIU";

  private cachedBaseUrl: string | null = null;
  private baseUrlExpiresAt = 0;

  // Exact fallback base URLs extracted from PlayFyProvider.cs3 classes.dex
  private readonly fallbackUrls = [
    "https://easypdfmaker.online",
    "https://reliablewebcenter.online",
  ];

  /**
   * PlayFy Custom 32-bit FNV-1a Hash Function
   * Matches `CryptoUtils.fnv1a32(String, long)` in PlayFy CS3 Dex bytecode:
   *   default seed = 0x811c9dc5 (2166136261)
   *   prime        = 0x01000193 (16777619)
   */
  public fnv1aHash(input: string, seed: bigint = 0x811c9dc5n): number {
    let hash = seed & MASK32;
    const prime = 0x01000193n;

    for (let i = 0; i < input.length; i++) {
      const charCode = BigInt(input.charCodeAt(i) & 0xffff);
      hash = ((hash ^ charCode) * prime) & MASK32;
    }

    return Number(BigInt.asIntN(32, hash));
  }

  /**
   * Derives 16-byte AES Key from lora and sig strings (`CryptoUtils.deriveKey(lora, sig)`)
   * Verified against PlayFyProvider.cs3 classes.dex -> produces `"BR4weRP=5A/Y&8%5"` for default seeds.
   */
  public deriveKey(lora: string = this.loraSeed, sig: string = this.sigSeed): Buffer {
    let h = fnv1a32(sig, 0x811c9dc5n);
    const out = Buffer.alloc(16);
    const lenLora = BigInt(lora.length);
    const lenSig = sig.length;
    let j = 0n;

    for (let i = 0; i < 16; i++) {
      const ch = BigInt(sig.charCodeAt(i % lenSig));
      const v8 = s32(ch) + s32(j);
      const v6 = s32(s32(h) * 31n);
      h = u32(v8 ^ v6);
      const idx = Number(h % lenLora);
      out[i] = lora.charCodeAt(idx);
      j = u32(j + 13n);
    }
    return out;
  }

  /**
   * Derives 16-byte AES IV from lora and sig strings (`CryptoUtils.deriveIv(lora, sig)`)
   * Verified against PlayFyProvider.cs3 classes.dex -> produces `"Va+XYCKnkinUMDvk"` for default seeds.
   */
  public deriveIv(lora: string = this.loraSeed, sig: string = this.sigSeed): Buffer {
    let h = fnv1a32(sig, 0x811c832an);
    const out = Buffer.alloc(16);
    const lenLora = BigInt(lora.length);
    const lenSig = sig.length;
    let outIdx = 0;
    let j = 0n;

    for (let i = 0; i <= 45; i += 3) {
      const ch = BigInt(sig.charCodeAt(i % lenSig));
      const v9 = s32(ch) + s32(j);
      const v6 = s32(s32(h) * 29n);
      h = u32(v9 ^ v6);
      const idx = Number(h % lenLora);
      out[outIdx++] = lora.charCodeAt(idx);
      j = u32(j + 7n);
    }
    return out;
  }

  /**
   * Decrypts PlayFy Base64 ciphertext or `{"data":"..."}` envelope using derived AES-128-CBC key & IV
   */
  public decryptPlayFy(cipherTextB64: string): string {
    let clean = cipherTextB64.trim();

    if (clean.startsWith("{")) {
      try {
        const parsed = JSON.parse(clean);
        if (parsed && typeof parsed.data === "string" && Object.keys(parsed).length === 1) {
          clean = parsed.data.trim();
        } else {
          return clean;
        }
      } catch {
        return clean;
      }
    } else if (clean.startsWith("[") || clean.startsWith("#EXTM3U")) {
      return clean;
    }

    const key = this.deriveKey();
    const iv = this.deriveIv();

    // Try with NoPadding first (as in PlayFy Dex: AES/CBC/NoPadding + manual PKCS7 / null strip)
    try {
      const rawBytes = Buffer.from(clean.replace(/\s+/g, ""), "base64");
      const decipher = createDecipheriv("aes-128-cbc", key, iv);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(rawBytes), decipher.final()]);

      let len = decrypted.length;
      if (len > 0) {
        const padByte = decrypted[len - 1];
        if (padByte >= 1 && padByte <= 16) {
          let validPad = true;
          for (let i = len - padByte; i < len; i++) {
            if (decrypted[i] !== padByte) {
              validPad = false;
              break;
            }
          }
          if (validPad) {
            len -= padByte;
          }
        }
      }

      return decrypted
        .subarray(0, len)
        .toString("utf-8")
        .replace(/\x00+$/g, "")
        .trim();
    } catch {
      // Fallback to standard PKCS5Padding
      const rawBytes = Buffer.from(clean.replace(/\s+/g, ""), "base64");
      const decipher = createDecipheriv("aes-128-cbc", key, iv);
      const decrypted = Buffer.concat([decipher.update(rawBytes), decipher.final()]);
      return decrypted.toString("utf-8").trim();
    }
  }

  private async fetchDynamicBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl && Date.now() < this.baseUrlExpiresAt) {
      return this.cachedBaseUrl;
    }

    const entries = await this.fetchFirebaseRemoteConfig({
      projectIdOrNumber: "239487160038",
      apiKey: "AIzaSyDdHIwVAD3XgP5bEwZOcR1QIz7gO5q5EoM",
      appId: "1:239487160038:android:308875071ce6f0fd48f527",
      packageName: "com.playfytv.app",
    });

    if (entries) {
      const apiUrl =
        entries.api_url || entries.base_url || entries.domain || entries.url || entries.playfy_api;
      if (apiUrl && apiUrl.startsWith("http")) {
        this.cachedBaseUrl = apiUrl.replace(/\/$/, "");
        this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
        return this.cachedBaseUrl;
      }
    }

    return this.fallbackUrls[0];
  }

  private async fetchChannelStreamsById(
    baseUrl: string,
    channelId: string | number,
    eventTitle: string
  ): Promise<StreamSource[]> {
    try {
      const res = await this.safeFetch(`${baseUrl}/channels/${channelId}.json`, {
        headers: { "User-Agent": "okhttp/4.12.0" },
        timeoutMs: 4000,
        ignoreCircuitBreaker: true,
      });
      const text = await res.text();
      const decText = this.decryptPlayFy(text);
      const parsed = JSON.parse(decText);
      const streamList = Array.isArray(parsed)
        ? parsed
        : parsed.streamUrls || parsed.streams || parsed.data || [];

      const sources: StreamSource[] = [];
      for (const s of streamList) {
        const rawUrl = s.link || s.url || s.webLink || s.stream_url || "";
        if (!rawUrl) continue;
        const drmRaw =
          s.api ||
          s.drmLicense ||
          s.license_key ||
          (s.kid && s.key ? `${s.kid}:${s.key}` : undefined);

        const src = await this.buildStreamSourceFromEntry({
          id: `playfy_${channelId}_${sources.length}`,
          rawUrl,
          tokenApi: s.tokenApi,
          quality: s.quality || s.name || s.title || "1080p",
          title: s.title || s.name || eventTitle,
          referer: s.referer,
          origin: s.origin,
          userAgent: s.userAgent || s.user_agent,
          drmLicense: drmRaw,
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
    this.checkCircuitBreaker();
    const primaryUrl = await this.fetchDynamicBaseUrl();
    const candidates = [primaryUrl, ...this.fallbackUrls.filter((u) => u !== primaryUrl)];

    for (const base of candidates) {
      try {
        const res = await this.safeFetch(`${base}/cats/live-events.json`, {
          headers: { "User-Agent": "okhttp/4.12.0" },
          ignoreCircuitBreaker: true,
        });
        const text = await res.text();
        const jsonStr = this.decryptPlayFy(text);

        if (jsonStr.startsWith("{") || jsonStr.startsWith("[")) {
          this.cachedBaseUrl = base;
          this.baseUrlExpiresAt = Date.now() + 1800 * 1000;
          this.recordSuccess();

          const parsed = JSON.parse(jsonStr);
          const eventsArr = Array.isArray(parsed)
            ? parsed
            : parsed.events || parsed.data || parsed.matches || [];
          const liveEvents: LiveEvent[] = [];

          for (const ev of eventsArr) {
            const info = ev.eventInfo || ev;
            let title = ev.title || info.eventName || ev.name || "Live Match";
            if (info.teamA && info.teamB && !title.toLowerCase().includes(" vs ")) {
              title = info.eventName
                ? `${info.teamA} vs ${info.teamB} (${info.eventName})`
                : `${info.teamA} vs ${info.teamB}`;
            }

            const rawLinks = ev.formats || ev.streams || ev.links || ev.channels || [];
            const sources: StreamSource[] = [];

            for (const s of rawLinks) {
              const rawUrl = s.webLink || s.url || s.link || s.stream_url || "";
              if (!rawUrl) continue;
              const drmRaw =
                s.api ||
                s.drmLicense ||
                s.license_key ||
                (s.kid && s.key ? `${s.kid}:${s.key}` : undefined);

              const src = await this.buildStreamSourceFromEntry({
                id: `playfy_${ev.id || ev.slug || liveEvents.length}_${sources.length}`,
                rawUrl,
                tokenApi: s.tokenApi,
                quality: s.quality || s.name || s.title || "1080p",
                title: s.name || s.title || title,
                referer: s.referer,
                origin: s.origin,
                userAgent: s.userAgent || s.user_agent,
                drmLicense: drmRaw,
              });
              if (src) {
                sources.push(src);
              }
            }

            if (sources.length > 0) {
              const nowSec = Math.floor(Date.now() / 1000);
              const startSec = Number(ev.start_time || ev.startTime || 0);
              const endSec = Number(ev.end_time || ev.endTime || 0);
              let status: "LIVE" | "UPCOMING" | "ENDED" = "LIVE";

              if (startSec > 0 && endSec > 0) {
                if (nowSec < startSec - 900) status = "UPCOMING";
                else if (nowSec > endSec) status = "ENDED";
              } else if (typeof ev.status === "string") {
                const upper = ev.status.toUpperCase();
                if (upper === "UPCOMING") status = "UPCOMING";
                else if (upper === "ENDED" || upper === "COMPLETED") status = "ENDED";
              }

              liveEvents.push({
                id: `playfy_${ev.id || ev.slug || liveEvents.length}`,
                title,
                category: info.eventCat || ev.cat || ev.category || ev.sport || "Sports",
                status,
                poster: info.eventLogo || ev.poster || ev.logo || ev.image || info.teamAFlag,
                startTime:
                  startSec > 0
                    ? new Date(startSec * 1000).toISOString()
                    : typeof info.startTime === "string"
                    ? info.startTime
                    : undefined,
                endTime:
                  endSec > 0
                    ? new Date(endSec * 1000).toISOString()
                    : typeof info.endTime === "string"
                    ? info.endTime
                    : undefined,
                competition: info.eventName || undefined,
                lastUpdated: new Date().toISOString(),
                sources,
              });
            }
          }

          if (liveEvents.length > 0) return liveEvents;

          // If /cats/live-events.json has no active inline formats yet, resolve active category channels from /cc.json
          try {
            const ccRes = await this.safeFetch(`${base}/cc.json`, {
              headers: { "User-Agent": "okhttp/4.12.0" },
              timeoutMs: 4000,
              ignoreCircuitBreaker: true,
            });
            const ccDec = this.decryptPlayFy(await ccRes.text());
            const ccList = JSON.parse(ccDec);
            if (Array.isArray(ccList) && ccList.length > 0) {
              await Promise.allSettled(
                ccList.slice(0, 6).map(async (cat: any) => {
                  if (cat.id === undefined) return;
                  const resolved = await this.fetchChannelStreamsById(
                    base,
                    cat.id,
                    cat.title || cat.name || "PlayFy Live"
                  );
                  if (resolved.length > 0) {
                    liveEvents.push({
                      id: `playfy_cat_${cat.id}`,
                      title: cat.title || cat.name || resolved[0].title || "PlayFy Live",
                      category: "Cricket",
                      status: "LIVE",
                      poster: cat.image || cat.logo,
                      lastUpdated: new Date().toISOString(),
                      sources: resolved,
                    });
                  }
                })
              );
              if (liveEvents.length > 0) return liveEvents;
            }
          } catch {
            // Fall through to M3U channels
          }
          break;
        }
      } catch {
        // Try next candidate domain
      }
    }

    // Fallback to M3U channels
    const channels = await this.fetchChannels();
    return channels.slice(0, 25).map((ch, idx) => ({
      id: `playfy_ev_${idx}`,
      title: ch.name,
      category: ch.category,
      status: "LIVE" as const,
      poster: ch.logo,
      lastUpdated: new Date().toISOString(),
      sources: ch.sources,
    }));
  }

  async fetchChannels(): Promise<Channel[]> {
    const m3uSources = [
      "https://raw.githubusercontent.com/Jitendra-unatti/fancode/refs/heads/main/data/fancode.m3u",
      "https://github.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/raw/main/ALL.m3u",
      "https://iptv-org.github.io/iptv/countries/in.m3u",
    ];

    for (const url of m3uSources) {
      try {
        const res = await this.safeFetch(url);
        const text = await res.text();
        const items = parseM3UPlaylist(text);

        const filtered = items
          .filter((i) => {
            const g = (i.group || "").toLowerCase();
            const t = i.title.toLowerCase();
            return (
              g.includes("sport") ||
              g.includes("fancode") ||
              t.includes("sport") ||
              t.includes("vs") ||
              t.includes("cricket") ||
              t.includes("sony ten") ||
              t.includes("star sports") ||
              t.includes("dd sports") ||
              t.includes("willow") ||
              t.includes("astro")
            );
          })
          .slice(0, 60);

        if (filtered.length > 0) {
          return filtered.map((item, idx) => {
            const source: StreamSource = {
              id: `playfy_src_${idx}`,
              provider: this.metadata.id,
              quality: item.title.includes("1080") || item.title.includes("HD") ? "1080p" : "720p",
              title: item.title,
              format: item.format,
              streamUrl: item.streamUrl,
              headers: item.headers,
              drm: item.drm,
              status: "ONLINE",
            };
            source.fingerprint = DrmHelper.generateFingerprint(source);

            return {
              id: `playfy_ch_${idx}`,
              name: item.title,
              logo: item.logo,
              category: "Sports",
              group: item.group || "Sports TV",
              sources: [source],
            };
          });
        }
      } catch {
        // Continue to next source
      }
    }

    return [];
  }

  async resolveStream(id: string): Promise<StreamSource | null> {
    if (id.startsWith("playfy_")) {
      const chId = id.replace(/^playfy_/, "");
      const base = await this.fetchDynamicBaseUrl();
      const resolved = await this.fetchChannelStreamsById(base, chId, chId);
      if (resolved.length > 0) return resolved[0];
    }

    const events = await this.fetchEvents();
    const ev = events.find((e) => e.id === id);
    if (ev && ev.sources.length > 0) return ev.sources[0];

    const channels = await this.fetchChannels();
    const ch = channels.find((c) => c.id === id);
    return ch?.sources[0] || null;
  }
}
