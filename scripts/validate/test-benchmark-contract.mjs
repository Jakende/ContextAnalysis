import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const benchmark = await server.ssrLoadModule("/src/lib/analysis/benchmark/benchmark.ts");
  const { sourceRegistry } = await server.ssrLoadModule("/src/lib/data/sourceRegistry.ts");

  validateDataset(benchmark);
  validateComparableRadius(benchmark);
  validateProjectAreaSuppression(benchmark);
  validateRadiusMismatchSuppression(benchmark);
  validateMalformedDatasetRejection(benchmark);

  assert.equal(
    sourceRegistry["uca-benchmark-peers"].localPath,
    "src/lib/data/benchmark/peers.v1.json",
  );
  assert.match(sourceRegistry["uca-benchmark-peers"].notes, /illustrative/i);

  console.log("Benchmark contract validation passed");
} finally {
  await server.close();
}

function validateDataset({ benchmarkDataset }) {
  assert.equal(benchmarkDataset.schemaVersion, "1.0.0");
  assert.equal(benchmarkDataset.status, "illustrative");
  assert.equal(benchmarkDataset.confidence, "low");
  assert.ok(Number.isFinite(Date.parse(benchmarkDataset.preprocessedAt)));
  assert.ok(benchmarkDataset.peers.length >= 2);
  assert.equal(new Set(benchmarkDataset.peers.map((peer) => peer.id)).size, benchmarkDataset.peers.length);
  for (const peer of benchmarkDataset.peers) {
    assert.equal(peer.context.type, "radius");
    assert.equal(peer.context.radiusMeters, 500);
    assert.equal(peer.confidence, "low");
    assert.ok(peer.caveats.some((caveat) => /illustrative/i.test(caveat)));
    assert.ok(peer.sourceIds.length > 0);
    assert.ok(Object.keys(peer.sourceVersions).length > 0);
    for (const score of Object.values(peer.scores)) {
      assert.ok(score >= 0 && score <= 100);
    }
  }
}

function validateComparableRadius({ createBenchmarkModule }) {
  const result = createBenchmarkModule(
    kpiIndicators(),
    "2026-07-20T00:00:00.000Z",
    { type: "radius", radiusMeters: 500, areaSqm: Math.PI * 500 * 500 },
  );
  const indicators = byId(result.indicators);
  assert.match(String(indicators["benchmark.comparability-status"].value), /^Comparable:/);
  assert.notEqual(indicators["benchmark.local-quality-rank"].value, null);
  assert.notEqual(indicators["benchmark.local-quality-percentile"].value, null);
  assert.equal(
    indicators["benchmark.dataset-preprocessed-at"].value,
    "2026-05-31T00:00:00.000Z",
  );
  assert.equal(indicators["benchmark.local-quality-percentile"].sourceVersion, "1.0.0/illustrative-1");
  assert.equal(indicators["benchmark.local-quality-percentile"].confidence, "low");
}

function validateProjectAreaSuppression({ createBenchmarkModule }) {
  const result = createBenchmarkModule(
    kpiIndicators(),
    "2026-07-20T00:00:00.000Z",
    { type: "project-area", areaSqm: Math.PI * 500 * 500 },
  );
  const indicators = byId(result.indicators);
  assert.match(String(indicators["benchmark.comparability-status"].value), /^Suppressed:/);
  assert.match(String(indicators["benchmark.comparability-status"].value), /project-area/);
  assertBenchmarkOutputsSuppressed(indicators);
}

function validateRadiusMismatchSuppression({ createBenchmarkModule }) {
  const result = createBenchmarkModule(
    kpiIndicators(),
    "2026-07-20T00:00:00.000Z",
    { type: "radius", radiusMeters: 800, areaSqm: Math.PI * 800 * 800 },
  );
  const indicators = byId(result.indicators);
  assert.match(String(indicators["benchmark.comparability-status"].value), /^Suppressed:/);
  assert.match(String(indicators["benchmark.comparability-status"].value), /800 m radius/);
  assertBenchmarkOutputsSuppressed(indicators);
}

function validateMalformedDatasetRejection({ benchmarkDataset, validateBenchmarkDataset }) {
  const duplicated = structuredClone(benchmarkDataset);
  duplicated.peers[1].id = duplicated.peers[0].id;
  assert.throws(() => validateBenchmarkDataset(duplicated), /Duplicate benchmark peer id/);

  const invalidScore = structuredClone(benchmarkDataset);
  invalidScore.peers[0].scores["kpi.local-quality-score"] = 101;
  assert.throws(() => validateBenchmarkDataset(invalidScore), /Invalid benchmark score/);

  const misleading = structuredClone(benchmarkDataset);
  misleading.confidence = "high";
  assert.throws(
    () => validateBenchmarkDataset(misleading),
    /Illustrative benchmark datasets must have low confidence/,
  );
}

function assertBenchmarkOutputsSuppressed(indicators) {
  for (const [id, indicator] of Object.entries(indicators)) {
    if (
      id === "benchmark.local-quality-rank" ||
      id.includes("percentile") ||
      id === "benchmark.strongest-relative-kpi" ||
      id === "benchmark.weakest-relative-kpi"
    ) {
      assert.equal(indicator.value, null, `${id} must be suppressed`);
      assert.ok(
        indicator.caveats.some((caveat) => /not comparable|non-comparable/i.test(caveat)),
        `${id} must explain context suppression`,
      );
    }
  }
}

function kpiIndicators() {
  const computedAt = "2026-07-20T00:00:00.000Z";
  return [
    ["kpi.local-quality-score", 74],
    ["kpi.mobility_access", 81],
    ["kpi.green_blue_access", 56],
    ["kpi.urban_mix", 70],
    ["kpi.social_infrastructure", 84],
    ["kpi.tree_canopy", 61],
    ["kpi.station_axis", 77],
  ].map(([id, value]) => ({
    id,
    label: id,
    scale: "L",
    value,
    method: "test fixture",
    sourceIds: ["test-fixture"],
    computedAt,
    confidence: "low",
    caveats: [],
  }));
}

function byId(indicators) {
  return Object.fromEntries(indicators.map((indicator) => [indicator.id, indicator]));
}
