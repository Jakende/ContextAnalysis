#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHARD_FRAGMENT_SCHEMA,
  applyValidatedStaging,
  compactShardedPolygons,
  inspectCompactionPreflight,
  validateApplyOptions,
} from "../preprocess/compact-sharded-polygons.mjs";
import { writeJson } from "../preprocess/shared.mjs";

const root = await mkdtemp(join(tmpdir(), "uca-shard-compaction-"));
const canonicalDir = join(root, "public/data/processed/example");
const inputIndexPath = join(canonicalDir, "index.json");
const stageOne = join(root, "stage-one");
const stageTwo = join(root, "stage-two");
const stageGdal = join(root, "stage-gdal");
const generatedAt = "2026-07-27T08:00:00.000Z";
const sourceId = "copernicus-urban-atlas";
const sourceFeature = {
  type: "Feature",
  properties: {
    sourceId,
    sourceVersion: "2021",
    identifier: "synthetic-road-1",
    partIndex: 0,
    label: "Other roads and associated land",
    area: 1.0,
  },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0.25, 0.25],
        [1.75, 0.25],
        [1.75, 0.75],
        [0.25, 0.75],
        [0.25, 0.25],
      ],
      [
        [0.8, 0.4],
        [1.2, 0.4],
        [1.2, 0.6],
        [0.8, 0.6],
        [0.8, 0.4],
      ],
    ],
  },
};

await writeJson(join(canonicalDir, "shards/90_180.geojson"), {
  type: "FeatureCollection",
  features: [sourceFeature],
});
await writeJson(join(canonicalDir, "shards/90_181.geojson"), {
  type: "FeatureCollection",
  features: [sourceFeature],
});
await writeJson(inputIndexPath, {
  type: "FeatureShardIndex",
  sourceId,
  sourceVersion: "2021",
  shardDegrees: 1,
  featureCount: 1,
  shardCount: 2,
  generatedAt: "2026-01-01T00:00:00.000Z",
  shards: [
    {
      key: "90_180",
      url: "/data/processed/example/shards/90_180.geojson",
      bbox: [0, 0, 1, 1],
      count: 1,
    },
    {
      key: "90_181",
      url: "/data/processed/example/shards/90_181.geojson",
      bbox: [1, 0, 2, 1],
      count: 1,
    },
  ],
});

const preflight = await inspectCompactionPreflight({
  inputIndexPath,
  expectedSourceId: sourceId,
});
assert.equal(preflight.declaredFeatureCount, 1);
assert.equal(preflight.inputShardCount, 2);
assert.ok(preflight.inputBytes > 0);
assert.ok(preflight.estimatedPeakHeapBytes >= preflight.inputBytes * 4);

const first = await compactShardedPolygons({
  inputIndexPath,
  stagingDir: stageOne,
  expectedSourceId: sourceId,
  generatedAt,
});
assert.equal(first.applied, false);
assert.equal(first.inputRecordCount, 2);
assert.equal(first.sourcePartCount, 1);
assert.equal(first.duplicateInputRecords, 1);
assert.equal(first.fragmentCount, 2);
assert.equal(first.outputShardCount, 2);
assert.equal(first.validatedSourceParts, 1);
assert.equal(first.validatedFragments, 2);
assert.equal(first.topologyPreflight.checkedSourcePartCount, 1);
assert.equal(first.topologyPreflight.invalidSourcePartCount, 0);

const indexOne = JSON.parse(await readFile(join(stageOne, "index.json"), "utf8"));
assert.equal(indexOne.featureCount, 1);
assert.equal(indexOne.sourcePartCount, 1);
assert.equal(indexOne.fragmentCount, 2);
assert.equal(indexOne.fragmentSchema, SHARD_FRAGMENT_SCHEMA);

