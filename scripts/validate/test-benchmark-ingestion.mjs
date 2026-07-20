import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { preprocessBenchmarkPeers } from "../preprocess/preprocess-benchmark-peers.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = resolve(
  projectRoot,
  "scripts/validate/fixtures/benchmark-peers.synthetic.json",
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "uca-benchmark-ingestion-"));

try {
  const firstOutput = join(temporaryDirectory, "first.json");
  const secondOutput = join(temporaryDirectory, "second.json");
  const first = await preprocessBenchmarkPeers({ inputPath: fixturePath, outputPath: firstOutput });
  const second = await preprocessBenchmarkPeers({ inputPath: fixturePath, outputPath: secondOutput });

  assert.equal(first.status, "curated");
  assert.deepEqual(first.peers.map((peer) => peer.id), ["synthetic-peer-a", "synthetic-peer-b"]);
  assert.ok(first.peers.every((peer) => peer.observedAt === "2026-01-15T00:00:00.000Z"));
  assert.equal(await readFile(firstOutput, "utf8"), await readFile(secondOutput, "utf8"));
  assert.deepEqual(first, second);

  await validateCsvInput(temporaryDirectory);
  await validateRuntimeSchema(first);
  await validateRejectInvalidCases(temporaryDirectory);

  console.log("Benchmark ingestion validation passed");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function validateCsvInput(directory) {
  const csvPath = join(directory, "synthetic.csv");
  const csv = [
    "peer_id,peer_label,geography_type,context_type,radius_meters,area_sqm,context_geography_type,observed_at,source_ids,source_versions,confidence,caveats,kpi.local-quality-score,kpi.mobility_access",
    "synthetic-csv-b,SYNTHETIC CSV B,district,radius,500,785398.16,,2026-01-15T00:00:00.000Z,uca-benchmark-peers,uca-benchmark-peers=synthetic-test-1,low,Synthetic fixture only,45,50",
    "synthetic-csv-a,SYNTHETIC CSV A,district,radius,500,785398.16,,2026-01-15T00:00:00.000Z,uca-benchmark-peers,uca-benchmark-peers=synthetic-test-1,low,Synthetic fixture only,55,60",
  ].join("\n");
  await writeFile(csvPath, `${csv}\n`, "utf8");
  const result = await preprocessBenchmarkPeers({
    inputPath: csvPath,
    datasetId: "synthetic-csv-test",
    datasetVersion: "synthetic-1",
    label: "SYNTHETIC CSV validation fixture",
    preprocessedAt: "2026-02-01T00:00:00.000Z",
    confidence: "low",
    caveats: ["Synthetic fixture only; not observed data."],
  });
  assert.deepEqual(result.peers.map((peer) => peer.id), ["synthetic-csv-a", "synthetic-csv-b"]);
}

async function validateRuntimeSchema(dataset) {
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const benchmark = await server.ssrLoadModule("/src/lib/analysis/benchmark/benchmark.ts");
    assert.equal(benchmark.validateBenchmarkDataset(dataset).status, "curated");
  } finally {
    await server.close();
  }
}

async function validateRejectInvalidCases(directory) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const cases = [
    {
      name: "duplicate-peer",
      mutate(value) { value.peers[1].id = value.peers[0].id.toUpperCase(); },
      pattern: /Duplicate benchmark peer ID/,
    },
    {
      name: "out-of-range-score",
      mutate(value) { value.peers[0].scores["kpi.mobility_access"] = 101; },
      pattern: /0 to 100/,
    },
    {
      name: "unknown-kpi",
      mutate(value) { value.peers[0].scores["kpi.typo"] = 50; },
      pattern: /unknown KPI ID/,
    },
    {
      name: "unknown-source",
      mutate(value) {
        value.peers[0].sourceIds = ["not-in-source-registry"];
        value.peers[0].sourceVersions = { "not-in-source-registry": "1" };
      },
      pattern: /unknown source registry ID/,
    },
    {
      name: "missing-source-version",
      mutate(value) { value.peers[0].sourceVersions = {}; },
      pattern: /missing source version/,
    },
    {
      name: "missing-observed-at",
      mutate(value) { delete value.peers[0].observedAt; },
      pattern: /observedAt must be a non-empty string/,
    },
    {
      name: "mixed-context",
      mutate(value) { value.peers[0].context = { type: "project-area", areaSqm: 785398.16 }; },
      pattern: /Mixed benchmark context types/,
    },
    {
      name: "incomparable-radius",
      mutate(value) { value.peers[0].context.radiusMeters = 800; },
      pattern: /same radius/,
    },
    {
      name: "future-observation",
      mutate(value) { value.peers[0].observedAt = "2026-03-01T00:00:00.000Z"; },
      pattern: /cannot be later than preprocessedAt/,
    },
    {
      name: "missing-caveats",
      mutate(value) { value.peers[0].caveats = []; },
      pattern: /must declare at least one caveat/,
    },
  ];

  for (const testCase of cases) {
    const value = structuredClone(fixture);
    testCase.mutate(value);
    const path = join(directory, `${testCase.name}.json`);
    await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
    await assert.rejects(
      () => preprocessBenchmarkPeers({ inputPath: path }),
      testCase.pattern,
      testCase.name,
    );
  }
}
