import { ClearKeyPair, DrmConfig, StreamSource } from "../core/types";
import { createHash } from "node:crypto";

/**
 * Normalizes a ClearKey KID or KEY value into lowercase hexadecimal.
 * Handles:
 *  - Standard 32-char hex strings
 *  - UUID strings with hyphens (e.g., "01234567-89ab-cdef-0123-456789abcdef")
 *  - Base64 and Base64URL encoded strings
 */
export function normalizeToHex(val: string): string {
  let clean = val.trim();
  if (!clean) return "";

  // Strip UUID dashes if 36-char UUID format (8-4-4-4-12)
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clean)) {
    clean = clean.replace(/-/g, "");
  }

  // If already a valid hex string of even length (typically 32 chars = 16 bytes)
  if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0 && clean.length >= 16) {
    return clean.toLowerCase();
  }

  // Convert Base64URL (- and _) to standard Base64 (+ and /)
  try {
    let b64 = clean.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) {
      b64 += "=";
    }
    const buf = Buffer.from(b64, "base64");
    if (buf.length > 0) {
      return buf.toString("hex").toLowerCase();
    }
  } catch {
    // Fallback below
  }
  return clean.toLowerCase();
}

/**
 * Converts a 32-character hexadecimal string into unpadded Base64URL format
 * as required by W3C EME ClearKey license requests (`{"kids":["..."],"type":"temporary"}`).
 */
