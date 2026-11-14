import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const catalogRoute = new Hono();

// GET /api/catalog?sport=cricket&phase=live|upcoming|ended|all&search=...&provider=...&limit=50&offset=0
catalogRoute.get("/", async (c) => {
  const sport = c.req.query("sport");
  const phase = (c.req.query("phase") as "live" | "upcoming" | "ended" | "all") || "all";
  const search = c.req.query("search") || c.req.query("q");
  const provider = c.req.query("provider");
  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  const offset = offsetRaw ? Math.max(0, parseInt(offsetRaw, 10) || 0) : 0;

  let fixtures = await aggregatorService.getUnifiedCatalog({
    sport,
    phase,
    search,
    provider,
  });

  if (offset > 0) {
    fixtures = fixtures.slice(offset);
  }
  if (limit && limit > 0) {
    fixtures = fixtures.slice(0, limit);
  }

  return c.json({
    success: true,
    totalFixtures: fixtures.length,
    filters: {
      sport: sport || "all",
      phase,
      search: search || null,
      provider: provider || "all",
      limit: limit || null,
      offset,
    },
    fixtures,
  });
});

// GET /api/catalog/:sport
catalogRoute.get("/:sport", async (c) => {
  const sport = c.req.param("sport");
  const phase = (c.req.query("phase") as "live" | "upcoming" | "ended" | "all") || "all";
  const search = c.req.query("search") || c.req.query("q");
  const provider = c.req.query("provider");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  const fixtures = await aggregatorService.getUnifiedCatalog({
    sport,
    phase,
    search,
    provider,
    limit,
  });

  return c.json({
    success: true,
    sport: sport.toLowerCase(),
    totalFixtures: fixtures.length,
    fixtures,
  });
});
