import { describe, expect, test } from "bun:test";
import app from "../src/index";

describe("Edge Proxy Multi-Mirror Failover & Segment Micro-Caching", () => {
  test("fails over to backup URL when primary upstream returns 404 or 403", async () => {
    let primaryHit = false;
    let fallbackHit = false;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/primary.m3u8")) {
          primaryHit = true;
          return new Response("Forbidden by CDN", { status: 403 });
        }
        if (req.url.includes("/fallback.m3u8")) {
          fallbackHit = true;
          return new Response("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nchunk1.ts\n", {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const primaryUrl = `http://localhost:${server.port}/primary.m3u8`;
    const fallbackUrl = `http://localhost:${server.port}/fallback.m3u8`;

    const res = await app.request(
      `/api/proxy?url=${encodeURIComponent(primaryUrl)}&fallback=${encodeURIComponent(fallbackUrl)}`
    );

    expect(primaryHit).toBe(true);
    expect(fallbackHit).toBe(true);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("#EXTM3U");

    server.stop();
  });

  test("micro-caches binary video segments for low-latency playback", async () => {
    let upstreamFetches = 0;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/video_001.ts")) {
          upstreamFetches++;
          const dummyChunk = new Uint8Array([0x47, 0x40, 0x00, 0x10, 0x00]); // TS sync byte
          return new Response(dummyChunk, {
            status: 200,
            headers: { "Content-Type": "video/mp2t", "Content-Length": "5" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const segmentUrl = `http://localhost:${server.port}/video_001.ts`;

    // 1st request -> Cache MISS
    const res1 = await app.request(`/api/proxy?url=${encodeURIComponent(segmentUrl)}`);
    expect(res1.status).toBe(200);
    expect(res1.headers.get("X-Cache")).toBe("MISS");
    expect(upstreamFetches).toBe(1);

    // 2nd request -> Cache HIT (upstreamFetches remains 1)
    const res2 = await app.request(`/api/proxy?url=${encodeURIComponent(segmentUrl)}`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-Cache")).toBe("HIT");
    expect(upstreamFetches).toBe(1);

    server.stop();
  });

  test("dynamically filters DASH MPD representations by quality parameter and injects BaseURL", async () => {
    const sampleMpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.5S">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" />
      <Representation id="rep_1080p" width="1920" height="1080" bandwidth="8000000">
        <SegmentTemplate media="video_1080p_$Number$.m4s" />
      </Representation>
      <Representation id="rep_720p" width="1280" height="720" bandwidth="4000000">
        <SegmentTemplate media="video_720p_$Number$.m4s" />
      </Representation>
      <Representation id="rep_480p" width="854" height="480" bandwidth="1500000">
        <SegmentTemplate media="video_480p_$Number$.m4s" />
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="audio_eng" bandwidth="128000" />
    </AdaptationSet>
  </Period>
</MPD>`;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/manifest.mpd")) {
          return new Response(sampleMpd, {
            status: 200,
            headers: { "Content-Type": "application/dash+xml" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const mpdUrl = `http://localhost:${server.port}/dash/manifest.mpd`;

    // 1. Request 720p quality
    const res720 = await app.request(`/api/proxy?url=${encodeURIComponent(mpdUrl)}&quality=720p`);
    expect(res720.status).toBe(200);
    expect(res720.headers.get("Content-Type")).toBe("application/dash+xml");
    const xml720 = await res720.text();
    expect(xml720).toContain('height="720"');
    expect(xml720).not.toContain('height="1080"');
    expect(xml720).not.toContain('height="480"');
    expect(xml720).toContain("<BaseURL>http://localhost:");
    expect(xml720).toContain("audio_eng"); // audio preserved
    expect(xml720).toContain("ContentProtection"); // DRM preserved

    // 2. Request 1080p quality
    const res1080 = await app.request(`/api/proxy?url=${encodeURIComponent(mpdUrl)}&quality=1080p`);
    expect(res1080.status).toBe(200);
    const xml1080 = await res1080.text();
    expect(xml1080).toContain('height="1080"');
    expect(xml1080).not.toContain('height="720"');
    expect(xml1080).not.toContain('height="480"');

    // 3. Request auto (unfiltered, all representations present)
    const resAuto = await app.request(`/api/proxy?url=${encodeURIComponent(mpdUrl)}&quality=auto`);
    expect(resAuto.status).toBe(200);
    const xmlAuto = await resAuto.text();
    expect(xmlAuto).toContain('height="1080"');
    expect(xmlAuto).toContain('height="720"');
    expect(xmlAuto).toContain('height="480"');

    server.stop();
  });

  test("dynamically filters HLS master playlist variants by quality parameter", async () => {
    const masterM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
1080p/index.m3u8`;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/master.m3u8")) {
          return new Response(masterM3u8, {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const m3u8Url = `http://localhost:${server.port}/hls/master.m3u8`;

    const res720 = await app.request(`/api/proxy?url=${encodeURIComponent(m3u8Url)}&quality=720p`);
    expect(res720.status).toBe(200);
    const body720 = await res720.text();
    expect(body720).toContain("RESOLUTION=1280x720");
    expect(body720).not.toContain("RESOLUTION=1920x1080");
    expect(body720).not.toContain("RESOLUTION=640x360");
    expect(body720).toContain("/api/proxy?url=");

    server.stop();
  });

  test("rewrites EXT-X-MEDIA audio tracks in HLS master playlist through proxy", async () => {
    const masterWithAudio = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi",DEFAULT=YES,URI="audio/hin.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=NO,URI="audio/eng.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="audio"
1080p/index.m3u8`;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/audio_master.m3u8")) {
          return new Response(masterWithAudio, {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const url = `http://localhost:${server.port}/live/audio_master.m3u8`;
    const res = await app.request(`/api/proxy?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi",DEFAULT=YES,URI=');
    expect(body).toContain('/api/proxy?url=');
    expect(body).toContain(encodeURIComponent(`http://localhost:${server.port}/live/audio/hin.m3u8`));


    server.stop();
  });

  test("extracts pipe headers and propagates custom referer, origin, and user-agent to child lines", async () => {
    let capturedHeaders: Headers | null = null;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/pipe_master.m3u8")) {
          capturedHeaders = req.headers;
          return new Response(
            `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\n720p.m3u8\n`,
            {
              status: 200,
              headers: { "Content-Type": "application/vnd.apple.mpegurl" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const pipeUrl = `http://localhost:${server.port}/pipe_master.m3u8|Referer=https://secure.fancode.com&User-Agent=CustomPlayer/1.0&Origin=https://fancode.com`;
    const res = await app.request(`/api/proxy?url=${encodeURIComponent(pipeUrl)}`);
    expect(res.status).toBe(200);

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("referer")).toBe("https://secure.fancode.com");
    expect(capturedHeaders!.get("user-agent")).toBe("CustomPlayer/1.0");
    expect(capturedHeaders!.get("origin")).toBe("https://fancode.com");

    const body = await res.text();
    expect(body).toContain("/api/proxy?url=");
    expect(body).toContain("referer=https%3A%2F%2Fsecure.fancode.com");
    expect(body).toContain("origin=https%3A%2F%2Ffancode.com");
    expect(body).toContain("ua=CustomPlayer%2F1.0");

    server.stop();
  });

  test("normalizes %2F in path and propagates Cookie header via pipe parameters", async () => {
    let capturedReqUrl = "";
    let capturedCookie = "";

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.includes("/live/stream.m3u8")) {
          capturedReqUrl = req.url;
          capturedCookie = req.headers.get("cookie") || "";
          return new Response(
            `#EXTM3U\n#EXT-X-VERSION:3\nchunk1.ts\n`,
            {
              status: 200,
              headers: { "Content-Type": "application/vnd.apple.mpegurl" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });

    // %2F in path + pipe headers with | delimiter and Cookie
    const pipeUrl = `http://localhost:${server.port}/live%2Fstream.m3u8|User-Agent=CustomUA|Cookie=session_id=abc999`;
    const res = await app.request(`/api/proxy?url=${encodeURIComponent(pipeUrl)}`);
    expect(res.status).toBe(200);

    expect(capturedReqUrl).toContain("/live/stream.m3u8");
    expect(capturedCookie).toBe("session_id=abc999");

    const body = await res.text();
    expect(body).toContain("cookie=session_id%3Dabc999");

    server.stop();
  });

  test("supports HEAD method on /api/proxy with 200 status and empty body", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/manifest.m3u8")) {
          return new Response("#EXTM3U\n#EXT-X-VERSION:3\nchunk.ts\n", {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Content-Length": "34",
            },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const streamUrl = `http://localhost:${server.port}/manifest.m3u8`;
    const res = await app.request(`/api/proxy?url=${encodeURIComponent(streamUrl)}`, {
      method: "HEAD",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.apple.mpegurl");
    expect(res.headers.get("Content-Length")).toBeDefined();
    const text = await res.text();
    expect(text).toBe("");

    server.stop();
  });

  test("propagates Cookie header through filterM3u8ByQuality when quality filter is active", async () => {
    const masterWithVariants = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1280x720
720p/index.m3u8
`;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/master.m3u8")) {
          return new Response(masterWithVariants, {
            status: 200,
            headers: { "Content-Type": "application/vnd.apple.mpegurl" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const pipeUrl = `http://localhost:${server.port}/master.m3u8|Cookie=auth_token=supersecret123`;
    const res = await app.request(`/api/proxy?url=${encodeURIComponent(pipeUrl)}&quality=720p`);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain("RESOLUTION=1280x720");
    expect(body).not.toContain("RESOLUTION=1920x1080");
    expect(body).toContain("cookie=auth_token%3Dsupersecret123");

    server.stop();
  });
});


