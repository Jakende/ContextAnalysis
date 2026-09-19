#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promotePointCache } from "../preprocess/promote-point-cache.mjs";
import { writeJson } from "../preprocess/shared.mjs";

const root = await mkdtemp(join(tmpdir(), "uca-promote-cache-"));
const canonicalIndexPath = join(
  root,
  "public/data/processed/example/index.json",
);
const cacheIndexPath = join(
  root,
  "public/data/processed/cache/example/frankfurt/index.json",
);
const munichShardPath = join(
  root,
  "public/data/processed/example/shards/2769_3831.geojson",
);
const sourceId = "example-source";
const generatedAt = "2026-07-26T12:00:00.000Z";

const munich = polygonFeature(sourceId, "v1", "munich", 11.58, 48.13);
const frankfurt = polygonFeature(sourceId, "v2", "frankfurt", 8.68, 50.11);
await writeJson(munichShardPath, {
  type: "FeatureCollection",
  features: [munich],
});
await writeJson(canonicalIndexPath, {
  type: "FeatureShardIndex",
  sourceId,
  sourceVersion: "v1",
  shardDegrees: 0.05,
  featureCount: 1,
  shardCount: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  shards: [
    {
      key: "2769_3831",
      url: "shards/2769_3831.geojson",
      bbox: [11.55, 48.45, 11.6, 48.5],
      count: 1,
    },
  ],
});
await writeJson(cacheIndexPath, {
  type: "FeatureCollection",
  features: [frankfurt, frankfurt],
});

const requiredBbox = [8.67, 50.1, 8.7, 50.12];
const first = await promotePointCache({
  cacheIndexPath,
  canonicalIndexPath,
  expectedSourceId: sourceId,
  requiredBbox,
  generatedAt,
});
assert.equal(first.inputFeatures, 1);
assert.equal(first.addedFeatures, 1);

const canonicalAfterFirst = JSON.parse(await readFile(canonicalIndexPath, "utf8"));
assert.equal(canonicalAfterFirst.featureCount, 2);
assert.equal(canonicalAfterFirst.sourceVersion, "v1+v2");
assert.equal(canonicalAfterFirst.coverageInputs.length, 1);
assert.equal(
  JSON.parse(await readFile(munichShardPath, "utf8")).features.length,
  1,
  "existing Munich shard must remain unchanged",
);

const second = await promotePointCache({
  cacheIndexPath,
  canonicalIndexPath,
  expectedSourceId: sourceId,
  requiredBbox,
  generatedAt,
});
assert.equal(second.addedFeatures, 0, "promotion must be idempotent");
assert.equal(
  JSON.parse(await readFile(canonicalIndexPath, "utf8")).featureCount,
  2,
);

await assert.rejects(
  promotePointCache({
    cacheIndexPath,
    canonicalIndexPath,
    expectedSourceId: sourceId,
    requiredBbox: [12.1, 47.8, 12.2, 47.9],
    generatedAt,
    dryRun: true,
  }),
  /has no example-source polygon intersecting required bbox/,
);

console.log("Point-cache promotion tests passed.");

function polygonFeature(featureSourceId, sourceVersion, identifier, lon, lat) {
  return {
    type: "Feature",
    properties: {
      sourceId: featureSourceId,
      sourceVersion,
      identifier,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, lat],
          [lon + 0.005, lat],
          [lon + 0.005, lat + 0.005],
          [lon, lat + 0.005],
          [lon, lat],
        ],
      ],
    },
  };
}
