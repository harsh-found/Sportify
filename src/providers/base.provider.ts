import { Channel, DrmConfig, LiveEvent, StreamSource } from "../core/types";
import { DrmHelper } from "../parsers/drm.helper";
import { TokenApiResolver } from "../parsers/token-api.resolver";
import { detectStreamFormat, parsePipeStreamUrl } from "../utils/stream-url";

export interface ProviderMetadata {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
  categories: string[];
}

export interface FirebaseRemoteConfigOptions {
  projectIdOrNumber: string;
  apiKey: string;
  appId: string;
  packageName?: string;
  certSha1?: string;
  timeoutMs?: number;
}

/**
 * Custom Error Hierarchy for Provider Isolation
 */
export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(`[${providerId}] ${message}`);
    this.name = "ProviderError";
  }
}

export class NetworkError extends ProviderError {
  constructor(
    providerId: string,
    public readonly url: string,
    public readonly statusCode?: number,
    cause?: unknown
  ) {
    super(
      providerId,
      `Network request failed for ${url}${statusCode ? ` (HTTP ${statusCode})` : ""}`,
      cause
    );
    this.name = "NetworkError";
  }
}

export class DecryptionError extends ProviderError {
  constructor(
    providerId: string,
    public readonly algorithm: string,
    cause?: unknown
  ) {
    super(providerId, `Decryption failed using ${algorithm}`, cause);
    this.name = "DecryptionError";
  }
}

export class CircuitOpenError extends ProviderError {
  constructor(providerId: string, public readonly cooldownRemainingMs: number) {
    super(
      providerId,
      `Circuit breaker is OPEN. Cooldown remaining: ${Math.ceil(cooldownRemainingMs / 1000)}s`
    );
    this.name = "CircuitOpenError";
  }
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF-OPEN";

export interface ProviderDiagnostics {
  providerId: string;
  providerName: string;
  version: string;
  circuitState: CircuitState;
  consecutiveFailures: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRatePct: number;
  lastFetchLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastEventsExtracted: number;
  lastChannelsExtracted: number;
  activeBaseUrl: string | null;
}

export interface IProvider {
  readonly metadata: ProviderMetadata;
  fetchEvents(): Promise<LiveEvent[]>;
  fetchChannels(): Promise<Channel[]>;
  resolveStream(id: string): Promise<StreamSource | null>;
  getCircuitState(): CircuitState;
  getDiagnostics?(): ProviderDiagnostics;
}

export abstract class AbstractBaseProvider implements IProvider {
  abstract readonly metadata: ProviderMetadata;

  protected defaultUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  // Circuit breaker state
  protected consecutiveFailures = 0;
  protected lastFailureTimestamp = 0;
  protected circuitState: CircuitState = "CLOSED";
  protected circuitBreakerThreshold = 3;
  protected circuitBreakerCooldownMs = 30000; // 30 seconds cooldown

  // Extraction & network telemetry
  protected totalRequests = 0;
  protected successfulRequests = 0;
  protected failedRequests = 0;
  protected lastFetchLatencyMs: number | null = null;
  protected lastSuccessAt: string | null = null;
  protected lastErrorAt: string | null = null;
  protected lastErrorMessage: string | null = null;
  protected lastEventsExtracted = 0;
  protected lastChannelsExtracted = 0;
  protected activeBaseUrl: string | null = null;

  // Shared Firebase Remote Config cache & singleflight map
  private static firebaseConfigCache = new Map<
    string,
    { entries: Record<string, string> | null; expiresAt: number }
  >();
  private static firebaseInFlight = new Map<
    string,
    Promise<Record<string, string> | null>
  >();

  abstract fetchEvents(): Promise<LiveEvent[]>;
  abstract fetchChannels(): Promise<Channel[]>;
  abstract resolveStream(id: string): Promise<StreamSource | null>;

  public getCircuitState(): CircuitState {
    if (this.circuitState === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTimestamp;
      if (elapsed >= this.circuitBreakerCooldownMs) {
        this.circuitState = "HALF-OPEN";
      }
    }
    return this.circuitState;
  }

  public getDiagnostics(): ProviderDiagnostics {
    const state = this.getCircuitState();
    const successRatePct =
      this.totalRequests > 0
        ? Math.round((this.successfulRequests / this.totalRequests) * 1000) / 10
        : 100;
    return {
      providerId: this.metadata.id,
      providerName: this.metadata.name,
      version: this.metadata.version || "1.4.0",
      circuitState: state,
      consecutiveFailures: this.consecutiveFailures,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      successRatePct,
      lastFetchLatencyMs: this.lastFetchLatencyMs,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      lastEventsExtracted: this.lastEventsExtracted,
      lastChannelsExtracted: this.lastChannelsExtracted,
      activeBaseUrl: this.activeBaseUrl,
    };
  }

  protected checkCircuitBreaker(): void {
    const state = this.getCircuitState();
    if (state === "OPEN") {
      const remaining =
        this.circuitBreakerCooldownMs - (Date.now() - this.lastFailureTimestamp);
      throw new CircuitOpenError(this.metadata.id, Math.max(0, remaining));
    }
  }

