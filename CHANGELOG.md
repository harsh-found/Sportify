# Changelog

All notable engineering changes to the **Sportify Live Sports & Stream Aggregation API** are documented in this file.

## [1.0.0] — Initial Public Release

### Added
- **Comprehensive Resource-Oriented REST API Architecture**:
  - **Sports**: `GET /api/sports` and `GET /api/sports/:sport` returning sport-level fixture counts, active tournaments, participating teams, and contributing providers.
  - **Matches & Events**: `GET /api/matches` (and `/api/events`), `GET /api/matches/live`, `GET /api/matches/upcoming`, and `GET /api/matches/:matchId` supporting filtering by `sport`, `phase`, `tournament`, `team`, `provider`, `language`, `drm`, `q`, `sort`, `page`, and `limit`.
  - **Tournaments & Competitions**: `GET /api/tournaments` (and `/api/competitions`) and `GET /api/tournaments/:tournamentId` with participating team rosters and live/upcoming fixture breakdowns.
  - **Teams**: `GET /api/teams` and `GET /api/teams/:teamCode` exposing canonical team codes, known aliases (including `IN` -> `IND`), `gender`, `ageGroup`, `leagueId`, and team fixtures.
  - **Channels & Broadcasters**: `GET /api/channels`, `GET /api/channels/:channelId`, and `GET /api/broadcasters` aggregating 24/7 sports channels and broadcast networks (`Star Sports Network`, `Sony Sports Network`, `JioCinema / Sports18`, `Willow TV`, `Sky Sports`, `TNT Sports`, `Prime Video Live`).
  - **Providers**: `GET /api/providers` and `GET /api/providers/:providerId` exposing Firebase project metadata, cryptographic algorithms, 3-state circuit breaker health, and live fixture/channel counts.
  - **Unified Search & Platform Statistics**: `GET /api/search?q=...` for cross-entity search across matches, tournaments, teams, and channels; `GET /api/stats` for real-time platform telemetry.
- **Redesigned Developer Documentation Portal (`/docs` & `public/docs.html`)**:
  - Built an interactive developer documentation portal featuring a live API Request Console, searchable endpoint catalog, 6-provider cryptographic matrix, JSON schema viewer, client SDK snippets, and embedded OpenAPI 3.1.0 inspector.
- **Advanced Event Intelligence & Franchise-to-Tournament Inference**:
  - Automatic inference of parent tournaments (`WBBL`, `BBL`, `IPL`, `WPL`, `PSL`, `SA20`) when upstream titles contain only participating franchise names (e.g., `"Adelaide Strikers Women vs Sydney Sixers Women"` -> `tourn_wbbl`).
  - Automatic gender promotion when tournament context indicates Women's competition (`WBBL: Adelaide Strikers vs Sydney Sixers` -> `STRW vs SIXW`).
  - Strict disambiguation across Men's (`IND`), Women's (`INDW`), Under-19 (`INDU19`), A-Teams (`INDA`), and ordinal match numbers (`1st ODI` vs `2nd ODI`).
  - Expanded alias dictionary (`IN` / `IND` / `India`, WBBL franchises, SA20 franchises, ICC Associate nations).
- **Lossless Cross-Provider Stream Deduplication**:
  - Implemented `normalizeStreamUrlForDedup()` to strip ephemeral cache-buster query tokens (`_`, `cb`, `rand`) while preserving signed stream tokens and merging ClearKey DRM (`kid:key`) and HTTP headers (`Referer`, `Origin`, `User-Agent`, `Cookie`) across all contributing providers.
  - Maintained unmerged raw provider events in `AggregatorService` so `buildUnifiedCatalog` and `getFixtureFeeds` preserve 100% of multi-provider attribution pointers even when upstream URLs are identical.

### Verified
- **Six CS3 Providers Audited Against Native Kotlin & Dalvik (`classes.dex`) Bytecode**:
  - Verified `Cricify`, `Sportzx` (`SXR3` ChaCha20 sponge + 128-bit MAC), `PlayFy` (32-bit FNV-1a key/IV derivation), `SKTech` (`LOOKUP_TABLE_D` + `V23`), `PlayZTV` (byte-reverse + pair-swap AES), and `LivXow` (`pro/*.txt` Base64url + substitution AES).
  - Sub-resource channel 404 responses isolated from provider circuit breakers (`ignoreCircuitBreaker: true`) so missing individual channels never trip provider availability.
