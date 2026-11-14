import app from "../src/index";
import { aggregatorService } from "../src/services/aggregator.service";

console.log("=== Sportify Live Sports Gateway: Production-Grade Benchmark ===");

// 1. Warm up cache
console.log("1. Pre-warming cache...");
const startWarm = performance.now();
await aggregatorService.getEvents();
await aggregatorService.getUnifiedCatalog();
console.log(`Cache warmed up in ${(performance.now() - startWarm).toFixed(2)}ms`);

// 2. Benchmarking cached /api/catalog latency over 100 iterations
console.log("\n2. Benchmarking cached /api/catalog latency over 100 iterations...");
const catalogLatencies: number[] = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  const res = await app.request("/api/catalog");
  const t1 = performance.now();
  if (res.status === 200) {
    catalogLatencies.push(t1 - t0);
  }
}

const avgCatalog = catalogLatencies.reduce((a, b) => a + b, 0) / catalogLatencies.length;
const minCatalog = Math.min(...catalogLatencies);
const maxCatalog = Math.max(...catalogLatencies);
const p95Catalog = catalogLatencies.sort((a, b) => a - b)[Math.floor(catalogLatencies.length * 0.95)];

console.log(`Catalog Average Latency: ${avgCatalog.toFixed(2)}ms`);
console.log(`Catalog Min Latency:     ${minCatalog.toFixed(2)}ms`);
console.log(`Catalog Max Latency:     ${maxCatalog.toFixed(2)}ms`);
console.log(`Catalog P95 Latency:     ${p95Catalog.toFixed(2)}ms`);

if (avgCatalog < 2.0) {
  console.log("✅ SUCCESS: Cached /api/catalog latency < 2ms SLA met!");
}

// 3. Benchmarking cached /api/v1/events latency over 50 iterations
console.log("\n3. Benchmarking cached /api/v1/events latency over 50 iterations...");
const latencies: number[] = [];
for (let i = 0; i < 50; i++) {
  const t0 = performance.now();
  const res = await app.request("/api/v1/events");
  const t1 = performance.now();
  if (res.status === 200) {
    latencies.push(t1 - t0);
  }
}

const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

console.log(`Events Average Latency:  ${avgLatency.toFixed(2)}ms`);
console.log(`Events P95 Latency:      ${p95Latency.toFixed(2)}ms`);

if (avgLatency < 2.0) {
  console.log("✅ SUCCESS: Cached /api/v1/events latency < 2ms SLA met!");
}

// 4. Memory profiling under high concurrency (100 parallel requests across multiple endpoints)
console.log("\n4. Testing memory stability under concurrent requests...");
const memBefore = process.memoryUsage();

const concurrentCalls = [
  ...Array.from({ length: 50 }, () => app.request("/api/catalog")),
  ...Array.from({ length: 50 }, () => app.request("/api/v1/events")),
  ...Array.from({ length: 20 }, () => app.request("/api/sports")),
];
await Promise.all(concurrentCalls);

const memAfter = process.memoryUsage();
console.log(`Heap Used Before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`Heap Used After:  ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`Delta:            ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`);

console.log("\nCache Stats:", JSON.stringify(aggregatorService.getCacheStats(), null, 2));

process.exit(0);
