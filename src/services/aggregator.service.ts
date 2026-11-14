import { Channel, LiveEvent, StreamSource } from "../core/types";
import { StreamCache } from "../engine/cache";
import { mergeAndDeduplicateEvents } from "../engine/normalizer";
import { streamProber, ProbeResult } from "../engine/prober";
import {
  buildUnifiedCatalog,
  buildRichStreamFeeds,
  detectSport,
  detectLanguage,
  detectBroadcaster,
  parseEventEntities,
  generateCanonicalKey,
  scoreSearchQuery,
  TEAM_ALIASES,
  TOURNAMENT_SIGNATURES,
  PROVIDER_TRUST_RANK,
} from "../catalog/normalizer";
import { NormalizedCatalogFixture, RichStreamFeed, TeamInfo, TournamentInfo } from "../catalog/types";
import { IProvider } from "../providers/base.provider";
import { CricifyProvider } from "../providers/cricify.provider";
import { SportzxProvider } from "../providers/sportzx.provider";
import { PlayZTVProvider } from "../providers/playztv.provider";
import { PlayFyProvider } from "../providers/playfy.provider";
import { SKTechProvider } from "../providers/sktech.provider";
import { LivXowProvider } from "../providers/livxow.provider";

export interface CatalogIndex {
  byFixtureId: Map<string, NormalizedCatalogFixture>;
  byCanonicalKey: Map<string, NormalizedCatalogFixture>;
  byProviderPointer: Map<string, NormalizedCatalogFixture>;
  bySport: Map<string, NormalizedCatalogFixture[]>;
  byPhase: Map<"live" | "upcoming" | "ended", NormalizedCatalogFixture[]>;
  byTournamentId: Map<string, NormalizedCatalogFixture[]>;
  byTeamCode: Map<string, NormalizedCatalogFixture[]>;
  byProvider: Map<string, NormalizedCatalogFixture[]>;
  hotMatches: NormalizedCatalogFixture[];
}

const PROVIDER_TECHNICAL_SPECS: Record<
  string,
  {
    firebaseProjectId: string;
    appIdPackage: string;
    cryptoAlgorithm: string;
    protocols: string[];
    trustScore: number;
  }
> = {
  cricify: {
    firebaseProjectId: "963020218535",
    appIdPackage: "com.cricfy.tv",
    cryptoAlgorithm: "AES-128-CBC (Primary / Dex-Secondary / EnvelopeCrypto)",
    protocols: ["HLS", "DASH ClearKey"],
    trustScore: 96,
  },
  sportzx: {
    firebaseProjectId: "234785582029",
    appIdPackage: "com.sportzxtv.app",
    cryptoAlgorithm: "SXR3 ChaCha20-Variant Sponge + 128-bit MAC Tag / AES-128-CBC",
    protocols: ["HLS", "DASH ClearKey"],
    trustScore: 94,
  },
  sktech: {
    firebaseProjectId: "330162934410",
    appIdPackage: "com.live.sktechtv",
    cryptoAlgorithm: "256-Byte Lookup Table D + V23 Substitution + 64-Char Header AES-128-CBC",
    protocols: ["HLS", "DASH ClearKey"],
    trustScore: 92,
  },
  playztv: {
    firebaseProjectId: "516859456626",
    appIdPackage: "com.playztv.app",
    cryptoAlgorithm: "Reverse Bytes + Adjacent Byte-Pair Swap + AES-128-CBC",
    protocols: ["DASH ClearKey", "HLS"],
    trustScore: 91,
  },
  livxow: {
    firebaseProjectId: "459539398637",
    appIdPackage: "com.livxow.app",
    cryptoAlgorithm: "Substitution Cipher + Base64url pro/*.txt + AES-128-CBC",
    protocols: ["DASH ClearKey", "HLS"],
    trustScore: 89,
  },
  playfy: {
    firebaseProjectId: "239487160038",
    appIdPackage: "com.playfytv.app",
    cryptoAlgorithm: "32-bit FNV-1a Key/IV Derivation (0x811c9dc5) + AES-128-CBC",
    protocols: ["DASH ClearKey", "HLS"],
    trustScore: 87,
  },
};

export class AggregatorService {
  private providers: Map<string, IProvider> = new Map();

  // High-performance in-memory caches with Singleflight stampede protection + Stale-While-Revalidate
  private rawEventsCache = new StreamCache<LiveEvent[]>({ defaultTtlMs: 60000, defaultSwrMs: 120000 });
  private eventsCache = new StreamCache<LiveEvent[]>({ defaultTtlMs: 60000, defaultSwrMs: 120000 });
  private channelsCache = new StreamCache<Channel[]>({ defaultTtlMs: 300000, defaultSwrMs: 300000 });
  private resolvedStreamCache = new StreamCache<StreamSource[]>({ defaultTtlMs: 300000, defaultSwrMs: 300000 });
  private catalogCache = new StreamCache<NormalizedCatalogFixture[]>({ defaultTtlMs: 60000, defaultSwrMs: 120000 });
  private fixtureFeedsCache = new StreamCache<{
    fixture: NormalizedCatalogFixture | null;
    feeds: RichStreamFeed[];
  }>({ defaultTtlMs: 120000, defaultSwrMs: 180000 });
  private m3uCache = new StreamCache<string>({ defaultTtlMs: 60000, defaultSwrMs: 120000 });

  private lastIndexedCatalogRef: NormalizedCatalogFixture[] | null = null;
  private cachedCatalogIndex: CatalogIndex | null = null;

  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.registerProvider(new CricifyProvider());
    this.registerProvider(new SportzxProvider());
    this.registerProvider(new PlayZTVProvider());
    this.registerProvider(new PlayFyProvider());
    this.registerProvider(new SKTechProvider());
    this.registerProvider(new LivXowProvider());

