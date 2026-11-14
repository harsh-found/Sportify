import { describe, expect, it } from "bun:test";
import {
  AbstractBaseProvider,
  CircuitOpenError,
  NetworkError,
  ProviderMetadata,
} from "../src/providers/base.provider";
import { Channel, LiveEvent, StreamSource } from "../src/core/types";

class MockFaultyProvider extends AbstractBaseProvider {
  readonly metadata: ProviderMetadata = {
    id: "mock_faulty",
    name: "Mock Faulty Provider",
    enabled: true,
    categories: ["Sports"],
  };

  public shouldFail = true;

  constructor() {
    super();
    this.circuitBreakerThreshold = 2; // Open after 2 failures
    this.circuitBreakerCooldownMs = 100; // 100ms cooldown for fast test
  }

  async fetchEvents(): Promise<LiveEvent[]> {
    return [];
  }

  async fetchChannels(): Promise<Channel[]> {
    return [];
  }

  async resolveStream(_id: string): Promise<StreamSource | null> {
    return null;
  }

  async simulateRequest(): Promise<string> {
    this.checkCircuitBreaker();
    if (this.shouldFail) {
      this.recordFailure();
      throw new NetworkError(this.metadata.id, "http://fake.url", 500);
    }
    this.recordSuccess();
    return "ok";
  }
}

describe("Circuit Breaker State Machine", () => {
  it("transitions from CLOSED -> OPEN after threshold failures and rejects with CircuitOpenError", async () => {
    const provider = new MockFaultyProvider();
    expect(provider.getCircuitState()).toBe("CLOSED");

    // Failure 1
    await expect(provider.simulateRequest()).rejects.toThrow(NetworkError);
    expect(provider.getCircuitState()).toBe("CLOSED");

    // Failure 2 (reaches threshold of 2)
    await expect(provider.simulateRequest()).rejects.toThrow(NetworkError);
    expect(provider.getCircuitState()).toBe("OPEN");

    // While OPEN, fails fast with CircuitOpenError without calling remote service
    await expect(provider.simulateRequest()).rejects.toThrow(CircuitOpenError);
  });

  it("transitions from OPEN -> HALF-OPEN after cooldown, and heals to CLOSED on canary success", async () => {
    const provider = new MockFaultyProvider();

    // Trigger circuit trip
    await expect(provider.simulateRequest()).rejects.toThrow(NetworkError);
    await expect(provider.simulateRequest()).rejects.toThrow(NetworkError);
    expect(provider.getCircuitState()).toBe("OPEN");

    // Wait for 110ms cooldown
    await new Promise((r) => setTimeout(r, 110));
    expect(provider.getCircuitState()).toBe("HALF-OPEN");

    // Canary call succeeds
    provider.shouldFail = false;
    const res = await provider.simulateRequest();
    expect(res).toBe("ok");

    // State should now be fully healed to CLOSED
    expect(provider.getCircuitState()).toBe("CLOSED");
  });
});
