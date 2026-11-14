import { Hono } from "hono";
import { aggregatorService } from "../services/aggregator.service";

export const playlistRoute = new Hono();

// GET /api/playlist.m3u or GET /api/playlist.m3u8
playlistRoute.get("/", async (c) => {
  const sport = c.req.query("sport");
  const urlObj = new URL(c.req.url);
  const proxyBaseUrl = `${urlObj.origin}/api/proxy`;

  const m3uContent = await aggregatorService.generateM3uPlaylist(proxyBaseUrl, { sport });

  return new Response(m3uContent, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Content-Disposition": 'inline; filename="sportify.m3u"',
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
});
