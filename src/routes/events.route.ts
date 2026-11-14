import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const eventsRoute = new Hono();

eventsRoute.get("/", async (c) => {
  const category = c.req.query("category");
  const events = await aggregatorService.getEvents(category);

  return c.json({
    success: true,
    count: events.length,
    data: events,
  });
});
