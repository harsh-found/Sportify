import { describe, expect, it } from "bun:test";
import { EnvelopeCrypto } from "../src/parsers/envelope-crypto";
import { parseM3UPlaylist } from "../src/parsers/m3u.parser";

describe("SC3 Embedded Envelope Cipher & M3U Parser Transparent Decryption", () => {
  it("encrypts and decrypts payload matching SC3 envelope structure", () => {
    const originalM3u = `#EXTM3U\n#EXTINF:-1 tvg-id="star1" group-title="Sports",Star Sports 1 HD\nhttps://stream.example.com/star1/index.m3u8`;
    const encrypted = EnvelopeCrypto.encryptContent(originalM3u);

    expect(encrypted.length).toBeGreaterThan(79);
    // Envelope slicing test
    const ivB64 = encrypted.substring(10, 34);
    const keyB64 = encrypted.substring(encrypted.length - 54, encrypted.length - 10);
    expect(Buffer.from(ivB64, "base64").length).toBe(16);
    expect(Buffer.from(keyB64, "base64").length).toBe(32);

    const decrypted = EnvelopeCrypto.decryptContent(encrypted);
    expect(decrypted).toBe(originalM3u);
  });

  it("handles multi-line text and long playlists in envelope cipher", () => {
    const message = "Multi-line payload\nWith special characters: !@#$%^&*()_+\nAcross several UTF-8 sequences.";
    const encrypted = EnvelopeCrypto.encryptContent(message);
    const decrypted = EnvelopeCrypto.decryptContent(encrypted);
    expect(decrypted).toBe(message);
  });

  it("returns plaintext unchanged if already M3U, JSON, or short string", () => {
    const m3u = "#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://example.com/ch1.m3u8";
    expect(EnvelopeCrypto.decryptContent(m3u)).toBe(m3u);

    const json = '{"channels":[{"id":1,"name":"Test"}]}';
    expect(EnvelopeCrypto.decryptContent(json)).toBe(json);

    const shortStr = "too short";
    expect(EnvelopeCrypto.decryptContent(shortStr)).toBe(shortStr);
  });

  it("gracefully returns original string when given corrupted envelope ciphertext", () => {
    const fakeEnvelope = "A".repeat(100);
    const res = EnvelopeCrypto.decryptContent(fakeEnvelope);
    expect(res).toBe(fakeEnvelope);
  });

  it("parseM3UPlaylist transparently decrypts an encrypted playlist", () => {
    const rawM3u = `#EXTM3U
#EXTINF:-1 tvg-logo="https://logo.png" group-title="Cricket",IND vs AUS Live HD
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210
#EXTVLCOPT:http-user-agent=CustomUA
https://cdn.example.com/live/ind_aus.mpd`;

    const encrypted = EnvelopeCrypto.encryptContent(rawM3u);
    const parsed = parseM3UPlaylist(encrypted);

    expect(parsed.length).toBe(1);
    expect(parsed[0].title).toBe("IND vs AUS Live HD");
    expect(parsed[0].group).toBe("Cricket");
    expect(parsed[0].format).toBe("DASH");
    expect(parsed[0].headers?.["User-Agent"]).toBe("CustomUA");
    expect(parsed[0].drm?.clearKeys?.[0].kid).toBe("0123456789abcdef0123456789abcdef");
    expect(parsed[0].drm?.clearKeys?.[0].key).toBe("fedcba9876543210fedcba9876543210");
  });
});
