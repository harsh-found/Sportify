import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import app from "../src/index";
import { aggregatorService } from "../src/services/aggregator.service";

describe("Sportify Live Sports Gateway API (v1.4.0)", () => {
  beforeAll(async () => {
    // Stop continuous background intervals to prevent hanging tests
    aggregatorService.stopBackgroundRefresh();
    // Warm up events and channels caches concurrently with 20s allowance
    await Promise.all([aggregatorService.getEvents(), aggregatorService.getChannels()]);
  }, 20000);

  afterAll(() => {
    aggregatorService.stopBackgroundRefresh();
  });

  test("GET /health returns Sportify Live Sports Gateway v1.4.0 metadata", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Response-Time")).toBeDefined();
    expect(res.headers.get("X-Request-Id")).toBeDefined();
    expect(res.headers.get("X-API-Version")).toBe("1.4.0");

    const data = (await res.json()) as any;
    expect(data.service).toBe("Sportify Live Sports Gateway");
    expect(data.version).toBe("1.4.0");
    expect(data.architecture).toBe("Edge-Federated Multi-Provider Engine");
    expect(data.status).toBe("healthy");
    expect(data.providersIntegrated).toBe(6);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.caches).toBeDefined();
    expect(data.endpoints).toBeDefined();
    expect(data.endpoints.unifiedCatalog).toBe("/api/catalog");
    expect(data.endpoints.catalogBySport).toBe("/api/catalog/:sport");
    expect(data.endpoints.sportsExplore).toBe("/api/sports");
    expect(data.endpoints.matches).toBe("/api/matches");
    expect(data.endpoints.hotMatches).toBe("/api/matches/hot");
    expect(data.endpoints.schedule).toBe("/api/schedule");
    expect(data.endpoints.epgXmltv).toBe("/api/epg.xml");
    expect(data.endpoints.tournaments).toBe("/api/tournaments");
    expect(data.endpoints.teams).toBe("/api/teams");
    expect(data.endpoints.channels).toBe("/api/channels");
    expect(data.endpoints.channelCategories).toBe("/api/channels/categories");
    expect(data.endpoints.broadcasters).toBe("/api/broadcasters");
    expect(data.endpoints.providers).toBe("/api/providers");
    expect(data.endpoints.unifiedStream).toBe("/api/stream/:fixtureKey");
    expect(data.endpoints.streamInspect).toBe("/api/streams/inspect?url=<manifest_url>");
    expect(data.endpoints.search).toBe("/api/search");
    expect(data.endpoints.stats).toBe("/api/stats");
    expect(data.endpoints.diagnostics).toBe("/api/diagnostics");
    expect(data.endpoints.streamProxy).toBe("/api/proxy?url=<target_m3u8_url>");
    expect(data.endpoints.iptvPlaylist).toBe("/api/playlist.m3u");
    expect(data.endpoints.apiDocs).toBe("/docs");
    expect(data.endpoints.openApiSchema).toBe("/api/openapi.json");
    expect(data.endpoints.health).toBe("/health");
  });

  test("GET /api/sports and GET /api/sports/:sport return sport summaries and details", async () => {
    const res = await app.request("/api/sports");
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.version).toBe("1.4.0");
    expect(Array.isArray(data.sports)).toBe(true);

    const detailRes = await app.request("/api/sports/cricket");
    expect(detailRes.status).toBe(200);
    const detailData = (await detailRes.json()) as any;
    expect(detailData.success).toBe(true);
    expect(detailData.sport).toBe("cricket");
    expect(Array.isArray(detailData.tournaments)).toBe(true);
    expect(Array.isArray(detailData.teams)).toBe(true);
    expect(Array.isArray(detailData.fixtures)).toBe(true);
  });

  test("GET /api/matches, /api/matches/live, /api/matches/upcoming, and /api/matches/hot support filtering and pagination", async () => {
    const res = await app.request("/api/matches?limit=5");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.version).toBe("1.4.0");
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.matches)).toBe(true);
    expect(data.matches.length).toBeLessThanOrEqual(5);

    const liveRes = await app.request("/api/matches/live?limit=5");
    expect(liveRes.status).toBe(200);
    const liveData = (await liveRes.json()) as any;
    expect(liveData.success).toBe(true);
    expect(liveData.phase).toBe("live");

    const upRes = await app.request("/api/matches/upcoming?limit=5");
    expect(upRes.status).toBe(200);
    const upData = (await upRes.json()) as any;
    expect(upData.success).toBe(true);
    expect(upData.phase).toBe("upcoming");

    const hotRes = await app.request("/api/matches/hot?limit=5");
    expect(hotRes.status).toBe(200);
    const hotData = (await hotRes.json()) as any;
    expect(hotData.success).toBe(true);
    expect(hotData.version).toBe("1.4.0");
    expect(Array.isArray(hotData.matches)).toBe(true);
  });

  test("GET /api/schedule and GET /api/epg.xml return chronological EPG schedule and XMLTV guide", async () => {
    const schedRes = await app.request("/api/schedule?hours=24");
    expect(schedRes.status).toBe(200);
    const schedData = (await schedRes.json()) as any;
    expect(schedData.success).toBe(true);
    expect(schedData.version).toBe("1.4.0");
    expect(schedData.summary).toBeDefined();
    expect(Array.isArray(schedData.liveNow)).toBe(true);
    expect(Array.isArray(schedData.startingSoon)).toBe(true);
    expect(typeof schedData.upcomingByDate).toBe("object");

    const epgRes = await app.request("/api/epg.xml?sport=cricket");
    expect(epgRes.status).toBe(200);
    expect(epgRes.headers.get("content-type")).toContain("application/xml");
    const xmlText = await epgRes.text();
    expect(xmlText).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xmlText).toContain('<tv generator-info-name="Sportify EPG Engine v1.4.0"');
  });

  test("GET /api/tournaments and GET /api/tournaments/:id return canonical and active competitions", async () => {
    const res = await app.request("/api/tournaments?sport=cricket");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.tournaments)).toBe(true);
    expect(data.tournaments.some((t: any) => t.id === "tourn_wbbl")).toBe(true);

    const detailRes = await app.request("/api/tournaments/wbbl");
    expect(detailRes.status).toBe(200);
    const detailData = (await detailRes.json()) as any;
    expect(detailData.success).toBe(true);
    expect(detailData.tournament.id).toBe("tourn_wbbl");
    expect(detailData.tournament.name).toBe("Women's Big Bash League");
  });

  test("GET /api/teams and GET /api/teams/:teamCode resolve canonical teams and aliases (e.g. IN -> IND)", async () => {
    const res = await app.request("/api/teams?sport=cricket&limit=20");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.teams)).toBe(true);
    expect(data.teams.length).toBeGreaterThan(0);

    const detailRes = await app.request("/api/teams/in");
    expect(detailRes.status).toBe(200);
    const detailData = (await detailRes.json()) as any;
    expect(detailData.success).toBe(true);
    expect(detailData.team.code).toBe("IND");
    expect(detailData.team.name).toBe("India");
    expect(detailData.team.aliases).toContain("in");
  });

  test("GET /api/channels, /api/channels/categories, /api/broadcasters, and /api/providers return structured resources", async () => {
    const chRes = await app.request("/api/channels?limit=10");
    expect(chRes.status).toBe(200);
    const chData = (await chRes.json()) as any;
    expect(chData.success).toBe(true);
    expect(Array.isArray(chData.channels)).toBe(true);

    const catRes = await app.request("/api/channels/categories");
    expect(catRes.status).toBe(200);
    const catData = (await catRes.json()) as any;
    expect(catData.success).toBe(true);
    expect(Array.isArray(catData.categories)).toBe(true);

    const bcRes = await app.request("/api/broadcasters");
    expect(bcRes.status).toBe(200);
    const bcData = (await bcRes.json()) as any;
    expect(bcData.success).toBe(true);
    expect(Array.isArray(bcData.broadcasters)).toBe(true);

    const provRes = await app.request("/api/providers");
    expect(provRes.status).toBe(200);
    const provData = (await provRes.json()) as any;
    expect(provData.success).toBe(true);
    expect(provData.totalProviders).toBe(6);

    const singleProv = await app.request("/api/providers/cricify");
    expect(singleProv.status).toBe(200);
    const singleProvData = (await singleProv.json()) as any;
    expect(singleProvData.success).toBe(true);
    expect(singleProvData.provider.id).toBe("cricify");
    expect(singleProvData.provider.firebaseProjectId).toBe("963020218535");
  });

  test("GET /api/search and GET /api/stats return unified search results and platform telemetry", async () => {
    const searchRes = await app.request("/api/search?q=India&limit=5");
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as any;
    expect(searchData.success).toBe(true);
    expect(searchData.query).toBe("India");
    expect(Array.isArray(searchData.teams)).toBe(true);
    expect(searchData.teams.some((t: any) => t.code === "IND" || t.code === "INDW")).toBe(true);

    const statsRes = await app.request("/api/stats");
    expect(statsRes.status).toBe(200);
    const statsData = (await statsRes.json()) as any;
    expect(statsData.success).toBe(true);
    expect(statsData.overview).toBeDefined();
    expect(statsData.overview.providersTotal).toBe(6);
    expect(Array.isArray(statsData.byProvider)).toBe(true);
  });

  test("GET /api/catalog returns normalized sports fixtures and supports HTTP ETag / 304 Not Modified", async () => {
    const res = await app.request("/api/catalog");
    expect(res.status).toBe(200);
    const etag = res.headers.get("ETag");
    expect(etag).toBeDefined();

    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(typeof data.totalFixtures).toBe("number");
    expect(Array.isArray(data.fixtures)).toBe(true);

    if (data.fixtures.length > 0) {
      const item = data.fixtures[0];
      expect(item.fixtureId).toBeDefined();
      expect(item.canonicalKey).toBeDefined();
      expect(item.kind).toBeDefined();
      expect(item.broadcastInfo).toBeDefined();
      expect(item.schedule).toBeDefined();
      expect(item.streamMetadata).toBeDefined();
    }

    if (etag) {
      const conditionalRes = await app.request("/api/catalog", {
        headers: { "If-None-Match": etag },
      });
      expect(conditionalRes.status).toBe(304);
    }
  });

  test("GET /api/catalog/:sport filters catalog by sport", async () => {
    const res = await app.request("/api/catalog/cricket");
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.sport).toBe("cricket");
    expect(Array.isArray(data.fixtures)).toBe(true);

    for (const fix of data.fixtures) {
      expect(fix.sport).toBe("cricket");
    }
  });

  test("GET /api/stream/:fixtureKey resolves stream feeds with rich provenance", async () => {
    const catalogRes = await app.request("/api/catalog");
    const catalogData = (await catalogRes.json()) as any;
    if (catalogData.fixtures && catalogData.fixtures.length > 0) {
      const fixtureKey = catalogData.fixtures[0].canonicalKey;
      const res = await app.request(`/api/stream/${encodeURIComponent(fixtureKey)}`);
      expect(res.status).toBe(200);

      const streamData = (await res.json()) as any;
      expect(streamData.success).toBe(true);
      expect(streamData.fixtureKey).toBe(fixtureKey);
      expect(Array.isArray(streamData.feeds)).toBe(true);

      if (streamData.feeds.length > 0) {
        const feed = streamData.feeds[0];
        expect(feed.streamId).toBeDefined();
        expect(feed.provenance).toBeDefined();
        expect(feed.network).toBeDefined();
        expect(feed.network.edgeProxyFallbackUrl).toContain("/api/proxy?url=");
        expect(feed.hasPreParsedRenditions).toBe(true);
      }
    }
  });

  test("GET /api/streams/inspect validates url and inspects live HLS manifest", async () => {
    const badRes = await app.request("/api/streams/inspect");
    expect(badRes.status).toBe(400);

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          `#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,FRAME-RATE=60\nchunklist_1080.m3u8\n`,
          { status: 200, headers: { "Content-Type": "application/vnd.apple.mpegurl" } }
        );
      },
    });

    const inspectRes = await app.request(
      `/api/streams/inspect?url=${encodeURIComponent(`http://localhost:${server.port}/master.m3u8`)}`
    );
    expect(inspectRes.status).toBe(200);
    const inspectData = (await inspectRes.json()) as any;
    expect(inspectData.success).toBe(true);
    expect(inspectData.inspection.isAlive).toBe(true);
    expect(inspectData.inspection.manifestType).toBe("HLS_MASTER");
    expect(inspectData.inspection.renditions.length).toBe(1);
    expect(inspectData.inspection.renditions[0].qualityTag).toBe("1080p");

    server.stop();
  });

  test("GET /api/proxy validates missing url parameter", async () => {
    const res = await app.request("/api/proxy");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Invalid or missing 'url'");
  });

  test("GET /portal returns 200 and renders HTML portal", async () => {
    const res = await app.request("/portal");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sportify Live");
    expect(html).toContain("Live Sports Catalog & Stream Explorer");
    expect(html).toContain("hls.js");
  });

  test("GET /app redirects to /portal", async () => {
    const res = await app.request("/app");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/portal");
  });

  test("GET /api/catalog with query filters (search, phase, limit)", async () => {
    const res = await app.request("/api/catalog?phase=live&limit=5");
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.filters).toBeDefined();
    expect(data.filters.phase).toBe("live");
    expect(data.filters.limit).toBe(5);
    expect(data.fixtures.length).toBeLessThanOrEqual(5);
  });

  test("GET /api/playlist.m3u generates IPTV compatible playlist", async () => {
    const res = await app.request("/api/playlist.m3u?sport=cricket");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/vnd.apple.mpegurl");

    const m3uText = await res.text();
    expect(m3uText).toStartWith("#EXTM3U");
    expect(m3uText).toContain("#EXTINF:-1");
  }, 30000);

  test("GET /playlist.m3u root alias returns 200", async () => {
    const res = await app.request("/playlist.m3u");
    expect(res.status).toBe(200);
    const m3uText = await res.text();
    expect(m3uText).toStartWith("#EXTM3U");
  }, 30000);

  test("GET /api/openapi.json returns valid OpenAPI 3.1.0 v1.4.0 specification", async () => {
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const schema = (await res.json()) as any;
    expect(schema.openapi).toBe("3.1.0");
    expect(schema.info.version).toBe("1.4.0");
    expect(schema.info.title).toContain("Sportify");
    expect(schema.paths["/api/catalog"]).toBeDefined();
    expect(schema.paths["/api/matches"]).toBeDefined();
    expect(schema.paths["/api/matches/hot"]).toBeDefined();
    expect(schema.paths["/api/schedule"]).toBeDefined();
    expect(schema.paths["/api/epg.xml"]).toBeDefined();
    expect(schema.paths["/api/tournaments"]).toBeDefined();
    expect(schema.paths["/api/teams"]).toBeDefined();
    expect(schema.paths["/api/channels"]).toBeDefined();
    expect(schema.paths["/api/channels/categories"]).toBeDefined();
    expect(schema.paths["/api/broadcasters"]).toBeDefined();
    expect(schema.paths["/api/providers"]).toBeDefined();
    expect(schema.paths["/api/search"]).toBeDefined();
    expect(schema.paths["/api/stats"]).toBeDefined();
    expect(schema.paths["/api/diagnostics"]).toBeDefined();
    expect(schema.paths["/api/stream/{fixtureKey}"]).toBeDefined();
    expect(schema.paths["/api/streams/inspect"]).toBeDefined();
    expect(schema.paths["/api/proxy"]).toBeDefined();
    expect(schema.paths["/api/playlist.m3u"]).toBeDefined();
  });

  test("GET /docs renders redesigned v1.4.0 developer documentation portal", async () => {
    const res = await app.request("/docs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sportify API");
    expect(html).toContain("v1.4.0");
    expect(html).toContain("SwaggerUIBundle");
    expect(html).toContain("/api/openapi.json");
  });

  test("GET /api/openapi.json supports gzip compression when requested", async () => {
    const res = await app.request("/api/openapi.json", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });
});

