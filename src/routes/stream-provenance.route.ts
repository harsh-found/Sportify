import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const streamProvenanceRoute = new Hono();

// GET /api/streams/inspect?url=...&referer=...&userAgent=...
streamProvenanceRoute.get("/inspect", async (c) => {
  const targetUrl = c.req.query("url");
  if (!targetUrl || !targetUrl.trim()) {
    return c.json(
      {
        success: false,
        version: "1.4.0",
        error: {
          code: "MISSING_STREAM_URL",
          message: "Query parameter 'url' is required (e.g., /api/streams/inspect?url=https://example.com/master.m3u8)",
        },
      },
      400
    );
  }

  const headers: Record<string, string> = {};
  const referer = c.req.query("referer");
  const origin = c.req.query("origin");
  const userAgent = c.req.query("userAgent") || c.req.query("ua");
  if (referer) headers["Referer"] = referer;
  if (origin) headers["Origin"] = origin;
  if (userAgent) headers["User-Agent"] = userAgent;

  try {
    const inspection = await aggregatorService.inspectStream(targetUrl.trim(), headers);

    return c.json({
      success: true,
      version: "1.4.0",
      inspection,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        version: "1.4.0",
        error: {
          code: "UNSAFE_UPSTREAM_URL",
          message: err?.message || "Invalid or blocked upstream URL",
        },
      },
      400
    );
  }
});

// GET /api/stream/:fixtureKey?probe=true&protocol=dash|hls&quality=1080p&language=hin&provider=cricify
streamProvenanceRoute.get("/:fixtureKey", async (c) => {
  const fixtureKey = decodeURIComponent(c.req.param("fixtureKey"));
  const shouldProbe = c.req.query("probe") === "true" || c.req.query("probe") === "1";
  const protocol = c.req.query("protocol") as any;
  const quality = c.req.query("quality");
  const language = c.req.query("language") || c.req.query("lang");
  const provider = c.req.query("provider");

  const urlObj = new URL(c.req.url);
  const proxyBaseUrl = `${urlObj.origin}/api/proxy`;

  const { fixture, feeds } = await aggregatorService.getFixtureFeeds(fixtureKey, proxyBaseUrl, {
    shouldProbe,
    protocol,
    quality,
    language,
    provider,
  });

  if (feeds.length === 0 && !fixture) {
    return c.json(
      {
        success: false,
        version: "1.4.0",
        error: `No live feeds found for fixture '${fixtureKey}'`,
      },
      404
    );
  }

  return c.json({
    success: true,
    version: "1.4.0",
    fixtureKey,
    fixtureTitle: fixture?.title || fixtureKey,
    kind: fixture?.kind || "match",
    totalFeeds: feeds.length,
    filters: {
      probe: shouldProbe,
      protocol: protocol || "all",
      quality: quality || "all",
      language: language || "all",
      provider: provider || "all",
    },
    feeds,
  });
});
