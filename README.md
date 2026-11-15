# Sportify Live Sports & Stream Aggregation API (`v1.4.0`)

**Sportify `v1.4.0`** is a high-availability, edge-federated sports data and live stream aggregation API platform built with **Bun**, **Hono**, and **TypeScript**. It queries six reverse-engineered CloudStream3 (`.cs3`) providers concurrently, decrypts upstream payloads in memory using their exact native Dalvik (`classes.dex`) ciphers, reconciles inconsistent event metadata into order-independent canonical fixtures, parses 24KB of real HLS/DASH manifests for video renditions, ClearKey DRM, and low-latency segments, and serves sub-millisecond O(1) indexed & Stale-While-Revalidate (SWR) cached responses.

---

## What's New in `v1.4.0`

1. **Zero Self-Sabotage CS3 Provider Extraction & Singleflight Firebase Remote Config**:
   - Eliminated circuit-breaker self-sabotage across all 6 CS3 providers (`Cricify`, `Sportzx`, `PlayZTV`, `PlayFy`, `SKTech`, `LivXow`) when probing optional candidate manifest paths (`/events.txt` vs `/events.json`, `categories.txt` vs `cats.txt`, and M3U mirrors) by isolating candidate probes from base-domain health checks.
   - Added singleflight request coalescing + 10-minute TTL caching (`firebaseConfigCache` & `firebaseInFlight`) in `AbstractBaseProvider.fetchFirebaseRemoteConfig()` so concurrent `fetchEvents()` and `fetchChannels()` calls never duplicate Firebase Remote Config requests.
   - Added accurate `DD/MM/YYYY` + `HH:mm:ss` and Unix epoch date/time parsing (`parseProviderDateTime` & `computeEventStatusFromTimes`) in `PlayZTV`, `LivXow`, `SKTech`, and `safeIsoDate()`, recovering 100% ISO-8601 UTC schedule timestamp coverage across all fixtures.

2. **Deep Extraction & Provider Telemetry Endpoint (`GET /api/diagnostics`)**:
   - Added `ProviderDiagnostics` tracking per-provider request counts, success rate percentage, last fetch latency (`ms`), active resolved mirror domain (`activeBaseUrl`), and extracted event/channel counts.
   - Added `GET /api/diagnostics` exposing real-time `extractionCoverage` (`scheduleTimestampCoveragePct`, `teamEntityResolutionPct`, `tournamentInferencePct`, `posterCoveragePct`, `multiProviderConsensusPct`), `deduplicationEfficiency`, and `providerDiagnostics`.

3. **Edge Stream Proxy SSRF Hardening, Signed CDN Token Inheritance & Credential Redaction**:
   - **SSRF Protection (`isSafeUpstreamUrl`)**: Blocks loopback (`127.0.0.0/8`, `localhost`, `::1`), RFC1918 private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT, and cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`) in both `/api/proxy` and `/api/streams/inspect`.
   - **Signed CDN Token Inheritance (`inheritSignedQueryParams`)**: Automatically propagates parent manifest signed query tokens (`hdnts`, `hdnea`, `token`, `sig`, `hmac`, `Policy`, `Signature`, `Key-Pair-Id`, `expires`, `wmsAuthSign`) onto relative HLS child variant playlists, encryption keys, and media segments when rewriting manifests in `/api/proxy`.
   - **CORS `OPTIONS` Preflight & Credential Redaction (`sanitizeHeadersForPublicDisplay`)**: Added `OPTIONS /api/proxy` preflight handler for browser `hls.js`/`shaka-player` range requests and redacted raw `Authorization` and `Cookie` secrets in public JSON responses while preserving server-side proxy forwarding.

---

## Previous Release Highlights (`v1.3.0`)

1. **Client Playback Compatibility Matrix & Recommended Player Engine (`playbackCompatibility`)**:
   - Every resolved `RichStreamFeed` includes a deterministic `playbackCompatibility` object (`webHlsJs`, `webShakaDash`, `safariNativeHls`, `androidExoPlayer`, `iptvVlcKodi`, `requiresClearKeyDrm`, `requiresCustomHeaders`, and `recommendedPlayer: "hls.js" | "shaka-player" | "native-hls" | "exo-kodi"`).

2. **24KB Deep Manifest Prober (`parseManifestContent` & `probeStream`)**:
   - Expanded live manifest inspection window from `4 KB` to `24 KB` (`24576` bytes) to parse multi-`AdaptationSet` MPEG-DASH `.mpd` XML manifests and multi-variant HLS master playlists without truncation.
   - Extracts `encryption` (`"NONE" | "CLEARKEY" | "AES-128" | "SAMPLE-AES" | "CENC"`), `isLowLatency` (`#EXT-X-PART-INF`, `#EXT-X-SERVER-CONTROL`, `availabilityTimeOffset`), `targetDurationSec`, and `segmentCount`.

3. **6-Scheme Edge Stream Proxy (`isCustomProviderScheme`) & Sub-5ms IPTV Playlist Generation**:
   - `/api/proxy` resolves all 6 custom CS3 provider URI schemes on the fly (`cricify://`, `sportzx://`, `playfy://`, `playztv://`, `livxow://`, `sktech://`) and forwards `auth` query parameters across rewritten HLS playlists.

4. **Unicode Diacritic Normalization & Expanded European/World Sport Intelligence**:
   - Added `normalizeUnicodeText()` (`NFD` + strip combining marks + fold `ı -> i`, `İ -> I`, `ß -> ss`, `ø -> o`, `ł -> l`) so international matchups like `"France vs Türkiye"` cleanly normalize to `FRA` vs `TUR` (`"France vs Turkiye"`).

---

## Six Federated CS3 Providers

