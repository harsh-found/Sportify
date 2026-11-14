import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const streamRoute = new Hono();

streamRoute.get("/:id", async (c) => {
  const id = c.req.param("id");
  const stream = await aggregatorService.resolveStream(id);

  if (!stream) {
    return c.json({ success: false, error: "Stream not found" }, 404);
  }

  return c.json({
    success: true,
    data: stream,
  });
});