    // Start non-blocking background cache warming timer
    this.startBackgroundRefresh(60000);
  }

  /**
   * Builds or returns a memoized O(1) multi-key index for the given catalog snapshot.
   */
  private getCatalogIndex(catalog: NormalizedCatalogFixture[]): CatalogIndex {
    if (this.lastIndexedCatalogRef === catalog && this.cachedCatalogIndex) {
      return this.cachedCatalogIndex;
    }

    const byFixtureId = new Map<string, NormalizedCatalogFixture>();
    const byCanonicalKey = new Map<string, NormalizedCatalogFixture>();
    const byProviderPointer = new Map<string, NormalizedCatalogFixture>();
    const bySport = new Map<string, NormalizedCatalogFixture[]>();
    const byPhase = new Map<"live" | "upcoming" | "ended", NormalizedCatalogFixture[]>([
      ["live", []],
      ["upcoming", []],
      ["ended", []],
    ]);
    const byTournamentId = new Map<string, NormalizedCatalogFixture[]>();
    const byTeamCode = new Map<string, NormalizedCatalogFixture[]>();
    const byProvider = new Map<string, NormalizedCatalogFixture[]>();
    const hotMatches: NormalizedCatalogFixture[] = [];

    for (const fix of catalog) {
      byFixtureId.set(fix.fixtureId, fix);
      byCanonicalKey.set(fix.canonicalKey, fix);

      for (const [prov, ptr] of Object.entries(fix.providerPointers)) {
        byProviderPointer.set(ptr, fix);
        const provKey = prov.toLowerCase();
        const pList = byProvider.get(provKey);
        if (pList) pList.push(fix);
        else byProvider.set(provKey, [fix]);
      }

      const sportKey = fix.sport.toLowerCase();
      const sList = bySport.get(sportKey);
      if (sList) sList.push(fix);
      else bySport.set(sportKey, [fix]);

      const phaseBucket = byPhase.get(fix.schedule.status);
      if (phaseBucket) phaseBucket.push(fix);

      if (fix.tournament?.id) {
        const tId = fix.tournament.id.toLowerCase();
        const tList = byTournamentId.get(tId);
        if (tList) tList.push(fix);
        else byTournamentId.set(tId, [fix]);
      }

      if (fix.teams) {
        const codeA = fix.teams.teamA.code.toLowerCase();
        const codeB = fix.teams.teamB.code.toLowerCase();
        const listA = byTeamCode.get(codeA);
        if (listA) listA.push(fix);
        else byTeamCode.set(codeA, [fix]);

        if (codeB !== codeA) {
          const listB = byTeamCode.get(codeB);
          if (listB) listB.push(fix);
          else byTeamCode.set(codeB, [fix]);
        }
      }

      if (fix.isHotMatch) {
        hotMatches.push(fix);
      }
    }

    const index: CatalogIndex = {
      byFixtureId,
      byCanonicalKey,
      byProviderPointer,
      bySport,
      byPhase,
      byTournamentId,
      byTeamCode,
      byProvider,
      hotMatches,
    };

    this.lastIndexedCatalogRef = catalog;
    this.cachedCatalogIndex = index;
    return index;
  }

  public getCatalogEtag(): string | null {
    return this.catalogCache.getEtag("unified_catalog");
  }

  public startBackgroundRefresh(intervalMs = 60000): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(async () => {
      try {
        await this.refreshEventsInBackground();
      } catch {
        // Ignore background refresh errors
      }
    }, intervalMs);
    if (typeof (this.refreshTimer as any)?.unref === "function") {
      (this.refreshTimer as any).unref();
    }
  }

  public stopBackgroundRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private async fetchAllRawProviderEvents(): Promise<LiveEvent[]> {
    return this.rawEventsCache.getOrFetch(
      "raw_provider_events",
      async () => {
        const activeProviders = Array.from(this.providers.values()).filter(
          (p) => p.metadata.enabled
        );

        const results = await Promise.allSettled(
          activeProviders.map((provider) => provider.fetchEvents())
        );

        const allEvents: LiveEvent[] = [];
        for (const res of results) {
          if (res.status === "fulfilled" && Array.isArray(res.value)) {
            allEvents.push(...res.value);
          }
        }

        if (allEvents.length === 0) {
          const stale = this.rawEventsCache.getStale("raw_provider_events");
          if (stale) return stale;
        }

        return allEvents;
      },
      60000
    );
  }

  private async refreshEventsInBackground(): Promise<LiveEvent[]> {
    const activeProviders = Array.from(this.providers.values()).filter(
      (p) => p.metadata.enabled
    );

    const results = await Promise.allSettled(
      activeProviders.map((provider) => provider.fetchEvents())
    );

    const allEvents: LiveEvent[] = [];
    for (const res of results) {
      if (res.status === "fulfilled" && Array.isArray(res.value)) {
        allEvents.push(...res.value);
      }
    }

    if (allEvents.length > 0) {
      this.rawEventsCache.set("raw_provider_events", allEvents, 60000);
      const deduplicated = mergeAndDeduplicateEvents(allEvents);
      this.eventsCache.set("all_events", deduplicated, 60000);
      const unified = buildUnifiedCatalog(allEvents);
      this.catalogCache.set("unified_catalog", unified, 60000);
      this.getCatalogIndex(unified);
      return deduplicated;
    }

    return this.eventsCache.getStale("all_events") || [];
  }

  public registerProvider(provider: IProvider): void {
    this.providers.set(provider.metadata.id, provider);
  }

  public getProviders() {
    return Array.from(this.providers.values()).map((p) => ({
      ...p.metadata,
      circuitState: p.getCircuitState(),
      ...(PROVIDER_TECHNICAL_SPECS[p.metadata.id] || {}),
    }));
  }

  public getCacheStats() {
    return {
      events: this.eventsCache.getStats(),
      channels: this.channelsCache.getStats(),
      resolvedSources: this.resolvedStreamCache.getStats(),
      catalog: this.catalogCache.getStats(),
      fixtureFeeds: this.fixtureFeedsCache.getStats(),
      m3u: this.m3uCache.getStats(),
    };
  }

  /**
   * Returns the normalized, deduplicated catalog of fixtures across all 6 providers.
   * Uses O(1) CatalogIndex buckets and weighted fuzzy search scoring.
   */
  async getUnifiedCatalog(options?: {
    sport?: string;
    phase?: "live" | "upcoming" | "ended" | "all";
    search?: string;
    provider?: string;
    limit?: number;
  }): Promise<NormalizedCatalogFixture[]> {
    const rawCatalog = await this.catalogCache.getOrFetch(
      "unified_catalog",
      async () => {
        const rawEvents = await this.fetchAllRawProviderEvents();
        const built = buildUnifiedCatalog(rawEvents);
        this.getCatalogIndex(built);
        return built;
      },
      60000
    );

    if (
      !options ||
      (!options.sport &&
        (!options.phase || options.phase === "all") &&
        !options.search &&
        !options.provider &&
        (!options.limit || options.limit <= 0))
    ) {
      return rawCatalog;
    }

    const index = this.getCatalogIndex(rawCatalog);
    let filtered: NormalizedCatalogFixture[];

    // Start from the most selective O(1) index bucket
    if (options.sport) {
      const targetSport = options.sport.toLowerCase().trim();
      filtered = [...(index.bySport.get(targetSport) || [])];
    } else if (options.phase && options.phase !== "all") {
      filtered = [...(index.byPhase.get(options.phase) || [])];
    } else if (options.provider) {
      const targetProvider = options.provider.toLowerCase().trim();
      filtered = [...(index.byProvider.get(targetProvider) || [])];
    } else {
      filtered = [...rawCatalog];
    }

    if (options.phase && options.phase !== "all" && options.sport) {
      filtered = filtered.filter((f) => f.schedule.status === options.phase);
    }

    if (options.provider && (options.sport || (options.phase && options.phase !== "all"))) {
      const targetProvider = options.provider.toLowerCase().trim();
      filtered = filtered.filter((f) => Boolean(f.providerPointers[targetProvider]));
    }

    if (options.search) {
      const q = options.search.trim();
      const scored = filtered
        .map((f) => ({
          fix: f,
          score: scoreSearchQuery(q, {
            primary: f.title,
            codes: f.teams ? [f.teams.teamA.code, f.teams.teamB.code] : [],
            secondary: [
              f.canonicalKey,
              f.tournament?.name || "",
              f.tournament?.shortName || "",
              f.teams?.teamA.name || "",
              f.teams?.teamB.name || "",
              f.sport,
            ],
          }),
        }))
        .filter((item) => item.score > 0);

      scored.sort((a, b) => b.score - a.score);
      filtered = scored.map((item) => item.fix);
    }

    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Returns aggregated sports list with total, live, upcoming fixture counts and tournament counts.
   */
  async getSports(): Promise<
    {
      sport: string;
      totalFixtures: number;
      liveFixtures: number;
      upcomingFixtures: number;
      tournamentsCount: number;
      providers: string[];
    }[]
  > {
    const catalog = await this.getUnifiedCatalog();
    const map = new Map<
      string,
      {
        total: number;
        live: number;
        upcoming: number;
        tournaments: Set<string>;
        providers: Set<string>;
      }
    >();

    for (const item of catalog) {
      const entry = map.get(item.sport) || {
        total: 0,
        live: 0,
        upcoming: 0,
        tournaments: new Set<string>(),
        providers: new Set<string>(),
      };
      entry.total++;
      if (item.schedule.isLive) entry.live++;
      else if (item.schedule.status === "upcoming") entry.upcoming++;
      if (item.tournament?.id) entry.tournaments.add(item.tournament.id);
      for (const p of Object.keys(item.providerPointers)) {
        entry.providers.add(p);
      }
      map.set(item.sport, entry);
    }

    return Array.from(map.entries())
      .map(([sport, counts]) => ({
        sport,
        totalFixtures: counts.total,
        liveFixtures: counts.live,
        upcomingFixtures: counts.upcoming,
        tournamentsCount: counts.tournaments.size,
        providers: Array.from(counts.providers),
      }))
      .sort((a, b) => b.totalFixtures - a.totalFixtures);
  }

  /**
   * Returns detailed breakdown for a single sport category.
   */
  async getSportDetail(sportSlug: string) {
    const target = sportSlug.toLowerCase().trim();
    const fixtures = await this.getUnifiedCatalog({ sport: target });
    const tournamentsMap = new Map<string, TournamentInfo & { fixtureCount: number }>();
    const teamsMap = new Map<string, TeamInfo>();
    const providersSet = new Set<string>();

    let liveCount = 0;
    let upcomingCount = 0;

    for (const fix of fixtures) {
      if (fix.schedule.isLive) liveCount++;
      else if (fix.schedule.status === "upcoming") upcomingCount++;

      if (fix.tournament) {
        const existing = tournamentsMap.get(fix.tournament.id);
        if (existing) {
          existing.fixtureCount++;
        } else {
          tournamentsMap.set(fix.tournament.id, { ...fix.tournament, fixtureCount: 1 });
        }
      }
      if (fix.teams) {
        teamsMap.set(fix.teams.teamA.code, fix.teams.teamA);
        teamsMap.set(fix.teams.teamB.code, fix.teams.teamB);
      }
      for (const p of Object.keys(fix.providerPointers)) {
        providersSet.add(p);
      }
    }

    return {
      sport: target,
      totalFixtures: fixtures.length,
      liveFixtures: liveCount,
      upcomingFixtures: upcomingCount,
      providers: Array.from(providersSet),
      tournaments: Array.from(tournamentsMap.values()),
      teams: Array.from(teamsMap.values()),
      fixtures,
    };
  }

  /**
   * Queries matches/fixtures with comprehensive filtering, sorting, and pagination.
   */
  async queryMatches(options?: {
    sport?: string;
    phase?: "live" | "upcoming" | "ended" | "all";
    kind?: "match" | "tournament_channel" | "all";
    tournament?: string;
    team?: string;
    provider?: string;
    language?: string;
    drm?: boolean;
    hot?: boolean;
    q?: string;
    sort?: "status" | "feeds" | "title" | "time";
    page?: number;
    limit?: number;
  }) {
    const allCatalog = await this.getUnifiedCatalog();
    let filtered = [...allCatalog];

    if (options?.hot !== undefined) {
      filtered = filtered.filter((f) => Boolean(f.isHotMatch) === options.hot);
    }

    if (options?.sport) {
      const s = options.sport.toLowerCase().trim();
      filtered = filtered.filter((f) => f.sport.toLowerCase() === s);
    }

    if (options?.phase && options.phase !== "all") {
      filtered = filtered.filter((f) => f.schedule.status === options.phase);
    }

    if (options?.kind && options.kind !== "all") {
      filtered = filtered.filter((f) => f.kind === options.kind);
    }

    if (options?.tournament) {
      const t = options.tournament.toLowerCase().trim();
      filtered = filtered.filter(
        (f) =>
          f.tournament?.id.toLowerCase() === t ||
          f.tournament?.shortName.toLowerCase() === t ||
          f.tournament?.name.toLowerCase().includes(t)
      );
    }

    if (options?.team) {
      const tm = options.team.toLowerCase().trim();
      const aliasCode = TEAM_ALIASES[tm]?.code.toLowerCase();
      filtered = filtered.filter((f) => {
        if (!f.teams) return false;
        const aCode = f.teams.teamA.code.toLowerCase();
        const bCode = f.teams.teamB.code.toLowerCase();
        const aName = f.teams.teamA.name.toLowerCase();
        const bName = f.teams.teamB.name.toLowerCase();
        return (
          aCode === tm ||
          bCode === tm ||
          (aliasCode && (aCode === aliasCode || bCode === aliasCode)) ||
          aName.includes(tm) ||
          bName.includes(tm)
        );
      });
    }

    if (options?.provider) {
      const p = options.provider.toLowerCase().trim();
      filtered = filtered.filter((f) => Boolean(f.providerPointers[p]));
    }

    if (options?.language) {
      const lang = options.language.toLowerCase().trim();
      filtered = filtered.filter((f) =>
        f.streamMetadata.availableLanguages.some((l) => l.toLowerCase() === lang)
      );
    }

    if (options?.drm !== undefined) {
      filtered = filtered.filter((f) => Boolean(f.streamMetadata.hasDrmFeeds) === options.drm);
    }

    if (options?.q) {
      const q = options.q.toLowerCase().trim();
      filtered = filtered.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.canonicalKey.toLowerCase().includes(q) ||
          (f.tournament?.name && f.tournament.name.toLowerCase().includes(q)) ||
          (f.tournament?.shortName && f.tournament.shortName.toLowerCase().includes(q)) ||
          (f.teams?.teamA.name && f.teams.teamA.name.toLowerCase().includes(q)) ||
          (f.teams?.teamB.name && f.teams.teamB.name.toLowerCase().includes(q)) ||
          (f.teams?.teamA.code && f.teams.teamA.code.toLowerCase() === q) ||
          (f.teams?.teamB.code && f.teams.teamB.code.toLowerCase() === q)
      );
    }

    const sortBy = options?.sort || "status";
    if (sortBy === "status") {
      filtered.sort((a, b) => {
        if (a.schedule.isLive !== b.schedule.isLive) return a.schedule.isLive ? -1 : 1;
        return b.streamMetadata.totalWorkingFeeds - a.streamMetadata.totalWorkingFeeds;
      });
    } else if (sortBy === "feeds") {
      filtered.sort(
        (a, b) => b.streamMetadata.totalWorkingFeeds - a.streamMetadata.totalWorkingFeeds
      );
    } else if (sortBy === "title") {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "time") {
      filtered.sort((a, b) =>
        (a.schedule.startTimeUtc || "").localeCompare(b.schedule.startTimeUtc || "")
      );
    }

    const total = filtered.length;
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(250, Math.max(1, options?.limit || 50));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit);

    return {
      total,
      page,
      limit,
      totalPages,
      items,
    };
  }

  /**
   * Returns complete details for a single match/fixture including resolved stream feeds.
   */
  async getMatchDetail(matchIdOrKey: string, proxyBaseUrl = "http://localhost:3000/api/proxy") {
    const catalog = await this.getUnifiedCatalog();
    const target = decodeURIComponent(matchIdOrKey).trim();

    const fixture =
      catalog.find(
        (f) =>
          f.fixtureId === target ||
          f.canonicalKey === target ||
          Object.values(f.providerPointers).includes(target)
      ) || null;

    if (!fixture) return null;

    const { feeds } = await this.getFixtureFeeds(fixture.canonicalKey, proxyBaseUrl);
    return {
      fixture,
      feeds,
    };
  }

  /**
   * Returns all tournaments/competitions across the live catalog + canonical tournament registry.
   */
  async getTournaments(options?: { sport?: string; q?: string; activeOnly?: boolean }) {
    const catalog = await this.getUnifiedCatalog();
    const tournamentMap = new Map<
      string,
      {
        id: string;
        name: string;
        shortName: string;
        category: string;
        sport: string;
        totalFixtures: number;
        liveFixtures: number;
        upcomingFixtures: number;
        participatingTeams: Map<string, TeamInfo>;
        providers: Set<string>;
      }
    >();

    // Seed from canonical tournament definitions
    for (const sig of TOURNAMENT_SIGNATURES) {
      tournamentMap.set(sig.info.id, {
        id: sig.info.id,
        name: sig.info.name,
        shortName: sig.info.shortName,
        category: sig.info.category,
        sport: sig.sport,
        totalFixtures: 0,
        liveFixtures: 0,
        upcomingFixtures: 0,
        participatingTeams: new Map(),
        providers: new Set(),
      });
    }

    for (const fix of catalog) {
      if (!fix.tournament) continue;
      let entry = tournamentMap.get(fix.tournament.id);
      if (!entry) {
        entry = {
          id: fix.tournament.id,
          name: fix.tournament.name,
          shortName: fix.tournament.shortName,
          category: fix.tournament.category,
          sport: fix.sport,
          totalFixtures: 0,
          liveFixtures: 0,
          upcomingFixtures: 0,
          participatingTeams: new Map(),
          providers: new Set(),
        };
        tournamentMap.set(fix.tournament.id, entry);
      }

      entry.totalFixtures++;
      if (fix.schedule.isLive) entry.liveFixtures++;
      else if (fix.schedule.status === "upcoming") entry.upcomingFixtures++;

      if (fix.teams) {
        entry.participatingTeams.set(fix.teams.teamA.code, fix.teams.teamA);
        entry.participatingTeams.set(fix.teams.teamB.code, fix.teams.teamB);
      }
      for (const p of Object.keys(fix.providerPointers)) {
        entry.providers.add(p);
      }
    }

    let list = Array.from(tournamentMap.values()).map((t) => ({
      id: t.id,
      name: t.name,
      shortName: t.shortName,
      category: t.category,
      sport: t.sport,
      totalFixtures: t.totalFixtures,
      liveFixtures: t.liveFixtures,
      upcomingFixtures: t.upcomingFixtures,
      participatingTeamsCount: t.participatingTeams.size,
      participatingTeams: Array.from(t.participatingTeams.values()),
      providers: Array.from(t.providers),
    }));

    if (options?.activeOnly) {
      list = list.filter((t) => t.totalFixtures > 0);
    }

    if (options?.sport) {
      const s = options.sport.toLowerCase().trim();
      list = list.filter((t) => t.sport.toLowerCase() === s);
    }

    if (options?.q) {
      const q = options.q.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.shortName.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      if (b.liveFixtures !== a.liveFixtures) return b.liveFixtures - a.liveFixtures;
      if (b.totalFixtures !== a.totalFixtures) return b.totalFixtures - a.totalFixtures;
      return a.name.localeCompare(b.name);
    });

    return list;
  }

  /**
   * Returns detail for a specific tournament by ID or shortName/slug.
   */
  async getTournamentDetail(tournamentIdOrSlug: string) {
    const target = decodeURIComponent(tournamentIdOrSlug).toLowerCase().trim();
    const tournaments = await this.getTournaments();
    const found =
      tournaments.find(
        (t) =>
          t.id.toLowerCase() === target ||
          t.id.toLowerCase() === `tourn_${target}` ||
          t.shortName.toLowerCase() === target ||
          t.name.toLowerCase() === target
      ) || null;

    if (!found) return null;

    const catalog = await this.getUnifiedCatalog();
    const fixtures = catalog.filter((f) => f.tournament?.id === found.id);

    return {
      ...found,
      fixtures,
    };
  }

  /**
   * Returns all canonical and active teams with fixture statistics and aliases.
   */
  async getTeams(options?: {
    sport?: string;
    gender?: string;
    league?: string;
    q?: string;
    activeOnly?: boolean;
    limit?: number;
  }) {
    const catalog = await this.getUnifiedCatalog();
    const teamMap = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        shortName: string;
        gender: "men" | "women" | "mixed";
        ageGroup: "senior" | "u19" | "u23" | "a-team" | "emerging";
        leagueId: string | null;
        sport: string;
        aliases: Set<string>;
        totalMatches: number;
        liveMatches: number;
        upcomingMatches: number;
      }
    >();

    // Seed from canonical TEAM_ALIASES
    for (const [alias, entry] of Object.entries(TEAM_ALIASES)) {
      const existing = teamMap.get(entry.code);
      if (existing) {
        existing.aliases.add(alias);
      } else {
        const isFootballClub = [
          "RMA",
          "BAR",
          "ATM",
          "MCI",
          "MUN",
          "LIV",
          "ARS",
          "CHE",
          "TOT",
          "NEW",
          "AVL",
          "BAY",
          "BVB",
          "PSG",
          "JUV",
          "INT",
          "ACM",
        ].includes(entry.code);
        teamMap.set(entry.code, {
          id: `team_${entry.code.toLowerCase()}`,
          code: entry.code,
          name: entry.name,
          shortName: entry.code,
          gender: entry.gender || "men",
          ageGroup: entry.ageGroup || "senior",
          leagueId: entry.leagueId || null,
          sport: isFootballClub ? "football" : "cricket",
          aliases: new Set([alias, entry.code.toLowerCase(), entry.name.toLowerCase()]),
          totalMatches: 0,
          liveMatches: 0,
          upcomingMatches: 0,
        });
      }
    }

    // Enrich with active fixtures from the catalog
    for (const fix of catalog) {
      if (!fix.teams) continue;
      for (const side of [fix.teams.teamA, fix.teams.teamB]) {
        let entry = teamMap.get(side.code);
        if (!entry) {
          entry = {
            id: side.id || `team_${side.code.toLowerCase()}`,
            code: side.code,
            name: side.name,
            shortName: side.shortName || side.code,
            gender: side.gender || "men",
            ageGroup: side.ageGroup || "senior",
            leagueId: side.leagueId || fix.tournament?.id || null,
            sport: fix.sport,
            aliases: new Set([side.code.toLowerCase(), side.name.toLowerCase()]),
            totalMatches: 0,
            liveMatches: 0,
            upcomingMatches: 0,
          };
          teamMap.set(side.code, entry);
        }
        entry.totalMatches++;
        if (fix.schedule.isLive) entry.liveMatches++;
        else if (fix.schedule.status === "upcoming") entry.upcomingMatches++;
      }
    }

    let list = Array.from(teamMap.values()).map((t) => ({
      ...t,
      aliases: Array.from(t.aliases),
    }));

    if (options?.activeOnly) {
      list = list.filter((t) => t.totalMatches > 0);
    }

    if (options?.sport) {
      const s = options.sport.toLowerCase().trim();
      list = list.filter((t) => t.sport.toLowerCase() === s);
    }

    if (options?.gender) {
      const g = options.gender.toLowerCase().trim();
      list = list.filter((t) => t.gender.toLowerCase() === g);
    }

    if (options?.league) {
      const l = options.league.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.leagueId?.toLowerCase() === l ||
          t.leagueId?.toLowerCase() === `tourn_${l}`
      );
    }

    if (options?.q) {
      const q = options.q.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.code.toLowerCase() === q ||
          t.name.toLowerCase().includes(q) ||
          t.aliases.some((a) => a.includes(q))
      );
    }

    list.sort((a, b) => {
      if (b.liveMatches !== a.liveMatches) return b.liveMatches - a.liveMatches;
      if (b.totalMatches !== a.totalMatches) return b.totalMatches - a.totalMatches;
      return a.name.localeCompare(b.name);
    });

    if (options?.limit && options.limit > 0) {
      list = list.slice(0, options.limit);
    }

    return list;
  }

  /**
   * Returns detail for a single team by code, ID, or alias.
   */
  async getTeamDetail(teamCodeOrAlias: string) {
    const target = decodeURIComponent(teamCodeOrAlias).toLowerCase().trim();
    const aliasResolved = TEAM_ALIASES[target]?.code.toLowerCase();
    const teams = await this.getTeams();

    const found =
      teams.find(
        (t) =>
          t.code.toLowerCase() === target ||
          t.id.toLowerCase() === target ||
          (aliasResolved && t.code.toLowerCase() === aliasResolved) ||
          t.name.toLowerCase() === target
      ) || null;

    if (!found) return null;

    const catalog = await this.getUnifiedCatalog();
    const fixtures = catalog.filter(
      (f) =>
        f.teams &&
        (f.teams.teamA.code.toLowerCase() === found.code.toLowerCase() ||
          f.teams.teamB.code.toLowerCase() === found.code.toLowerCase())
    );

    return {
      ...found,
      fixtures,
    };
  }

  /**
   * Returns detailed information and resolved streams for a single channel ID.
   */
  async getChannelDetail(channelId: string, proxyBaseUrl = "http://localhost:3000/api/proxy") {
    const target = decodeURIComponent(channelId).trim();
    const channels = await this.getChannels();
    const channel = channels.find((c) => c.id === target) || null;
    if (!channel) return null;

    const resolvedSources = await this.resolveSourceList(channel.sources);
    const feeds = buildRichStreamFeeds(resolvedSources, proxyBaseUrl);

    return {
      ...channel,
      sources: resolvedSources,
      feeds,
    };
  }

  /**
   * Returns aggregated broadcasters across all catalog fixtures and live channels.
   */
  async getBroadcasters() {
    const [catalog, channels] = await Promise.all([
      this.getUnifiedCatalog(),
      this.getChannels(),
    ]);

    const broadcasterMap = new Map<
      string,
      {
        id: string;
        name: string;
        fixturesCount: number;
        liveFixturesCount: number;
        channelsCount: number;
        sports: Set<string>;
        languages: Set<string>;
      }
    >();

    const ensureEntry = (name: string) => {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      let entry = broadcasterMap.get(slug);
      if (!entry) {
        entry = {
          id: `bc_${slug}`,
          name,
          fixturesCount: 0,
          liveFixturesCount: 0,
          channelsCount: 0,
          sports: new Set(),
          languages: new Set(),
        };
        broadcasterMap.set(slug, entry);
      }
      return entry;
    };

    for (const fix of catalog) {
      for (const bcName of fix.streamMetadata.primaryBroadcasters) {
        const entry = ensureEntry(bcName);
        entry.fixturesCount++;
        if (fix.schedule.isLive) entry.liveFixturesCount++;
        entry.sports.add(fix.sport);
        for (const lang of fix.streamMetadata.availableLanguages) {
          entry.languages.add(lang);
        }
      }
    }

    for (const ch of channels) {
      const bcName = detectBroadcaster(ch.name, ch.sources[0]?.streamUrl || "");
      const entry = ensureEntry(bcName);
      entry.channelsCount++;
      const lang = detectLanguage(ch.name).code;
      entry.languages.add(lang);
    }

    return Array.from(broadcasterMap.values())
      .map((b) => ({
        id: b.id,
        name: b.name,
        fixturesCount: b.fixturesCount,
        liveFixturesCount: b.liveFixturesCount,
        channelsCount: b.channelsCount,
        sports: Array.from(b.sports),
        languages: Array.from(b.languages),
      }))
      .sort((a, b) => b.fixturesCount + b.channelsCount - (a.fixturesCount + a.channelsCount));
  }

  /**
   * Returns enriched provider statuses including live fixture and channel counts.
   */
  async getProvidersEnriched() {
    const [catalog, channels] = await Promise.all([
      this.getUnifiedCatalog(),
      this.getChannels(),
    ]);

    return this.getProviders().map((p) => {
      const providerFixtures = catalog.filter((f) => Boolean(f.providerPointers[p.id]));
      const liveFixtures = providerFixtures.filter((f) => f.schedule.isLive);
      const providerChannels = channels.filter((c) =>
        c.sources.some((s) => s.provider === p.id) || c.id.startsWith(`${p.id}_`)
      );

      return {
        ...p,
        stats: {
          totalFixtures: providerFixtures.length,
          liveFixtures: liveFixtures.length,
          totalChannels: providerChannels.length,
        },
      };
    });
  }

  /**
   * Returns complete details for a single provider by ID (`cricify`, `sportzx`, `playztv`, `playfy`, `sktech`, `livxow`).
   */
  async getProviderDetail(providerId: string) {
    const target = providerId.toLowerCase().trim();
    const enriched = await this.getProvidersEnriched();
    const prov = enriched.find((p) => p.id.toLowerCase() === target) || null;
    if (!prov) return null;

    const [catalog, channels] = await Promise.all([
      this.getUnifiedCatalog({ provider: target }),
      this.getChannels(),
    ]);

    const providerChannels = channels.filter(
      (c) => c.sources.some((s) => s.provider === target) || c.id.startsWith(`${target}_`)
    );

    return {
      ...prov,
      fixtures: catalog,
      channels: providerChannels.slice(0, 100),
    };
  }

  /**
   * Unified cross-entity search across matches, tournaments, teams, and channels.
   */
  async searchAll(query: string, limit = 20) {
    const q = query.trim();
    if (!q) {
      return {
        query: "",
        totalResults: 0,
        matches: [],
        tournaments: [],
        teams: [],
        channels: [],
      };
    }

    const lower = q.toLowerCase();
    const [matches, tournaments, teams, allChannels] = await Promise.all([
      this. getUnifiedCatalog({ search: q, limit }),
      this.getTournaments({ q }),
      this.getTeams({ q, limit }),
      this.getChannels(),
    ]);

    const channels = allChannels
      .filter(
        (c) =>
          c.name.toLowerCase().includes(lower) ||
          c.category.toLowerCase().includes(lower) ||
          (c.group && c.group.toLowerCase().includes(lower))
      )
      .slice(0, limit);

    return {
      query: q,
      totalResults:
        matches.length +
        tournaments.slice(0, limit).length +
        teams.length +
        channels.length,
      matches,
      tournaments: tournaments.slice(0, limit),
      teams,
      channels,
    };
  }

  /**
   * Returns comprehensive platform statistics across all sports, phases, providers, protocols, and caches.
   */
  async getPlatformStats() {
    const [catalog, sports, tournaments, channels, providers] = await Promise.all([
      this.getUnifiedCatalog(),
      this.getSports(),
      this.getTournaments({ activeOnly: true }),
      this.getChannels(),
      this.getProvidersEnriched(),
    ]);

    const liveFixtures = catalog.filter((f) => f.schedule.isLive).length;
    const upcomingFixtures = catalog.filter((f) => f.schedule.status === "upcoming").length;
    const endedFixtures = catalog.filter((f) => f.schedule.status === "ended").length;
    const headToHeadMatches = catalog.filter((f) => f.kind === "match").length;
    const tournamentBroadcasts = catalog.filter((f) => f.kind === "tournament_channel").length;
    const drmProtectedFixtures = catalog.filter((f) => f.streamMetadata.hasDrmFeeds).length;
    const multiProviderFixtures = catalog.filter(
      (f) => Object.keys(f.providerPointers).length > 1
    ).length;
    const totalWorkingFeeds = catalog.reduce(
      (sum, f) => sum + (f.streamMetadata.totalWorkingFeeds || 0),
      0
    );

    return {
      overview: {
        totalFixtures: catalog.length,
        liveFixtures,
        upcomingFixtures,
        endedFixtures,
        headToHeadMatches,
        tournamentBroadcasts,
        multiProviderFixtures,
        drmProtectedFixtures,
        totalWorkingFeeds,
        totalChannels: channels.length,
        activeSports: sports.length,
        activeTournaments: tournaments.length,
        providersOnline: providers.filter((p) => p.circuitState !== "OPEN").length,
        providersTotal: providers.length,
      },
      bySport: sports,
      byProvider: providers.map((p) => ({
        id: p.id,
        name: p.name,
        circuitState: p.circuitState,
        trustScore: (p as any).trustScore || PROVIDER_TRUST_RANK[p.id]?.score || 85,
        liveFixtures: p.stats.liveFixtures,
        totalFixtures: p.stats.totalFixtures,
        totalChannels: p.stats.totalChannels,
      })),
      caches: this.getCacheStats(),
      system: {
        uptimeSeconds: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Resolves all custom provider scheme URLs (`playztv://`, `livxow://`, `sktech://`) into real HTTP manifests
   */
  private async resolveSourceList(sources: StreamSource[]): Promise<StreamSource[]> {
    const resolvedList = await Promise.all(
      sources.map(async (s) => {
        if (s.streamUrl.startsWith("playztv://")) {
          const playztv = this.providers.get("playztv") as PlayZTVProvider | undefined;
          if (playztv) {
            return this.resolvedStreamCache.getOrFetch(s.streamUrl, () =>
              playztv.resolveAllStreams(s.streamUrl)
            );
          }
        } else if (s.streamUrl.startsWith("livxow://")) {
          const livxow = this.providers.get("livxow") as LivXowProvider | undefined;
          if (livxow) {
            return this.resolvedStreamCache.getOrFetch(s.streamUrl, () =>
              livxow.resolveAllStreams(s.streamUrl)
            );
          }
        } else if (s.streamUrl.startsWith("sktech://")) {
          const sktech = this.providers.get("sktech") as SKTechProvider | undefined;
          if (sktech) {
            return this.resolvedStreamCache.getOrFetch(s.streamUrl, () =>
              sktech.resolveAllStreams(s.streamUrl)
            );
          }
        }
        return [s];
      })
    );

    return resolvedList.flat();
  }

  /**
   * Resolves a custom provider URI (`playztv://...`, `livxow://...`, `sktech://...`) directly into its primary StreamSource.
   */
  async resolveCustomUri(uri: string): Promise<StreamSource | null> {
    const list = await this.resolveSourceList([
      {
        provider: uri.split("://")[0] || "unknown",
        quality: "1080p",
        format: "HLS",
        streamUrl: uri,
        status: "ONLINE",
      },
    ]);
    return list[0] || null;
  }

  /**
   * Resolves rich stream feeds with provenance, attribution badges, ClearKey DRM, and renditions for a fixtureKey or fixtureId.
   */
  async getFixtureFeeds(
    fixtureKeyOrId: string,
    proxyBaseUrl = "http://localhost:3000/api/proxy",
    options?: {
      shouldProbe?: boolean;
      protocol?: "dash" | "hls";
      quality?: string;
      language?: string;
      provider?: string;
    }
  ): Promise<{
    fixture: NormalizedCatalogFixture | null;
    feeds: RichStreamFeed[];
  }> {
    const cacheKey = `feeds::${fixtureKeyOrId}::${proxyBaseUrl}`;
    const baseData = await this.fixtureFeedsCache.getOrFetch(
      cacheKey,
      async () => {
        const [rawEvents, catalog] = await Promise.all([
          this.fetchAllRawProviderEvents(),
          this.getUnifiedCatalog(),
        ]);

        const fixture =
          catalog.find(
            (f) => f.canonicalKey === fixtureKeyOrId || f.fixtureId === fixtureKeyOrId
          ) || null;

        if (!fixture) {
          const directEvent = rawEvents.find((e) => e.id === fixtureKeyOrId);
          if (!directEvent) {
            return { fixture: null, feeds: [] };
          }
          const resolvedSources = await this.resolveSourceList(directEvent.sources);
          const feeds = buildRichStreamFeeds(resolvedSources, proxyBaseUrl);
          return { fixture: null, feeds };
        }

        const pointerEventIds = new Set(Object.values(fixture.providerPointers));
        const rawSources: StreamSource[] = [];

        for (const ev of rawEvents) {
          if (pointerEventIds.has(ev.id)) {
            rawSources.push(...ev.sources);
            continue;
          }
          const sport = detectSport(ev.category, ev.title);
          const parsed = parseEventEntities(ev.title, ev.competition);
          const key = generateCanonicalKey(sport, parsed, ev.startTime);
          if (key === fixture.canonicalKey) {
            rawSources.push(...ev.sources);
          }
        }

        const resolvedSources = await this.resolveSourceList(rawSources);
        const feeds = buildRichStreamFeeds(resolvedSources, proxyBaseUrl);

        // Attach automatic backup mirror URL into edgeProxyFallbackUrl for instant proxy failover
        if (feeds.length >= 2) {
          for (let i = 0; i < feeds.length; i++) {
            const backupFeed = feeds[(i + 1) % feeds.length];
            if (backupFeed && backupFeed.network.masterPlaylistUrl) {
              const fbParam = `&fallback=${encodeURIComponent(
                backupFeed.network.masterPlaylistUrl
              )}`;
              feeds[i] = {
                ...feeds[i],
                network: {
                  ...feeds[i].network,
                  edgeProxyFallbackUrl: `${feeds[i].network.edgeProxyFallbackUrl}${fbParam}`,
                },
              };
            }
          }
        }

        return { fixture, feeds };
      },
      120000
    );

    let feeds = [...baseData.feeds];

    if (options?.shouldProbe && feeds.length > 0) {
      feeds = await streamProber.probeFeedsBatch(feeds);
    }

    if (options?.protocol && (options.protocol === "dash" || options.protocol === "hls")) {
      feeds = feeds.filter((f) => f.protocol === options.protocol);
    }

    if (options?.language) {
      const langTarget = options.language.toLowerCase();
      feeds = feeds.filter(
        (f) =>
          f.language.code.toLowerCase() === langTarget ||
          f.language.name.toLowerCase().includes(langTarget)
      );
    }

    if (options?.provider) {
      const provTarget = options.provider.toLowerCase();
      feeds = feeds.filter(
        (f) =>
          f.provenance.primaryProvider.toLowerCase() === provTarget ||
          f.provenance.mirroredProviders.some((m) => m.toLowerCase() === provTarget)
      );
    }

    if (options?.quality) {
      const qTarget = options.quality.toLowerCase();
      feeds = feeds.map((f) => ({
        ...f,
        renditions: f.renditions.filter((r) => r.qualityTag.toLowerCase() === qTarget),
      }));
    }

    return {
      fixture: baseData.fixture,
      feeds,
    };
  }

  /**
   * Generates a complete IPTV M3U8 playlist across all live fixtures & channels,
   * including `#KODIPROP` ClearKey DRM directives for OTT Navigator, TiviMate, and Kodi.
   */
  async generateM3uPlaylist(
    proxyBaseUrl: string,
    options?: { sport?: string }
  ): Promise<string> {
    const cacheKey = `m3u_playlist_${proxyBaseUrl}_${options?.sport || "all"}`;
    return this.m3uCache.getOrFetch(
      cacheKey,
      async () => {
        const catalog = await this.getUnifiedCatalog({ sport: options?.sport });
        const lines: string[] = [
          '#EXTM3U url-tvg="" x-tvg-url=""',
          "#PLAYLIST:Sportify Live Sports & Streams Gateway",
        ];

        const activeFixtures = catalog.slice(0, 60);
        const feedResults = await Promise.all(
          activeFixtures.map((fix) =>
            this.getFixtureFeeds(fix.canonicalKey, proxyBaseUrl).catch(() => ({
              fixture: fix,
              feeds: [] as RichStreamFeed[],
            }))
          )
        );

        for (let i = 0; i < activeFixtures.length; i++) {
          const fix = activeFixtures[i];
          const { feeds } = feedResults[i];
          if (feeds.length === 0) continue;

          const primaryFeed = feeds[0];
          const groupTitle = `${fix.sport.toUpperCase()} - ${
            fix.schedule.isLive ? "LIVE" : "UPCOMING"
          }`;
          const logo = fix.posterUrl || "";
          const displayName = `${fix.title} [${primaryFeed.language.badge}] (${primaryFeed.provenance.primaryProvider})`;

          lines.push(
            `#EXTINF:-1 tvg-id="${fix.fixtureId}" tvg-name="${fix.title.replace(
              /"/g,
              ""
            )}" tvg-logo="${logo}" group-title="${groupTitle}",${displayName}`
          );

          if (primaryFeed.drm && primaryFeed.drm.clearKeys && primaryFeed.drm.clearKeys.length > 0) {
            const ck = primaryFeed.drm.clearKeys[0];
            lines.push("#KODIPROP:inputstream.adaptive.manifest_type=mpd");
            lines.push("#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey");
            lines.push(`#KODIPROP:inputstream.adaptive.license_key=${ck.kid}:${ck.key}`);
          }

          if (primaryFeed.network.headers) {
            const ua =
              primaryFeed.network.headers["User-Agent"] ||
              primaryFeed.network.headers["user-agent"];
            const ref =
              primaryFeed.network.headers["Referer"] ||
              primaryFeed.network.headers["referer"];
            if (ua) lines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
            if (ref) lines.push(`#EXTVLCOPT:http-referrer=${ref}`);
          }

          if (primaryFeed.protocol === "hls") {
            lines.push(primaryFeed.network.edgeProxyFallbackUrl);
          } else {
            lines.push(primaryFeed.network.masterPlaylistUrl);
          }
        }

        return lines.join("\n") + "\n";
      },
      60000
    );
  }

  /**
   * Fetches live sports events concurrently across all enabled providers.
   */
  async getEvents(category?: string): Promise<LiveEvent[]> {
    const allEvents = await this.eventsCache.getOrFetch(
      "all_events",
      async () => {
        const rawEvents = await this.fetchAllRawProviderEvents();
        if (rawEvents.length === 0) {
          const stale = this.eventsCache.getStale("all_events");
          if (stale) return stale;
        }
        return mergeAndDeduplicateEvents(rawEvents);
      },
      60000
    );

    if (category) {
      const lower = category.toLowerCase();
      return allEvents.filter((e) => e.category.toLowerCase().includes(lower));
    }

    return allEvents;
  }

  /**
   * Fetches all live TV channels concurrently across all enabled providers.
   */
  async getChannels(category?: string): Promise<Channel[]> {
    const allChannels = await this.channelsCache.getOrFetch(
      "all_channels",
      async () => {
        const activeProviders = Array.from(this.providers.values()).filter(
          (p) => p.metadata.enabled
        );

        const results = await Promise.allSettled(
          activeProviders.map((provider) => provider.fetchChannels())
        );

        const combined: Channel[] = [];
        for (const res of results) {
          if (res.status === "fulfilled" && Array.isArray(res.value)) {
            combined.push(...res.value);
          }
        }

        if (combined.length === 0) {
          const stale = this.channelsCache.getStale("all_channels");
          if (stale) return stale;
        }

        return combined;
      }
    );

    if (category) {
      const lower = category.toLowerCase();
      return allChannels.filter(
        (c) =>
          c.category.toLowerCase().includes(lower) ||
          (c.group && c.group.toLowerCase().includes(lower))
      );
    }

    return allChannels;
  }

  /**
   * Returns high-priority marquee & trending matches (upstream isHot, finals, rivalries, or multi-provider consensus).
   */
  async getHotMatches(options?: { sport?: string; limit?: number }): Promise<NormalizedCatalogFixture[]> {
    const catalog = await this.getUnifiedCatalog();
    const index = this.getCatalogIndex(catalog);
    let list = [...index.hotMatches];

    // If no fixtures were explicitly marked hot, promote the highest-coverage live matches
    if (list.length === 0) {
      list = [...catalog].filter((f) => f.schedule.isLive);
    }

    if (options?.sport) {
      const s = options.sport.toLowerCase().trim();
      list = list.filter((f) => f.sport.toLowerCase() === s);
    }

    list.sort((a, b) => {
      if (a.schedule.isLive !== b.schedule.isLive) return a.schedule.isLive ? -1 : 1;
      const provA = Object.keys(a.providerPointers).length;
      const provB = Object.keys(b.providerPointers).length;
      if (provB !== provA) return provB - provA;
      return b.streamMetadata.totalWorkingFeeds - a.streamMetadata.totalWorkingFeeds;
    });

    const limit = Math.min(100, Math.max(1, options?.limit || 25));
    return list.slice(0, limit);
  }

  /**
   * Returns a chronological Electronic Program Guide (EPG) & timeline schedule across all sports.
   */
  async getSchedule(options?: { sport?: string; date?: string }) {
    const catalog = await this.getUnifiedCatalog({ sport: options?.sport });
    const nowMs = Date.now();
    const sixHoursMs = 6 * 3600 * 1000;

    const liveNow: NormalizedCatalogFixture[] = [];
    const startingSoon: NormalizedCatalogFixture[] = [];
    const upcomingByDate: Record<string, NormalizedCatalogFixture[]> = {};
    const recentlyEnded: NormalizedCatalogFixture[] = [];

    for (const fix of catalog) {
      const dateKey = fix.schedule.startTimeUtc
        ? fix.schedule.startTimeUtc.slice(0, 10)
        : fix.canonicalKey.split("::")[2]?.slice(0, 10) || new Date().toISOString().slice(0, 10);

      if (options?.date && dateKey !== options.date.trim()) {
        continue;
      }

      if (fix.schedule.isLive || fix.schedule.status === "live") {
        liveNow.push(fix);
      } else if (fix.schedule.status === "upcoming") {
        const startMs = fix.schedule.startTimeUtc ? Date.parse(fix.schedule.startTimeUtc) : NaN;
        if (!Number.isNaN(startMs) && startMs >= nowMs && startMs - nowMs <= sixHoursMs) {
          startingSoon.push(fix);
        }
        if (!upcomingByDate[dateKey]) {
          upcomingByDate[dateKey] = [];
        }
        upcomingByDate[dateKey].push(fix);
      } else {
        recentlyEnded.push(fix);
      }
    }

    liveNow.sort((a, b) => b.streamMetadata.totalWorkingFeeds - a.streamMetadata.totalWorkingFeeds);
    startingSoon.sort((a, b) =>
      (a.schedule.startTimeUtc || "").localeCompare(b.schedule.startTimeUtc || "")
    );

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        liveNowCount: liveNow.length,
        startingSoonCount: startingSoon.length,
        upcomingCount: Object.values(upcomingByDate).reduce((acc, arr) => acc + arr.length, 0),
        recentlyEndedCount: recentlyEnded.length,
        totalScheduled:
          liveNow.length +
          Object.values(upcomingByDate).reduce((acc, arr) => acc + arr.length, 0) +
          recentlyEnded.length,
      },
      liveNow,
      startingSoon,
      upcomingByDate,
      recentlyEnded,
    };
  }

  /**
   * Generates a standard XMLTV (`epg.xml`) Electronic Program Guide matching the `tvg-id`s in `/api/playlist.m3u`.
   */
  async generateXmltvEpg(options?: { sport?: string }): Promise<string> {
    const catalog = await this.getUnifiedCatalog({ sport: options?.sport });
    const escapeXml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const formatXmltvTime = (isoStr?: string | null, fallbackOffsetHours = 0): string => {
      const d = isoStr ? new Date(isoStr) : new Date(Date.now() + fallbackOffsetHours * 3600 * 1000);
      const validDate = Number.isNaN(d.getTime())
        ? new Date(Date.now() + fallbackOffsetHours * 3600 * 1000)
        : d;
      const pad = (n: number) => String(n).padStart(2, "0");
      return (
        `${validDate.getUTCFullYear()}${pad(validDate.getUTCMonth() + 1)}${pad(validDate.getUTCDate())}` +
        `${pad(validDate.getUTCHours())}${pad(validDate.getUTCMinutes())}${pad(validDate.getUTCSeconds())} +0000`
      );
    };

    const lines: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
      '<tv generator-info-name="Sportify EPG Engine v1.1.0" generator-info-url="https://sportify.api">',
    ];

    for (const fix of catalog) {
      lines.push(`  <channel id="${escapeXml(fix.fixtureId)}">`);
      lines.push(`    <display-name>${escapeXml(fix.title)}</display-name>`);
      if (fix.posterUrl) {
        lines.push(`    <icon src="${escapeXml(fix.posterUrl)}" />`);
      }
      lines.push(`  </channel>`);
    }

    for (const fix of catalog) {
      const startXml = formatXmltvTime(fix.schedule.startTimeUtc, -1);
      const stopXml = formatXmltvTime(fix.schedule.endTimeUtc, 3);
      const descParts = [
        fix.tournament?.name ? `Tournament: ${fix.tournament.name}` : "",
        fix.matchFormat ? `Format: ${fix.matchFormat}` : "",
        `Status: ${fix.schedule.status.toUpperCase()}`,
        `Feeds: ${fix.streamMetadata.totalWorkingFeeds}`,
        `Broadcasters: ${fix.streamMetadata.primaryBroadcasters.join(", ") || "Live Sports"}`,
      ].filter(Boolean);

      lines.push(
        `  <programme start="${startXml}" stop="${stopXml}" channel="${escapeXml(fix.fixtureId)}">`
      );
      lines.push(`    <title lang="en">${escapeXml(fix.title)}</title>`);
      lines.push(`    <desc lang="en">${escapeXml(descParts.join(" | "))}</desc>`);
      lines.push(`    <category lang="en">${escapeXml(fix.sport.toUpperCase())}</category>`);
      if (fix.tournament?.shortName) {
        lines.push(`    <sub-title lang="en">${escapeXml(fix.tournament.shortName)}</sub-title>`);
      }
      lines.push(`  </programme>`);
    }

    lines.push("</tv>");
    return lines.join("\n") + "\n";
  }

  /**
   * Returns aggregated channel categories with channel counts, HD counts, and contributing providers.
   */
  async getChannelCategories() {
    const channels = await this.getChannels();
    const catMap = new Map<
      string,
      {
        id: string;
        category: string;
        channelsCount: number;
        hdCount: number;
        providers: Set<string>;
      }
    >();

    for (const ch of channels) {
      const rawCat = (ch.group || ch.category || "Live TV").trim();
      const slug = rawCat.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "live-tv";
      let entry = catMap.get(slug);
      if (!entry) {
        entry = {
          id: `cat_${slug}`,
          category: rawCat,
          channelsCount: 0,
          hdCount: 0,
          providers: new Set(),
        };
        catMap.set(slug, entry);
      }
      entry.channelsCount++;
      if (/\b(hd|fhd|uhd|4k|1080p|720p)\b/i.test(`${ch.name} ${ch.resolution || ""}`)) {
        entry.hdCount++;
      }
      for (const s of ch.sources) {
        entry.providers.add(s.provider);
      }
    }

    return Array.from(catMap.values())
      .map((c) => ({
        id: c.id,
        category: c.category,
        channelsCount: c.channelsCount,
        hdCount: c.hdCount,
        providers: Array.from(c.providers),
      }))
      .sort((a, b) => b.channelsCount - a.channelsCount);
  }

  /**
   * Deeply inspects an HLS or DASH manifest URL on demand, returning real parsed renditions,
   * audio tracks, ClearKey KIDs, and edge latency.
   */
  async inspectStream(url: string, headers?: Record<string, string>): Promise<ProbeResult> {
    return streamProber.inspectManifest(url, headers);
  }

  /**
   * Resolves a single event or channel ID into a playable StreamSource.
   */
  async resolveStream(id: string): Promise<StreamSource | null> {
    const events = await this.getEvents();
    const matchedEvent = events.find((e) => e.id === id);

    if (matchedEvent && matchedEvent.sources.length > 0) {
      const resolved = await this.resolveSourceList(matchedEvent.sources);
      if (resolved.length > 0) {
        matchedEvent.sources = resolved;
        return resolved[0];
      }
    }

    const channels = await this.getChannels();
    const matchedChannel = channels.find((c) => c.id === id);
    if (matchedChannel && matchedChannel.sources.length > 0) {
      const resolved = await this.resolveSourceList(matchedChannel.sources);
      if (resolved.length > 0) {
        matchedChannel.sources = resolved;
        return resolved[0];
      }
    }

    const prefix = id.split("_")[0];
    const provider = this.providers.get(prefix);
    if (provider) {
      try {
        return await provider.resolveStream(id);
      } catch {
        return null;
      }
    }

    return null;
  }
}

export const aggregatorService = new AggregatorService();
