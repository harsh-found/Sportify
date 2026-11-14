# Sportify Live Sports & Stream Aggregation API (`v1.1.0`)

**Sportify `v1.1.0`** is a high-availability, edge-federated sports data and live stream aggregation API platform built with **Bun**, **Hono**, and **TypeScript**. It queries six reverse-engineered CloudStream3 (`.cs3`) providers concurrently, decrypts upstream payloads in memory using their exact native ciphers, reconciles inconsistent event metadata into order-independent canonical fixtures, parses real HLS/DASH manifests for video renditions and ClearKey DRM, and serves sub-millisecond O(1) indexed & Stale-While-Revalidate (SWR) cached responses.

---

## What's New in `v1.1.0`

1. **Provider Extraction Beyond CS3**:
   - Extracts upstream country/franchise flags (`teamAFlag`, `teamBFlag`) and attaches them directly to canonical `teams.teamA.logo` and `teams.teamB.logo`.
   - Extracts upstream hot/marquee status (`isHot`, `priority`, `eventBanner`, `eventType`) and synthesizes dynamic Match Card poster URLs (`generateMatchCardUrl` from `LiveEventsProvider.kt`) when an upstream event omits a poster image.
   - Extracts multi-bitrate format hints (`formatsNew`, `formats`, `link_names`) across providers to provide accurate feed counts before full stream resolution.
   - Supports both `"yyyy/MM/dd HH:mm:ss Z"` and Unix epoch timestamp date parsing in `SportzxProvider` (`LiveEventsProvider.kt`).

2. **Real HLS & DASH Manifest Inspection & Rendition Discovery**:
   - Pure manifest parser (`parseManifestContent`) and live manifest inspector (`inspectManifest` / `GET /api/streams/inspect`) that parses real HLS Master/Media playlists (`#EXT-X-STREAM-INF`, `#EXT-X-MEDIA:TYPE=AUDIO`) and DASH MPD XML (`<Representation>`, `<AdaptationSet>`, `cenc:default_KID`).
   - Automatically replaces synthetic renditions with real discovered video renditions, audio tracks, and ClearKey KIDs when `?probe=true` is requested on `/api/stream/:fixtureKey`.

3. **O(1) Memoized `CatalogIndex` & Weighted Typo-Tolerant Search (`scoreSearchQuery`)**:
   - Pre-computes a secondary in-memory index (`byFixtureId`, `byCanonicalKey`, `byProviderPointer`, `bySport`, `byPhase`, `byTournamentId`, `byTeamCode`, `byProvider`, `hotMatches`) whenever the catalog refreshes, turning match/sport/team/tournament/hot lookups into O(1) operations.
   - Weighted search scoring (`scoreSearchQuery`) ranking exact code/title matches (`100`), prefix matches (`88`), multi-token AND matches (`78`), substring matches (`76`/`62`), and 1-edit-distance Levenshtein typo tolerance (`48`).

4. **Stale-While-Revalidate (SWR) Cache & HTTP `ETag` (`304 Not Modified`)**:
   - `StreamCache<T>` upgraded with `defaultSwrMs` background refresh so expired keys within the SWR window serve stale data in `<1.5ms` while revalidating asynchronously in the background.
   - Automatic weak `ETag` (`W/"..."`) generation and `If-None-Match` conditional request handling (`304 Not Modified`) across read-heavy collection endpoints.

5. **New High-Value `v1.1.0` Endpoints**:
   - `GET /api/matches/hot`: Returns high-demand marquee fixtures ranked by upstream priority, multi-provider coverage, and live status.
   - `GET /api/schedule` & `GET /api/epg`: Chronological Electronic Program Guide grouped into `liveNow`, `startingSoon`, `upcomingByDate`, and `recentlyEnded`.
   - `GET /api/epg.xml` & `GET /epg.xml`: Standards-compliant XMLTV Electronic Program Guide matching `tvg-id` identifiers in `/api/playlist.m3u`.
   - `GET /api/channels/categories`: Aggregated 24/7 channel categories with channel counts, HD counts, and provider attribution.
   - `GET /api/streams/inspect?url=...`: On-demand real-time HLS/DASH manifest & ClearKey DRM inspector.

---

## Six Federated CS3 Providers

| Provider ID | Firebase Project & App Package | Cryptographic & Extraction Pipeline |
| :--- | :--- | :--- |
| **`cricify`** | `963020218535` &bull; `com.cricfy.tv` | Primary / Dex-Secondary / Legacy-Secondary AES-128-CBC + `EnvelopeCrypto`, `/cats.txt`, `/categories/live-events.txt`, `/channels/{slug}.txt`, dynamic Match Card poster synthesis |
| **`sportzx`** | `234785582029` &bull; `com.sportzxtv.app` | `SXR3` ChaCha20-variant sponge cipher + 128-bit MAC tag verifier (`decryptV3`), AES-128-CBC fallbacks, `/events.json`, `/channels/{id}.json`, `formatsNew` & dual date parser |
| **`playfy`** | `239487160038` &bull; `com.playfytv.app` | Dalvik 32-bit FNV-1a key/IV derivation (`0x811c9dc5`), `{"data":"..."}` envelope unwrapping, `/cats/live-events.json`, `/cc.json`, `/channels/{id}.json` |
| **`sktech`** | `330162934410` &bull; `com.live.sktechtv` | 256-byte Lookup Table D (`decryptLegacyLookup`), V23 substitution (`decryptV23`), 64-char hex header stripping, `/events.txt`, `/cats.txt`, `/channels/{id}.txt` |
| **`playztv`** | `516859456626` &bull; `com.playztv.app` | Reverse bytes + adjacent byte-pair swap + AES-128-CBC, `/events.txt`, `/categories.txt`, `/channels/{id}.txt` |
| **`livxow`** | `459539398637` &bull; `com.livxow.app` | Multi-pass substitution cipher + Base64url `pro/*.txt` stream resolution + AES-128-CBC, `/events.txt`, `/cats.txt` |

