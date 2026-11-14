# Sportify Live Sports & Stream Aggregation API (`v1.0.0`)

**Sportify `v1.0.0`** is a high-availability, edge-federated sports data and live stream aggregation API platform built with **Bun**, **Hono**, and **TypeScript**. It queries six reverse-engineered CloudStream3 (`.cs3`) providers concurrently, decrypts upstream payloads in memory using their exact native ciphers, reconciles inconsistent event metadata into order-independent canonical fixtures, deduplicates multi-provider streams without losing ClearKey DRM or HTTP header provenance, and serves sub-millisecond cached responses.

---

## Key Capabilities

1. **Six CS3 Providers Reverse-Engineered & Federated**:
   - **Cricify (`cricify`)**: Firebase Remote Config (`963020218535` / `com.cricfy.tv`), Primary/Dex-Secondary/Legacy-Secondary AES-128-CBC + `EnvelopeCrypto`, `/cats.txt` + `/categories/live-events.txt` + `/channels/{slug}.txt`, and curated M3U mirrors.
   - **Sportzx (`sportzx`)**: Exact `SXR3` ChaCha20-variant sponge stream cipher & 128-bit MAC tag verifier (`decryptV3`), AES-128-CBC fallbacks (`decryptFallback`, `decryptFallback2`), Firebase Remote Config (`234785582029` / `com.sportzxtv.app`), `/events.json` + `/channels/{id}.json`.
   - **PlayFy (`playfy`)**: Dalvik bytecode 32-bit FNV-1a key/IV derivation (`0x811c9dc5` -> `"BR4weRP=5A/Y&8%5"` / `"Va+XYCKnkinUMDvk"`), `{"data":"..."}` envelope unwrapping, Firebase Remote Config (`239487160038` / `com.playfytv.app`), `/cats/live-events.json` + `/cc.json` + `/channels/{id}.json`.
   - **SKTech (`sktech`)**: 256-byte Lookup Table D (`decryptLegacyLookup`), V23 substitution (`decryptV23`), 64-char hex header stripping, `[{"event":"..."}]` / `[{"cat":"..."}]` wrapper parsing, Firebase Remote Config (`330162934410` / `com.live.sktechtv`).
   - **PlayZTV (`playztv`)**: Reverse bytes + adjacent byte-pair swap + AES-128-CBC, Firebase Remote Config (`516859456626` / `com.playztv.app`), `/events.txt` + `/categories.txt` + `/channels/{id}.txt`.
   - **LivXow (`livxow`)**: Multi-pass substitution cipher + Base64url `pro/*.txt` stream resolution + AES-128-CBC, Firebase Remote Config (`459539398637` / `com.livxow.app`).

2. **Advanced Event Identity, Franchise Inference & Disambiguation**:
   - **Order-Independent Canonical Keys**: `"New Zealand vs India"`, `"IND vs NZ"`, and `"NZ vs IN"` automatically resolve to `cricket::ind-vs-nz::YYYY-MM-DD`.
   - **Franchise-to-League Inference**: Matches containing only franchise names (e.g., `"Adelaide Strikers Women vs Sydney Sixers Women"` or `"CSK vs MI"`) automatically infer their parent tournament (`Women's Big Bash League (WBBL)` or `Indian Premier League (IPL)`).
   - **Strict Disambiguation**: Men's, Women's (`INDW` vs `AUSW`), Under-19 (`INDU19` vs `AUSU19`), A-Teams (`INDA`), and distinct match numbers (`1st ODI` vs `2nd ODI`) never falsely merge.
   - **Zero Fake Teams**: League/tournament broadcast channels (e.g., `"Nepal Premier League"`, `"NPL vs NPL"`, `"Formula 1"`) are classified as `kind: "tournament_channel"` with `teams: null`.

