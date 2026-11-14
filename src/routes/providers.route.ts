import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const providersRoute = new Hono();

providersRoute.get("/", (c) => {
  const providers = aggregatorService.getProviders();
  return c.json({
    success: true,
    count: providers.length,
    data: providers,
  });
});