---

## Complete API Endpoint Reference (`v1.1.0`)

| Resource Group | Method & Path | Description |
| :--- | :--- | :--- |
| **Sports** | `GET /api/sports` | List all active sports with total, live, upcoming fixture counts and tournament counts |
| **Sports** | `GET /api/sports/:sport` | Detailed sport breakdown with active tournaments, participating teams, and fixtures |
| **Matches & Events** | `GET /api/matches` | Query normalized matches/events (`sport`, `phase`, `tournament`, `team`, `provider`, `language`, `drm`, `hot`, `q`, `sort`, `page`, `limit`) |
| **Matches & Events** | `GET /api/matches/live` | List all currently live matches across all 6 providers |
| **Matches & Events** | `GET /api/matches/upcoming` | List scheduled upcoming fixtures |
| **Matches & Events** | `GET /api/matches/hot` | List high-demand marquee matches ranked by priority, multi-provider coverage, and live status |
| **Matches & Events** | `GET /api/matches/:matchId` | Retrieve full match details and resolved stream feeds by `fixtureId` or `canonicalKey` |
| **Schedule & EPG** | `GET /api/schedule` | Chronological EPG schedule grouped by `liveNow`, `startingSoon`, `upcomingByDate`, and `recentlyEnded` |
| **Schedule & EPG** | `GET /api/epg.xml` | Standard XMLTV Electronic Program Guide matching `tvg-id`s in `/api/playlist.m3u` |
| **Catalog** | `GET /api/catalog` | Fetch unified catalog of matches and tournament broadcast channels (supports HTTP `ETag`) |
| **Catalog** | `GET /api/catalog/:sport` | Filter unified catalog by sport slug |
| **Tournaments** | `GET /api/tournaments` | List all tournaments/competitions (`IPL`, `WBBL`, `BBL`, `WPL`, `PSL`, `UCL`, `EPL`, `F1`, `NBA`, `NHL`) with fixture and team counts |
| **Tournaments** | `GET /api/tournaments/:tournamentId` | Tournament detail, participating teams, and fixtures (`tourn_wbbl`, `wbbl`, `ipl`) |
| **Teams** | `GET /api/teams` | List canonical teams with gender, age group, franchise league, logos, aliases, and match counts |
| **Teams** | `GET /api/teams/:teamCode` | Team profile, known aliases (`IND`, `IN`, `India`), and active fixtures |
| **Channels** | `GET /api/channels` | Paginated 24/7 live sports and regional TV channels (`category`, `provider`, `q`, `page`, `limit`) |
| **Channels** | `GET /api/channels/categories` | Normalized channel categories with channel counts, HD counts, and provider attribution |
| **Channels** | `GET /api/channels/:channelId` | Channel metadata and resolved playable stream feeds |
| **Broadcasters** | `GET /api/broadcasters` | Aggregated broadcast networks (`Star Sports`, `Sony Sports`, `JioCinema`, `Willow TV`, `Sky Sports`) |
| **Providers** | `GET /api/providers` | Status, Firebase config, cipher specs, circuit breaker state, and fixture/channel counts for all 6 CS3 providers |
| **Providers** | `GET /api/providers/:providerId` | Detailed inspection of a single provider and its contributed fixtures/channels |
| **Streams** | `GET /api/stream/:fixtureKey` | Resolve deduplicated stream feeds with provenance, ClearKey DRM, real manifest renditions, and optional `?probe=true` |
| **Streams** | `GET /api/streams/inspect` | On-demand real-time HLS/DASH manifest inspector extracting video renditions, audio tracks, and ClearKey KIDs |
| **Edge Proxy** | `GET /api/proxy` | CORS-safe HLS/DASH reverse proxy with header injection, manifest rewriting, and automatic failover |
| **IPTV & SSE** | `GET /api/playlist.m3u` | Generate IPTV M3U8 playlist with `#KODIPROP` ClearKey DRM and `#EXTVLCOPT` headers |
| **IPTV & SSE** | `GET /api/live/sse` | Real-time Server-Sent Events (SSE) stream for live catalog updates |
| **Search & Stats** | `GET /api/search?q=...` | Weighted tokenized & 1-edit-distance typo-tolerant cross-resource search |
| **Search & Stats** | `GET /api/stats` | Comprehensive platform statistics across sports, phases, providers, protocols, SWR caches, and memory |
| **System & UI** | `GET /health` | Gateway health check, circuit breaker states, cache statistics, and endpoint map |
| **System & UI** | `GET /portal` | Interactive Live Sports Portal & HLS Stream Test Bench |
| **System & UI** | `GET /docs` | `v1.1.0` Developer Documentation Portal & Interactive API Console |
| **System & UI** | `GET /api/openapi.json` | Full OpenAPI 3.1.0 specification |

---

## Development, Testing & Benchmarking

```bash
# Install dependencies
bun install

# Start development server on port 3000
bun run dev

# Run complete unit & integration test suite (125 tests across 17 files)
bun test

# Run latency & throughput benchmark (<2ms cached SLA)
bun run benchmark

# Type-check & lint
bun run build
```
