import { describe, expect, it } from "bun:test";
import { PlayZTVProvider } from "../src/providers/playztv.provider";
import { LivXowProvider } from "../src/providers/livxow.provider";
import { PlayFyProvider } from "../src/providers/playfy.provider";
import { CricifyProvider } from "../src/providers/cricify.provider";
import { SKTechProvider } from "../src/providers/sktech.provider";
import { SportzxProvider } from "../src/providers/sportzx.provider";
import { createCipheriv } from "node:crypto";

describe("Deterministic Offline Crypto Fixtures (<100ms)", () => {
  it("PlayZTV: round-trip Native decryption (adjacent byte swap + byte reverse + AES-128-CBC)", () => {
    const playztv = new PlayZTVProvider();
    const plainText = JSON.stringify({ match: "IND vs AUS Final", status: "LIVE" });

    // Encrypt in reverse order of PlayZTV pipeline
    const key = Buffer.from("cz14RStkN01PVE5w");
    const iv = Buffer.from("WTlEvckd2UR41sdk");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    const b4 = enc.toString("base64");
    const b3 = Buffer.from(b4, "utf-8");
    for (let i = 0; i < b3.length - 1; i += 2) {
      const tmp = b3[i];
      b3[i] = b3[i + 1];
      b3[i + 1] = tmp;
    }
    const b2 = Buffer.from(b3).reverse();
    const finalPayload = b2.toString("base64");

    const decrypted = playztv.decryptNative(finalPayload);
    expect(decrypted).toBe(plainText);
  });

  it("LivXow: round-trip Substitution Cipher + AES-128-CBC", () => {
    const livxow = new LivXowProvider();
    const plainText = JSON.stringify({ event: "World Cup Semi-Final" });

    const key = Buffer.from("M8mkKlNL75K4nl15");
    const iv = Buffer.from("kN7m5Kl1pN5nk4xK");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    const b64 = enc.toString("base64");

    // Reverse substitution map
    const subFrom = "fFgGjJkKaApPbBmMoOzZeEnNcCdDrRqQtTvVuUxXhHiIwWyYlLsS";
    const subTo =   "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ";
    const revMap = new Map<string, string>();
    for (let i = 0; i < subTo.length; i++) {
      revMap.set(subTo[i], subFrom[i]);
    }

    const encSubstitution = b64.split("").map((c) => revMap.get(c) || c).join("");

    const decrypted = livxow.decryptLivXow(encSubstitution);
    expect(decrypted).toBe(plainText);
  });

  it("PlayFy: deterministic FNV-1a 32-bit key/IV derivation and AES-128-CBC fallback", () => {
    const playfy = new PlayFyProvider();
    const lora = "zH7hY9@lO=8uXk#f%mI/VvJd2G10Z5eU+L6Pi&aEbwA4scBCStQ3KyWqRjDgnoMRP";
    const sig = "Mc1pOdG+rjLRsO8tlGCxcBFqGIU";

    const key = playfy.deriveKey(lora, sig);
    const iv = playfy.deriveIv(lora, sig);

    expect(key.length).toBe(16);
    expect(iv.length).toBe(16);

    const plainText = JSON.stringify({ stream: "https://example.com/live.m3u8" });
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    const decrypted = playfy.decryptPlayFy(enc.toString("base64"));
    expect(decrypted).toBe(plainText);
  });

  it("Cricify: AES-128-CBC decryption with static remote config key", () => {
    const cricify = new CricifyProvider();
    const plainText = JSON.stringify({ matchId: "cric_99", name: "IND vs ENG" });

    const key = Buffer.from("3hHzxYAgSGI8/ham", "utf8");
    const iv = Buffer.from("UqCvkvjecEIz842V", "utf8");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    const decrypted = cricify.decryptPayload(enc.toString("base64"));
    expect(decrypted).toBe(plainText);
  });

  it("SKTech: multi-pass decryption fallback", () => {
    const sktech = new SKTechProvider();
    const plainText = JSON.stringify([{ id: "1", title: "Test Event" }]);

    // Direct JSON passthrough
    expect(sktech.decryptPayload(plainText)).toBe(plainText);

    // Fallback C AES-128-CBC
    const key = Buffer.from("l2l5kB7xC5qP1rK1");
    const iv = Buffer.from("p1K5nP7uB8hH1l19");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);
    expect(sktech.decryptPayload(enc.toString("base64"))).toBe(plainText);
  });

  it("Sportzx: AES-128-CBC fallback and V3 passthrough verification", () => {
    const sportzx = new SportzxProvider();
    const plainText = JSON.stringify({ event: "IPL 2026 Final", status: "LIVE" });

    // Fallback 1 AES-128-CBC
    const key = Buffer.from("385557666474657740366c39354c323d", "hex");
    const iv = Buffer.from("31695248214b26747a33686225625377", "hex");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    const decrypted = sportzx.decryptFallback(enc.toString("base64"));
    expect(decrypted).toBe(plainText);

    // Fallback 2 (AppPassword derived key)
    const key2 = Buffer.from("6ayJ7jo@ao#pxVc%", "utf-8");
    const iv2 = Buffer.from("HsjJTCA7jJztpL2w", "utf-8");
    const cipher2 = createCipheriv("aes-128-cbc", key2, iv2);
    const enc2 = Buffer.concat([cipher2.update(Buffer.from(plainText, "utf-8")), cipher2.final()]);

    const decrypted2 = sportzx.decryptFallback2(enc2.toString("base64"));
    expect(decrypted2).toBe(plainText);

    // Direct JSON passthrough
    expect(sportzx.decryptSportzx(plainText)).toBe(plainText);
  });

  it("PlayZTV: round-trip Primary Substitution AES and Fallback AES modes", () => {
    const playztv = new PlayZTVProvider();
    const plainText = JSON.stringify([{ match: "IND vs PAK", cat: "Cricket" }]);

    // Primary mode: AES-128-CBC with b/1jml5nk4x5k7pN / 14nMk8mN5Kl5KL7l + reverse substitution
    const key1 = Buffer.from("Yi8xam1sNW5rNHg1azdwTg==", "base64");
    const iv1 = Buffer.from("MTRuTWs4bU41S2w1S0w3bA==", "base64");
    const cipher1 = createCipheriv("aes-128-cbc", key1, iv1);
    const enc1 = Buffer.concat([cipher1.update(Buffer.from(plainText, "utf-8")), cipher1.final()]);
    const b64_1 = enc1.toString("base64");

    const subFrom = "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ";
    const subTo = "fFgGjJkKaApPbBmMoOzZeEnNcCdDrRqQtTvVuUxXhHiIwWyYlLsS";
    const revMap = new Map<string, string>();
    for (let i = 0; i < subTo.length; i++) {
      revMap.set(subTo[i], subFrom[i]);
    }
    const subPayload = b64_1.split("").map((c) => revMap.get(c) || c).join("");
    expect(playztv.decryptNative(subPayload)).toBe(plainText);

    // Fallback mode: AES-128-CBC with m5Kl5nk4xK1kN7pN / k5K4nM8mKlNL7l15
    const key2 = Buffer.from("bTVLbDVuazR4SzFrTjdwTg==", "base64");
    const iv2 = Buffer.from("azVLNG5NOG1LbE5MN2wxNQ==", "base64");
    const cipher2 = createCipheriv("aes-128-cbc", key2, iv2);
    const enc2 = Buffer.concat([cipher2.update(Buffer.from(plainText, "utf-8")), cipher2.final()]);
    expect(playztv.decryptNative(enc2.toString("base64"))).toBe(plainText);
  });

  it("Cricify: Secondary AES-128-CBC key fallback", () => {
    const cricify = new CricifyProvider();
    const plainText = JSON.stringify({ data: [{ title: "AUS vs ENG" }] });

    const key = Buffer.from("1514925786399479", "utf8");
    const iv = Buffer.from("1696747751010409", "utf8");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    expect(cricify.decryptPayload(enc.toString("base64"))).toBe(plainText);
  });

  it("SKTech: strips 64-character hex integrity header before AES decryption", () => {
    const sktech = new SKTechProvider();
    const plainText = JSON.stringify([{ match: "SA vs SL" }]);

    const key = Buffer.from("l2l5kB7xC5qP1rK1");
    const iv = Buffer.from("p1K5nP7uB8hH1l19");
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf-8")), cipher.final()]);

    const hexHeader = "a1b2c3d4".repeat(8); // 64 hex chars
    const payloadWithHeader = `${hexHeader}${enc.toString("base64")}`;
    expect(sktech.decryptPayload(payloadWithHeader)).toBe(plainText);
  });

  it("PlayFy: verifies exact Dalvik bytecode derived key/IV and JSON envelope unwrapping", () => {
    const playfy = new PlayFyProvider();
    expect(playfy.deriveKey().toString("utf8")).toBe("BR4weRP=5A/Y&8%5");
    expect(playfy.deriveIv().toString("utf8")).toBe("Va+XYCKnkinUMDvk");

    const plainText = JSON.stringify([{ id: 1, title: "PLAYFy TV+ HD" }]);
    const cipher = createCipheriv("aes-128-cbc", playfy.deriveKey(), playfy.deriveIv());
    const enc = Buffer.concat([cipher.update(Buffer.from(plainText, "utf8")), cipher.final()]);
    const envelope = JSON.stringify({ data: enc.toString("base64") });

    expect(playfy.decryptPlayFy(envelope)).toBe(plainText);
  });
});



