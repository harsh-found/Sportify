# Active Stream Health Canary, Resilient Edge Failover Proxy & Video Bench Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Arena Edge Live Sports Gateway to a production-grade, zero-dead-link streaming infrastructure with active background health probing, intelligent mirror failover, in-memory chunk caching, and an embedded live HLS video playback bench.

**Architecture:** An asynchronous `StreamProber` with concurrency limiting continuously tests live stream feeds with lightweight range requests, measuring latency, HTTP liveness, and manifest validity, updating stream health and priority tiers in real time. The `proxyRoute` is upgraded with multi-mirror automatic failover and micro-caching for video chunks. The landing UI is enriched with an embedded HLS.js player test bench.

**Tech Stack:** Bun, Hono, TypeScript, Zod, Hls.js CDN, Bun in-memory byte buffer cache.

**Spec:** Native Arena Edge Live Sports Gateway Architecture v2.1.0.

## Global Constraints

- Strict adherence to the 6 Core Indian Sports Providers (`Cricify`, `Sportzx`, `PlayZTV`, `PlayFy`, `SKTech`, `LivXow`).
- Zero unhandled exceptions or uncaught network failures.
- Non-blocking asynchronous probing; prober must never slow down client REST endpoints.
- Lightweight light mode design in `public/index.html` with Phosphor icons (no emojis).

## Review Focus

- Probing non-HTTP or pseudo-scheme URLs (`playztv://`, `livxow://`) without throwing exceptions.
- Upstream CDN returning 403 Forbidden or 404 Not Found triggering automatic mirror failover in proxy without hanging.
- Micro-caching video segments in proxy ensuring Content-Type and byte ranges remain intact.
- High concurrency probe rate-limiting to prevent IP blocking from upstream CDNs.
- HLS.js player gracefully handling non-HLS or DRM streams with clear diagnostic messaging.

---

### Task 1: Active Stream Prober & Health Canary Engine

**Files:**
- Create: `src/engine/prober.ts`
- Test: `tests/prober.test.ts`
- Modify: `src/catalog/types.ts:40-65`
- Modify: `src/catalog/normalizer.ts:325-340`

**Interfaces:**
- Produces: `StreamProber.probeStream(url: string, headers?: Record<string, string>): Promise<StreamProbeResult>`
- Produces: `StreamProber.probeFeedsBatch(feeds: RichStreamFeed[]): Promise<RichStreamFeed[]>`
- Result Type: `{ isAlive: boolean; latencyMs: number; statusCode: number; formatVerified: boolean }`

- [ ] **Step 1: Write unit tests for `StreamProber`**
  Test probe verification for live HLS streams, 404 dead link handling, latency tracking, and batch ranking.

- [ ] **Step 2: Run test to verify failure**
  Run: `bun test tests/prober.test.ts`

- [ ] **Step 3: Implement `StreamProber` in `src/engine/prober.ts`**
  Use `fetch` with `Range: bytes=0-1024` or `HEAD`, timeout of 3500ms, and LRU cache for probe results (TTL 120s).

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test tests/prober.test.ts`

- [ ] **Step 5: Commit Task 1**
  `git add src/engine/prober.ts tests/prober.test.ts && git commit -m "feat(prober): implement active stream health prober and latency canary"`

---

### Task 2: Multi-Mirror Failover & Segment Micro-Caching in Edge Proxy

**Files:**
- Modify: `src/routes/proxy.route.ts`
- Test: `tests/proxy-failover.test.ts`

**Interfaces:**
- Consumes: Target URL, optional `backupUrl`, optional `fallbackUrls` array.
- Produces: Seamless fallback to backup mirror if primary upstream returns 403, 404, 502, or 503.
- Produces: 5-second LRU in-memory buffer cache for video chunks (`.ts`, `.m4s`, `.mp4`).

- [ ] **Step 1: Write integration tests for failover and segment caching**
  Test primary failure triggering fallback URL, and verify repeated segment fetches hit memory cache.

- [ ] **Step 2: Run test to verify failure**
  Run: `bun test tests/proxy-failover.test.ts`

- [ ] **Step 3: Implement multi-mirror failover and chunk cache in `src/routes/proxy.route.ts`**
  Add `backupUrl` support in query parameters, loop through candidate mirrors on upstream error, and cache binary segment buffers with `StreamCache<ArrayBuffer>`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test tests/proxy-failover.test.ts`

- [ ] **Step 5: Commit Task 2**
  `git add src/routes/proxy.route.ts tests/proxy-failover.test.ts && git commit -m "feat(proxy): add multi-mirror failover and segment micro-caching"`

---

### Task 3: Stream Resolution Prober Integration & Live Route Enhancement

**Files:**
- Modify: `src/routes/stream-provenance.route.ts`
- Modify: `src/services/aggregator.service.ts`
- Test: `tests/stream-provenance-probe.test.ts`

**Interfaces:**
- Consumes: `StreamProber.probeFeedsBatch`
- Produces: `GET /api/stream/:fixtureKey?probe=true` active verification, adjusting `reliabilityScore` and `priorityTier` dynamically.

- [ ] **Step 1: Write test for probed stream resolution**
  Verify feeds returned with `probe=true` include real tested latency and offline demotion.

- [ ] **Step 2: Run test to verify failure**
  Run: `bun test tests/stream-provenance-probe.test.ts`

- [ ] **Step 3: Integrate prober into `getFixtureFeeds` in `AggregatorService`**
  When `probe` flag is requested, probe feeds concurrently and sort verified working feeds to top.

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test tests/stream-provenance-probe.test.ts`

- [ ] **Step 5: Commit Task 3**
  `git add src/routes/stream-provenance.route.ts src/services/aggregator.service.ts tests/stream-provenance-probe.test.ts && git commit -m "feat(stream): integrate active health canary into stream provenance resolution"`

---

### Task 4: Embedded Live HLS Video Player Test Bench in Landing UI

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: Video test bench section in UI with Hls.js CDN integration.
- Action: "Play Stream in Bench" button loads the HLS stream through `/api/proxy` with live playback controls, audio stats, and bitrate indicator.

- [ ] **Step 1: Add Hls.js script and Video Player modal/panel to `public/index.html`**
  Clean, minimal video player element matching light-mode theme with playback diagnostics.

- [ ] **Step 2: Add JS playback handler**
  Initialize `Hls` player or native HLS, load `/api/proxy?url=...`, display buffer status, and provide close/pause controls.

- [ ] **Step 3: Verify video player loads and tests cleanly**
  Run verification test via `bun -e 'import app from "./src/index"; ...'`

- [ ] **Step 4: Commit Task 4**
  `git add public/index.html && git commit -m "feat(ui): add embedded live HLS video playback test bench"`