const fragmentsOne = await loadFragments(stageOne, indexOne);
assert.equal(fragmentsOne.length, 2);
assert.equal(new Set(fragmentsOne.map((feature) => feature.id)).size, 2);
assert.equal(
  new Set(fragmentsOne.map((feature) => feature.properties.sourcePartId)).size,
  1,
);
for (const feature of fragmentsOne) {
  assert.equal(feature.id, feature.properties.fragmentId);
  assert.equal(feature.properties.fragmentSchema, SHARD_FRAGMENT_SCHEMA);
  assert.equal(feature.properties.fragmentSourceGeometryValidity, "valid");
  assert.equal(feature.properties.fragmentGeometryRepair, null);
  assert.equal(feature.properties.label, sourceFeature.properties.label);
  assert.equal(feature.properties.area, sourceFeature.properties.area);
}
assert.deepEqual(geometryBbox(fragmentsOne[0].geometry), [0.25, 0.25, 1, 0.75]);
assert.deepEqual(geometryBbox(fragmentsOne[1].geometry), [1, 0.25, 1.75, 0.75]);
assert.ok(
  Math.abs(
    fragmentsOne.reduce((sum, feature) => sum + polygonArea(feature.geometry), 0) -
      polygonArea(sourceFeature.geometry),
  ) < 1e-12,
  "exact shard clipping must conserve polygon area, including holes",
);

const second = await compactShardedPolygons({
  inputIndexPath,
  stagingDir: stageTwo,
  expectedSourceId: sourceId,
  generatedAt,
});
const indexTwo = JSON.parse(await readFile(join(stageTwo, "index.json"), "utf8"));
const fragmentsTwo = await loadFragments(stageTwo, indexTwo);
assert.deepEqual(
  fragmentsTwo.map((feature) => feature.id),
  fragmentsOne.map((feature) => feature.id),
  "fragment IDs must be stable across deterministic rebuilds",
);
assert.equal(
  await readFile(join(stageTwo, "index.json"), "utf8"),
  await readFile(join(stageOne, "index.json"), "utf8"),
  "staged indexes must be byte-stable for identical inputs and timestamps",
);

const forcedGdal = await compactShardedPolygons({
  inputIndexPath,
  stagingDir: stageGdal,
  expectedSourceId: sourceId,
  generatedAt,
  clipEngine: "gdal",
});
const forcedGdalEngine = Object.keys(forcedGdal.clipEngineCounts).find((engine) =>
  engine.startsWith("gdal-ogr/"),
);
assert.ok(forcedGdalEngine, "forced OGR clipping must report its GDAL version");
assert.equal(forcedGdal.clipEngineCounts[forcedGdalEngine], 2);
assert.equal(forcedGdal.repairedSourcePartCount, 0);
assert.equal(forcedGdal.ogrValidatedFragments, 2);
const indexGdal = JSON.parse(await readFile(join(stageGdal, "index.json"), "utf8"));
const fragmentsGdal = await loadFragments(stageGdal, indexGdal);
for (const feature of fragmentsGdal) {
  assert.equal(feature.properties.fragmentClipEngine, forcedGdalEngine);
  assert.equal(feature.properties.fragmentGeometryRepair, null);
  assert.equal(feature.properties.fragmentSourceGeometryValidity, "valid");
}
assert.ok(
  Math.abs(
    fragmentsGdal.reduce(
      (sum, feature) => sum + polygonArea(feature.geometry),
      0,
    ) - polygonArea(sourceFeature.geometry),
  ) < 1e-12,
  "forced OGR clipping must conserve valid source area",
);

await assert.rejects(
  compactShardedPolygons({
    inputIndexPath,
    stagingDir: stageOne,
    expectedSourceId: sourceId,
    generatedAt,
  }),
  /Refusing to overwrite existing staging directory/,
);
assert.throws(
  () =>
    validateApplyOptions({
      inputIndexPath,
      stagingDir: join(root, "unused-stage"),
      expectedSourceId: sourceId,
      applyTo: canonicalDir,
      confirmApply: sourceId,
    }),
  /requires all of --apply-to, --backup-dir, and --confirm-apply/,
);
assert.throws(
  () =>
    validateApplyOptions({
      inputIndexPath,
      stagingDir: join(root, "unused-stage"),
      expectedSourceId: sourceId,
      applyTo: canonicalDir,
      backupDir: join(root, "backup"),
      confirmApply: "wrong-source",
    }),
  /must exactly equal copernicus-urban-atlas/,
);

