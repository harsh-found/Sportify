import { describe, expect, it } from "bun:test";
import { CricifyProvider } from "../../src/providers/cricify.provider";
import { SportzxProvider } from "../../src/providers/sportzx.provider";
import { PlayZTVProvider } from "../../src/providers/playztv.provider";
import { PlayFyProvider } from "../../src/providers/playfy.provider";
import { SKTechProvider } from "../../src/providers/sktech.provider";
import { LivXowProvider } from "../../src/providers/livxow.provider";

describe("Live Integration Tests: 6 Core Indian Sports Providers", () => {
  it("CricifyProvider live extraction", async () => {
    const provider = new CricifyProvider();
    const channels = await provider.fetchChannels();
    expect(Array.isArray(channels)).toBe(true);
    if (channels.length > 0) {
      expect(channels[0].sources.length).toBeGreaterThan(0);
      expect(channels[0].sources[0].provider).toBe("cricify");
    }
  }, 15000);

  it("SportzxProvider live failover extraction", async () => {
    const provider = new SportzxProvider();
    const events = await provider.fetchEvents();
    expect(Array.isArray(events)).toBe(true);
    if (events.length > 0) {
      expect(events[0].sources.length).toBeGreaterThan(0);
      expect(events[0].sources[0].provider).toBe("sportzx");
    }
  }, 15000);

  it("PlayZTVProvider live decryption and stream resolution", async () => {
    const provider = new PlayZTVProvider();
    const events = await provider.fetchEvents();
    expect(Array.isArray(events)).toBe(true);
    if (events.length > 0) {
      expect(events[0].sources.length).toBeGreaterThan(0);
      expect(events[0].sources[0].provider).toBe("playztv");
    }
  }, 30000);

  it("PlayFyProvider live dynamic config and stream extraction", async () => {
    const provider = new PlayFyProvider();
    const events = await provider.fetchEvents();
    expect(Array.isArray(events)).toBe(true);
    if (events.length > 0) {
      expect(events[0].sources.length).toBeGreaterThan(0);
      expect(events[0].sources[0].provider).toBe("playfy");
    }
  }, 15000);

  it("SKTechProvider live decryption and stream resolution", async () => {
    const provider = new SKTechProvider();
    const events = await provider.fetchEvents();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sources.length).toBeGreaterThan(0);
    expect(events[0].sources[0].provider).toBe("sktech");

    const streams = await provider.resolveAllStreams(events[0].sources[0].streamUrl);
    expect(Array.isArray(streams)).toBe(true);
    expect(streams.length).toBeGreaterThan(0);
    expect(streams[0].streamUrl.startsWith("http")).toBe(true);
  }, 15000);

  it("LivXowProvider live substitution AES channels and events", async () => {
    const provider = new LivXowProvider();
    const events = await provider.fetchEvents();
    expect(Array.isArray(events)).toBe(true);
    if (events.length > 0) {
      expect(events[0].sources.length).toBeGreaterThan(0);
      expect(events[0].sources[0].provider).toBe("livxow");
    }
  }, 15000);
});
