import { z } from "zod";

export const ClearKeyPairSchema = z.object({
  kid: z.string().describe("Hexadecimal Key ID"),
  key: z.string().describe("Hexadecimal Key"),
});

export type ClearKeyPair = z.infer<typeof ClearKeyPairSchema>;

export const DRMConfigSchema = z.object({
  type: z.enum(["clearkey", "widevine", "playready"]),
  clearKeys: z.array(ClearKeyPairSchema).optional(),
  licenseUrl: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export type DRMConfig = z.infer<typeof DRMConfigSchema>;
export type DrmConfig = DRMConfig;

export const StreamHealthSchema = z.object({
  latencyMs: z.number().optional(),
  lastChecked: z.string().optional(),
  errorCount: z.number().default(0),
});

export type StreamHealth = z.infer<typeof StreamHealthSchema>;

export const StreamSourceSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  provider: z.string(),
  quality: z.string().default("Auto"),
  format: z.enum(["HLS", "DASH"]),
  streamUrl: z.string(),
  headers: z.record(z.string()).optional(),
  drm: DRMConfigSchema.optional(),
  status: z.enum(["ONLINE", "DEGRADED", "OFFLINE"]).default("ONLINE"),
  timestamp: z.string().optional(),
  health: StreamHealthSchema.optional(),
  fingerprint: z.string().optional(),
});

export type StreamSource = Omit<z.infer<typeof StreamSourceSchema>, "status"> & {
  status?: "ONLINE" | "DEGRADED" | "OFFLINE";
};

export const FormatHintSchema = z.object({
  title: z.string(),
  logo: z.string().optional(),
});

export type FormatHint = z.infer<typeof FormatHintSchema>;

export const LiveEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().default("Sports"),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  status: z.enum(["LIVE", "UPCOMING", "ENDED"]).default("LIVE"),
  poster: z.string().optional(),
  thumbnail: z.string().optional(),
  teamAFlag: z.string().optional(),
  teamBFlag: z.string().optional(),
  eventBanner: z.string().optional(),
  eventType: z.string().optional(),
  isHot: z.boolean().optional(),
  priority: z.number().optional(),
  formatHints: z.array(FormatHintSchema).optional(),
  venue: z.string().optional(),
  competition: z.string().optional(),
  lastUpdated: z.string().optional(),
  sources: z.array(StreamSourceSchema).default([]),
});

export type LiveEvent = Omit<z.infer<typeof LiveEventSchema>, "sources"> & {
  sources: StreamSource[];
};

export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().optional(),
  category: z.string().default("Live TV"),
  group: z.string().optional(),
  region: z.string().default("Global"),
  resolution: z.string().optional(),
  lastUpdated: z.string().optional(),
  sources: z.array(StreamSourceSchema).default([]),
});

export type Channel = Omit<z.infer<typeof ChannelSchema>, "region" | "sources"> & {
  region?: string;
  sources: StreamSource[];
};

