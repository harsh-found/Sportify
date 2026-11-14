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

export interface IProvider {
  readonly metadata: ProviderMetadata;
  fetchEvents(): Promise<LiveEvent[]>;
  fetchChannels(): Promise<Channel[]>;
  resolveStream(id: string): Promise<StreamSource | null>;
  getCircuitState(): CircuitState;
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
    if (this.circuitState !== "CLOSED") {
      this.logInfo("Circuit breaker healed -> CLOSED");
      this.circuitState = "CLOSED";
    }
  }

  protected recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTimestamp = Date.now();
    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      if (this.circuitState !== "OPEN") {
        this.logWarn(
          `Circuit breaker transitioned to OPEN (${this.consecutiveFailures} consecutive failures)`
        );
      }
      this.circuitState = "OPEN";
    }
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

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(effectiveTimeout),
      });

      if (!response.ok) {
        if (!ignoreCb) {
          this.recordFailure();
        }
        throw new NetworkError(this.metadata.id, url, response.status);
      }

      if (!ignoreCb) {
        this.recordSuccess();
      }
      return response;
    } catch (err) {
      if (err instanceof ProviderError) {
        throw err;
      }
      if (!ignoreCb) {
        this.recordFailure();
      }
      throw new NetworkError(this.metadata.id, url, undefined, err);
    }
  }

  /**
   * Shared Firebase Remote Config fetcher reproducing the CloudStream 3 Kotlin
   * `FirebaseRemoteConfigFetcher.kt` implementation with strict timeout protection.
   */
  protected async fetchFirebaseRemoteConfig(
    opts: FirebaseRemoteConfigOptions
  ): Promise<Record<string, string> | null> {
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
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3500),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        state?: string;
        entries?: Record<string, string>;
      };
      if (data?.entries && typeof data.entries === "object") {
        return data.entries;
      }
    } catch {
      // Ignore Firebase Remote Config network timeout/errors and fall back cleanly
    }
    return null;
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
