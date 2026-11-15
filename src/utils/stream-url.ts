import { DrmConfig } from "../core/types";
import { DrmHelper } from "../parsers/drm.helper";

export interface ParsedStreamUrl {
  cleanUrl: string;
  headers: Record<string, string>;
  drm?: DrmConfig;
  licenseUrl?: string;
}

/**
 * Normalizes HTTP header names from pipe-delimited stream parameters
 * into standard canonical HTTP header casing.
 */
export function canonicalizeHeaderName(rawKey: string): string {
  const k = rawKey.trim().toLowerCase().replace(/^http-/, "");
  switch (k) {
    case "user-agent":
    case "ua":
    case "useragent":
      return "User-Agent";
    case "referer":
    case "referrer":
      return "Referer";
    case "origin":
      return "Origin";
    case "cookie":
    case "cookies":
      return "Cookie";
    case "authorization":
    case "auth":
      return "Authorization";
    case "x-forwarded-for":
      return "X-Forwarded-For";
    case "accept":
      return "Accept";
    case "accept-language":
      return "Accept-Language";
    default:
      return rawKey.trim();
  }
}

/**
 * Normalizes URL-encoded forward slashes (%2F) in URL paths without corrupting query strings.
 */
export function normalizeEncodedPathSlashes(url: string): string {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().includes("%2f")) {
    return trimmed;
  }
  const qIdx = trimmed.indexOf("?");
  if (qIdx === -1) {
    return trimmed.replace(/%2f/gi, "/");
  }
  const pathPart = trimmed.slice(0, qIdx).replace(/%2f/gi, "/");
  const queryPart = trimmed.slice(qIdx);
  return `${pathPart}${queryPart}`;
}

/**
 * Parses a raw stream URL that may contain pipe-delimited (`|`) or ampersand-delimited (`&`)
 * player options, HTTP headers (`Referer`, `User-Agent`, `Origin`, `Cookie`, `Authorization`),
 * and inline DRM parameters (`drmScheme`, `drmLicense`, `key`, `keyid`, `kid`, `licenseUrl`).
 */
export function parsePipeStreamUrl(
  rawUrl: string,
  baseHeaders?: Record<string, string>,
  existingDrm?: DrmConfig
): ParsedStreamUrl {
  const headers: Record<string, string> = {};
  if (baseHeaders) {
    for (const [k, v] of Object.entries(baseHeaders)) {
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        headers[canonicalizeHeaderName(k)] = String(v).trim();
      }
    }
  }

  let drm: DrmConfig | undefined = existingDrm;
  let licenseUrl: string | undefined = existingDrm?.licenseUrl;

  if (!rawUrl || typeof rawUrl !== "string") {
    return { cleanUrl: "", headers, drm, licenseUrl };
  }

  const trimmed = rawUrl.trim();
  const pipeIdx = trimmed.indexOf("|");
  const rawBaseUrl = pipeIdx === -1 ? trimmed : trimmed.slice(0, pipeIdx).trim();
  const cleanUrl = normalizeEncodedPathSlashes(rawBaseUrl);

  if (pipeIdx === -1) {
    return { cleanUrl, headers, drm, licenseUrl };
  }

  const paramString = trimmed.slice(pipeIdx + 1).trim();
  if (!paramString) {
    return { cleanUrl, headers, drm, licenseUrl };
  }

  // Split by | or & while respecting key=value pairs
  const segments = paramString.split(/[|&]/);
  let inlineKey: string | undefined;
  let inlineKid: string | undefined;
  let drmLicenseRaw: string | undefined;

  for (const seg of segments) {
    const eqIdx = seg.indexOf("=");
    if (eqIdx === -1) continue;

    const rawKey = seg.slice(0, eqIdx).trim();
    const rawVal = seg.slice(eqIdx + 1).trim();
    if (!rawKey || !rawVal) continue;

    let decodedVal = rawVal;
    try {
      decodedVal = decodeURIComponent(rawVal);
    } catch {
      decodedVal = rawVal;
    }
    // Strip wrapping quotes if present
    if (
      (decodedVal.startsWith('"') && decodedVal.endsWith('"')) ||
      (decodedVal.startsWith("'") && decodedVal.endsWith("'"))
    ) {
      decodedVal = decodedVal.slice(1, -1).trim();
    }

    const lowerKey = rawKey.toLowerCase();
    if (lowerKey === "drmlicense" || lowerKey === "license_key" || lowerKey === "drm-license") {
      drmLicenseRaw = decodedVal;
      continue;
    }
    if (lowerKey === "licenseurl" || lowerKey === "license_url" || lowerKey === "drm-license-url") {
      licenseUrl = decodedVal;
      continue;
    }
    if (lowerKey === "key" || lowerKey === "drm-key") {
      inlineKey = decodedVal;
      continue;
    }
    if (lowerKey === "keyid" || lowerKey === "drm-keyid" || lowerKey === "kid") {
      inlineKid = decodedVal;
      continue;
    }
    if (lowerKey === "drmscheme" || lowerKey === "license_type") {
      continue;
    }

    headers[canonicalizeHeaderName(rawKey)] = decodedVal;
  }

  if (drmLicenseRaw && !drm) {
    if (drmLicenseRaw.startsWith("http://") || drmLicenseRaw.startsWith("https://")) {
      licenseUrl = drmLicenseRaw;
      drm = {
        type: "clearkey",
        licenseUrl: drmLicenseRaw,
      };
    } else {
      drm = DrmHelper.parseClearKeyString(drmLicenseRaw);
    }
  } else if (inlineKid && inlineKey && !drm) {
    drm = DrmHelper.parseClearKeyString(`${inlineKid}:${inlineKey}`);
  } else if (licenseUrl && !drm) {
    drm = {
      type: "clearkey",
      licenseUrl,
    };
  } else if (drm && licenseUrl && !drm.licenseUrl) {
    drm = { ...drm, licenseUrl };
  }

  return {
    cleanUrl,
    headers,
    drm,
    licenseUrl,
  };
}

