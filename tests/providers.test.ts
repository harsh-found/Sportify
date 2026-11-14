import { describe, expect, it } from "bun:test";
import { CricifyProvider } from "../src/providers/cricify.provider";
import { SportzxProvider } from "../src/providers/sportzx.provider";
import { PlayZTVProvider } from "../src/providers/playztv.provider";
import { PlayFyProvider } from "../src/providers/playfy.provider";
import { SKTechProvider } from "../src/providers/sktech.provider";
import { LivXowProvider } from "../src/providers/livxow.provider";
import { ProviderError, NetworkError, DecryptionError, CircuitOpenError } from "../src/providers/base.provider";

describe("All 6 Core Indian Sports Provider Adapters (Unit Isolation)", () => {
  const providers = [
    new CricifyProvider(),
    new SportzxProvider(),
    new PlayZTVProvider(),
    new PlayFyProvider(),
    new SKTechProvider(),
    new LivXowProvider(),
  ];

  it("verifies provider metadata and configuration", () => {
    for (const p of providers) {
      expect(p.metadata.id).toBeDefined();
      expect(p.metadata.name).toBeDefined();
      expect(p.metadata.enabled).toBe(true);
      expect(p.metadata.categories.length).toBeGreaterThan(0);
      expect(p.getCircuitState()).toBe("CLOSED");
    }
  });

  it("validates ProviderError hierarchy", () => {
    const netErr = new NetworkError("cricify", "http://example.com", 404);
    expect(netErr instanceof ProviderError).toBe(true);
    expect(netErr.statusCode).toBe(404);
    expect(netErr.url).toBe("http://example.com");

    const decErr = new DecryptionError("playztv", "NativeAES", "bad padding");
    expect(decErr instanceof ProviderError).toBe(true);
    expect(decErr.algorithm).toBe("NativeAES");

    const circErr = new CircuitOpenError("sktech", 30000);
    expect(circErr instanceof ProviderError).toBe(true);
    expect(circErr.cooldownRemainingMs).toBe(30000);
  });
});
