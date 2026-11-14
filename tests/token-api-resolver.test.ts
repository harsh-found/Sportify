import { describe, expect, it } from "bun:test";
import { TokenApiResolver } from "../src/parsers/token-api.resolver";

describe("TokenApiResolver", () => {
  it("resolves embed type directly if URL is already a stream", async () => {
    const config = JSON.stringify({
      type: "embed",
      url: "https://stream.server.com/live/master.m3u8",
    });
    const result = await TokenApiResolver.resolve(config);
    expect(result).toBe("https://stream.server.com/live/master.m3u8");
  });

  it("extracts stream from embed HTML page via playbackURL or regex", async () => {
    const fakeHtml = `
      <html>
        <script>
          const playbackURL = "https://edge.stream.net/live/ch1.mpd";
        </script>
      </html>
    `;
    const mockFetch = async () => new Response(fakeHtml, { status: 200 });

    const config = JSON.stringify({
      type: "embed",
      url: "https://embed.player.com/watch?v=123",
    });
    const result = await TokenApiResolver.resolve(config, mockFetch as any);
    expect(result).toBe("https://edge.stream.net/live/ch1.mpd");
  });

  it("resolves json type using link_key and dot notation", async () => {
    const fakeJson = {
      status: "success",
      data: {
        stream_link: "https://cdn.sport.com/stream/index.m3u8",
      },
    };
    const mockFetch = async () => new Response(JSON.stringify(fakeJson), { status: 200 });

    const config = JSON.stringify({
      type: "json",
      api: "https://api.sport.com/get-stream",
      link_key: "data.stream_link",
    });
    const result = await TokenApiResolver.resolve(config, mockFetch as any);
    expect(result).toBe("https://cdn.sport.com/stream/index.m3u8");
  });

  it("resolves html type by extracting .m3u8 or .mpd regex", async () => {
    const fakeHtml = `
      <div id="player">
        <video src="https://hls.live.com/hls/master.m3u8"></video>
      </div>
    `;
    const mockFetch = async () => new Response(fakeHtml, { status: 200 });

    const config = JSON.stringify({
      type: "html",
      api: "https://portal.live.com/stream-view",
    });
    const result = await TokenApiResolver.resolve(config, mockFetch as any);
    expect(result).toBe("https://hls.live.com/hls/master.m3u8");
  });

  it("resolves location service (ls) type with base64 encoded ip_api", async () => {
    // "https://ip.test.com/locate" in base64 is "aHR0cHM6Ly9pcC50ZXN0LmNvbS9sb2NhdGU="
    const fakeGeoJson = {
      server: "ap-south-1",
      streamUrl: "https://regional.stream.in/live/ind_aus.mpd",
    };
    const mockFetch = async () => new Response(JSON.stringify(fakeGeoJson), { status: 200 });

    const config = JSON.stringify({
      type: "ls",
      ip_api: "aHR0cHM6Ly9pcC50ZXN0LmNvbS9sb2NhdGU=",
      link_key: "streamUrl",
    });
    const result = await TokenApiResolver.resolve(config, mockFetch as any);
    expect(result).toBe("https://regional.stream.in/live/ind_aus.mpd");
  });

  it("resolves yt type directly", async () => {
    const config = JSON.stringify({
      type: "yt",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    const result = await TokenApiResolver.resolve(config);
    expect(result).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("gracefully returns null for invalid or empty tokenApi", async () => {
    expect(await TokenApiResolver.resolve(null)).toBeNull();
    expect(await TokenApiResolver.resolve("")).toBeNull();
    expect(await TokenApiResolver.resolve("{invalid_json")).toBeNull();
  });
});
