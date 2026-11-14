import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const liveSseRoute = new Hono();

// GET /api/live/sse or GET /api/events/live-sse
liveSseRoute.get("/sse", async (c) => {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (event: string, data: any) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {}
      };

      // 1. Send immediate snapshot of all LIVE fixtures
      try {
        const liveFixtures = await aggregatorService.getUnifiedCatalog({ phase: "live" });
        sendEvent("snapshot", {
          status: "connected",
          timestamp: new Date().toISOString(),
          totalLive: liveFixtures.length,
          fixtures: liveFixtures.map((f) => ({
            canonicalKey: f.canonicalKey,
            title: f.title,
            sport: f.sport,
            tournament: f.tournament?.name || null,
            totalWorkingFeeds: f.streamMetadata.totalWorkingFeeds,
            maxResolution: f.streamMetadata.maxResolution,
            languages: f.streamMetadata.availableLanguages,
            broadcasters: f.streamMetadata.primaryBroadcasters,
          })),
        });
      } catch (err: any) {
        sendEvent("error", { message: err?.message || "Failed to load live snapshot" });
      }

      // 2. Heartbeat & live ticker interval every 15s
      const interval = setInterval(async () => {
        try {
          const live = await aggregatorService.getUnifiedCatalog({ phase: "live" });
          sendEvent("heartbeat", {
            timestamp: new Date().toISOString(),
            totalLive: live.length,
            liveKeys: live.map((f) => f.canonicalKey),
          });
        } catch {}
      }, 15000);

      // Clean up on client disconnect
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
