import { describe, expect, test } from "bun:test";
import {
  parseEventEntities,
  detectSport,
  buildUnifiedCatalog,
  isGenericOrNoiseTournamentName,
  cleanDynamicTournamentName,
  buildTournamentShortName,
  buildDynamicTournamentInfo,
} from "../src/catalog/normalizer";
import { SportzxProvider } from "../src/providers/sportzx.provider";
import type { LiveEvent } from "../src/core/types";

describe("Sportify v1.2.0 Entity Intelligence, Tournament Hygiene & Bytecode Crypto", () => {
  test("isGenericOrNoiseTournamentName filters generic sport/category names while keeping real competitions", () => {
    expect(isGenericOrNoiseTournamentName("Cricket")).toBe(true);
    expect(isGenericOrNoiseTournamentName("Football")).toBe(true);
    expect(isGenericOrNoiseTournamentName("Boxing")).toBe(true);
    expect(isGenericOrNoiseTournamentName("Motorsports")).toBe(true);
    expect(isGenericOrNoiseTournamentName("Live Events")).toBe(true);
    expect(isGenericOrNoiseTournamentName("2nd Semi-final")).toBe(true);

    expect(isGenericOrNoiseTournamentName("UEFA Nations League")).toBe(false);
    expect(isGenericOrNoiseTournamentName("SAFF Championship")).toBe(false);
    expect(isGenericOrNoiseTournamentName("Nepal Premier League")).toBe(false);
    expect(buildDynamicTournamentInfo("Cricket")).toBeNull();
    expect(buildDynamicTournamentInfo("Boxing")).toBeNull();
  });

  test("cleanDynamicTournamentName strips stage suffixes and buildTournamentShortName preserves whole words", () => {
    expect(cleanDynamicTournamentName("SAFF Women's Championship | 2nd Semi-final")).toBe(
      "SAFF Women's Championship"
    );
    expect(buildTournamentShortName("UEFA Nations League")).toBe("UEFA Nations League");
    expect(buildTournamentShortName("Nepal Premier League")).toBe("Nepal Premier League");
    expect(buildTournamentShortName("World Championship Boxing Heavyweight Title")).toBe(
      "World Championship"
    );
  });

  test("parseEventEntities & detectSport classify SAFF Championship (Bangladesh vs Pakistan) as football, not cricket", () => {
    const title = "SAFF Championship | 2nd Semi-final (Bangladesh vs Pakistan)";
    const sport = detectSport("Football", title);
    const parsed = parseEventEntities(title, "SAFF Championship | 2nd Semi-final");
    expect(sport).toBe("football");
    expect(parsed.tournament?.id).toBe("tourn_saff");
    expect(parsed.tournament?.name).toBe("SAFF Championship");
    expect(parsed.teams?.teamA.code).toBe("BAN");
    expect(parsed.teams?.teamB.code).toBe("PAK");
  });

  test("parseEventEntities never creates a fake tournament when rawCompetition is a generic sport name", () => {
    const parsed = parseEventEntities("Jake Paul vs Mike Tyson", "Boxing");
    const sport = detectSport("Boxing", "Jake Paul vs Mike Tyson");
    expect(sport).toBe("mma");
    expect(parsed.tournament).toBeNull();
  });

  test("buildUnifiedCatalog enriches availableLanguages and primaryBroadcasters from formatHints and excludes deferred pointers from rawUrls", () => {
    const mockEvents: LiveEvent[] = [
      {
        id: "playztv_nz_ind",
        title: "One Day International (New Zealand vs India)",
        category: "Cricket",
        competition: "One Day International",
        startTime: new Date().toISOString(),
        status: "LIVE",
        formatHints: [
          { title: "PRIME VIDEO - AQ" },
          { title: "PRIME HINDI - AQ" },
          { title: "WILLOW - AQ" },
        ],
        sources: [
          {
            provider: "playztv",
            quality: "1080p",
            format: "HLS",
            streamUrl: "playztv://aHR0cHM6Ly9leGFtcGxlLmNvbS9wcm8vMTIzLnR4dA==",
            status: "ONLINE",
          },
        ],
      },
    ];

    const catalog = buildUnifiedCatalog(mockEvents);
    expect(catalog.length).toBe(1);
    const fix = catalog[0];
    expect(fix.streamMetadata.totalWorkingFeeds).toBe(3);
    expect(fix.streamMetadata.availableLanguages).toContain("hin");
    expect(fix.streamMetadata.primaryBroadcasters).toContain("Prime Video Live");
    expect(fix.streamMetadata.primaryBroadcasters).toContain("Willow TV");
    expect(fix.streamMetadata.primaryBroadcasters).not.toContain("Direct Sports Feed");
  });

  test("SportzxProvider.resolveAllStreams handles direct HTTP URLs and deferred scheme pointers gracefully", async () => {
    const provider = new SportzxProvider();
    const direct = await provider.resolveAllStreams("https://cdn.example.com/live/master.m3u8");
    expect(direct.length).toBe(1);
    expect(direct[0].provider).toBe("sportzx");
    expect(direct[0].streamUrl).toBe("https://cdn.example.com/live/master.m3u8");
  });
});
