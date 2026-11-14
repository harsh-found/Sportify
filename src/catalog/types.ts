import { z } from "zod";
import { DRMConfigSchema } from "../core/types";

export const TournamentSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  logo: z.string().nullable().optional(),
  category: z.string(),
});
export type Tournament = z.infer<typeof TournamentSchema>;

export const TeamSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  shortName: z.string().optional(),
  code: z.string(),
  logo: z.string().nullable().optional(),
  gender: z.enum(["men", "women", "mixed"]).optional(),
  ageGroup: z.enum(["senior", "u19", "u23", "a-team", "emerging"]).optional(),
  leagueId: z.string().nullable().optional(),
});
export type Team = z.infer<typeof TeamSchema>;

export const MatchTeamsSchema = z.object({
  teamA: TeamSchema,
  teamB: TeamSchema,
});
export type MatchTeams = z.infer<typeof MatchTeamsSchema>;

export const BroadcastInfoSchema = z.object({
  eventName: z.string().optional(),
  badgeText: z.string().optional(),
  channelName: z.string().optional(),
  broadcaster: z.string().nullable().optional(),
  is24x7: z.boolean().optional(),
});
export type BroadcastInfo = z.infer<typeof BroadcastInfoSchema>;

export const ScheduleInfoSchema = z.object({
  startTimeUtc: z.string().nullable().optional(),
  endTimeUtc: z.string().nullable().optional(),
  status: z.enum(["live", "upcoming", "ended"]),
  liveBadgeText: z.string().optional(),
  isLive: z.boolean(),
});
export type ScheduleInfo = z.infer<typeof ScheduleInfoSchema>;

export const StreamMetadataSchema = z.object({
  totalWorkingFeeds: z.number(),
  availableLanguages: z.array(z.string()),
  availableQualities: z.array(z.string()).optional(),
  maxResolution: z.string(),
  hasDrmFeeds: z.boolean().optional(),
  primaryBroadcasters: z.array(z.string()),
});
export type StreamMetadata = z.infer<typeof StreamMetadataSchema>;

export const CatalogFixtureSchema = z.object({
  fixtureId: z.string(),
  canonicalKey: z.string(),
  kind: z.enum(["match", "tournament_channel"]),
  sport: z.string(),
  phase: z.enum(["live", "upcoming", "ended"]).optional(),
  isHotMatch: z.boolean().optional(),
  title: z.string(),
  matchFormat: z.string().nullable().optional(),
  matchStage: z.string().nullable().optional(),
  matchNumberTag: z.string().nullable().optional(),
  eventConfidence: z.number().min(0).max(1).optional(),
  tournament: TournamentSchema.nullable().optional(),
  teams: MatchTeamsSchema.nullable().optional(),
  broadcastInfo: BroadcastInfoSchema.nullable().optional(),
  schedule: ScheduleInfoSchema,
  streamMetadata: StreamMetadataSchema,
  posterUrl: z.string().nullable().optional(),
  providerPointers: z.record(z.string()),
});
export type CatalogFixture = z.infer<typeof CatalogFixtureSchema>;
export type NormalizedCatalogFixture = CatalogFixture;
export type SportCategory = string;
export type TeamInfo = Team;
export type TournamentInfo = Tournament;

export const SourceProvenanceItemSchema = z.object({
  providerKey: z.string().optional(),
  providerId: z.string().optional(),
  providerName: z.string(),
  isPrimary: z.boolean().optional(),
  discoveredAt: z.string().optional(),
});
export type SourceProvenanceItem = z.infer<typeof SourceProvenanceItemSchema>;

export const StreamProvenanceSchema = z.object({
  isExclusive: z.boolean().optional(),
  isMultiSource: z.boolean(),
  primaryProvider: z.string(),
  mirroredProviders: z.array(z.string()),
  sourceList: z.array(SourceProvenanceItemSchema),
  attributionBadge: z.string(),
});
export type StreamProvenance = z.infer<typeof StreamProvenanceSchema>;

export const LanguageInfoSchema = z.object({
  code: z.string(),
  name: z.string(),
  badge: z.string(),
});
export type LanguageInfo = z.infer<typeof LanguageInfoSchema>;

export const RenditionSchema = z.object({
  id: z.string().optional(),
  qualityTag: z.string(),
  label: z.string().optional(),
  resolution: z.string().optional(),
  height: z.number().optional(),
  bandwidthKbps: z.number().optional(),
  bitrate: z.number().optional(),
  fps: z.number().optional(),
  codec: z.string().optional(),
  isDefault: z.boolean().optional(),
  url: z.string(),
});
export type Rendition = z.infer<typeof RenditionSchema>;
export type RenditionVariant = Rendition;
export type RenditionOption = Rendition;

export const NetworkEndpointsSchema = z.object({
  masterPlaylistUrl: z.string(),
  edgeProxyFallbackUrl: z.string(),
  headers: z.record(z.string()).optional(),
});
export type NetworkEndpoints = z.infer<typeof NetworkEndpointsSchema>;

export const StreamHealthCheckSchema = z.object({
  isAlive: z.boolean(),
  latencyMs: z.number(),
  statusCode: z.number(),
  lastChecked: z.string(),
});
export type StreamHealthCheck = z.infer<typeof StreamHealthCheckSchema>;

export const RichStreamFeedSchema = z.object({
  streamId: z.string(),
  channelName: z.string(),
  channelGroup: z.string(),
  priorityTier: z.enum(["primary", "backup", "fallback"]),
  reliabilityScore: z.number().min(0).max(100),
  language: LanguageInfoSchema,
  protocol: z.enum(["hls", "dash"]),
  drm: DRMConfigSchema.nullable().optional(),
  provenance: StreamProvenanceSchema,
  network: NetworkEndpointsSchema,
  hasPreParsedRenditions: z.boolean(),
  renditions: z.array(RenditionSchema),
  health: StreamHealthCheckSchema.optional(),
});
export type RichStreamFeed = z.infer<typeof RichStreamFeedSchema>;
