# Changelog

All notable engineering changes to the **Sportify Live Sports & Stream Aggregation API** are documented in this file.

## [1.3.0] — Build The Best Sports Streaming API Release

### Added & Improved
- **Playback Compatibility Matrix & Recommended Player (`playbackCompatibility`)**:
  - Added `PlaybackCompatibilitySchema` to `RichStreamFeedSchema` (`webHlsJs`, `webShakaDash`, `safariNativeHls`, `androidExoPlayer`, `iptvVlcKodi`, `requiresClearKeyDrm`, `requiresCustomHeaders`, `recommendedPlayer: "hls.js" | "shaka-player" | "native-hls" | "exo-kodi"`).
- **24KB Deep Manifest Prober (`parseManifestContent` & `probeStream`)**:
  - Increased stream manifest inspection buffer from `4096` bytes to `24576` bytes (`24 KB`) to capture full multi-AdaptationSet DASH MPDs and HLS master playlists.
  - Added extraction of `encryption` (`"NONE" | "CLEARKEY" | "AES-128" | "SAMPLE-AES" | "CENC"`), `isLowLatency` (`boolean`), `targetDurationSec`, and `segmentCount`, and attached live `health` metrics (`isAlive`, `latencyMs`, `statusCode`, `lastChecked`) onto probed feeds.
- **6-Scheme Edge Stream Proxy (`isCustomProviderScheme`) & Sub-5ms IPTV Playlist Generation**:
  - Upgraded `/api/proxy` to resolve all 6 custom CS3 provider URI schemes (`cricify://`, `sportzx://`, `playfy://`, `playztv://`, `livxow://`, `sktech://`) on demand and forward `auth` query parameters as upstream `Authorization` headers across HLS manifest rewrites.
  - Optimized `AggregatorService.generateM3uPlaylist()` to execute in `<5ms` without blocking on cold upstream network fans by emitting on-demand `/api/proxy?url=encodeURIComponent(schemeUrl)` links for deferred schemes.
  - Enhanced `AggregatorService.inspectStream()` to automatically resolve custom provider schemes before inspecting manifests.
- **Unicode Diacritic Folding & Expanded Sport/Team Intelligence**:
  - Added `normalizeUnicodeText()` to fold non-ASCII diacritics (`Türkiye` -> `Turkiye`, `Curaçao` -> `Curacao`, `São Paulo` -> `Sao Paulo`) before entity tokenization and team alias matching.
  - Expanded `TEAM_ALIASES`, `TOURNAMENT_SIGNATURES`, and `detectSport()` with European & World national football teams, English Men's/Women's club teams (`WFC`, `LFC`, `AFC`), `cycling` (`Tour de France`, `Giro d'Italia`, `Vuelta a Espana`, `UCI`), `snooker`, and `darts`.
- **Rebuilt `v1.3.0` Developer Documentation Portal (`/public/docs.html`)**:
  - Re-engineered `/public/docs.html` from the ground up with an interactive 28-endpoint catalog, live API Request Workbench, HLS/DASH Manifest & DRM Inspector, Live IPTV M3U8/XMLTV Previewer, and 6-provider Dalvik cryptographic reference while preserving the dark zinc & emerald design system (`#0E0E10` / `#121215` / `#151518` / `#1C1C21` / `#27272A` / `#F4F4F5` / `#10B981`).

---

## [1.2.0] — Next-Level Engineering Release

### Added & Improved
- **Bytecode-Exact CS3 Provider Extraction Across All 6 Adapters**:
  - **`SportzxProvider` (`SportzxCryptoUtils.dex`)**: Implemented exact Dalvik `decryptV3` byte layout (`ct = [29..len-16]`, `tag = [len-16..len]`, `macSp` absorbing `macKey` at both start and end, counter `0`) with fallback to legacy synthetic layout, recovering 53+ live events and pre-resolving top `/channels/{id}.json` streams.
  - **`PlayFyProvider` (`PlayFyProvider.cs3` `classes.dex`)**: Updated Firebase Remote Config package to `com.playfy.tv`, SHA-1 cert `31CD6939D1BEAE32D1B0EF2D9460B170116A1885`, and `entries.baseUrl`, parsing `parsed.channels` from `/cats/live-events.json` (49+ live events) and resolving `/channels/{id}.json` stream lists.
  - **`CricifyProvider` (`CricifyProvider.cs3`)**: Prioritized `${base}/categories/live-events.txt` before `${base}/cats.txt`, added `hasRealEvents` guard against category-only manifests, and increased pre-resolved event slugs to 16.
  - **`PlayZTV`, `LivXow`, and `SKTech`**: Added parallel pre-resolution of top 8 active events' `pro/*.txt` sub-manifests, parallelized `resolveAllStreams()`, and added a `3500ms` timeout in `TokenApiResolver.safeFetch()`.
  - **Deferred Scheme Resolution**: Added `sportzx://`, `playfy://`, and `cricify://` deferred stream resolution in `AggregatorService.resolveSourceList()` alongside `playztv://`, `livxow://`, and `sktech://`.
- **Tournament Hygiene, Word-Boundary ShortNames & Multi-Sport National Teams**:
  - Added `GENERIC_CATEGORY_TOURNAMENT_NAMES`, `isGenericOrNoiseTournamentName()`, `cleanDynamicTournamentName()`, `buildTournamentShortName()`, and `buildDynamicTournamentInfo()` to eliminate bogus category tournaments (`"Cricket"`, `"Football"`, `"Boxing"`, `"Motorsports"`) and mid-word 16-char truncations (`"UEFA Nations Lea"` -> `"UEFA Nations League"`).
  - Added 12 new `TOURNAMENT_SIGNATURES` including `SAFF Championship` (`football`), `UEFA Nations League` (`football`), `Abu Dhabi T10` (`cricket`), `ACC Emerging Teams Cup` (`cricket`), `ODI Series`, `T20I Series`, `Sheffield Shield`, and `CSA T20 Challenge`.
  - Updated `AggregatorService.getTeams()` to track `sports: string[]` across active fixtures so multi-sport national teams (`Bangladesh`, `Pakistan`, `India`, `England`) accurately appear under both `football` and `cricket` when playing in tournaments like the `SAFF Championship`.
- **Format-Hint Metadata Enrichment & Cross-Provider Channel Deduplication**:
  - Enriched `availableLanguages` and `primaryBroadcasters` from upstream `formatHints` (`link_names`, `formatsNew`, `formats`) and excluded deferred scheme pointers from `rawUrls`.
  - Deduplicated 24/7 channels across providers by canonical channel name in `getChannels()` while preserving `mergedIds` for `getChannelDetail()`.

---

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
