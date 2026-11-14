import { DrmConfig } from "../core/types";
import { DrmHelper, normalizeClearKey } from "./drm.helper";
import { EnvelopeCrypto } from "./envelope-crypto";
import { canonicalizeHeaderName, detectStreamFormat, parsePipeStreamUrl } from "../utils/stream-url";

export interface ParsedM3UItem {
  title: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  streamUrl: string;
  format: "HLS" | "DASH";
  headers?: Record<string, string>;
  drm?: DrmConfig;
}

/**
 * Extracts an attribute value from an `#EXTINF` line (e.g., `tvg-logo="..."`, `key="..."`).
 */
function extractExtInfAttr(line: string, attrName: string): string | undefined {
  const regex = new RegExp(`(?:^|\\s)${attrName}=(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, "i");
  const match = line.match(regex);
  const val = match?.[1] ?? match?.[2] ?? match?.[3];
  return val ? val.trim() : undefined;
}

/**
 * High-resilience M3U/M3U8 & KODIPROP / EXTVLCOPT / EXTHTTP Parser.
 * Matches the full CloudStream 3 `IptvPlaylistParser` specification from `Cricify.kt`:
 *  - Transparent SC3 envelope decryption (`EnvelopeCrypto`)
 *  - `#EXTINF` metadata (`tvg-id`, `tvg-logo`, `group-title`, and inline `key`/`drm-key`/`keyid`/`drm-keyid`/`kid`)
 *  - `#KODIPROP` ClearKey pairs (`kid:key`), JSON key arrays, flat multi-KID JSON maps, and license server URLs
 *  - `#EXTVLCOPT` (`http-user-agent`, `http-referrer`, `http-origin`, `http-cookie`) and `#EXTHTTP` JSON headers
 *  - Multi-line wrapped stream URLs and pipe-delimited (`|` and `&`) URL parameters
 */
export function parseM3UPlaylist(content: string): ParsedM3UItem[] {
  const decryptedContent = EnvelopeCrypto.decryptContent(content);
  const rawLines = decryptedContent.split(/\r?\n/);

  // Consolidate multi-line wrapped URLs (as done in Cricify.kt IptvPlaylistParser)
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      lines.push(trimmed);
    } else if (
      lines.length > 0 &&
      !lines[lines.length - 1].startsWith("#") &&
      !trimmed.startsWith("http://") &&
      !trimmed.startsWith("https://") &&
      !/^[a-zA-Z0-9+.-]+:\/\//.test(trimmed)
    ) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}${trimmed}`;
    } else {
      lines.push(trimmed);
    }
  }

  const items: ParsedM3UItem[] = [];

  let currentTitle = "Unknown Stream";
  let currentLogo: string | undefined;
  let currentGroup: string | undefined;
  let currentTvgId: string | undefined;
  let currentHeaders: Record<string, string> = {};
  let currentDrmType: "clearkey" | "widevine" | "playready" | undefined;
  let currentClearKeys: { kid: string; key: string }[] = [];
  let currentLicenseUrl: string | undefined;

  const resetState = () => {
    currentTitle = "Unknown Stream";
    currentLogo = undefined;
    currentGroup = undefined;
    currentTvgId = undefined;
    currentHeaders = {};
    currentDrmType = undefined;
    currentClearKeys = [];
    currentLicenseUrl = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF:")) {
      currentLogo = extractExtInfAttr(line, "tvg-logo");
      currentGroup = extractExtInfAttr(line, "group-title");
      currentTvgId = extractExtInfAttr(line, "tvg-id");

      // Check inline DRM attributes on #EXTINF (from Cricify.kt: key, drm-key, keyid, drm-keyid, kid)
      const extKey = extractExtInfAttr(line, "key") || extractExtInfAttr(line, "drm-key");
      const extKid =
        extractExtInfAttr(line, "keyid") ||
        extractExtInfAttr(line, "drm-keyid") ||
        extractExtInfAttr(line, "kid");
      if (extKey && extKid) {
        currentDrmType = "clearkey";
        currentClearKeys.push(normalizeClearKey(extKid, extKey));
      }

      const commaIndex = line.lastIndexOf(",");
      if (commaIndex !== -1 && commaIndex < line.length - 1) {
        currentTitle = line.slice(commaIndex + 1).trim();
      }
      continue;
    }

    if (line.startsWith("#EXTVLCOPT:")) {
      const opt = line.slice("#EXTVLCOPT:".length).trim();
      const eqIndex = opt.indexOf("=");
      if (eqIndex !== -1) {
        const key = opt.slice(0, eqIndex).trim();
        const val = opt.slice(eqIndex + 1).trim();
        if (key && val) {
          currentHeaders[canonicalizeHeaderName(key)] = val;
        }
      }
      continue;
    }

    if (line.startsWith("#EXTHTTP:")) {
      try {
        const jsonStr = line.slice("#EXTHTTP:".length).trim();
        const parsedHeaders = JSON.parse(jsonStr);
        if (parsedHeaders && typeof parsedHeaders === "object") {
          for (const [k, v] of Object.entries(parsedHeaders)) {
            if (typeof v === "string" && v.trim()) {
              currentHeaders[canonicalizeHeaderName(k)] = v.trim();
            }
          }
        }
      } catch {
        // Ignore malformed EXTHTTP JSON
      }
      continue;
    }

    if (line.startsWith("#KODIPROP:")) {
      const prop = line.slice("#KODIPROP:".length).trim();
      const eqIdx = prop.indexOf("=");
      if (eqIdx === -1) continue;

      const propKey = prop.slice(0, eqIdx).trim().toLowerCase();
      const propVal = prop.slice(eqIdx + 1).trim();

      if (propKey.endsWith("license_type")) {
        const typeStr = propVal.toLowerCase();
        if (typeStr.includes("clearkey") || typeStr.includes("org.w3.clearkey")) {
          currentDrmType = "clearkey";
        } else if (typeStr.includes("widevine")) {
          currentDrmType = "widevine";
        } else if (typeStr.includes("playready")) {
          currentDrmType = "playready";
        }
      } else if (propKey.endsWith("license_key")) {
        const parsedDrm = DrmHelper.parseClearKeyString(propVal);
        if (parsedDrm) {
          currentDrmType = currentDrmType || parsedDrm.type;
          if (parsedDrm.clearKeys && parsedDrm.clearKeys.length > 0) {
            currentClearKeys.push(...parsedDrm.clearKeys);
          }
          if (parsedDrm.licenseUrl) {
            currentLicenseUrl = parsedDrm.licenseUrl;
          }
        } else if (propVal.startsWith("http://") || propVal.startsWith("https://")) {
          currentLicenseUrl = propVal;
        }
      } else if (propKey.endsWith("stream_headers")) {
        // #KODIPROP:inputstream.adaptive.stream_headers=User-Agent=...&Referer=...
        const parsedPipe = parsePipeStreamUrl(`http://dummy.local|${propVal}`);
        Object.assign(currentHeaders, parsedPipe.headers);
      }
      continue;
    }

    // Stream URL line (supports http://, https://, or custom provider schemes like playztv://, sktech://)
    if (
      !line.startsWith("#") &&
      (line.startsWith("http://") ||
        line.startsWith("https://") ||
        /^[a-zA-Z0-9+.-]+:\/\//.test(line))
    ) {
      const existingDrm: DrmConfig | undefined =
        currentDrmType || currentClearKeys.length > 0 || currentLicenseUrl
          ? {
              type: currentDrmType || "clearkey",
              ...(currentClearKeys.length > 0 ? { clearKeys: currentClearKeys } : {}),
              ...(currentLicenseUrl ? { licenseUrl: currentLicenseUrl } : {}),
            }
          : undefined;

      const parsedUrl = parsePipeStreamUrl(line, currentHeaders, existingDrm);
      const format = detectStreamFormat(parsedUrl.cleanUrl);

      items.push({
        title: currentTitle,
        logo: currentLogo,
        group: currentGroup,
        tvgId: currentTvgId,
        streamUrl: parsedUrl.cleanUrl,
        format,
        headers: Object.keys(parsedUrl.headers).length > 0 ? parsedUrl.headers : undefined,
        drm: parsedUrl.drm,
      });

      resetState();
    }
  }

  return items;
}
