import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const channelsRoute = new Hono();

channelsRoute.get("/", async (c) => {
  const category = c.req.query("category");
  const channels = await aggregatorService.getChannels(category);

  return c.json({
    success: true,
    count: channels.length,
    data: channels,
  });
});