await writeJson(join(canonicalDir, "shards/90_180.geojson"), {
  type: "FeatureCollection",
  features: [
    {
      ...sourceFeature,
      properties: { ...sourceFeature.properties, label: "Changed after staging" },
    },
  ],
});
const guardedBackup = join(root, "guarded-backup");
await assert.rejects(
  applyValidatedStaging({
    inputIndexPath,
    stagingDir: stageOne,
    expectedSourceId: sourceId,
    applyTo: canonicalDir,
    backupDir: guardedBackup,
    confirmApply: sourceId,
  }),
  /Canonical input assets changed after staging/,
);
assert.ok(existsSync(canonicalDir), "digest rejection must leave canonical input in place");
assert.ok(existsSync(stageOne), "digest rejection must leave reviewed staging in place");
assert.equal(existsSync(guardedBackup), false, "digest rejection must not create a backup");

const invalidRoot = await mkdtemp(join(tmpdir(), "uca-shard-compaction-invalid-"));
const invalidDir = join(invalidRoot, "public/data/processed/example");
const invalidIndexPath = join(invalidDir, "index.json");
await writeJson(join(invalidDir, "shards/90_180.geojson"), {
  type: "FeatureCollection",
  features: [sourceFeature],
});
await writeJson(join(invalidDir, "shards/90_181.geojson"), {
  type: "FeatureCollection",
  features: [
    {
      ...sourceFeature,
      properties: { ...sourceFeature.properties, label: "Divergent label" },
    },
  ],
});
await writeJson(
  invalidIndexPath,
  {
    ...JSON.parse(await readFile(inputIndexPath, "utf8")),
    shards: [
      {
        key: "90_180",
        url: "/data/processed/example/shards/90_180.geojson",
        bbox: [0, 0, 1, 1],
        count: 1,
      },
      {
        key: "90_181",
        url: "/data/processed/example/shards/90_181.geojson",
        bbox: [1, 0, 2, 1],
        count: 1,
      },
    ],
  },
);
await assert.rejects(
  compactShardedPolygons({
    inputIndexPath: invalidIndexPath,
    stagingDir: join(invalidRoot, "stage"),
    expectedSourceId: sourceId,
    generatedAt,
  }),
  /inconsistent properties across shards/,
);