export function hexToBase64Url(hex: string): string {
  const cleanHex = normalizeToHex(hex);
  if (!cleanHex || cleanHex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(cleanHex)) {
    return "";
  }
  return Buffer.from(cleanHex, "hex")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function normalizeClearKey(kid: string, key: string): ClearKeyPair {
  return {
    kid: normalizeToHex(kid),
    key: normalizeToHex(key),
  };
}

export class DrmHelper {
  /**
   * Parses a raw license_key string into a structured map of normalized { kidHex -> keyHex } pairs.
   * Supports:
   *  - Single or comma-delimited "kid:key" pairs
   *  - W3C ClearKey JSON: {"keys":[{"kty":"oct","k":"...","kid":"..."}]}
   *  - Flat JSON map: {"kid_hex":"key_hex", "kid2_hex":"key2_hex"} (used by Cricify/LivXow/Sportzx)
   */
  static parseLicenseKeysMap(rawString: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!rawString) return map;

    const trimmed = rawString.trim();
    if (!trimmed || trimmed === ":" || trimmed === "0:0" || trimmed === "null:null") {
      return map;
    }

    // 1. JSON format
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && Array.isArray(parsed.keys)) {
          for (const kObj of parsed.keys) {
            const rawKid = kObj?.kid || kObj?.keyId || kObj?.key_id;
            const rawKey = kObj?.k || kObj?.key;
            if (rawKid && rawKey) {
              const pair = normalizeClearKey(String(rawKid), String(rawKey));
              if (pair.kid && pair.key) {
                map.set(pair.kid, pair.key);
              }
            }
          }
          return map;
        }

        // Flat JSON object map: { "kid1": "key1", "kid2": "key2" }
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && k !== "type") {
              const pair = normalizeClearKey(k, v);
              if (pair.kid && pair.key) {
                map.set(pair.kid, pair.key);
              }
            }
          }
          return map;
        }
      } catch {
        // Fallback to regex/colon parsing below
      }
    }

    // 2. Colon-delimited pair(s): "kid1:key1" or "kid1:key1,kid2:key2"
    if (trimmed.includes(":") && !trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      const segments = trimmed.split(/[,;]/);
      for (const seg of segments) {
        const colonIdx = seg.indexOf(":");
        if (colonIdx === -1) continue;
        const rawKid = seg.slice(0, colonIdx).trim();
        const rawKey = seg.slice(colonIdx + 1).trim();
        if (rawKid && rawKey && rawKid !== "0" && rawKey !== "0") {
          const pair = normalizeClearKey(rawKid, rawKey);
          if (pair.kid && pair.key) {
            map.set(pair.kid, pair.key);
          }
        }
      }
    }

    return map;
  }

  /**
   * Parses a raw license_key string (either "kid:key" or JSON `{"keys":[{"k":"...","kid":"..."}]}`
   * or flat multi-KID JSON map `{"kid":"key"}` or a license server URL) into a valid DrmConfig.
   */
  static parseClearKeyString(rawString?: string | null, mpdKidHex?: string | null): DrmConfig | undefined {
    if (!rawString) return undefined;
    const trimmed = rawString.trim();
    if (!trimmed || trimmed === ":" || trimmed === "0:0" || trimmed === "null:null") {
      return undefined;
    }

    // If rawString is an HTTP(S) ClearKey license server URL
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return {
        type: "clearkey",
        licenseUrl: trimmed,
      };
    }

    const keysMap = this.parseLicenseKeysMap(trimmed);
    if (keysMap.size === 0) {
      return undefined;
    }

    const clearKeys: ClearKeyPair[] = [];
    const normalizedTargetKid = mpdKidHex ? normalizeToHex(mpdKidHex) : "";

    // If an MPD default_KID was provided and exists in the map, prioritize it first
    if (normalizedTargetKid && keysMap.has(normalizedTargetKid)) {
      clearKeys.push({
        kid: normalizedTargetKid,
        key: keysMap.get(normalizedTargetKid)!,
      });
    }

    for (const [kid, key] of keysMap.entries()) {
      if (kid !== normalizedTargetKid) {
        clearKeys.push({ kid, key });
      }
    }

    return clearKeys.length > 0
      ? {
          type: "clearkey",
          clearKeys,
        }
      : undefined;
  }

  /**
   * Extracts `cenc:default_KID="..."` from a DASH `.mpd` manifest XML string
   * and normalizes it to a 32-character lowercase hex string.
   */
  static extractMpdDefaultKid(mpdXml: string): string | null {
    if (!mpdXml) return null;
    const match = mpdXml.match(/(?:cenc:)?default_KID\s*=\s*["']([^"']+)["']/i);
    if (match && match[1]) {
      return normalizeToHex(match[1]);
    }
    return null;
  }

  /**
   * Dynamically resolves a ClearKey pair from a DASH MPD manifest and a W3C ClearKey license server URL,
   * reproducing the exact protocol in `Cricify.kt` and `LivXowProvider.kt`:
   *   1. Fetch MPD manifest and extract `cenc:default_KID`
   *   2. Convert hex KID to unpadded Base64URL
   *   3. POST `{"kids":["<kid_b64url>"],"type":"temporary"}` to `licenseUrl`
   *   4. Parse returned `{"keys":[{"k":"...","kid":"..."}]}` into normalized hex `ClearKeyPair`
   */
  static async resolveClearKeyFromLicenseServer(
    mpdUrl: string,
    licenseUrl: string,
    headers?: Record<string, string>,
    fetcher: typeof fetch = fetch
  ): Promise<DrmConfig | undefined> {
    try {
      const mpdRes = await fetcher(mpdUrl, {
        headers: {
          "User-Agent": headers?.["User-Agent"] || "Dalvik/2.1.0 (Linux; U; Android)",
          ...(headers || {}),
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!mpdRes.ok) return { type: "clearkey", licenseUrl };

      const mpdText = await mpdRes.text();
      const kidHex = this.extractMpdDefaultKid(mpdText);
      if (!kidHex) return { type: "clearkey", licenseUrl };

      const kidB64Url = hexToBase64Url(kidHex);
      if (!kidB64Url) return { type: "clearkey", licenseUrl };

      const licRes = await fetcher(licenseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Dalvik/2.1.0 (Linux; U; Android)",
        },
        body: JSON.stringify({
          kids: [kidB64Url],
          type: "temporary",
        }),
        signal: AbortSignal.timeout(4000),
      });

      if (!licRes.ok) return { type: "clearkey", licenseUrl };
      const licJson = await licRes.text();
      const parsed = this.parseClearKeyString(licJson, kidHex);
      if (parsed && parsed.clearKeys && parsed.clearKeys.length > 0) {
        return {
          type: "clearkey",
          licenseUrl,
          clearKeys: parsed.clearKeys,
        };
      }
    } catch {
      // Fallback to keeping licenseUrl metadata
    }
    return { type: "clearkey", licenseUrl };
  }

  /**
   * Validates if a DrmConfig contains valid, usable DRM metadata.
   */
  static isValid(drm?: DrmConfig): boolean {
    if (!drm) return false;
    if (drm.type === "clearkey") {
      if (drm.clearKeys && drm.clearKeys.length > 0) {
        return drm.clearKeys.every((k) => k.kid.length >= 8 && k.key.length >= 8);
      }
      return Boolean(drm.licenseUrl);
    }
    return Boolean(drm.licenseUrl);
  }

  /**
   * Merges two DrmConfig objects, combining unique ClearKey pairs and preserving licenseUrl.
   */
  static mergeDrm(primary?: DrmConfig, secondary?: DrmConfig): DrmConfig | undefined {
    if (!primary) return secondary;
    if (!secondary) return primary;

    const mergedKeysMap = new Map<string, string>();
    for (const k of primary.clearKeys || []) {
      if (k.kid && k.key) mergedKeysMap.set(k.kid, k.key);
    }
    for (const k of secondary.clearKeys || []) {
      if (k.kid && k.key && !mergedKeysMap.has(k.kid)) {
        mergedKeysMap.set(k.kid, k.key);
      }
    }

    const clearKeys: ClearKeyPair[] = Array.from(mergedKeysMap.entries()).map(([kid, key]) => ({
      kid,
      key,
    }));

    return {
      type: primary.type || secondary.type,
      licenseUrl: primary.licenseUrl || secondary.licenseUrl,
      headers: { ...(secondary.headers || {}), ...(primary.headers || {}) },
      ...(clearKeys.length > 0 ? { clearKeys } : {}),
    };
  }

  /**
   * Generates a unique, deterministic SHA-256 fingerprint for a StreamSource.
   */
  static generateFingerprint(source: Pick<StreamSource, "provider" | "streamUrl" | "format">): string {
    const cleanUrl = source.streamUrl.split("|")[0].trim();
    const raw = `${source.provider}:${source.format}:${cleanUrl}`;
    return createHash("sha256").update(raw).digest("hex").substring(0, 16);
  }
}
