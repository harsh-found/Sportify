import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

const API_VERSION = "1.1.0";

export const matchesResourceRoute = new Hono();

// GET /api/matches (or /api/events)
matchesResourceRoute.get("/", async (c) => {
  const sport = c.req.query("sport");
  const phase = (c.req.query("phase") || c.req.query("status") || "all").toLowerCase() as
    | "live"
    | "upcoming"
    | "ended"
    | "all";
  const kind = (c.req.query("kind") || "all") as "match" | "tournament_channel" | "all";
  const tournament = c.req.query("tournament") || c.req.query("competition");
  const team = c.req.query("team");
  const provider = c.req.query("provider");
  const language = c.req.query("language") || c.req.query("lang");
  const drmParam = c.req.query("drm");
  const drm = drmParam === "true" || drmParam === "1" ? true : drmParam === "false" || drmParam === "0" ? false : undefined;
  const hotParam = c.req.query("hot");
  const hot = hotParam === "true" || hotParam === "1" ? true : hotParam === "false" || hotParam === "0" ? false : undefined;
  const q = c.req.query("q") || c.req.query("search");
  const sort = (c.req.query("sort") || "status") as "status" | "feeds" | "title" | "time";
  const page = Number(c.req.query("page") || "1") || 1;
  const limit = Number(c.req.query("limit") || "50") || 50;

  const result = await aggregatorService.queryMatches({
    sport,
    phase,
    kind,
    tournament,
    team,
    provider,
    language,
    drm,
    hot,
    q,
    sort,
    page,
    limit,
  });

  return c.json({
    success: true,
    version: API_VERSION,
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
    filters: {
      sport: sport || "all",
      phase,
      kind,
      tournament: tournament || null,
      team: team || null,
      provider: provider || "all",
      language: language || "all",
      drm: drm ?? null,
      hot: hot ?? null,
      q: q || null,
      sort,
    },
    matches: result.items,
    fixtures: result.items,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/matches/live
matchesResourceRoute.get("/live", async (c) => {
  const sport = c.req.query("sport");
  const tournament = c.req.query("tournament");
  const team = c.req.query("team");
  const provider = c.req.query("provider");
  const q = c.req.query("q") || c.req.query("search");
  const page = Number(c.req.query("page") || "1") || 1;
  const limit = Number(c.req.query("limit") || "50") || 50;

  const result = await aggregatorService.queryMatches({
    sport,
    phase: "live",
    tournament,
    team,
    provider,
    q,
    page,
    limit,
  });

  return c.json({
    success: true,
    version: API_VERSION,
    phase: "live",
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
    matches: result.items,
    fixtures: result.items,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/matches/upcoming
matchesResourceRoute.get("/upcoming", async (c) => {
  const sport = c.req.query("sport");
  const tournament = c.req.query("tournament");
  const team = c.req.query("team");
  const provider = c.req.query("provider");
  const q = c.req.query("q") || c.req.query("search");
  const page = Number(c.req.query("page") || "1") || 1;
  const limit = Number(c.req.query("limit") || "50") || 50;

  const result = await aggregatorService.queryMatches({
    sport,
    phase: "upcoming",
    tournament,
    team,
    provider,
    q,
    page,
    limit,
  });

  return c.json({
    success: true,
    version: API_VERSION,
    phase: "upcoming",
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
    matches: result.items,
    fixtures: result.items,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/matches/hot
matchesResourceRoute.get("/hot", async (c) => {
  const sport = c.req.query("sport");
  const limit = Number(c.req.query("limit") || "25") || 25;

  const items = await aggregatorService.getHotMatches({ sport, limit });

  return c.json({
    success: true,
    version: API_VERSION,
    total: items.length,
    matches: items,
    fixtures: items,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/matches/:matchId
matchesResourceRoute.get("/:matchId", async (c) => {
  const matchId = c.req.param("matchId");
  const urlObj = new URL(c.req.url);
  const proxyBaseUrl = `${urlObj.origin}/api/proxy`;

  const detail = await aggregatorService.getMatchDetail(matchId, proxyBaseUrl);
  if (!detail) {
    return c.json(
      {
        success: false,
        version: API_VERSION,
        error: {
          code: "MATCH_NOT_FOUND",
          message: `No match or fixture found matching identifier '${matchId}'`,
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    version: API_VERSION,
    match: detail.fixture,
    fixture: detail.fixture,
    totalFeeds: detail.feeds.length,
    feeds: detail.feeds,
    timestamp: new Date().toISOString(),
  });
});

export const tournamentsResourceRoute = new Hono();

// GET /api/tournaments (or /api/competitions)
tournamentsResourceRoute.get("/", async (c) => {
  const sport = c.req.query("sport");
  const q = c.req.query("q") || c.req.query("search");
  const activeOnly = c.req.query("active") === "true" || c.req.query("active") === "1";

  const tournaments = await aggregatorService.getTournaments({
    sport,
    q,
    activeOnly,
  });

  return c.json({
    success: true,
    version: API_VERSION,
    totalTournaments: tournaments.length,
    tournaments,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/tournaments/:tournamentId
tournamentsResourceRoute.get("/:tournamentId", async (c) => {
  const tournamentId = c.req.param("tournamentId");
  const detail = await aggregatorService.getTournamentDetail(tournamentId);

  if (!detail) {
    return c.json(
      {
        success: false,
        version: API_VERSION,
        error: {
          code: "TOURNAMENT_NOT_FOUND",
          message: `No tournament or competition found matching '${tournamentId}'`,
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    version: API_VERSION,
    tournament: detail,
    timestamp: new Date().toISOString(),
  });
});

export const teamsResourceRoute = new Hono();

// GET /api/teams
teamsResourceRoute.get("/", async (c) => {
  const sport = c.req.query("sport");
  const gender = c.req.query("gender");
  const league = c.req.query("league") || c.req.query("tournament");
  const q = c.req.query("q") || c.req.query("search");
  const activeOnly = c.req.query("active") === "true" || c.req.query("active") === "1";
  const limit = Number(c.req.query("limit") || "150") || 150;

  const teams = await aggregatorService.getTeams({
    sport,
    gender,
    league,
    q,
    activeOnly,
    limit,
  });

  return c.json({
    success: true,
    version: API_VERSION,
    totalTeams: teams.length,
    teams,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/teams/:teamCode
teamsResourceRoute.get("/:teamCode", async (c) => {
  const teamCode = c.req.param("teamCode");
  const detail = await aggregatorService.getTeamDetail(teamCode);

  if (!detail) {
    return c.json(
      {
        success: false,
        version: API_VERSION,
        error: {
          code: "TEAM_NOT_FOUND",
          message: `No team found matching code or alias '${teamCode}'`,
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    version: API_VERSION,
    team: detail,
    timestamp: new Date().toISOString(),
  });
});

export const channelsResourceRoute = new Hono();

// GET /api/channels
channelsResourceRoute.get("/", async (c) => {
  const category = c.req.query("category");
  const provider = c.req.query("provider")?.toLowerCase().trim();
  const q = c.req.query("q") || c.req.query("search");
  const page = Math.max(1, Number(c.req.query("page") || "1") || 1);
  const limit = Math.min(250, Math.max(1, Number(c.req.query("limit") || "100") || 100));

  let channels = await aggregatorService.getChannels(category);

  if (provider) {
    channels = channels.filter(
      (ch) =>
        ch.sources.some((s) => s.provider.toLowerCase() === provider) ||
        ch.id.toLowerCase().startsWith(`${provider}_`)
    );
  }

  if (q) {
    const lower = q.toLowerCase().trim();
    channels = channels.filter(
      (ch) =>
        ch.name.toLowerCase().includes(lower) ||
        ch.category.toLowerCase().includes(lower) ||
        (ch.group && ch.group.toLowerCase().includes(lower))
    );
  }

  const total = channels.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const items = channels.slice((page - 1) * limit, page * limit);

  return c.json({
    success: true,
    version: API_VERSION,
    total,
    page,
    limit,
    totalPages,
    channels: items,
    data: items,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/channels/categories
channelsResourceRoute.get("/categories", async (c) => {
  const categories = await aggregatorService.getChannelCategories();

  return c.json({
    success: true,
    version: API_VERSION,
    totalCategories: categories.length,
    categories,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/channels/:channelId
channelsResourceRoute.get("/:channelId", async (c) => {
  const channelId = c.req.param("channelId");
  const urlObj = new URL(c.req.url);
  const proxyBaseUrl = `${urlObj.origin}/api/proxy`;

  const detail = await aggregatorService.getChannelDetail(channelId, proxyBaseUrl);
  if (!detail) {
    return c.json(
      {
        success: false,
        version: API_VERSION,
        error: {
          code: "CHANNEL_NOT_FOUND",
          message: `No channel found with ID '${channelId}'`,
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    version: API_VERSION,
    channel: detail,
    timestamp: new Date().toISOString(),
  });
});

export const broadcastersResourceRoute = new Hono();

// GET /api/broadcasters
broadcastersResourceRoute.get("/", async (c) => {
  const broadcasters = await aggregatorService.getBroadcasters();

  return c.json({
    success: true,
    version: API_VERSION,
    totalBroadcasters: broadcasters.length,
    broadcasters,
    timestamp: new Date().toISOString(),
  });
});

export const providersResourceRoute = new Hono();

// GET /api/providers
providersResourceRoute.get("/", async (c) => {
  const providers = await aggregatorService.getProvidersEnriched();

  return c.json({
    success: true,
    version: API_VERSION,
    totalProviders: providers.length,
    providers,
    data: providers,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/providers/:providerId
providersResourceRoute.get("/:providerId", async (c) => {
  const providerId = c.req.param("providerId");
  const detail = await aggregatorService.getProviderDetail(providerId);

  if (!detail) {
    return c.json(
      {
        success: false,
        version: API_VERSION,
        error: {
          code: "PROVIDER_NOT_FOUND",
          message: `Unknown CS3 provider '${providerId}'. Valid providers: cricify, sportzx, playztv, playfy, sktech, livxow`,
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    version: API_VERSION,
    provider: detail,
    timestamp: new Date().toISOString(),
  });
});

export const searchResourceRoute = new Hono();

// GET /api/search?q=...
searchResourceRoute.get("/", async (c) => {
  const q = c.req.query("q") || c.req.query("query") || "";
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || "20") || 20));
  const results = await aggregatorService.searchAll(q, limit);

  return c.json({
    success: true,
    version: API_VERSION,
    ...results,
    timestamp: new Date().toISOString(),
  });
});

export const statsResourceRoute = new Hono();

// GET /api/stats
statsResourceRoute.get("/", async (c) => {
  const stats = await aggregatorService.getPlatformStats();

  return c.json({
    success: true,
    version: API_VERSION,
    ...stats,
  });
});

export const scheduleResourceRoute = new Hono();

// GET /api/schedule (or /api/epg)
scheduleResourceRoute.get("/", async (c) => {
  const sport = c.req.query("sport");
  const date = c.req.query("date");
  const format = (c.req.query("format") || "json").toLowerCase();

  if (format === "xml" || format === "xmltv") {
    const xml = await aggregatorService.generateXmltvEpg({ sport });
    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      },
    });
  }

  const schedule = await aggregatorService.getSchedule({ sport, date });

  return c.json({
    success: true,
    version: API_VERSION,
    ...schedule,
  });
});