const repairRoot = await mkdtemp(join(tmpdir(), "uca-shard-compaction-repair-"));
const repairDir = join(repairRoot, "public/data/processed/example");
const repairIndexPath = join(repairDir, "index.json");
const repairGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0.1, 0.1],
      [1.8, 0.1],
      [0.2, 0.9],
      [1.6, 0.8],
      [0.1, 0.1],
    ],
  ],
};
const repairFeature = {
  ...sourceFeature,
  properties: {
    ...sourceFeature.properties,
    identifier: "synthetic-invalid-road-1",
  },
  geometry: repairGeometry,
};
await writeJson(join(repairDir, "shards/90_180.geojson"), {
  type: "FeatureCollection",
  features: [repairFeature],
});
await writeJson(join(repairDir, "shards/90_181.geojson"), {
  type: "FeatureCollection",
  features: [repairFeature],
});
await writeJson(repairIndexPath, {
  ...JSON.parse(await readFile(inputIndexPath, "utf8")),
  generatedAt: "2026-01-02T00:00:00.000Z",
});
const repairStage = join(repairRoot, "stage");
const repaired = await compactShardedPolygons({
  inputIndexPath: repairIndexPath,
  stagingDir: repairStage,
  expectedSourceId: sourceId,
  generatedAt,
});
assert.equal(repaired.sourcePartCount, 1);
assert.equal(repaired.repairedSourcePartCount, 1);
assert.equal(repaired.clipEngineRequested, "auto");
assert.equal(repaired.topologyPreflight.checkedSourcePartCount, 1);
assert.equal(repaired.topologyPreflight.invalidSourcePartCount, 1);
assert.equal(repaired.ogrValidatedFragments, repaired.fragmentCount);
const repairedIndex = JSON.parse(
  await readFile(join(repairStage, "index.json"), "utf8"),
);
const repairedFragments = await loadFragments(repairStage, repairedIndex);
assert.ok(repairedFragments.length > 0);
for (const feature of repairedFragments) {
  assert.match(feature.properties.fragmentClipEngine, /^gdal-ogr\//);
  assert.equal(
    feature.properties.fragmentGeometryRepair,
    "gdal-make-valid-linework",
  );
  assert.equal(
    feature.properties.fragmentSourceGeometryValidity,
    "invalid-repaired",
  );
  assert.ok(
    Math.abs(
      feature.properties.fragmentSourceAreaBeforeRepairDegrees2 -
        polygonArea(repairGeometry),
    ) < 1e-12,
  );
  assert.ok(feature.properties.fragmentSourceAreaAfterRepairDegrees2 > 0);
}
assert.ok(
  Math.abs(
    repairedFragments.reduce(
      (sum, feature) => sum + polygonArea(feature.geometry),
      0,
    ) - repairedIndex.compaction.sourceAreaDegrees2,
  ) < 1e-10,
  "repaired fragments must conserve the explicitly repaired source area",
);

const decimalGridRoot = await mkdtemp(
  join(tmpdir(), "uca-shard-compaction-decimal-grid-"),
);
const decimalGridDir = join(
  decimalGridRoot,
  "public/data/processed/example",
);
const decimalGridIndexPath = join(decimalGridDir, "index.json");
const decimalGridFeature = {
  type: "Feature",
  properties: {
    sourceId,
    sourceVersion: "2021",
    identifier: "decimal-grid-boundary",
    partIndex: 0,
  },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [11.06387499999892, 48.000000000000014],
      [11.063875, 48],
      [11.063952, 47.999999],
      [11.064024000001023, 48.000000000000014],
      [11.06387499999892, 48.000000000000014],
    ]],
  },
};
await writeJson(join(decimalGridDir, "shards/2760_3821.geojson"), {
  type: "FeatureCollection",
  features: [decimalGridFeature],
});
await writeJson(decimalGridIndexPath, {
  type: "FeatureShardIndex",
  sourceId,
  sourceVersion: "2021",
  shardDegrees: 0.05,
  featureCount: 1,
  shardCount: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  shards: [
    {
      key: "2760_3821",
      url: "/data/processed/example/shards/2760_3821.geojson",
      bbox: [11.05, 48, 11.1, 48.05],
      count: 1,
    },
  ],
});
const decimalGridStage = join(decimalGridRoot, "stage");
const decimalGridResult = await compactShardedPolygons({
  inputIndexPath: decimalGridIndexPath,
  stagingDir: decimalGridStage,
  expectedSourceId: sourceId,
  generatedAt,
});
assert.equal(decimalGridResult.topologyPreflight.invalidSourcePartCount, 0);
assert.equal(
  decimalGridResult.ogrValidatedFragments,
  decimalGridResult.fragmentCount,
  "decimal shard bounds must remain topology-safe after coordinate normalization",
);

console.log("Sharded polygon compaction tests passed.");

async function loadFragments(stage, index) {
  const features = [];
  for (const shard of index.shards) {
    const collection = JSON.parse(
      await readFile(join(stage, "shards", `${shard.key}.geojson`), "utf8"),
    );
    features.push(...collection.features);
  }
  return features;
}

function geometryBbox(geometry) {
  const coordinates = [];
  flattenCoordinates(geometry.coordinates, coordinates);
  return coordinates.reduce(
    (bbox, coordinate) => [
      Math.min(bbox[0], coordinate[0]),
      Math.min(bbox[1], coordinate[1]),
      Math.max(bbox[2], coordinate[0]),
      Math.max(bbox[3], coordinate[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function flattenCoordinates(value, output) {
  if (typeof value?.[0] === "number") {
    output.push(value);
    return;
  }
  value.forEach((item) => flattenCoordinates(item, output));
}

function polygonArea(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  return polygons.reduce((total, polygon) => {
    const outer = Math.abs(ringArea(polygon[0]));
    const holes = polygon
      .slice(1)
      .reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
    return total + outer - holes;
  }, 0);
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 1; index < ring.length; index += 1) {
    sum +=
      ring[index - 1][0] * ring[index][1] -
      ring[index][0] * ring[index - 1][1];
  }
  return sum / 2;
}
