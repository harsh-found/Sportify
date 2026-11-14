# Changelog

All notable engineering changes to the **Sportify Live Sports & Stream Aggregation API** are documented in this file.

## [1.1.0] — Build Beyond Limits Release

### Added
- **New High-Value `v1.1.0` Endpoints**:
  - `GET /api/matches/hot` (and `?hot=true` filter on `/api/matches`): Returns high-demand marquee matches ranked by upstream priority, `isHot` flags, tournament stage (Finals/Semi-Finals), multi-provider coverage, and live status.
  - `GET /api/schedule` & `GET /api/epg`: Chronological Electronic Program Guide grouped into `liveNow`, `startingSoon`, `upcomingByDate`, and `recentlyEnded`.
  - `GET /api/epg.xml` & `GET /epg.xml`: Standards-compliant XMLTV Electronic Program Guide matching `tvg-id` identifiers in `/api/playlist.m3u` for TiviMate, OTT Navigator, and Kodi.
  - `GET /api/channels/categories`: Aggregated channel categories with total channel counts, HD channel counts, and contributing provider attribution.
  - `GET /api/streams/inspect?url=...`: On-demand HLS Master/Media and DASH MPD manifest inspector returning real video renditions, audio tracks, ClearKey KIDs, and edge latency.
- **Real HLS & DASH Manifest Parsing (`parseManifestContent` & `inspectManifest`)**:
  - Parses `#EXT-X-STREAM-INF` (bandwidth, resolution, frame-rate, codecs), `#EXT-X-MEDIA:TYPE=AUDIO` tracks, and `#EXT-X-KEY` ClearKey KIDs from HLS playlists.
  - Parses `<Representation>` video variants, `<AdaptationSet>` audio tracks, and `cenc:default_KID` attributes from DASH MPD XML manifests.
  - Automatically replaces synthetic renditions with real manifest renditions when `?probe=true` is passed to `/api/stream/:fixtureKey`.
- **Provider Extraction Enhancements Across All 6 CS3 Adapters**:
  - Extracts `teamAFlag`, `teamBFlag`, `eventBanner`, `eventType`, `isHot`, `priority`, and multi-bitrate `formatHints` (`formatsNew`, `formats`, `link_names`) across `Cricify`, `Sportzx`, `PlayZTV`, `PlayFy`, `SKTech`, and `LivXow`.
  - Synthesizes dynamic Match Card poster URLs (`generateMatchCardUrl` from `LiveEventsProvider.kt`) when upstream events omit an explicit poster or banner URL.
  - Added dual date parser in `SportzxProvider` supporting both `"yyyy/MM/dd HH:mm:ss Z"` and Unix epoch timestamps (`LiveEventsProvider.kt`).
- **O(1) Memoized `CatalogIndex` & Weighted Typo-Tolerant Search (`scoreSearchQuery`)**:
  - Pre-computes `byFixtureId`, `byCanonicalKey`, `byProviderPointer`, `bySport`, `byPhase`, `byTournamentId`, `byTeamCode`, `byProvider`, and `hotMatches` secondary indexes on catalog updates.
  - Added `scoreSearchQuery` with exact (`100`), prefix (`88`), multi-token AND (`78`), substring (`76`/`62`), and 1-edit-distance Levenshtein typo tolerance (`48`).
  - Expanded `TOURNAMENT_SIGNATURES` to cover The Hundred, Vitality Blast, Super Smash, Major League Cricket (MLC), Ligue 1, Saudi Pro League, MLS, NBA, NHL, and Grand Slam Tennis (Wimbledon, Roland Garros, Australian Open, US Open).
- **Stale-While-Revalidate (SWR) Cache & HTTP `ETag` (`304 Not Modified`)**:
  - Upgraded `StreamCache<T>` with `defaultSwrMs`, `staleServed`, `coalescedRequests`, `hitRate`, and deterministic weak `ETag` (`W/"..."`) support (`If-None-Match` -> `304 Not Modified`).

---

## [1.0.0] — Initial Public Release

### Added
- **Comprehensive Resource-Oriented REST API Architecture**:
  - **Sports**: `GET /api/sports` and `GET /api/sports/:sport` returning sport-level fixture counts, active tournaments, participating teams, and contributing providers.
  - **Matches & Events**: `GET /api/matches` (and `/api/events`), `GET /api/matches/live`, `GET /api/matches/upcoming`, and `GET /api/matches/:matchId` supporting filtering by `sport`, `phase`, `tournament`, `team`, `provider`, `language`, `drm`, `q`, `sort`, `page`, and `limit`.
  - **Tournaments & Competitions**: `GET /api/tournaments` (and `/api/competitions`) and `GET /api/tournaments/:tournamentId` with participating team rosters and live/upcoming fixture breakdowns.
  - **Teams**: `GET /api/teams` and `GET /api/teams/:teamCode` exposing canonical team codes, known aliases (including `IN` -> `IND`), `gender`, `ageGroup`, `leagueId`, and team fixtures.
  - **Channels & Broadcasters**: `GET /api/channels`, `GET /api/channels/:channelId`, and `GET /api/broadcasters` aggregating 24/7 sports channels and broadcast networks.
  - **Providers**: `GET /api/providers` and `GET /api/providers/:providerId` exposing Firebase project metadata, cryptographic algorithms, 3-state circuit breaker health, and live fixture/channel counts.
  - **Unified Search & Platform Statistics**: `GET /api/search?q=...` and `GET /api/stats`.
- **Developer Documentation Portal (`/docs` & `public/docs.html`)**:
  - Interactive developer documentation portal featuring a live API Request Console, searchable endpoint catalog, 6-provider cryptographic matrix, JSON schema viewer, client SDK snippets, and embedded OpenAPI 3.1.0 inspector.
- **Advanced Event Intelligence & Franchise-to-Tournament Inference**:
  - Automatic inference of parent tournaments (`WBBL`, `BBL`, `IPL`, `WPL`, `PSL`, `SA20`) when upstream titles contain only participating franchise names.
  - Strict disambiguation across Men's (`IND`), Women's (`INDW`), Under-19 (`INDU19`), A-Teams (`INDA`), and ordinal match numbers (`1st ODI` vs `2nd ODI`).
- **Lossless Cross-Provider Stream Deduplication**:
  - Implemented `normalizeStreamUrlForDedup()` to strip ephemeral cache-buster query tokens while preserving signed stream tokens and merging ClearKey DRM (`kid:key`) and HTTP headers across all contributing providers.