3. **Lossless Stream Deduplication & ClearKey DRM Merging**:
   - Normalizes stream URLs across providers (stripping ephemeral cache-buster parameters while preserving signed stream tokens).
   - Merges ClearKey DRM hex `kid:key` pairs, `licenseUrl`, and required upstream HTTP headers (`Referer`, `Origin`, `User-Agent`, `Cookie`) across mirrored feeds.
   - Tracks full multi-provider attribution (`primaryProvider`, `mirroredProviders`, `sourceList`, `attributionBadge`, `reliabilityScore`).

4. **Built-In HLS/DASH Edge Reverse Proxy & IPTV M3U8 Generator**:
   - `/api/proxy` spoofs upstream headers, rewrites relative child manifests and media segments on-the-fly, supports dynamic variant filtering (`?quality=1080p`), and automatically fails over to a backup mirror (`&fallback=...`) on upstream `403`/`404`/`5xx` or timeout.
   - `/api/playlist.m3u` generates standards-compliant IPTV playlists with `#KODIPROP` ClearKey directives and `#EXTVLCOPT` headers for TiviMate, OTT Navigator, Kodi, and VLC.

---

## Project Architecture

```text
/src
  ├── index.ts                      # Hono application gateway, middleware & route mounting
  ├── core/
  │   └── types.ts                  # Core Zod schemas (LiveEvent, Channel, StreamSource, DRMConfig)
  ├── catalog/
  │   ├── types.ts                  # Normalized catalog, team, tournament & RichStreamFeed schemas
  │   └── normalizer.ts             # Event entity parser, franchise inference & stream deduplication
  ├── engine/
  │   ├── cache.ts                  # Bounded LRU + TTL cache with Singleflight stampede protection
  │   ├── circuit-breaker.ts        # 3-state (CLOSED / OPEN / HALF_OPEN) provider fault isolation
  │   ├── normalizer.ts             # Cross-provider LiveEvent deduplication
  │   └── prober.ts                 # Live stream canary health prober & manifest validator
  ├── parsers/
  │   ├── drm.helper.ts             # ClearKey hex/Base64url normalization & lossless DRM merging
  │   └── m3u.parser.ts             # M3U8 #EXTINF / #KODIPROP / #EXTVLCOPT parser
  ├── providers/
  │   ├── base.provider.ts          # BaseProvider with circuit breaker & timeout enforcement
  │   ├── cricify.provider.ts       # Cricify CS3 adapter
  │   ├── sportzx.provider.ts       # Sportzx CS3 adapter (SXR3 ChaCha20 sponge + MAC)
  │   ├── playfy.provider.ts        # PlayFy CS3 adapter (FNV-1a 32-bit key/IV derivation)
  │   ├── sktech.provider.ts        # SKTech CS3 adapter (Lookup Table D + V23)
  │   ├── playztv.provider.ts       # PlayZTV CS3 adapter
  │   └── livxow.provider.ts        # LivXow CS3 adapter
  ├── services/
  │   ├── aggregator.service.ts     # Concurrent 6-provider aggregation, caching & query engine
  │   └── token-resolver.service.ts # Dynamic token & custom URI resolver
  ├── routes/
  │   ├── v1-resources.route.ts     # Resource endpoints (matches, tournaments, teams, channels, etc.)
  │   ├── catalog.route.ts          # Unified catalog endpoints (/api/catalog)
  │   ├── sports.route.ts           # Sports summary & detail endpoints (/api/sports)
  │   ├── stream-provenance.route.ts# Rich stream resolution (/api/stream/:fixtureKey)
  │   ├── proxy.route.ts            # Edge HLS/DASH reverse proxy (/api/proxy)
  │   ├── playlist.route.ts         # IPTV M3U8 generator (/api/playlist.m3u)
  │   ├── live-sse.route.ts         # Real-time Server-Sent Events (/api/live/sse)
  │   └── docs.route.ts             # OpenAPI 3.1 specification & /docs portal
  └── utils/
      ├── crypto.ts                 # AES-128-CBC & byte-transformation primitives
      ├── envelope-crypto.ts        # Envelope decryption helper
      ├── firebase-fetcher.ts       # Google Firebase Remote Config REST client
      └── stream-url.ts             # Pipe-delimited stream URL & proxy query helpers
```

