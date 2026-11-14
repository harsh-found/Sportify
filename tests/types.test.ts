import { describe, expect, it } from "bun:test";
import { ChannelSchema, LiveEventSchema, StreamSourceSchema } from "../src/core/types";
import { DrmHelper } from "../src/parsers/drm.helper";

describe("Core Types & Validation", () => {
  it("validates valid HLS and DASH stream objects with fingerprints and health", () => {
    const hlsSource = {
      id: "src_cric_1",
      provider: "cricify",
      quality: "1080p",
      format: "HLS",
      streamUrl: "https://example.com/live.m3u8",
      headers: { Referer: "https://example.com" },
      status: "ONLINE",
      timestamp: new Date().toISOString(),
      fingerprint: DrmHelper.generateFingerprint({
        provider: "cricify",
        streamUrl: "https://example.com/live.m3u8",
        format: "HLS",
      }),
      health: {
        latencyMs: 120,
        lastChecked: new Date().toISOString(),
        errorCount: 0,
      },
    };
    const parsed = StreamSourceSchema.safeParse(hlsSource);
    expect(parsed.success).toBe(true);

    const dashSource = {
      id: "src_sportzx_1",
      provider: "sportzx",
      quality: "720p",
      format: "DASH",
      streamUrl: "https://example.com/manifest.mpd",
      drm: {
        type: "clearkey",
        clearKeys: [{ kid: "1234567890abcdef", key: "abcdef1234567890" }],
      },
      status: "ONLINE",
    };
    expect(StreamSourceSchema.safeParse(dashSource).success).toBe(true);
    expect(DrmHelper.isValid(dashSource.drm as any)).toBe(true);
  });

  it("validates a full LiveEvent with enriched metadata", () => {
    const event = {
      id: "event_123",
      title: "India vs Australia 1st T20",
      category: "Cricket",
      status: "LIVE",
      startTime: "2026-11-10T14:00:00Z",
      venue: "Melbourne Cricket Ground",
      competition: "Bilateral Series",
      lastUpdated: new Date().toISOString(),
      sources: [
        {
          provider: "cricify",
          quality: "1080p",
          format: "HLS",
          streamUrl: "https://cdn.example.com/live.m3u8",
          status: "ONLINE",
        },
      ],
    };
    expect(LiveEventSchema.safeParse(event).success).toBe(true);
  });

  it("validates ChannelSchema with group, region, and resolution", () => {
    const channel = {
      id: "ch_star_1",
      name: "Star Sports 1 HD",
      category: "Sports",
      group: "Star Network",
      region: "IN",
      resolution: "1080p",
      sources: [
        {
          provider: "playfy",
          format: "HLS",
          streamUrl: "https://cdn.example.com/star1.m3u8",
        },
      ],
    };
    expect(ChannelSchema.safeParse(channel).success).toBe(true);
  });
});
