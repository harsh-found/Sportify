import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const sportsRoute = new Hono();

// GET /api/sports
sportsRoute.get("/", async (c) => {
  const sports = await aggregatorService.getSports();

  return c.json({
    success: true,
    version: "1.4.0",
    totalSports: sports.length,
    sports,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/sports/:sport
sportsRoute.get("/:sport", async (c) => {
  const sport = c.req.param("sport");
  const detail = await aggregatorService.getSportDetail(sport);

  return c.json({
    success: true,
    version: "1.4.0",
    ...detail,
    timestamp: new Date().toISOString(),
  });
});
