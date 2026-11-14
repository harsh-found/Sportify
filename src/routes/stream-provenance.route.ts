import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const streamProvenanceRoute = new Hono();

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
        error: `No live feeds found for fixture '${fixtureKey}'`,
      },
      404
    );
  }

  return c.json({
    success: true,
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