---

## Complete API Endpoint Reference (`v1.0.0`)

| Resource Group | Method & Path | Description |
| :--- | :--- | :--- |
| **Sports** | `GET /api/sports` | List all active sports with total, live, upcoming fixture counts and tournament counts |
| **Sports** | `GET /api/sports/:sport` | Detailed sport breakdown with active tournaments, participating teams, and fixtures |
| **Matches & Events** | `GET /api/matches` | Query normalized matches/events (`sport`, `phase`, `tournament`, `team`, `provider`, `language`, `drm`, `q`, `sort`, `page`, `limit`) |
| **Matches & Events** | `GET /api/matches/live` | List all currently live matches across all 6 providers |
| **Matches & Events** | `GET /api/matches/upcoming` | List scheduled upcoming fixtures |
| **Matches & Events** | `GET /api/matches/:matchId` | Retrieve full match details and resolved stream feeds by `fixtureId` or `canonicalKey` |
| **Catalog** | `GET /api/catalog` | Fetch unified catalog of matches and tournament broadcast channels |
| **Catalog** | `GET /api/catalog/:sport` | Filter unified catalog by sport slug |
| **Tournaments** | `GET /api/tournaments` | List all tournaments/competitions (`IPL`, `WBBL`, `BBL`, `WPL`, `PSL`, `UCL`, `EPL`, `F1`) with fixture and team counts |
| **Tournaments** | `GET /api/tournaments/:tournamentId` | Tournament detail, participating teams, and fixtures (`tourn_wbbl`, `wbbl`, `ipl`) |
| **Teams** | `GET /api/teams` | List canonical teams with gender, age group, franchise league, aliases, and match counts |
| **Teams** | `GET /api/teams/:teamCode` | Team profile, known aliases (`IND`, `IN`, `India`), and active fixtures |
| **Channels** | `GET /api/channels` | Paginated 24/7 live sports and regional TV channels (`category`, `provider`, `q`, `page`, `limit`) |
| **Channels** | `GET /api/channels/:channelId` | Channel metadata and resolved playable stream feeds |
| **Broadcasters** | `GET /api/broadcasters` | Aggregated broadcast networks (`Star Sports`, `Sony Sports`, `JioCinema`, `Willow TV`, `Sky Sports`) |
| **Providers** | `GET /api/providers` | Status, Firebase config, cipher specs, circuit breaker state, and fixture/channel counts for all 6 CS3 providers |
| **Providers** | `GET /api/providers/:providerId` | Detailed inspection of a single provider and its contributed fixtures/channels |
| **Streams** | `GET /api/stream/:fixtureKey` | Resolve deduplicated stream feeds with provenance, ClearKey DRM, renditions, and optional `?probe=true` |
| **Edge Proxy** | `GET /api/proxy` | CORS-safe HLS/DASH reverse proxy with header injection, manifest rewriting, and automatic failover |
| **IPTV & SSE** | `GET /api/playlist.m3u` | Generate IPTV M3U8 playlist with `#KODIPROP` ClearKey DRM and `#EXTVLCOPT` headers |
| **IPTV & SSE** | `GET /api/live/sse` | Real-time Server-Sent Events (SSE) stream for live catalog updates |
| **Search & Stats** | `GET /api/search?q=...` | Unified cross-resource search across matches, tournaments, teams, and channels |
| **Search & Stats** | `GET /api/stats` | Comprehensive platform statistics across sports, phases, providers, protocols, caches, and memory |
| **System & UI** | `GET /health` | Gateway health check, circuit breaker states, cache statistics, and endpoint map |
| **System & UI** | `GET /portal` | Interactive Live Sports Portal & HLS Stream Test Bench |
| **System & UI** | `GET /docs` | Redesigned `v1.0.0` Developer Documentation Portal & Interactive API Console |
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