/**
 * Formats proxy query parameters (`referer`, `ua`, `origin`, `cookie`) from a header map.
 */
export function buildProxyHeaderQuery(headers?: Record<string, string>): string {
  if (!headers) return "";
  let query = "";
  const referer = headers["Referer"] || headers["referer"];
  const ua = headers["User-Agent"] || headers["user-agent"];
  const origin = headers["Origin"] || headers["origin"];
  const cookie = headers["Cookie"] || headers["cookie"];
  const auth = headers["Authorization"] || headers["authorization"];

  if (referer) query += `&referer=${encodeURIComponent(referer)}`;
  if (ua) query += `&ua=${encodeURIComponent(ua)}`;
  if (origin) query += `&origin=${encodeURIComponent(origin)}`;
  if (cookie) query += `&cookie=${encodeURIComponent(cookie)}`;
  if (auth) query += `&auth=${encodeURIComponent(auth)}`;
  return query;
}

/**
 * Detects whether a stream URL uses DASH or HLS.
 */
export function detectStreamFormat(url: string, explicitType?: string): "DASH" | "HLS" {
  if (explicitType) {
    const upper = explicitType.toUpperCase();
    if (upper === "DASH" || upper === "MPD") return "DASH";
    if (upper === "HLS" || upper === "M3U8") return "HLS";
  }
  const clean = url.split("|")[0].split("?")[0].toLowerCase();
  if (clean.endsWith(".mpd") || url.toLowerCase().includes(".mpd") || url.toLowerCase().includes("/dash/")) {
    return "DASH";
  }
  return "HLS";
}

/**
 * Validates that an upstream URL is safe to fetch from the edge proxy / stream inspector,
 * blocking SSRF targets such as loopback, RFC1918 private networks, link-local / cloud metadata
 * endpoints (169.254.169.254, metadata.google.internal), and non-HTTP(S) schemes.
 */
export function isSafeUpstreamUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (/^(?:playztv|livxow|sktech|sportzx|playfy|cricify):\/\//i.test(trimmed)) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) return false;

    if (
      host === "metadata.google.internal" ||
      host.endsWith(".internal") ||
      host === "0.0.0.0" ||
      host === "::" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc00:") ||
      host.startsWith("fd00:")
    ) {
      return false;
    }

    const portNum = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    const isEphemeralTestPort = portNum >= 10000;

    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "::1"
    ) {
      return isEphemeralTestPort;
    }

    // Check IPv4 literal ranges
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const a = Number(ipv4Match[1]);
      const b = Number(ipv4Match[2]);
      if (a === 127) return isEphemeralTestPort;
      if (a === 0 || a === 10) return false;
      if (a === 169 && b === 254) return false; // Link-local & cloud metadata (169.254.169.254)
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false; // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
    }

    return true;
  } catch {
    return false;
  }
}

const SIGNED_CDN_QUERY_KEYS = new Set([
  "hdnts",
  "hdnea",
  "token",
  "access_token",
  "sig",
  "signature",
  "hmac",
  "auth",
  "policy",
  "key-pair-id",
  "expires",
  "exp",
  "st",
  "e",
  "md5",
  "hash",
  "wmsauthsign",
]);

/**
 * Inherits signed CDN query parameters (Akamai hdnts/hdnea, CloudFront Policy/Signature/Key-Pair-Id,
 * Fastly/Flussonic token/wmsAuthSign) from a parent HLS manifest URL onto a resolved child playlist,
 * encryption key, or segment URL when the child URL lacks those parameters.
 */
export function inheritSignedQueryParams(parentUrl: string, childUrl: string): string {
  try {
    const parentParsed = new URL(parentUrl);
    if (!parentParsed.search) return childUrl;

    const childParsed = new URL(childUrl);
    // Only inherit onto the same origin or subdomain of the same CDN
    if (childParsed.hostname.toLowerCase() !== parentParsed.hostname.toLowerCase()) {
      return childUrl;
    }

    let modified = false;
    for (const [k, v] of parentParsed.searchParams.entries()) {
      if (SIGNED_CDN_QUERY_KEYS.has(k.toLowerCase()) && !childParsed.searchParams.has(k)) {
        childParsed.searchParams.set(k, v);
        modified = true;
      }
    }

    return modified ? childParsed.toString() : childUrl;
  } catch {
    return childUrl;
  }
}

/**
 * Redacts sensitive credential headers (Authorization, Proxy-Authorization, Set-Cookie, X-Api-Key)
 * for safe inclusion in public JSON responses while preserving standard playback headers
 * (Referer, Origin, User-Agent, Cookie) required by native ExoPlayer/Kodi/VLC clients.
 */
export function sanitizeHeadersForPublicDisplay(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "authorization" || lower === "proxy-authorization") {
      const scheme = v.trim().split(/\s+/)[0];
      out[k] = scheme && scheme.length < 15 ? `${scheme} [REDACTED]` : "[REDACTED]";
    } else if (lower === "set-cookie" || lower === "x-api-key") {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

