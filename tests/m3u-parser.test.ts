import { describe, expect, it } from "bun:test";
import { parseM3UPlaylist } from "../src/parsers/m3u.parser";
import { normalizeClearKey } from "../src/parsers/drm.helper";

describe("M3U & DRM Parser", () => {
  it("normalizes Base64 and Hex ClearKey values into clean hex format", () => {
    // Hex test
    const hexResult = normalizeClearKey(
      "42e4f52d863b3c37d87f3f5042e4f52d",
      "1b8a9b796c8a36e17f8f83a51b8a9b79"
    );
    expect(hexResult.kid).toBe("42e4f52d863b3c37d87f3f5042e4f52d");
    expect(hexResult.key).toBe("1b8a9b796c8a36e17f8f83a51b8a9b79");

    // Base64 to Hex test
    // "hello" base64 is aGVsbG8= -> hex 68656c6c6f
    const b64Result = normalizeClearKey("aGVsbG8=", "d29ybGQ=");
    expect(b64Result.kid).toBe("68656c6c6f");
    expect(b64Result.key).toBe("776f726c64");
  });

  it("extracts stream URL, HTTP headers, and ClearKey DRM from M3U lines", () => {
    const m3uSample = `
#EXTM3U
#EXTINF:-1 tvg-id="star_hindi" tvg-logo="https://logo.png" group-title="Sports",Star Sports 1 Hindi
#EXTHTTP:{"Referer":"https://jiotv.com","User-Agent":"JioTV/1.0"}
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=42e4f52d863b3c37d87f3f5042e4f52d:1b8a9b796c8a36e17f8f83a51b8a9b79
https://stream.example.com/live/manifest.mpd
    `.trim();

    const result = parseM3UPlaylist(m3uSample);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Star Sports 1 Hindi");
    expect(result[0].format).toBe("DASH");
    expect(result[0].streamUrl).toBe("https://stream.example.com/live/manifest.mpd");
    expect(result[0].headers?.["Referer"]).toBe("https://jiotv.com");
    expect(result[0].drm?.type).toBe("clearkey");
    expect(result[0].drm?.clearKeys?.[0].kid).toBe("42e4f52d863b3c37d87f3f5042e4f52d");
    expect(result[0].drm?.clearKeys?.[0].key).toBe("1b8a9b796c8a36e17f8f83a51b8a9b79");
  });

  it("gracefully parses standard HLS streams with #EXTVLCOPT", () => {
    const m3uHls = `
#EXTM3U
#EXTINF:-1 group-title="Cricket",Sky Sports Cricket HD
#EXTVLCOPT:http-user-agent=Mozilla/5.0
#EXTVLCOPT:http-referrer=https://thedaddy.pk/
https://live.thedaddy.pk/hls/skysports/index.m3u8
    `.trim();

    const result = parseM3UPlaylist(m3uHls);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("Sky Sports Cricket HD");
    expect(result[0].format).toBe("HLS");
    expect(result[0].headers?.["Referer"]).toBe("https://thedaddy.pk/");
    expect(result[0].headers?.["User-Agent"]).toBe("Mozilla/5.0");
  });

  it("parses multi-delimiter pipe headers with both | and & and preserves Cookie", () => {
    const pipeSample = `
#EXTM3U
#EXTINF:-1,Pipe Stream 1
https://live.example.com/stream.m3u8|User-Agent=CustomUA|Referer=https://ref.com|Cookie=auth_token=xyz123
#EXTINF:-1,Pipe Stream 2
https://live.example.com/hls%2Fstream.m3u8|User-Agent=CustomUA2&Referer=https://ref2.com&Origin=https://orig.com
    `.trim();

    const result = parseM3UPlaylist(pipeSample);
    expect(result.length).toBe(2);

    // Stream 1: Delimited by |
    expect(result[0].title).toBe("Pipe Stream 1");
    expect(result[0].streamUrl).toBe("https://live.example.com/stream.m3u8");
    expect(result[0].headers?.["User-Agent"]).toBe("CustomUA");
    expect(result[0].headers?.["Referer"]).toBe("https://ref.com");
    expect(result[0].headers?.["Cookie"]).toBe("auth_token=xyz123");

    // Stream 2: Delimited by & and has %2F in path
    expect(result[1].title).toBe("Pipe Stream 2");
    expect(result[1].streamUrl).toBe("https://live.example.com/hls/stream.m3u8");
    expect(result[1].headers?.["User-Agent"]).toBe("CustomUA2");
    expect(result[1].headers?.["Referer"]).toBe("https://ref2.com");
    expect(result[1].headers?.["Origin"]).toBe("https://orig.com");
  });

  it("parses JSON format ClearKey in #KODIPROP license_key", () => {
    const jsonKeySample = `
#EXTM3U
#EXTINF:-1,JSON DRM Channel
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key={"keys":[{"k":"b25la2V5MTIzNDU2Nzg=","kid":"b25la2lkMTIzNDU2Nzg="}]}
https://drm.example.com/manifest.mpd
    `.trim();

    const result = parseM3UPlaylist(jsonKeySample);
    expect(result.length).toBe(1);
    expect(result[0].drm?.type).toBe("clearkey");
    expect(result[0].drm?.clearKeys?.[0].kid).toBe("6f6e656b69643132333435363738");
    expect(result[0].drm?.clearKeys?.[0].key).toBe("6f6e656b65793132333435363738");
  });

  it("normalizes UUID format ClearKey and Base64URL keys without corruption", () => {
    const uuidKid = "01234567-89ab-cdef-0123-456789abcdef";
    const uuidKey = "fedcba98-7654-3210-fedc-ba9876543210";
    const res = normalizeClearKey(uuidKid, uuidKey);
    expect(res.kid).toBe("0123456789abcdef0123456789abcdef");
    expect(res.key).toBe("fedcba9876543210fedcba9876543210");

    // Base64url with - and _
    const b64urlKey = "-__-ABEiM0RVZneImaq7zA";
    const b64res = normalizeClearKey(b64urlKey, b64urlKey);
    expect(b64res.kid).toBe("fbfffe00112233445566778899aabbcc");
    expect(b64res.key).toBe("fbfffe00112233445566778899aabbcc");
  });

  it("successfully parses custom scheme streams (playztv://, sktech://, etc.)", () => {
    const customSchemeM3U = `#EXTM3U
#EXTINF:-1 tvg-logo="https://logo.png" group-title="Sports",PlayZ Match 1
playztv://live/match123|Referer=https://playz.tv/
#EXTINF:-1 group-title="Cricket",SKTech Star Sports
sktech://channels/star1
`;
    const parsed = parseM3UPlaylist(customSchemeM3U);
    expect(parsed.length).toBe(2);
    expect(parsed[0].streamUrl).toBe("playztv://live/match123");
    expect(parsed[0].headers?.["Referer"]).toBe("https://playz.tv/");
    expect(parsed[1].streamUrl).toBe("sktech://channels/star1");
    expect(parsed[1].group).toBe("Cricket");
  });

  it("parses flat multi-KID JSON map and prioritizes matching MPD default_KID", () => {
    const { DrmHelper } = require("../src/parsers/drm.helper");
    const flatJson = JSON.stringify({
      "11111111111111111111111111111111": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "22222222222222222222222222222222": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const drm = DrmHelper.parseClearKeyString(flatJson, "22222222-2222-2222-2222-222222222222");
    expect(drm).toBeDefined();
    expect(drm.clearKeys.length).toBe(2);
    // The matching MPD KID should be placed first
    expect(drm.clearKeys[0].kid).toBe("22222222222222222222222222222222");
    expect(drm.clearKeys[0].key).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("resolves dynamic ClearKey from MPD manifest and W3C ClearKey license server", async () => {
    const { DrmHelper, hexToBase64Url } = require("../src/parsers/drm.helper");
    const kidHex = "1994b1df7dfd2e8a8d7b9bf3fb900285";
    const keyHex = "22a1444b3da18e139191665b3d652835";

    const mockFetcher = async (url: string, init?: RequestInit) => {
      if (url.endsWith(".mpd")) {
        return new Response(
          `<MPD><ContentProtection cenc:default_KID="1994b1df-7dfd-2e8a-8d7b-9bf3fb900285"/></MPD>`,
          { status: 200 }
        );
      }
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.kids).toEqual([hexToBase64Url(kidHex)]);
      return new Response(
        JSON.stringify({
          keys: [{ kty: "oct", kid: hexToBase64Url(kidHex), k: hexToBase64Url(keyHex) }],
        }),
        { status: 200 }
      );
    };

    const resolved = await DrmHelper.resolveClearKeyFromLicenseServer(
      "https://cdn.example.com/live.mpd",
      "https://license.example.com/clearkey",
      undefined,
      mockFetcher as any
    );

    expect(resolved?.type).toBe("clearkey");
    expect(resolved?.clearKeys?.[0]).toEqual({ kid: kidHex, key: keyHex });
  });

  it("parses #EXTINF inline key/keyid attributes and multi-line wrapped URLs", () => {
    const sample = `#EXTM3U
#EXTINF:-1 tvg-id="w1" key="fedcba9876543210fedcba9876543210" keyid="0123456789abcdef0123456789abcdef",Willow FHD
https://cdn.example.com/dash/willow
/manifest.mpd|Referer=https://willow.tv`;

    const items = parseM3UPlaylist(sample);
    expect(items.length).toBe(1);
    expect(items[0].streamUrl).toBe("https://cdn.example.com/dash/willow/manifest.mpd");
    expect(items[0].format).toBe("DASH");
    expect(items[0].headers?.["Referer"]).toBe("https://willow.tv");
    expect(items[0].drm?.clearKeys?.[0]).toEqual({
      kid: "0123456789abcdef0123456789abcdef",
      key: "fedcba9876543210fedcba9876543210",
    });
  });
});



