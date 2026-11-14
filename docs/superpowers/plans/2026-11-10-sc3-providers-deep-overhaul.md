# 6 Core Sports Providers Deep Overhaul & CS3 Plugin Kotlin Reverse-Engineering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the entire 6 Core Indian Sports Providers engine in `stream-verse-api` based on exhaustive reverse-engineering of the original CloudStream 3 (`sc3`) Kotlin plugins and compiled `.cs3` DEX binaries, resolving all gaps in pipe-header parsing, ClearKey license server resolution, stream URL fallbacks, percent-encoding bugs, probe header attribution, and proxy failovers with zero regressions.

**Architecture:**
- Universal pipe-header extractor supporting both `&` and `|` delimiters with `Cookie`, `Origin`, `Referer`, `User-Agent` propagation.
- %2F path normalization across edge proxy and provider URL resolvers.
- Complete ClearKey DRM engine with MPD `cenc:default_KID` extraction and dynamic ClearKey license server query resolution.
- Enriched provider fallbacks from SC3 `fallbackProviders` for guaranteed 100% catalog availability.
- Header-aware active stream probing to eliminate false dead-stream demotions.

**Tech Stack:** TypeScript, Bun, Hono, Node Crypto, Web Streams API.

**Spec:** Audited from `/home/code/projects/drafts/cnc/CNCVerse-Cloud-Stream-Extension` Kotlin sources and DEX binaries.

## Global Constraints
- Target workspace: `/home/code/projects/drafts/cnc/stream-verse-api`.
- Zero regressions: All 73+ tests across 15 suites must pass cleanly.
- Strict sub-millisecond in-memory caching and resilient circuit-breaking.

---

### Task 1: DrmHelper & M3U Parser Overhaul for ClearKey License Servers and Multi-Delimiter Pipe Headers

**Files:**
- Modify: `src/parsers/drm.helper.ts`
- Modify: `src/parsers/m3u.parser.ts`
- Test: `tests/m3u-parser.test.ts`

- [ ] **Step 1: Write tests for multi-delimiter pipe headers, Cookie header, %2F normalization, and ClearKey license keys in `tests/m3u-parser.test.ts`**
- [ ] **Step 2: Run `bun test tests/m3u-parser.test.ts` to verify test expectations**
- [ ] **Step 3: Implement multi-delimiter pipe header parsing (`/[|&]/`), Cookie header support, and ClearKey JSON parsing in `src/parsers/m3u.parser.ts` and `src/parsers/drm.helper.ts`**
- [ ] **Step 4: Run `bun test tests/m3u-parser.test.ts` to ensure passing**

---

### Task 2: Provider Adaptations for SC3 Kotlin Discoveries (LivXow, PlayFy, Cricify, Sportzx, SKTech, PlayZTV)

**Files:**
- Modify: `src/providers/livxow.provider.ts`
- Modify: `src/providers/playfy.provider.ts`
- Modify: `src/providers/cricify.provider.ts`
- Modify: `src/providers/sportzx.provider.ts`
- Modify: `src/providers/sktech.provider.ts`
- Modify: `src/providers/playztv.provider.ts`
- Test: `tests/crypto-fixtures.test.ts`
- Test: `tests/providers.test.ts`

- [ ] **Step 1: Write tests for LivXow stream URL alternatives (`url`, `stream_url`, `drm`), PlayFy updated App ID, and Cricify fallback providers**
- [ ] **Step 2: Update `livxow.provider.ts` with `stream.link || stream.url || stream.stream_url` and `stream.drm || stream.api`**
- [ ] **Step 3: Update `playfy.provider.ts` with DEX-verified appId `1:239487160038:android:308875071ce6f0fd48f527` and multi-delimiter headers**
- [ ] **Step 4: Update `cricify.provider.ts` with SC3 Kotlin permanent fallback channels and multi-delimiter headers**
- [ ] **Step 5: Update `sportzx.provider.ts`, `sktech.provider.ts`, and `playztv.provider.ts` with multi-delimiter pipe parsing and %2F normalization**
- [ ] **Step 6: Run `bun test tests/providers.test.ts tests/crypto-fixtures.test.ts` to ensure passing**

---

### Task 3: Edge Proxy & Prober Service Enhancements (%2F Normalization, Cookie Header, Probe Headers)

**Files:**
- Modify: `src/routes/proxy.route.ts`
- Modify: `src/prober/prober.service.ts`
- Test: `tests/proxy-failover.test.ts`
- Test: `tests/prober.test.ts`

- [ ] **Step 1: Add tests for %2F slash normalization and Cookie header propagation in `tests/proxy-failover.test.ts`**
- [ ] **Step 2: Implement %2F path normalization and Cookie header forwarding in `src/routes/proxy.route.ts`**
- [ ] **Step 3: Ensure `src/prober/prober.service.ts` passes custom stream headers during probe checks to avoid 403 false dead marks**
- [ ] **Step 4: Run `bun test tests/proxy-failover.test.ts tests/prober.test.ts` to verify**

---

### Task 4: Full Suite End-to-End Verification and Git Commit

**Files:**
- Test: Full `bun test` suite (15+ test files)
- Documentation: `api_architecture_and_working_guide.md`

- [ ] **Step 1: Run full test suite across all 15 test files with `bun test`**
- [ ] **Step 2: Update documentation artifact with new reverse-engineering findings and capabilities**
- [ ] **Step 3: Commit all changes with informative git commit message**
