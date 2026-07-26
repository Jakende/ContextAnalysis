#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATA_ACCESS_PROFILE_SCHEMA,
  DATA_ACCESS_THRESHOLDS,
  buildDataAccessProfile,
} from "../benchmark/profile-data-access.mjs";

const root = await mkdtemp(join(tmpdir(), "uca-data-access-profile-"));

try {
  const dataRoot = join(root, "data");
  const sourceDirectory = join(dataRoot, "processed", "fixture");
  const shardPath = join(sourceDirectory, "shards", "fixture.geojson");
  const indexPath = join(sourceDirectory, "index.json");
  const manifestPath = join(dataRoot, "data-release-manifest.json");
  await mkdir(join(sourceDirectory, "shards"), { recursive: true });
  await writeFile(shardPath, "{}\n", "utf8");
  await writeJson(indexPath, {
    type: "FeatureShardIndex",
    sourceId: "fixture-source",
    sourceVersion: "fixture-1",
    featureCount: 1,
    shardCount: 1,
    shards: [
      {
        key: "fixture",
        url: "/data/processed/fixture/shards/fixture.geojson",
        bbox: [-0.1, -0.1, 0.1, 0.1],
        count: 1,
      },
    ],
  });
  await writeManifest(manifestPath, 3);

  const passing = await buildDataAccessProfile({
    dataRoot,
    manifestPath,
    sources: [
      {
        sourceId: "fixture-source",
        indexPath: "processed/fixture/index.json",
        role: "exact-polygon-analysis",
      },
    ],
    radiiMeters: [1_000],
  });
  assert.equal(passing.schema, DATA_ACCESS_PROFILE_SCHEMA);
  assert.equal(passing.summary.status, "pass");
  assert.equal(passing.observations[0].selectedShards, 1);
  assert.equal(passing.observations[0].transferBytes, 3);

  const shardFile = await open(shardPath, "r+");
  await shardFile.truncate(DATA_ACCESS_THRESHOLDS.maxSingleShardBytes + 1);
  await shardFile.close();
  await writeManifest(
    manifestPath,
    DATA_ACCESS_THRESHOLDS.maxSingleShardBytes + 1,
  );
  const failing = await buildDataAccessProfile({
    dataRoot,
    manifestPath,
    sources: [
      {
        sourceId: "fixture-source",
        indexPath: "processed/fixture/index.json",
        role: "exact-polygon-analysis",
      },
    ],
    radiiMeters: [1_000],
  });
  assert.equal(failing.summary.status, "optimize");
  assert.deepEqual(failing.observations[0].failedThresholds, [
    "single-shard-bytes",
  ]);
  assert.deepEqual(failing.decision.failingSourceIds, ["fixture-source"]);

  console.log("Data-access profile contract validation passed");

  async function writeManifest(path, shardBytes) {
    await writeJson(path, {
      releaseId: "uca-data-fixture00000000",
      releaseDigest: "fixture",
      regressionCities: [
        { id: "fixture-city", label: "Fixture", lat: 0, lon: 0 },
      ],
      assets: [
        {
          path: "processed/fixture/shards/fixture.geojson",
          bytes: shardBytes,
        },
      ],
    });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