| Provider ID | Firebase Project & App Package | Cryptographic & Extraction Pipeline |
| :--- | :--- | :--- |
| **`cricify`** | `963020218535` &bull; `com.cricfy.tv` | Primary / Dex-Secondary / Legacy-Secondary AES-128-CBC + `EnvelopeCrypto`, `/cats.txt`, `/categories/live-events.txt`, `/channels/{slug}.txt`, dynamic Match Card poster synthesis |
| **`sportzx`** | `234785582029` &bull; `com.sportzxtv.app` | `SXR3` ChaCha20-variant sponge cipher + 128-bit MAC tag verifier (`decryptV3`), AES-128-CBC fallbacks, `/events.txt`, `/events.json`, `/channels/{id}.json`, `formatsNew` & dual date parser |
| **`playfy`** | `239487160038` &bull; `com.playfy.tv` | Dalvik 32-bit FNV-1a key/IV derivation (`0x811c9dc5`), `{"data":"..."}` envelope unwrapping, `/cats/live-events.json`, `/cc.json`, `/channels/{id}.json` |
| **`sktech`** | `330162934410` &bull; `com.live.sktechtv` | 256-byte Lookup Table D (`decryptLegacyLookup`), V23 substitution (`decryptV23`), 64-char hex header stripping, `/events.txt`, `/cats.txt`, `/channels/{id}.txt` |
| **`playztv`** | `516859456626` &bull; `com.playz.tv` | Reverse bytes + adjacent byte-pair swap + AES-128-CBC, `/events.txt`, `/categories.txt`, `/channels/{id}.txt` |
| **`livxow`** | `459539398637` &bull; `com.livxow.tv` | Multi-pass substitution cipher + Base64url `pro/*.txt` stream resolution + AES-128-CBC, `/events.txt`, `/cats.txt` |

---

## Complete API Endpoint Reference (`v1.4.0` — 30 Endpoints)

| Resource Group | Method & Path | Description |
| :--- | :--- | :--- |
| **Sports** | `GET /api/sports` | List all active sports with total, live, upcoming fixture counts and tournament counts |
| **Sports** | `GET /api/sports/:sport` | Detailed sport breakdown with active tournaments, participating teams, and fixtures |
| **Matches & Events** | `GET /api/matches` | Query normalized matches/events (`sport`, `phase`, `tournament`, `team`, `provider`, `language`, `drm`, `hot`, `q`, `sort`, `page`, `limit`) |
| **Matches & Events** | `GET /api/matches/live` | List all currently live matches across all 6 providers |
| **Matches & Events** | `GET /api/matches/upcoming` | List scheduled upcoming fixtures |
| **Matches & Events** | `GET /api/matches/hot` | List high-demand marquee matches ranked by priority, multi-provider coverage, and live status |
| **Matches & Events** | `GET /api/matches/:matchId` | Retrieve full match details and resolved stream feeds by `fixtureId` or `canonicalKey` |
| **Matches & Events** | `GET /api/events` | Alias for `/api/matches` returning normalized match and event resources |
| **Schedule & EPG** | `GET /api/schedule` | Chronological EPG schedule grouped by `liveNow`, `startingSoon`, `upcomingByDate`, and `recentlyEnded` |
| **Schedule & EPG** | `GET /api/epg` | Alias for `/api/schedule` supporting JSON EPG and `?format=xmltv` |
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
| **Providers** | `GET /api/providers` | Status, Firebase config, cipher specs, circuit breaker state, diagnostics, and fixture/channel counts for all 6 CS3 providers |
| **Providers** | `GET /api/providers/:providerId` | Detailed inspection of a single provider and its contributed fixtures/channels |
| **Streams** | `GET /api/stream/:fixtureKey` | Resolve deduplicated stream feeds with provenance, ClearKey DRM, playbackCompatibility, and optional `?probe=true` |
| **Streams** | `GET /api/streams/inspect` | On-demand 24KB HLS/DASH manifest inspector extracting video renditions, audio tracks, and ClearKey KIDs |
| **Edge Proxy** | `GET /api/proxy` | SSRF-hardened CORS-safe HLS/DASH reverse proxy with signed CDN token inheritance, header injection, and automatic failover |
| **IPTV & SSE** | `GET /api/playlist.m3u` | Generate IPTV M3U8 playlist with `#KODIPROP` ClearKey DRM and `#EXTVLCOPT` headers |
| **IPTV & SSE** | `GET /api/live/sse` | Real-time Server-Sent Events (SSE) stream for live catalog updates |
| **Search & Telemetry** | `GET /api/search?q=...` | Weighted tokenized & 1-edit-distance typo-tolerant cross-resource search |
| **Search & Telemetry** | `GET /api/stats` | Comprehensive platform statistics across sports, phases, providers, protocols, SWR caches, and memory |
| **Search & Telemetry** | `GET /api/diagnostics` | Deep extraction coverage percentages, deduplication efficiency, and per-provider telemetry |
| **System & UI** | `GET /health` | Gateway health check, circuit breaker states, cache statistics, and endpoint map |
| **System & UI** | `GET /portal` | Interactive Live Sports Portal & HLS Stream Test Bench |
| **System & UI** | `GET /docs` | `v1.4.0` Developer Documentation Portal & Interactive API Workbench |
| **System & UI** | `GET /api/openapi.json` | Full OpenAPI 3.1.0 specification |

---

## Development, Testing & Benchmarking

```bash
# Install dependencies
bun install

# Start development server on port 3000
bun run dev

# Run complete unit & integration test suite
bun test

# Run latency & throughput benchmark (<2ms cached SLA)
bun run benchmark

# Type-check & lint
bun run build
```
