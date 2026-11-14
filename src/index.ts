import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import path from "node:path";
import { eventsRoute } from "./routes/events.route";
import { channelsRoute } from "./routes/channels.route";
import { streamRoute } from "./routes/stream.route";
import { providersRoute } from "./routes/providers.route";
import { catalogRoute } from "./routes/catalog.route";
import { sportsRoute } from "./routes/sports.route";
import { streamProvenanceRoute } from "./routes/stream-provenance.route";
import { proxyRoute } from "./routes/proxy.route";
import { playlistRoute } from "./routes/playlist.route";
import { liveSseRoute } from "./routes/live-sse.route";
import { docsRoute } from "./routes/docs.route";
import {
  matchesResourceRoute,
  tournamentsResourceRoute,
  teamsResourceRoute,
  channelsResourceRoute,
  broadcastersResourceRoute,
  providersResourceRoute,
  searchResourceRoute,
  statsResourceRoute,
} from "./routes/v1-resources.route";
import { aggregatorService } from "./services/aggregator.service";

const app = new Hono();

// Enable CORS for all clients (Web players, mobile apps)
app.use("*", cors());

// High-performance payload compression (Gzip/Deflate) excluding real-time SSE stream
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/live")) return next();
  return compress()(c, next);
});

// High-precision Edge telemetry & request tracing middleware
app.use("*", async (c, next) => {
  const start = performance.now();
  const requestId = crypto.randomUUID();
  c.header("X-Request-Id", requestId);
  c.header("X-API-Version", "1.0.0");
  await next();
  const elapsed = performance.now() - start;
  c.header("X-Response-Time", `${elapsed.toFixed(2)}ms`);
  c.header("Server-Timing", `edge;dur=${elapsed.toFixed(2)}`);
});

function getPublicFile(relativePath: string) {
  const metaPath = path.resolve(import.meta.dir, "../public", relativePath);
  const cwdPath = path.resolve(process.cwd(), "public", relativePath);
  const subPath = path.resolve(process.cwd(), "public", relativePath);

  const metaFile = Bun.file(metaPath);
  if (metaFile.size > 0) return metaFile;
  const cwdFile = Bun.file(cwdPath);
  if (cwdFile.size > 0) return cwdFile;
  return Bun.file(subPath);
}

// Serve Landing & Interactive Playground UI
app.get("/", async (c) => {
  const indexFile = getPublicFile("index.html");
  if (await indexFile.exists()) {
    const html = await indexFile.text();
    return c.html(html);
  }
  return c.json({
    service: "Sportify Live Sports Gateway",
    version: "1.0.0",
    architecture: "Edge-Federated Multi-Provider Engine",
    status: "healthy",
    providersIntegrated: 6,
    endpoints: {
      sportsPortal: "/portal",
      apiDocs: "/docs",
      openApiSchema: "/api/openapi.json",
      unifiedCatalog: "/api/catalog",
      catalogBySport: "/api/catalog/:sport",
      sportsExplore: "/api/sports",
      sportDetail: "/api/sports/:sport",
      matches: "/api/matches",
      liveMatches: "/api/matches/live",
      upcomingMatches: "/api/matches/upcoming",
      matchDetail: "/api/matches/:matchId",
      tournaments: "/api/tournaments",
      tournamentDetail: "/api/tournaments/:tournamentId",
      teams: "/api/teams",
      teamDetail: "/api/teams/:teamCode",
      channels: "/api/channels",
      channelDetail: "/api/channels/:channelId",
      broadcasters: "/api/broadcasters",
      providers: "/api/providers",
      providerDetail: "/api/providers/:providerId",
      unifiedStream: "/api/stream/:fixtureKey",
      search: "/api/search?q=<query>",
      stats: "/api/stats",
      streamProxy: "/api/proxy?url=<target_m3u8_url>",
      iptvPlaylist: "/api/playlist.m3u",
      liveSse: "/api/live/sse",
      health: "/health",
    },
  });
});

// Serve Dedicated Sports Portal UI
app.get("/portal", async (c) => {
  const portalFile = getPublicFile("portal.html");
  if (await portalFile.exists()) {
    const html = await portalFile.text();
    return c.html(html);
  }
  return c.text("Portal not found", 404);
});

app.get("/app", (c) => c.redirect("/portal"));

// Serve public logos
app.get("/logos/:file", async (c) => {
  const filename = c.req.param("file");
  const file = getPublicFile(`logos/${filename}`);
  if (await file.exists()) {
    return new Response(file);
  }
  return c.text("Logo not found", 404);
});

// Comprehensive Edge Health & Telemetry status
app.get("/health", (c) => {
  return c.json({
    service: "Sportify Live Sports Gateway",
    version: "1.0.0",
    architecture: "Edge-Federated Multi-Provider Engine",
    status: "healthy",
    providersIntegrated: 6,
    providers: aggregatorService.getProviders(),
    caches: aggregatorService.getCacheStats(),
    memory: process.memoryUsage(),
    endpoints: {
      unifiedCatalog: "/api/catalog",
      catalogBySport: "/api/catalog/:sport",
      sportsExplore: "/api/sports",
      sportDetail: "/api/sports/:sport",
      matches: "/api/matches",
      liveMatches: "/api/matches/live",
      upcomingMatches: "/api/matches/upcoming",
      matchDetail: "/api/matches/:matchId",
      tournaments: "/api/tournaments",
      tournamentDetail: "/api/tournaments/:tournamentId",
      teams: "/api/teams",
      teamDetail: "/api/teams/:teamCode",
      channels: "/api/channels",
      channelDetail: "/api/channels/:channelId",
      broadcasters: "/api/broadcasters",
      providers: "/api/providers",
      providerDetail: "/api/providers/:providerId",
      unifiedStream: "/api/stream/:fixtureKey",
      search: "/api/search",
      stats: "/api/stats",
      streamProxy: "/api/proxy?url=<target_m3u8_url>",
      iptvPlaylist: "/api/playlist.m3u",
      liveSse: "/api/live/sse",
      apiDocs: "/docs",
      openApiSchema: "/api/openapi.json",
      health: "/health",
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Interactive API Documentation & OpenAPI Specification
app.route("/", docsRoute);

// Real-Time Server-Sent Events (SSE) Live Feed
app.route("/api/live", liveSseRoute);

// Sportify v1.0.0 Resource-Oriented Endpoints
app.route("/api/catalog", catalogRoute);
app.route("/api/sports", sportsRoute);
app.route("/api/matches", matchesResourceRoute);
app.route("/api/events", matchesResourceRoute);
app.route("/api/tournaments", tournamentsResourceRoute);
app.route("/api/competitions", tournamentsResourceRoute);
app.route("/api/teams", teamsResourceRoute);
app.route("/api/channels", channelsResourceRoute);
app.route("/api/broadcasters", broadcastersResourceRoute);
app.route("/api/providers", providersResourceRoute);
app.route("/api/stream", streamProvenanceRoute);
app.route("/api/streams", streamProvenanceRoute);
app.route("/api/search", searchResourceRoute);
app.route("/api/stats", statsResourceRoute);
app.route("/api/proxy", proxyRoute);
app.route("/api/playlist.m3u", playlistRoute);
app.route("/api/playlist.m3u8", playlistRoute);
app.route("/playlist.m3u", playlistRoute);

// Backwards-compatible v1 legacy routes
app.route("/api/v1/events", eventsRoute);
app.route("/api/v1/channels", channelsRoute);
app.route("/api/v1/stream", streamRoute);
app.route("/api/v1/providers", providersRoute);

export default app;
