export interface TokenApiConfig {
  url?: string;
  api?: string;
  type?: string;
  link_key?: string;
  default_string?: string;
  request_type?: string;
  request_body_type?: string;
  ip_api?: string;
}

export class TokenApiResolver {
  private static readonly DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  /**
   * Resolves a tokenApi configuration (JSON string or object) into a playable stream URL.
   */
  static async resolve(
    input: string | TokenApiConfig | null | undefined,
    fetchFn: typeof fetch = fetch
  ): Promise<string | null> {
    if (!input) return null;

    let config: TokenApiConfig;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return null;
      try {
        config = JSON.parse(trimmed);
      } catch {
        // If not valid JSON, but starts with http, return directly
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          return trimmed;
        }
        return null;
      }
    } else {
      config = input;
    }

    const type = (config.type || "").toLowerCase().trim();

    try {
      switch (type) {
        case "embed":
          return await this.handleEmbedExtraction(config, fetchFn);
        case "json":
        case "sp":
          return await this.handleJsonExtraction(config, fetchFn);
        case "html":
          return await this.handleHtmlExtraction(config, fetchFn);
        case "yt":
          return await this.handleYoutubeExtraction(config);
        case "ls":
          return await this.handleLocationServiceExtraction(config, fetchFn);
        default:
          return await this.handleDirectApiCall(config, fetchFn);
      }
    } catch {
      return null;
    }
  }

  private static async safeFetch(
    fetchFn: typeof fetch,
    url: string,
    init: RequestInit = {}
  ): Promise<Response> {
    if (fetchFn === fetch && !init.signal) {
      return fetchFn(url, { ...init, signal: AbortSignal.timeout(3500) });
    }
    return fetchFn(url, init);
  }

  private static async handleEmbedExtraction(
    config: TokenApiConfig,
    fetchFn: typeof fetch
  ): Promise<string | null> {
    const embedUrl = (config.url || "").trim() || (config.api || "").trim();
    if (!embedUrl) return null;

    // If embedUrl already looks like a stream, return directly
    if (/\.(m3u8|mpd|mp4|ts|mkv|webm)(\?|$)/i.test(embedUrl)) {
      return embedUrl;
    }

    // Attempt to fetch embed page and extract stream URL from HTML
    try {
      const res = await this.safeFetch(fetchFn, embedUrl, {
        headers: { "User-Agent": this.DEFAULT_UA },
      });
      if (!res.ok) return null;
      const html = await res.text();
      return this.extractUrlFromHtml(html);
    } catch {
      return null;
    }
  }

  private static async handleJsonExtraction(
    config: TokenApiConfig,
    fetchFn: typeof fetch
  ): Promise<string | null> {
    const apiUrl = (config.api || "").trim() || (config.url || "").trim();
    if (!apiUrl) return null;

    const res = await this.safeFetch(fetchFn, apiUrl, {
      headers: {
        "User-Agent": this.DEFAULT_UA,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const bodyText = await res.text();
    let json: any;
    try {
      json = JSON.parse(bodyText);
    } catch {
      if (bodyText.startsWith("http://") || bodyText.startsWith("https://")) {
        return bodyText.trim();
      }
      return null;
    }

    if (config.link_key && typeof json === "object" && json !== null) {
      // Support dot notation like "data.stream" or "stream_url"
      const keys = config.link_key.split(".");
      let val: any = json;
      for (const k of keys) {
        if (val && typeof val === "object" && k in val) {
          val = val[k];
        } else {
          val = undefined;
          break;
        }
      }
      if (typeof val === "string" && val.trim().startsWith("http")) {
        return val.trim();
      }
    }

    // Direct key matches if link_key didn't resolve
    if (typeof json === "object" && json !== null) {
      for (const candidate of ["url", "link", "stream", "stream_url", "playbackUrl"]) {
        if (typeof json[candidate] === "string" && json[candidate].startsWith("http")) {
          return json[candidate].trim();
        }
      }
    }

    return null;
  }

  private static async handleHtmlExtraction(
    config: TokenApiConfig,
    fetchFn: typeof fetch
  ): Promise<string | null> {
    const apiUrl = (config.api || "").trim() || (config.url || "").trim();
    if (!apiUrl) return null;

    const res = await this.safeFetch(fetchFn, apiUrl, {
      headers: { "User-Agent": this.DEFAULT_UA },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return this.extractUrlFromHtml(html);
  }

  private static extractUrlFromHtml(html: string): string | null {
    const patterns = [
      /player\.load\(\{[^}]*source:\s*["']([^"']+)["']/i,
      /playbackURL\s*=\s*["']([^"']+)["']/i,
      /src\s*=\s*['"]([^'"]*\.(?:m3u8|mpd|mp4|ts)[^'"]*)['"]/i,
      /url\s*:\s*['"]([^'"]*\.(?:m3u8|mpd|mp4|ts)[^'"]*)['"]/i,
      /["'](https?:\/\/[^"']+\.(?:m3u8|mpd)[^"']*)["']/i,
    ];

    for (const pat of patterns) {
      const match = html.match(pat);
      if (match && match[1] && match[1].startsWith("http")) {
        return match[1].trim();
      }
    }
    return null;
  }

  private static async handleYoutubeExtraction(config: TokenApiConfig): Promise<string | null> {
    const ytUrl = (config.url || "").trim() || (config.api || "").trim();
    return ytUrl && ytUrl.startsWith("http") ? ytUrl : null;
  }

  private static async handleLocationServiceExtraction(
    config: TokenApiConfig,
    fetchFn: typeof fetch
  ): Promise<string | null> {
    let ipApiUrl = config.ip_api?.trim();
    if (ipApiUrl && ipApiUrl.startsWith("aHR0")) {
      try {
        ipApiUrl = Buffer.from(ipApiUrl, "base64").toString("utf-8");
      } catch {}
    }
    if (!ipApiUrl) {
      ipApiUrl = "https://ip-api.streamingucms.com/";
    }

    const res = await this.safeFetch(fetchFn, ipApiUrl, {
      headers: { "User-Agent": this.DEFAULT_UA },
    });
    if (!res.ok) return null;
    const json = await res.json();

    if (config.link_key && json && typeof json === "object") {
      const val = (json as any)[config.link_key];
      if (typeof val === "string" && val.startsWith("http")) {
        return val.trim();
      }
    }

    if (json && typeof json === "object") {
      for (const k of ["url", "link", "stream", "stream_url"]) {
        if (typeof (json as any)[k] === "string" && (json as any)[k].startsWith("http")) {
          return (json as any)[k].trim();
        }
      }
    }

    return null;
  }

  private static async handleDirectApiCall(
    config: TokenApiConfig,
    fetchFn: typeof fetch
  ): Promise<string | null> {
    const target = (config.api || "").trim() || (config.url || "").trim();
    if (!target) return null;

    if (/\.(m3u8|mpd|mp4|ts)(\?|$)/i.test(target)) {
      return target;
    }

    try {
      const res = await this.safeFetch(fetchFn, target, {
        headers: { "User-Agent": this.DEFAULT_UA },
      });
      if (!res.ok) return null;
      const text = await res.text();
      const trimmed = text.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
      }
      return this.extractUrlFromHtml(trimmed);
    } catch {
      return null;
    }
  }
}
