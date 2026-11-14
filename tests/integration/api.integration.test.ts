import { describe, expect, it } from "bun:test";
import app from "../../src/index";

describe("Live API Integration Suite", () => {
  it("GET /health returns healthy system status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe("healthy");
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /api/v1/providers lists all 6 active Indian providers", async () => {
    const res = await app.request("/api/v1/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: any[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(6);
    const ids = body.data.map((p) => p.id);
    expect(ids).toContain("cricify");
    expect(ids).toContain("sportzx");
    expect(ids).toContain("playztv");
    expect(ids).toContain("playfy");
    expect(ids).toContain("sktech");
    expect(ids).toContain("livxow");
  });

  it("GET /api/v1/events returns real-time live events", async () => {
    const res = await app.request("/api/v1/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: any[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  }, 30000);

  it("GET /api/v1/channels returns live channel listings", async () => {
    const res = await app.request("/api/v1/channels");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: any[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  }, 30000);
});
