import { describe, expect, it } from "bun:test";
import app from "../src/index";

describe("API Routes (Unit & Fast Smoke Suite)", () => {
  it("returns 200 and healthy status on /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe("healthy");
    expect(typeof body.uptime).toBe("number");
  });

  it("returns all 6 registered providers on /api/v1/providers", async () => {
    const res = await app.request("/api/v1/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: any[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(6);
  });
});
