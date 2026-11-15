import { Hono } from "hono";
import path from "node:path";

export const docsRoute = new Hono();

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Sportify Live Sports & Stream Aggregation API",
    version: "1.4.0",
    description:
      "Production-grade sports data and live stream aggregation API platform federating 6 CS3 providers (Cricify, Sportzx, PlayZTV, PlayFy, SKTech, LivXow) with O(1) indexed catalog lookups, Unicode diacritic entity normalization, franchise-to-tournament inference, 24KB deep HLS/DASH manifest rendition & encryption inspection, PlaybackCompatibility client profiles, ClearKey DRM resolution, XMLTV EPG generation, extraction quality diagnostics, and SSRF-hardened 6-scheme HLS/DASH edge proxying.",
    contact: {
      name: "Sportify Platform Engineering",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current Edge Gateway Instance",
    },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["System & Telemetry"],
        summary: "Gateway Health, Provider Circuit States & Cache Telemetry",
        responses: {
          "200": { description: "Healthy gateway response with provider and cache telemetry" },
        },
      },
    },
    "/api/stats": {
      get: {
        tags: ["System & Telemetry"],
        summary: "Comprehensive Platform Statistics Across Sports, Providers, Protocols & Caches",
        responses: {
          "200": { description: "Aggregated platform statistics and system telemetry" },
        },
      },
    },
    "/api/diagnostics": {
      get: {
        tags: ["System & Telemetry"],
        summary: "Extraction Coverage, Deduplication Efficiency & Per-Provider Telemetry Diagnostics",
        responses: {
          "200": { description: "Real-time extraction coverage, deduplication ratio, and provider network telemetry" },
        },
      },
    },
    "/api/search": {
      get: {
        tags: ["Search"],
        summary: "Unified Weighted & Fuzzy Cross-Resource Search (Matches, Tournaments, Teams, Channels)",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Search query string with typo tolerance (e.g. India, WBBL, IPL, Star Sports)" },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": { description: "Categorized search results across matches, tournaments, teams, and channels" },
        },
      },
    },
    "/api/sports": {
      get: {
        tags: ["Sports"],
        summary: "List Active Sports Categories with Live & Upcoming Fixture Counts",
        responses: {
          "200": { description: "Aggregated list of sports categories" },
        },
      },
    },
    "/api/sports/{sport}": {
      get: {
        tags: ["Sports"],
        summary: "Detailed Sport Breakdown (Tournaments, Teams, Fixtures)",
        parameters: [
          { name: "sport", in: "path", required: true, schema: { type: "string" }, description: "Sport slug (e.g. cricket, football, motorsport)" },
        ],
        responses: {
          "200": { description: "Sport detail with active tournaments, teams, and fixtures" },
        },
      },
    },
    "/api/matches": {
      get: {
        tags: ["Matches & Events"],
        summary: "Query Normalized Matches & Events with O(1) Indexed Filtering, Sorting & Pagination",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
          { name: "phase", in: "query", schema: { type: "string", enum: ["live", "upcoming", "ended", "all"] } },
          { name: "tournament", in: "query", schema: { type: "string" } },
          { name: "team", in: "query", schema: { type: "string" } },
          { name: "provider", in: "query", schema: { type: "string" } },
          { name: "language", in: "query", schema: { type: "string" } },
          { name: "drm", in: "query", schema: { type: "boolean" } },
          { name: "hot", in: "query", schema: { type: "boolean" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["status", "feeds", "title", "time"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": { description: "Paginated list of normalized matches and fixtures" },
          "304": { description: "Not Modified (when If-None-Match matches catalog ETag)" },
        },
      },
    },
    "/api/matches/live": {
      get: {
        tags: ["Matches & Events"],
        summary: "List Currently Live Matches Across All 6 Providers",
        responses: {
          "200": { description: "Currently live matches" },
        },
      },
    },
    "/api/matches/upcoming": {
      get: {
        tags: ["Matches & Events"],
        summary: "List Upcoming Scheduled Fixtures",
        responses: {
          "200": { description: "Upcoming fixtures" },
        },
      },
    },
    "/api/matches/hot": {
      get: {
        tags: ["Matches & Events"],
        summary: "List High-Priority Marquee & Trending Matches (Rivalries, Finals, Multi-Provider Live)",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
        ],
        responses: {
          "200": { description: "Marquee and trending matches" },
        },
      },
    },
    "/api/matches/{matchId}": {
      get: {
        tags: ["Matches & Events"],
        summary: "Get Match Detail & Resolved Multi-Provider Stream Feeds (O(1) Indexed Lookup)",
        parameters: [
          { name: "matchId", in: "path", required: true, schema: { type: "string" }, description: "fixtureId, canonicalKey, or provider event ID" },
        ],
        responses: {
          "200": { description: "Match metadata and resolved stream feeds" },
          "404": { description: "Match not found" },
        },
      },
    },
    "/api/schedule": {
      get: {
        tags: ["Schedule & EPG"],
        summary: "Chronological Electronic Program Guide (EPG) Grouped by Live Now, Starting Soon & Date",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
          { name: "date", in: "query", schema: { type: "string" }, description: "YYYY-MM-DD filter" },
          { name: "format", in: "query", schema: { type: "string", enum: ["json", "xmltv"] } },
        ],
        responses: {
          "200": { description: "Structured chronological EPG schedule" },
        },
      },
    },
    "/api/epg.xml": {
      get: {
        tags: ["Schedule & EPG"],
        summary: "Standard XMLTV Electronic Program Guide for IPTV Players (TiviMate, OTT Navigator, Kodi)",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "XMLTV document" },
        },
      },
    },
    "/api/tournaments": {
      get: {
        tags: ["Tournaments & Competitions"],
        summary: "List All Tournaments & Competitions (IPL, WBBL, BBL, WPL, PSL, UCL, EPL, F1, NBA, NHL, Grand Slams)",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "active", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": { description: "List of tournaments with fixture and team counts" },
        },
      },
    },
    "/api/tournaments/{tournamentId}": {
      get: {
        tags: ["Tournaments & Competitions"],
        summary: "Get Tournament Detail, Participating Teams & Fixtures",
        parameters: [
          { name: "tournamentId", in: "path", required: true, schema: { type: "string" }, description: "Tournament ID or shortName (e.g. tourn_ipl, wbbl)" },
        ],
        responses: {
          "200": { description: "Tournament detail and fixtures" },
          "404": { description: "Tournament not found" },
        },
      },
    },
    "/api/teams": {
      get: {
        tags: ["Teams"],
        summary: "List Canonical Teams with Gender, Age Group, League & Aliases",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
          { name: "gender", in: "query", schema: { type: "string", enum: ["men", "women"] } },
          { name: "league", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "active", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": { description: "List of canonical teams" },
        },
      },
    },
    "/api/teams/{teamCode}": {
      get: {
        tags: ["Teams"],
        summary: "Get Team Profile, Known Aliases & Active Fixtures",
        parameters: [
          { name: "teamCode", in: "path", required: true, schema: { type: "string" }, description: "Team code or alias (e.g. IND, NZ, CSK, STRW)" },
        ],
        responses: {
          "200": { description: "Team profile and fixtures" },
          "404": { description: "Team not found" },
        },
      },
    },
    "/api/channels": {
      get: {
        tags: ["Channels & Broadcasters"],
        summary: "List 24/7 Live Sports & TV Channels Across All 6 Providers",
        parameters: [
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "provider", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
        ],
        responses: {
          "200": { description: "Paginated channels list" },
        },
      },
    },
    "/api/channels/categories": {
      get: {
        tags: ["Channels & Broadcasters"],
        summary: "List Normalized Channel Categories with Channel Counts, HD Counts & Providers",
        responses: {
          "200": { description: "Aggregated channel categories" },
        },
      },
    },
    "/api/channels/{channelId}": {
      get: {
        tags: ["Channels & Broadcasters"],
        summary: "Get Channel Metadata & Resolved Playable Streams",
        parameters: [
          { name: "channelId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Channel detail and resolved stream sources" },
          "404": { description: "Channel not found" },
        },
      },
    },
    "/api/broadcasters": {
      get: {
        tags: ["Channels & Broadcasters"],
        summary: "List Broadcast Networks with Fixture & Channel Counts",
        responses: {
          "200": { description: "Aggregated broadcasters list" },
        },
      },
    },
    "/api/providers": {
      get: {
        tags: ["Providers"],
        summary: "List All 6 CS3 Providers with Cryptographic Specs, Circuit States & Live Counts",
        responses: {
          "200": { description: "Provider statuses and statistics" },
        },
      },
    },
    "/api/providers/{providerId}": {
      get: {
        tags: ["Providers"],
        summary: "Get Provider Detail, Circuit State & Contributed Fixtures/Channels",
        parameters: [
          { name: "providerId", in: "path", required: true, schema: { type: "string", enum: ["cricify", "sportzx", "playztv", "playfy", "sktech", "livxow"] } },
        ],
        responses: {
          "200": { description: "Provider detail and contributed resources" },
          "404": { description: "Provider not found" },
        },
      },
    },
    "/api/catalog": {
      get: {
        tags: ["Catalog"],
        summary: "Fetch Normalized & Deduplicated Unified Sports Catalog",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
          { name: "phase", in: "query", schema: { type: "string", enum: ["live", "upcoming", "ended", "all"] } },
          { name: "provider", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Normalized sports fixtures catalog" },
        },
      },
    },
    "/api/catalog/{sport}": {
      get: {
        tags: ["Catalog"],
        summary: "Fetch Unified Sports Catalog Filtered by Sport",
        parameters: [
          { name: "sport", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Normalized fixtures for the requested sport" },
        },
      },
    },
    "/api/streams/inspect": {
      get: {
        tags: ["Streams & Proxy"],
        summary: "Deeply Inspect HLS/DASH Manifest URL for Real Renditions, Audio Tracks, ClearKey KIDs & Latency",
        parameters: [
          { name: "url", in: "query", required: true, schema: { type: "string" }, description: "Target .m3u8 or .mpd manifest URL" },
          { name: "referer", in: "query", schema: { type: "string" } },
          { name: "userAgent", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Parsed manifest inspection result with video renditions, audio tracks, and DRM KIDs" },
          "400": { description: "Missing url parameter" },
        },
      },
    },
    "/api/stream/{fixtureKey}": {
      get: {
        tags: ["Streams & Proxy"],
        summary: "Resolve Rich Stream Feeds with Multi-Provider Provenance, ClearKey DRM & Canary Probing",
        parameters: [
          { name: "fixtureKey", in: "path", required: true, schema: { type: "string" } },
          { name: "probe", in: "query", schema: { type: "boolean" } },
          { name: "protocol", in: "query", schema: { type: "string", enum: ["hls", "dash"] } },
          { name: "quality", in: "query", schema: { type: "string", enum: ["AUTO", "1080p", "720p", "480p", "360p"] } },
          { name: "language", in: "query", schema: { type: "string" } },
          { name: "provider", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Resolved stream feeds with provenance and renditions" },
          "404": { description: "No live feeds found for fixture" },
        },
      },
    },
    "/api/proxy": {
      get: {
        tags: ["Streams & Proxy"],
        summary: "CORS-Safe HLS/DASH Edge Reverse Proxy & Quality Variant Filter",
        parameters: [
          { name: "url", in: "query", required: true, schema: { type: "string" } },
          { name: "fallback", in: "query", schema: { type: "string" } },
          { name: "quality", in: "query", schema: { type: "string" } },
          { name: "referer", in: "query", schema: { type: "string" } },
          { name: "ua", in: "query", schema: { type: "string" } },
          { name: "cookie", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Proxied HLS manifest, DASH MPD, or TS/fMP4 media segment" },
          "400": { description: "Missing or invalid url parameter" },
        },
      },
    },
    "/api/playlist.m3u": {
      get: {
        tags: ["IPTV & Live SSE"],
        summary: "Generate Dynamic IPTV M3U8 Playlist with #KODIPROP ClearKey DRM Directives",
        parameters: [
          { name: "sport", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "M3U8 playlist file" },
        },
      },
    },
    "/api/live/sse": {
      get: {
        tags: ["IPTV & Live SSE"],
        summary: "Real-Time Server-Sent Events (SSE) Catalog & Provider Health Stream",
        responses: {
          "200": { description: "EventStream connection" },
        },
      },
    },
  },
};

docsRoute.get("/api/openapi.json", (c) => c.json(openApiSpec));
docsRoute.get("/openapi.json", (c) => c.json(openApiSpec));

docsRoute.get("/docs", async (c) => {
  const metaPath = path.resolve(import.meta.dir, "../../public/docs.html");
  const cwdPath = path.resolve(process.cwd(), "public/docs.html");

  const metaFile = Bun.file(metaPath);
  if (await metaFile.exists()) {
    return c.html(await metaFile.text());
  }
  const cwdFile = Bun.file(cwdPath);
  if (await cwdFile.exists()) {
    return c.html(await cwdFile.text());
  }

  return c.html(`<!DOCTYPE html><html><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script><script>window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' });</script></body></html>`);
});
