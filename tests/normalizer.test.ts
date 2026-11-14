import { describe, expect, it } from "bun:test";
import { mergeAndDeduplicateEvents } from "../src/engine/normalizer";
import { LiveEvent } from "../src/core/types";

describe("Event Normalizer", () => {
  it("merges identical matches from different providers into a single event with multi-sources", () => {
    const e1: LiveEvent = {
      id: "cric_1",
      title: "India vs Australia - 2nd ODI",
      category: "Cricket",
      status: "LIVE",
      sources: [
        {
          provider: "cricify",
          quality: "1080p",
          format: "HLS",
          streamUrl: "https://cric.cdn/live.m3u8",
          status: "ONLINE",
        },
      ],
    };

    const e2: LiveEvent = {
      id: "sport_1",
      title: "IND vs AUS (2nd ODI)",
      category: "Cricket",
      status: "LIVE",
      sources: [
        {
          provider: "sportzx",
          quality: "720p",
          format: "HLS",
          streamUrl: "https://sport.cdn/live.m3u8",
          headers: { Referer: "https://sportzx.live/" },
          status: "ONLINE",
        },
      ],
    };

    const merged = mergeAndDeduplicateEvents([e1, e2]);
    expect(merged.length).toBe(1);
    expect(merged[0].sources.length).toBe(2);
    expect(merged[0].sources.map((s) => s.provider)).toContain("cricify");
    expect(merged[0].sources.map((s) => s.provider)).toContain("sportzx");
  });

  it("keeps distinct matches separate", () => {
    const e1: LiveEvent = {
      id: "e1",
      title: "England vs Pakistan 1st Test",
      category: "Cricket",
      status: "LIVE",
      sources: [],
    };
    const e2: LiveEvent = {
      id: "e2",
      title: "Real Madrid vs Barcelona",
      category: "Football",
      status: "LIVE",
      sources: [],
    };

    const merged = mergeAndDeduplicateEvents([e1, e2]);
    expect(merged.length).toBe(2);
  });

  it("does not merge matches with distinct match numbers (1st ODI vs 2nd ODI)", () => {
    const e1: LiveEvent = {
      id: "e1",
      title: "India vs Australia - 1st ODI",
      category: "Cricket",
      status: "LIVE",
      sources: [],
    };
    const e2: LiveEvent = {
      id: "e2",
      title: "India vs Australia - 2nd ODI",
      category: "Cricket",
      status: "LIVE",
      sources: [],
    };

    const merged = mergeAndDeduplicateEvents([e1, e2]);
    expect(merged.length).toBe(2);
  });

  it("does not merge matches on different calendar dates", () => {
    const e1: LiveEvent = {
      id: "e1",
      title: "IND vs AUS",
      category: "Cricket",
      status: "LIVE",
      startTime: "2026-11-10T14:00:00Z",
      sources: [],
    };
    const e2: LiveEvent = {
      id: "e2",
      title: "IND vs AUS",
      category: "Cricket",
      status: "LIVE",
      startTime: "2026-11-15T14:00:00Z",
      sources: [],
    };

    const merged = mergeAndDeduplicateEvents([e1, e2]);
    expect(merged.length).toBe(2);
  });

  it("enriches existing source with DRM and headers when identical stream URLs merge", () => {
    const e1: LiveEvent = {
      id: "e1",
      title: "MIW vs RCBW",
      category: "Cricket",
      status: "LIVE",
      sources: [
        {
          provider: "playfy",
          quality: "1080p",
          format: "DASH",
          streamUrl: "https://stream.example/live.mpd",
          status: "ONLINE",
        },
      ],
    };

    const e2: LiveEvent = {
      id: "e2",
      title: "Mumbai Indians Women vs Royal Challengers Bengaluru Women",
      category: "Cricket",
      status: "LIVE",
      sources: [
        {
          provider: "sktech",
          quality: "1080p",
          format: "DASH",
          streamUrl: "https://stream.example/live.mpd",
          drm: {
            type: "clearkey",
            clearKeys: [{ kid: "0123456789abcdef0123456789abcdef", key: "fedcba9876543210fedcba9876543210" }],
          },
          headers: { Referer: "https://sktech.net" },
          status: "ONLINE",
        },
      ],
    };

    const merged = mergeAndDeduplicateEvents([e1, e2]);
    expect(merged.length).toBe(1);
    expect(merged[0].sources.length).toBe(1);
    expect(merged[0].sources[0].drm?.clearKeys?.[0].kid).toBe("0123456789abcdef0123456789abcdef");
    expect(merged[0].sources[0].headers?.Referer).toBe("https://sktech.net");
  });
});
