import { describe, expect, test } from "bun:test";
import {
  parseEventEntities,
  detectSport,
  detectLanguage,
  generateCanonicalKey,
  buildUnifiedCatalog,
  buildRichStreamFeeds,
  scoreSearchQuery,
} from "../src/catalog/normalizer";
import { LiveEvent } from "../src/core/types";

describe("Catalog Normalizer & Provenance Engine", () => {
  test("detects league/tournament channels without fake teams (e.g. NPL)", () => {
    const parsed = parseEventEntities("Nepal Premier League (NPL) 2026");
    expect(parsed.kind).toBe("tournament_channel");
    expect(parsed.teams).toBeNull();
    expect(parsed.tournament).not.toBeNull();
    expect(parsed.tournament?.name).toBe("Nepal Premier League");
    expect(parsed.tournament?.shortName).toBe("NPL T20");
  });

  test("detects synthetic duplicate team names as tournament channels (e.g. NPL vs NPL)", () => {
    const parsed = parseEventEntities("NPL vs NPL");
    expect(parsed.kind).toBe("tournament_channel");
    expect(parsed.teams).toBeNull();
    expect(parsed.tournament?.shortName).toBe("NPL T20");
  });

  test("generates identical canonicalKey regardless of team order (IND vs NZ vs NZ vs IND)", () => {
    const parsed1 = parseEventEntities("IND vs NZ");
    const parsed2 = parseEventEntities("New Zealand vs India");

    expect(parsed1.kind).toBe("match");
    expect(parsed2.kind).toBe("match");

    const key1 = generateCanonicalKey("cricket", parsed1, "2026-11-09T06:45:00.000Z");
    const key2 = generateCanonicalKey("cricket", parsed2, "2026-11-09T06:45:00.000Z");

    expect(key1).toBe("cricket::ind-vs-nz::2026-11-09");
    expect(key2).toBe("cricket::ind-vs-nz::2026-11-09");
    expect(key1).toBe(key2);
  });

  test("detects sport accurately from category and title", () => {
    expect(detectSport("Live Cricket", "India vs Australia 1st ODI")).toBe("cricket");
    expect(detectSport("Sports", "Real Madrid vs Barcelona")).toBe("football");
    expect(detectSport("Racing", "Formula 1 Las Vegas GP")).toBe("motorsport");
    expect(detectSport("Combat", "UFC 312 Main Card")).toBe("mma");
  });

  test("detects audio/commentary languages accurately", () => {
    expect(detectLanguage("Star Sports 1 Hindi HD").code).toBe("hin");
    expect(detectLanguage("NPL Live Nepali Stream").code).toBe("nep");
    expect(detectLanguage("Willow Cricket English HD").code).toBe("eng");
    expect(detectLanguage("PTV Sports Urdu Live").code).toBe("urd");
    expect(detectLanguage("Asianet Malayalam Sports").code).toBe("mal");
    expect(detectLanguage("ChardiKla Punjabi Sports").code).toBe("pan");
  });

  test("builds unified catalog grouping multiple provider events", () => {
    const mockEvents: LiveEvent[] = [
      {
        id: "ev_1",
        title: "Nepal Premier League (NPL) 2026",
        category: "Cricket",
        status: "LIVE",
        startTime: "2026-11-09T06:45:00.000Z",
        sources: [
          {
            streamUrl: "http://129.225.106.195/d/master.m3u8?d=feed1",
            format: "HLS",
            quality: "1080p",
            provider: "cricify",
          },
        ],
      },
      {
        id: "ev_2",
        title: "NPL vs NPL",
        category: "Cricket",
        status: "LIVE",
        startTime: "2026-11-09T06:45:00.000Z",
        sources: [
          {
            streamUrl: "http://129.225.106.195/d/master.m3u8?d=feed1", // Identical stream URL!
            format: "HLS",
            quality: "1080p",
            provider: "sportzx",
          },
          {
            streamUrl: "https://secondary.stream.net/live/feed2.m3u8",
            format: "HLS",
            quality: "720p",
            provider: "sktech",
          },
        ],
      },
    ];

    const catalog = buildUnifiedCatalog(mockEvents);
    expect(catalog.length).toBe(1);

    const nplFixture = catalog[0];
    expect(nplFixture.kind).toBe("tournament_channel");
    expect(nplFixture.teams).toBeNull();
    expect(nplFixture.tournament?.shortName).toBe("NPL T20");
    expect(nplFixture.streamMetadata.totalWorkingFeeds).toBe(2);
    expect(nplFixture.providerPointers["cricify"]).toBeDefined();
    expect(nplFixture.providerPointers["sportzx"]).toBeDefined();
  });

  test("builds rich stream feeds with multi-provider provenance and attribution badge", () => {
    const rawSources = [
      {
        streamUrl: "http://129.225.106.195/d/master.m3u8?d=feed1",
        format: "HLS" as const,
        quality: "1080p",
        provider: "cricify",
      },
      {
        streamUrl: "http://129.225.106.195/d/master.m3u8?d=feed1",
        format: "HLS" as const,
        quality: "1080p",
        provider: "sportzx",
      },
      {
        streamUrl: "http://129.225.106.195/d/master.m3u8?d=feed1",
        format: "HLS" as const,
        quality: "1080p",
        provider: "sktech",
      },
    ];

    const feeds = buildRichStreamFeeds(rawSources, "/api/proxy");
    expect(feeds.length).toBe(1);

    const unifiedFeed = feeds[0];
    expect(unifiedFeed.provenance.isMultiSource).toBe(true);
    expect(unifiedFeed.provenance.primaryProvider).toBe("cricify");
    expect(unifiedFeed.provenance.mirroredProviders).toEqual(["sportzx", "sktech"]);
    expect(unifiedFeed.provenance.attributionBadge).toBe("Multi-Source (Cricify Live + 2 Mirrors)");
    expect(unifiedFeed.network.masterPlaylistUrl).toBe("http://129.225.106.195/d/master.m3u8?d=feed1");
    expect(unifiedFeed.network.edgeProxyFallbackUrl).toContain("/api/proxy?url=");
    expect(unifiedFeed.hasPreParsedRenditions).toBe(true);
    expect(unifiedFeed.renditions.length).toBeGreaterThanOrEqual(4);
    const renditionUrls = unifiedFeed.renditions.map((r) => r.url);
    const uniqueUrls = new Set(renditionUrls);
    expect(uniqueUrls.size).toBe(unifiedFeed.renditions.length); // Every rendition has its own distinct URL!
    expect(renditionUrls.some((u) => u.includes("quality=auto"))).toBe(true);
    expect(renditionUrls.some((u) => u.includes("quality=1080p"))).toBe(true);
    expect(renditionUrls.some((u) => u.includes("quality=720p"))).toBe(true);
  });

  test("parses prefix and suffix tournament brackets correctly without corrupting team names", () => {
    // Pattern 1: Tournament Prefix in bracket (PlayZTV style)
    const parsed1 = parseEventEntities("ICC World Test Championship (Pakistan vs Sri Lanka)");
    expect(parsed1.kind).toBe("match");
    expect(parsed1.teams?.teamA.code).toBe("PAK");
    expect(parsed1.teams?.teamB.code).toBe("SL");
    expect(parsed1.tournament?.name).toBe("ICC World Test Championship");

    // Pattern 2: Tournament Suffix in bracket (Sportzx style)
    const parsed2 = parseEventEntities("Pakistan vs Sri Lanka (ICC World Test Championship)");
    expect(parsed2.kind).toBe("match");
    expect(parsed2.teams?.teamA.code).toBe("PAK");
    expect(parsed2.teams?.teamB.code).toBe("SL");

    // Both generate identical canonical keys!
    const key1 = generateCanonicalKey("cricket", parsed1, "10/11/2026 04:30:00");
    const key2 = generateCanonicalKey("cricket", parsed2, "2026/11/10 04:30:00 +0000");
    expect(key1).toBe("cricket::pak-vs-sl::2026-11-10");
    expect(key2).toBe("cricket::pak-vs-sl::2026-11-10");
    expect(key1).toBe(key2);
  });

  test("parses canonical date across DD/MM/YYYY, YYYY/MM/DD, and ISO formats", () => {
    const { parseCanonicalDate, safeIsoDate } = require("../src/catalog/normalizer");
    expect(parseCanonicalDate("10/11/2026 04:30:00")).toBe("2026-11-10");
    expect(parseCanonicalDate("2026/11/10 04:30:00 +0000")).toBe("2026-11-10");
    expect(parseCanonicalDate("2026-11-10T04:30:00.000Z")).toBe("2026-11-10");

    expect(safeIsoDate("10/11/2026 04:30:00")).toBe("2026-11-10T04:30:00.000Z");
    expect(safeIsoDate("2026/11/10 04:30:00")).toBe("2026-11-10T04:30:00.000Z");
  });

  test("detects extended sports (kabaddi, badminton, table-tennis, volleyball, rugby)", () => {
    expect(detectSport("Sports", "Pro Kabaddi League Bengal vs Bengaluru")).toBe("kabaddi");
    expect(detectSport("Sports", "BWF All England Open Finals")).toBe("badminton");
    expect(detectSport("Sports", "WTT Table Tennis World Tour")).toBe("table-tennis");
    expect(detectSport("Sports", "FIVB Volleyball Nations League")).toBe("volleyball");
    expect(detectSport("Sports", "Six Nations Rugby Championship")).toBe("rugby");
  });

  test("cross-provider coalesces fixtures even with different date representations", () => {
    const playZtvEvent: LiveEvent = {
      id: "playztv_1",
      title: "ICC World Test Championship (Pakistan vs Sri Lanka)",
      category: "Cricket",
      status: "LIVE",
      startTime: "10/11/2026 04:30:00",
      sources: [
        {
          streamUrl: "http://stream.playztv.com/live/pakvsl.m3u8",
          format: "HLS",
          quality: "1080p",
          provider: "playztv",
        },
      ],
    };

    const sportzxEvent: LiveEvent = {
      id: "sportzx_1",
      title: "Pakistan vs Sri Lanka (ICC World Test Championship)",
      category: "Cricket",
      status: "LIVE",
      startTime: "2026/11/10 04:30:00 +0000",
      sources: [
        {
          streamUrl: "http://stream.sportzx.com/live/pakvsl.m3u8",
          format: "HLS",
          quality: "720p",
          provider: "sportzx",
        },
      ],
    };

    const cricifyEvent: LiveEvent = {
      id: "cricify_1",
      title: "Sri Lanka vs Pakistan",
      category: "Cricket",
      status: "LIVE",
      sources: [
        {
          streamUrl: "http://stream.playztv.com/live/pakvsl.m3u8", // identical mirror
          format: "HLS",
          quality: "1080p",
          provider: "cricify",
        },
      ],
    };

    const unified = buildUnifiedCatalog([playZtvEvent, sportzxEvent, cricifyEvent]);
    expect(unified.length).toBe(1);
    expect(unified[0].teams?.teamA.code).toBe("PAK");
    expect(unified[0].teams?.teamB.code).toBe("SL");
    expect(unified[0].streamMetadata.totalWorkingFeeds).toBe(2);
    expect(unified[0].providerPointers["playztv"]).toBeDefined();
    expect(unified[0].providerPointers["sportzx"]).toBeDefined();
    expect(unified[0].providerPointers["cricify"]).toBeDefined();
  });

  test("parses colon tournament prefix and slash separator accurately", () => {
    const parsedColon = parseEventEntities("ICC Champions Trophy: IND vs PAK");
    expect(parsedColon.kind).toBe("match");
    expect(parsedColon.teams?.teamA.code).toBe("IND");
    expect(parsedColon.teams?.teamB.code).toBe("PAK");
    expect(parsedColon.tournament?.shortName).toBe("Champions Trophy");

    const parsedSlash = parseEventEntities("IND / PAK");
    expect(parsedSlash.kind).toBe("match");
    expect(parsedSlash.teams?.teamA.code).toBe("IND");
    expect(parsedSlash.teams?.teamB.code).toBe("PAK");
  });

  test("propagates pipe and object headers into network.headers and renditions query params", () => {
    const rawSources = [
      {
        streamUrl: "http://stream.net/live.m3u8|Referer=https://upstream.com&User-Agent=CustomUA",
        format: "HLS" as const,
        quality: "1080p",
        provider: "cricify",
      },
    ];

    const feeds = buildRichStreamFeeds(rawSources, "/api/proxy");
    expect(feeds.length).toBe(1);
    expect(feeds[0].network.headers).toBeDefined();
    expect(feeds[0].network.headers?.["Referer"]).toBe("https://upstream.com");
    expect(feeds[0].network.headers?.["User-Agent"]).toBe("CustomUA");
    expect(feeds[0].network.edgeProxyFallbackUrl).toContain("referer=https%3A%2F%2Fupstream.com");
    expect(feeds[0].network.edgeProxyFallbackUrl).toContain("ua=CustomUA");
    expect(feeds[0].renditions[0].url).toContain("referer=https%3A%2F%2Fupstream.com");
  });

  test("prevents false matches on channel names with quality or language suffixes (e.g. Sony Ten 1 - HD)", () => {
    const parsed1 = parseEventEntities("Sony Ten 1 - HD");
    expect(parsed1.kind).toBe("tournament_channel");
    expect(parsed1.teams).toBeNull();
    expect(parsed1.cleanTitle).toBe("Sony Ten 1 - HD");

    const parsed2 = parseEventEntities("Star Sports 1 - Hindi");
    expect(parsed2.kind).toBe("tournament_channel");
    expect(parsed2.teams).toBeNull();
    expect(parsed2.cleanTitle).toBe("Star Sports 1 - Hindi");

    const parsed3 = parseEventEntities("Sky Sports Main Event - UHD");
    expect(parsed3.kind).toBe("tournament_channel");
    expect(parsed3.teams).toBeNull();
  });

  test("correctly parses match number prefixes and avoids fake match tournaments", () => {
    const parsed = parseEventEntities("IPL 2026: Match 1 - CSK vs RCB");
    expect(parsed.kind).toBe("match");
    expect(parsed.tournament?.shortName).toBe("IPL");
    expect(parsed.teams?.teamA.code).toBe("CSK");
    expect(parsed.teams?.teamB.code).toBe("RCB");
    expect(parsed.cleanTitle).toBe("Chennai Super Kings vs Royal Challengers Bengaluru");

    const parsedLive = parseEventEntities("Live: Real Madrid vs Barcelona");
    expect(parsedLive.kind).toBe("match");
    expect(parsedLive.teams?.teamA.code).toBe("RMA");
    expect(parsedLive.teams?.teamB.code).toBe("BAR");
    expect(parsedLive.tournament).toBeNull(); // ensures no fake "tourn_live"
  });

  test("propagates Cookie header across pipe parameters and renditions", () => {
    const rawSources = [
      {
        streamUrl: "http://stream.net/live.mpd|Cookie=session_token_xyz&Referer=https://upstream.com",
        format: "DASH" as const,
        quality: "1080p",
        provider: "playztv",
      },
    ];

    const feeds = buildRichStreamFeeds(rawSources, "/api/proxy");
    expect(feeds.length).toBe(1);
    expect(feeds[0].network.headers?.["Cookie"]).toBe("session_token_xyz");
    expect(feeds[0].network.edgeProxyFallbackUrl).toContain("cookie=session_token_xyz");
    expect(feeds[0].renditions[0].url).toContain("cookie=session_token_xyz");
  });

  test("resolves expanded ICC associates and WPL teams accurately", () => {
    const parsedIcc = parseEventEntities("NED vs SCOT");
    expect(parsedIcc.teams?.teamA.name).toBe("Netherlands");
    expect(parsedIcc.teams?.teamB.name).toBe("Scotland");

    const parsedWpl = parseEventEntities("MI W vs RCB W");
    expect(parsedWpl.teams?.teamA.name).toBe("Mumbai Indians Women");
    expect(parsedWpl.teams?.teamB.name).toBe("Royal Challengers Bengaluru Women");
  });

  test("prevents false merges when match numbers differ (1st ODI vs 2nd ODI) or dates are far apart", () => {
    const match1: LiveEvent = {
      id: "ev_odi_1",
      title: "India vs Australia - 1st ODI",
      category: "Cricket",
      status: "ENDED",
      startTime: "2026-11-10T08:00:00Z",
      sources: [{ provider: "cricify", quality: "1080p", format: "HLS", streamUrl: "https://a.com/1.m3u8" }],
    };
    const match2: LiveEvent = {
      id: "ev_odi_2",
      title: "India vs Australia - 2nd ODI",
      category: "Cricket",
      status: "LIVE",
      startTime: "2026-11-13T08:00:00Z",
      sources: [{ provider: "sportzx", quality: "1080p", format: "HLS", streamUrl: "https://a.com/2.m3u8" }],
    };

    const catalog = buildUnifiedCatalog([match1, match2]);
    expect(catalog.length).toBe(2);
    expect(catalog[0].schedule.status).toBe("ended");
    expect(catalog[1].schedule.status).toBe("live");
  });

  test("merges ClearKey DRM and HTTP headers when duplicate stream URLs are contributed by multiple providers", () => {
    const sources = [
      {
        provider: "cricify",
        quality: "1080p",
        format: "DASH" as const,
        streamUrl: "https://cdn.example.com/live/cenc.mpd",
      },
      {
        provider: "playztv",
        quality: "1080p",
        title: "Star Sports 1 FHD",
        format: "DASH" as const,
        streamUrl: "https://cdn.example.com/live/cenc.mpd|Referer=https://jiotv.com",
        drm: {
          type: "clearkey" as const,
          clearKeys: [{ kid: "0123456789abcdef0123456789abcdef", key: "fedcba9876543210fedcba9876543210" }],
        },
      },
    ];

    const feeds = buildRichStreamFeeds(sources, "/api/proxy");
    expect(feeds.length).toBe(1);
    expect(feeds[0].channelName).toBe("Star Sports 1 FHD");
    expect(feeds[0].drm?.clearKeys?.[0]?.kid).toBe("0123456789abcdef0123456789abcdef");
    expect(feeds[0].network.headers?.["Referer"]).toBe("https://jiotv.com");
  });

  test("reconciles 'New Zealand vs India', 'IND vs NZ', and 'NZ vs IN' into the exact same canonical fixture", () => {
    const p1 = parseEventEntities("New Zealand vs India");
    const p2 = parseEventEntities("IND vs NZ");
    const p3 = parseEventEntities("NZ vs IN");

    const k1 = generateCanonicalKey("cricket", p1, "2026-11-14T08:00:00Z");
    const k2 = generateCanonicalKey("cricket", p2, "2026-11-14T08:00:00Z");
    const k3 = generateCanonicalKey("cricket", p3, "2026-11-14T08:00:00Z");

    expect(k1).toBe("cricket::ind-vs-nz::2026-11-14");
    expect(k2).toBe("cricket::ind-vs-nz::2026-11-14");
    expect(k3).toBe("cricket::ind-vs-nz::2026-11-14");
  });

  test("automatically infers WBBL and IPL tournaments from participating franchise names alone", () => {
    const wbblFromFranchises = parseEventEntities("Adelaide Strikers Women vs Sydney Sixers Women");
    expect(wbblFromFranchises.kind).toBe("match");
    expect(wbblFromFranchises.teams?.teamA.code).toBe("STRW");
    expect(wbblFromFranchises.teams?.teamB.code).toBe("SIXW");
    expect(wbblFromFranchises.tournament?.id).toBe("tourn_wbbl");
    expect(wbblFromFranchises.tournament?.shortName).toBe("WBBL");
    expect(wbblFromFranchises.matchFormat).toBe("T20");

    const wbblFromPrefix = parseEventEntities("WBBL: Adelaide Strikers vs Sydney Sixers");
    expect(wbblFromPrefix.teams?.teamA.code).toBe("STRW");
    expect(wbblFromPrefix.teams?.teamB.code).toBe("SIXW");
    expect(wbblFromPrefix.tournament?.id).toBe("tourn_wbbl");

    const iplFromFranchises = parseEventEntities("CSK vs MI");
    expect(iplFromFranchises.tournament?.id).toBe("tourn_ipl");
    expect(iplFromFranchises.matchFormat).toBe("T20");
  });

  test("keeps Men's, Women's, and U19 fixtures strictly separate on the same date", () => {
    const men = parseEventEntities("India vs Australia");
    const women = parseEventEntities("India Women vs Australia Women");
    const u19 = parseEventEntities("India U19 vs Australia U19");

    const kMen = generateCanonicalKey("cricket", men, "2026-11-14");
    const kWomen = generateCanonicalKey("cricket", women, "2026-11-14");
    const kU19 = generateCanonicalKey("cricket", u19, "2026-11-14");

    expect(kMen).toBe("cricket::aus-vs-ind::2026-11-14");
    expect(kWomen).toBe("cricket::ausw-vs-indw::2026-11-14");
    expect(kU19).toBe("cricket::ausu19-vs-indu19::2026-11-14");
  });

  test("deduplicates stream URLs with ephemeral cache-buster params while preserving stream tokens", () => {
    const sources = [
      {
        provider: "cricify",
        quality: "1080p",
        format: "HLS" as const,
        streamUrl: "https://CDN.EXAMPLE.COM:443/live//master.m3u8?id=101&_=17300001",
      },
      {
        provider: "sportzx",
        quality: "1080p",
        format: "HLS" as const,
        streamUrl: "https://cdn.example.com/live/master.m3u8?cb=9999&id=101",
      },
    ];

    const feeds = buildRichStreamFeeds(sources, "/api/proxy");
    expect(feeds.length).toBe(1);
    expect(feeds[0].provenance.isMultiSource).toBe(true);
    expect(feeds[0].provenance.primaryProvider).toBe("cricify");
    expect(feeds[0].provenance.mirroredProviders).toEqual(["sportzx"]);
  });

  test("scoreSearchQuery ranks exact, prefix, multi-token, and 1-edit-distance typo queries accurately", () => {
    const exact = scoreSearchQuery("IND", ["IND", "India"]);
    const prefix = scoreSearchQuery("Ind", ["India vs Australia"]);
    const multiToken = scoreSearchQuery("India Australia", ["Australia vs India - 1st Test"]);
    const typo = scoreSearchQuery("Crickt", ["Cricket World Cup"]);
    const unrelated = scoreSearchQuery("Basketball", ["India vs New Zealand"]);

    expect(exact).toBe(100);
    expect(prefix).toBeGreaterThanOrEqual(80);
    expect(multiToken).toBeGreaterThanOrEqual(70);
    expect(typo).toBeGreaterThanOrEqual(45);
    expect(unrelated).toBe(0);
  });

  test("buildUnifiedCatalog preserves upstream teamAFlag/teamBFlag logos, isHotMatch, and formatHints", () => {
    const hotEvent: LiveEvent = {
      id: "cricify_hot_1",
      title: "India vs Pakistan - Final",
      category: "Cricket",
      status: "LIVE",
      isHot: true,
      priority: 95,
      teamAFlag: "https://cdn.flags.com/ind.png",
      teamBFlag: "https://cdn.flags.com/pak.png",
      eventBanner: "https://cdn.banners.com/ind-vs-pak.jpg",
      formatHints: [
        { title: "1080p FHD" },
        { title: "720p HD" },
      ],
      sources: [
        {
          provider: "cricify",
          quality: "1080p",
          format: "HLS",
          streamUrl: "https://cdn.stream.com/master.m3u8",
        },
      ],
    };

    const catalog = buildUnifiedCatalog([hotEvent]);
    expect(catalog.length).toBe(1);
    const fix = catalog[0];
    expect(fix.isHotMatch).toBe(true);
    expect(fix.phase).toBe("live");
    expect(fix.teams?.teamA.logo).toBe("https://cdn.flags.com/ind.png");
    expect(fix.teams?.teamB.logo).toBe("https://cdn.flags.com/pak.png");
    expect(fix.posterUrl).toBe("https://cdn.banners.com/ind-vs-pak.jpg");
    expect(fix.streamMetadata.totalWorkingFeeds).toBeGreaterThanOrEqual(2);
  });
});