  protected recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAt = new Date().toISOString();
    if (this.circuitState !== "CLOSED") {
      this.logInfo("Circuit breaker healed -> CLOSED");
      this.circuitState = "CLOSED";
    }
  }

  protected recordFailure(reason?: string): void {
    this.consecutiveFailures++;
    this.lastFailureTimestamp = Date.now();
    this.lastErrorAt = new Date().toISOString();
    if (reason) {
      this.lastErrorMessage = reason;
    }
    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      if (this.circuitState !== "OPEN") {
        this.logWarn(
          `Circuit breaker transitioned to OPEN (${this.consecutiveFailures} consecutive failures)`
        );
      }
      this.circuitState = "OPEN";
    }
  }

  /**
   * Parses CS3 provider date (`DD/MM/YYYY` or `YYYY-MM-DD`) and time (`HH:mm:ss` or `HH:mm`)
   * into a standardized ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ss.000Z`).
   */
  protected parseProviderDateTime(dateStr?: string, timeStr?: string): string | undefined {
    const dRaw = (dateStr || "").trim();
    const tRaw = (timeStr || "").trim();
    if (!dRaw) return undefined;

    let year = "";
    let month = "";
    let day = "";

    const dmy = dRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
      day = dmy[1].padStart(2, "0");
      month = dmy[2].padStart(2, "0");
      year = dmy[3];
    } else {
      const ymd = dRaw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
      if (ymd) {
        year = ymd[1];
        month = ymd[2].padStart(2, "0");
        day = ymd[3].padStart(2, "0");
      }
    }

    if (!year || !month || !day) {
      return tRaw ? `${dRaw} ${tRaw}` : dRaw;
    }

    let hh = "00";
    let mm = "00";
    let ss = "00";
    if (tRaw) {
      const tm = tRaw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
      if (tm) {
        hh = tm[1].padStart(2, "0");
        mm = tm[2].padStart(2, "0");
        ss = (tm[3] || "00").padStart(2, "0");
      }
    }

    return `${year}-${month}-${day}T${hh}:${mm}:${ss}.000Z`;
  }

  /**
   * Determines accurate event status (`LIVE` | `UPCOMING` | `ENDED`) from start/end ISO strings,
   * matching the CS3 `LiveEventsProvider.kt` 15-minute pre-match buffer and 4-hour default duration.
   */
  protected computeEventStatusFromTimes(
    startIso?: string,
    endIso?: string
  ): "LIVE" | "UPCOMING" | "ENDED" {
    if (!startIso) return "LIVE";
    const startMs = Date.parse(startIso);
    if (Number.isNaN(startMs) || startMs <= 0) return "LIVE";

    const endMsRaw = endIso ? Date.parse(endIso) : NaN;
    const effectiveEndMs =
      !Number.isNaN(endMsRaw) && endMsRaw > startMs
        ? endMsRaw
        : startMs + 4 * 3600 * 1000;

    const nowMs = Date.now();
    if (nowMs < startMs - 15 * 60 * 1000) {
      return "UPCOMING";
    }
    if (nowMs > effectiveEndMs) {
      return "ENDED";
    }
    return "LIVE";
  }

  protected async safeFetch(
    url: string,
    options: RequestInit & { timeoutMs?: number; ignoreCircuitBreaker?: boolean } = {},
    timeoutMs = 6500
  ): Promise<Response> {
    const effectiveTimeout = options.timeoutMs ?? timeoutMs;
    const ignoreCb = options.ignoreCircuitBreaker === true;

    if (!ignoreCb) {
      this.checkCircuitBreaker();
    }

    const headers = new Headers(options.headers || {});
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", this.defaultUserAgent);
    }

    this.totalRequests++;
    const startPerf = performance.now();

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(effectiveTimeout),
      });

      this.lastFetchLatencyMs = Math.round(performance.now() - startPerf);

      if (!response.ok) {
        this.failedRequests++;
        const msg = `HTTP ${response.status} for ${url}`;
        if (!ignoreCb) {
          this.recordFailure(msg);
        } else {
          this.lastErrorAt = new Date().toISOString();
          this.lastErrorMessage = msg;
        }
        throw new NetworkError(this.metadata.id, url, response.status);
      }

      this.successfulRequests++;
      if (!ignoreCb) {
        this.recordSuccess();
      } else {
        this.lastSuccessAt = new Date().toISOString();
      }
      return response;
    } catch (err) {
      this.lastFetchLatencyMs = Math.round(performance.now() - startPerf);
      if (err instanceof ProviderError) {
        throw err;
      }
      this.failedRequests++;
      const msg = err instanceof Error ? err.message : String(err);
      if (!ignoreCb) {
        this.recordFailure(msg);
      } else {
        this.lastErrorAt = new Date().toISOString();
        this.lastErrorMessage = msg;
      }
      throw new NetworkError(this.metadata.id, url, undefined, err);
    }
  }

  /**
   * Shared Firebase Remote Config fetcher reproducing the CloudStream 3 Kotlin
   * `FirebaseRemoteConfigFetcher.kt` implementation with singleflight deduplication and TTL cache.
   */
  protected async fetchFirebaseRemoteConfig(
    opts: FirebaseRemoteConfigOptions
  ): Promise<Record<string, string> | null> {
    const cacheKey = `${opts.projectIdOrNumber}:${opts.appId}`;
    const cached = AbstractBaseProvider.firebaseConfigCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.entries;
    }

    const existingFlight = AbstractBaseProvider.firebaseInFlight.get(cacheKey);
    if (existingFlight) {
      return existingFlight;
    }

    const flight = (async (): Promise<Record<string, string> | null> => {
      const url = `https://firebaseremoteconfig.googleapis.com/v1/projects/${opts.projectIdOrNumber}/namespaces/firebase:fetch?key=${opts.apiKey}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Goog-Api-Key": opts.apiKey,
      };
      if (opts.packageName) {
        headers["X-Android-Package"] = opts.packageName;
      }
      if (opts.certSha1) {
        headers["X-Android-Cert"] = opts.certSha1;
      }

      const appInstanceId = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");

      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            appId: opts.appId,
            appInstanceId,
            ...(opts.packageName ? { packageName: opts.packageName } : {}),
            sdkVersion: "22.1.0",
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
        });
        if (!res.ok) {
          AbstractBaseProvider.firebaseConfigCache.set(cacheKey, {
            entries: null,
            expiresAt: Date.now() + 5 * 60 * 1000,
          });
          return null;
        }
        const data = (await res.json()) as {
          state?: string;
          entries?: Record<string, string>;
        };
        if (data?.entries && typeof data.entries === "object") {
          AbstractBaseProvider.firebaseConfigCache.set(cacheKey, {
            entries: data.entries,
            expiresAt: Date.now() + 30 * 60 * 1000,
          });
          return data.entries;
        }
      } catch {
        // Cache negative result briefly (2 minutes) to avoid repeated timeouts
        AbstractBaseProvider.firebaseConfigCache.set(cacheKey, {
          entries: null,
          expiresAt: Date.now() + 2 * 60 * 1000,
        });
      }
      return null;
    })().finally(() => {
      AbstractBaseProvider.firebaseInFlight.delete(cacheKey);
    });

    AbstractBaseProvider.firebaseInFlight.set(cacheKey, flight);
    return flight;
  }

  /**
   * Normalizes a raw provider stream entry object into a validated `StreamSource`.
   * Handles `tokenApi` dynamic resolution, pipe-delimited headers, and ClearKey DRM parsing.
   */
  protected async buildStreamSourceFromEntry(params: {
    id: string;
    rawUrl?: string | null;
    tokenApi?: string | null;
    quality?: string;
    title?: string;
    formatHint?: string;
    referer?: string | null;
    origin?: string | null;
    userAgent?: string | null;
    cookie?: string | null;
    drmScheme?: string | null;
    drmLicense?: string | null;
    extraHeaders?: Record<string, string>;
  }): Promise<StreamSource | null> {
    let resolvedUrl = (params.rawUrl || "").trim();

    if (!resolvedUrl && params.tokenApi) {
      const tokenResolved = await TokenApiResolver.resolve(params.tokenApi);
      if (tokenResolved) {
        resolvedUrl = tokenResolved.trim();
      }
    }

    if (!resolvedUrl) return null;

    const baseHeaders: Record<string, string> = { ...(params.extraHeaders || {}) };
    if (params.referer && params.referer !== "null") baseHeaders["Referer"] = params.referer.trim();
    if (params.origin && params.origin !== "null") baseHeaders["Origin"] = params.origin.trim();
    if (params.userAgent && params.userAgent !== "null") baseHeaders["User-Agent"] = params.userAgent.trim();
    if (params.cookie && params.cookie !== "null") baseHeaders["Cookie"] = params.cookie.trim();

    let initialDrm: DrmConfig | undefined;
    if (params.drmLicense && params.drmLicense !== "null" && params.drmLicense !== "0") {
      initialDrm = DrmHelper.parseClearKeyString(params.drmLicense);
    }

    const parsed = parsePipeStreamUrl(resolvedUrl, baseHeaders, initialDrm);
    if (!parsed.cleanUrl) return null;

    const format = detectStreamFormat(parsed.cleanUrl, params.formatHint);
    const source: StreamSource = {
      id: params.id,
      provider: this.metadata.id,
      quality: params.quality || "1080p",
      title: params.title,
      format,
      streamUrl: parsed.cleanUrl,
      drm: parsed.drm,
      headers: Object.keys(parsed.headers).length > 0 ? parsed.headers : undefined,
      status: "ONLINE",
    };
    source.fingerprint = DrmHelper.generateFingerprint(source);
    return source;
  }

  protected logInfo(message: string): void {
    console.log(`[${new Date().toISOString()}] [INFO] [${this.metadata.name}] ${message}`);
  }

  protected logWarn(message: string): void {
    console.warn(`[${new Date().toISOString()}] [WARN] [${this.metadata.name}] ${message}`);
  }

  protected logError(message: string, error?: unknown): void {
    console.error(
      `[${new Date().toISOString()}] [ERROR] [${this.metadata.name}] ${message}`,
      error instanceof Error ? error.message : error
    );
  }
}
