#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { getHeapStatistics } from "node:v8";
import polygonClipping from "polygon-clipping";
import { parseArgs, readJson, requireArg, writeJson } from "./shared.mjs";

export const SHARD_FRAGMENT_SCHEMA = "uca-shard-fragment/1";
export const SHARD_COMPACTION_SCHEMA = "uca-sharded-polygon-compaction/1";

const COMPACTION_PROPERTY_KEYS = new Set([
  "fragmentId",
  "fragmentSchema",
  "fragmentShardKey",
  "fragmentClipEngine",
  "fragmentGeometryRepair",
  "fragmentSourceGeometryValidity",
  "fragmentSourceAreaBeforeRepairDegrees2",
  "fragmentSourceAreaAfterRepairDegrees2",
  "sourcePartId",
]);
const MAX_OPEN_SPOOL_FILES = 24;
const POLYGON_CLIPPING_COORDINATE_LIMIT = 200_000;
const POLYGON_CLIPPING_RING_LIMIT = 2_000;
const EPSILON = 1e-10;

export async function compactShardedPolygons({
  inputIndexPath,
  stagingDir,
  expectedSourceId,
  generatedAt,
  publicPrefix,
  clipEngine = "auto",
}) {
  const paths = validatePaths({
    inputIndexPath,
    stagingDir,
    expectedSourceId,
    generatedAt,
  });
  if (!["auto", "gdal"].includes(clipEngine)) {
    throw new Error("clipEngine must be auto or gdal");
  }
  const inputIndexText = await readFile(paths.inputIndexPath, "utf8");
  const index = JSON.parse(inputIndexText);
  validateIndex(index, paths.inputIndexPath, expectedSourceId);
  const preflight = await preflightMemoryGuard(index, paths.inputIndexPath);
  const resolvedPublicPrefix =
    publicPrefix ?? derivePublicPrefix(index, paths.inputIndexPath);
  const partialDir = `${paths.stagingDir}.partial-${process.pid}`;
  if (existsSync(partialDir)) {
    throw new Error(`Refusing to overwrite partial staging directory ${partialDir}`);
  }

  await mkdir(partialDir, { recursive: false });
  try {
    const loaded = await loadSourceParts({
      index,
      inputIndexText,
      inputIndexPath: paths.inputIndexPath,
      expectedSourceId,
    });
    const declaredSourcePartCount =
      Number.isInteger(index.sourcePartCount)
        ? index.sourcePartCount
        : index.fragmentSchema
          ? null
          : index.featureCount;
    if (
      declaredSourcePartCount !== null &&
      declaredSourcePartCount !== loaded.sourceParts.length
    ) {
      throw new Error(
        `${paths.inputIndexPath} declares ${Number.isInteger(index.sourcePartCount) ? "sourcePartCount" : "unfragmented featureCount"}=${declaredSourcePartCount}, but ${loaded.sourceParts.length} unique source parts were reconstructed`,
      );
    }

    const topologyPreflight = await preflightSourcePartTopology({
      sourceParts: loaded.sourceParts,
      workDir: partialDir,
    });
    const output = await writeCompactedStage({
      index,
      sourceParts: loaded.sourceParts,
      inputRecordCount: loaded.inputRecordCount,
      inputBytes: loaded.inputBytes,
      inputIndexSha256: loaded.inputIndexSha256,
      inputAssetDigest: loaded.inputAssetDigest,
      estimatedPeakHeapBytes: preflight.estimatedPeakHeapBytes,
      topologyPreflight,
      clipEngine,
      stagingDir: partialDir,
      expectedSourceId,
      generatedAt,
      publicPrefix: resolvedPublicPrefix,
      inputIndexPath: paths.inputIndexPath,
    });
    const validation = await validateCompactedStage({
      stagingDir: partialDir,
      expectedSourceId,
    });
    await rename(partialDir, paths.stagingDir);

    const summary = {
      schema: SHARD_COMPACTION_SCHEMA,
      sourceId: expectedSourceId,
      inputIndexPath: paths.inputIndexPath,
      stagingDir: paths.stagingDir,
      applied: false,
      ...output,
      ...validation,
    };
    return summary;
  } catch (error) {
    await rm(partialDir, { recursive: true, force: true });
    throw error;
  }
}

export async function inspectCompactionPreflight({
  inputIndexPath,
  expectedSourceId,
}) {
  const input = resolve(inputIndexPath);
  const index = await readJson(input);
  validateIndex(index, input, expectedSourceId);
  return {
    schema: SHARD_COMPACTION_SCHEMA,
    sourceId: expectedSourceId,
    inputIndexPath: input,
    declaredFeatureCount: index.featureCount,
    declaredSourcePartCount: index.sourcePartCount ?? null,
    inputShardCount: index.shards.length,
    ...(await preflightMemoryGuard(index, input, false)),
  };
}

export async function applyValidatedStaging({
  inputIndexPath,
  stagingDir,
  expectedSourceId,
  applyTo,
  backupDir,
  confirmApply,
}) {
  const input = resolve(inputIndexPath);
  const staging = resolve(stagingDir);
  if (!existsSync(input)) throw new Error(`Missing input index ${input}`);
  if (!existsSync(staging)) throw new Error(`Missing reviewed staging directory ${staging}`);
  const apply = validateApplyOptions({
    inputIndexPath: input,
    stagingDir: staging,
    expectedSourceId,
    applyTo,
    backupDir,
    confirmApply,
  });
  if (!apply.applyRequested) {
    throw new Error("Applying reviewed staging requires explicit replacement options");
  }

  const currentIndex = await readJson(input);
  validateIndex(currentIndex, input, expectedSourceId);
  const stagedIndex = await readJson(join(staging, "index.json"));
  validateIndex(stagedIndex, join(staging, "index.json"), expectedSourceId);
  if (stagedIndex.compaction?.inputIndexPath !== displayPath(input)) {
    throw new Error("Staged compaction was not built from the requested canonical index");
  }
  const currentInput = await computeInputAssetDigest({
    index: currentIndex,
    inputIndexPath: input,
  });
  if (stagedIndex.compaction?.inputAssetDigest !== currentInput.inputAssetDigest) {
    throw new Error(
      "Canonical input assets changed after staging; rebuild and review a fresh stage",
    );
  }
  const validation = await validateCompactedStage({
    stagingDir: staging,
    expectedSourceId,
  });
  await applyStagedReplacement({
    stagingDir: staging,
    applyTo: apply.applyTo,
    backupDir: apply.backupDir,
  });
  return {
    schema: SHARD_COMPACTION_SCHEMA,
    sourceId: expectedSourceId,
    applied: true,
    applyTo: apply.applyTo,
    backupDir: apply.backupDir,
    ...validation,
  };
}

export function validateApplyOptions({
  inputIndexPath,
  stagingDir,
  expectedSourceId,
  applyTo,
  backupDir,
  confirmApply,
}) {
  const supplied = [applyTo, backupDir, confirmApply].filter(Boolean).length;
  if (supplied === 0) return { applyRequested: false };
  if (supplied !== 3) {
    throw new Error(
      "Replacement requires all of --apply-to, --backup-dir, and --confirm-apply",
    );
  }
  const inputDir = resolve(dirname(inputIndexPath));
  const target = resolve(applyTo);
  const staging = resolve(stagingDir);
  const backup = resolve(backupDir);
  if (target !== inputDir) {
    throw new Error(`--apply-to must exactly match the input index directory ${inputDir}`);
  }
  if (confirmApply !== expectedSourceId) {
    throw new Error(`--confirm-apply must exactly equal ${expectedSourceId}`);
  }
  if (backup === target || backup === staging) {
    throw new Error("--backup-dir must be separate from the canonical and staging directories");
  }
  if (isInside(backup, target) || isInside(backup, staging)) {
    throw new Error("--backup-dir must not be inside the canonical or staging directory");
  }
  if (existsSync(backup)) {
    throw new Error(`Refusing to overwrite existing backup path ${backup}`);
  }
  return {
    applyRequested: true,
    applyTo: target,
    backupDir: backup,
  };
}

async function loadSourceParts({
  index,
  inputIndexText,
  inputIndexPath,
  expectedSourceId,
}) {
  const sourceVersions = indexSourceVersions(index);
  const groups = new Map();
  let inputRecordCount = 0;
  let inputBytes = Buffer.byteLength(inputIndexText);
  const inputIndexSha256 = sha256Text(inputIndexText);
  const inputDigest = createHash("sha256");
  inputDigest.update(`index.json\0${inputIndexSha256}\n`);
  const seenShardPaths = new Set();
  const sortedShards = [...index.shards].sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  for (const shard of sortedShards) {
    validateShardEntry(shard, index.shardDegrees);
    const shardPath = resolveReferencedPath(inputIndexPath, shard.url);
    if (!existsSync(shardPath)) throw new Error(`Missing referenced shard ${shardPath}`);
    const shardText = await readFile(shardPath, "utf8");
    if (!seenShardPaths.has(shardPath)) {
      inputBytes += Buffer.byteLength(shardText);
      inputDigest.update(`${shard.url}\0${sha256Text(shardText)}\n`);
      seenShardPaths.add(shardPath);
    }
    const collection = JSON.parse(shardText);
    if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new Error(`${shardPath} is not a GeoJSON FeatureCollection`);
    }
    if (collection.features.length !== shard.count) {
      throw new Error(
        `${shardPath} contains ${collection.features.length} records, but the index declares ${shard.count}`,
      );
    }
    for (const feature of collection.features) {
      inputRecordCount += 1;
      const normalized = validateAndNormalizeSourceFeature({
        feature,
        expectedSourceId,
        sourceVersions,
        shardKey: shard.key,
      });
      const existing = groups.get(normalized.sourcePartId);
      if (!existing) {
        groups.set(normalized.sourcePartId, {
          sourcePartId: normalized.sourcePartId,
          properties: normalized.properties,
          propertiesHash: stableHash(normalized.properties),
          mode: normalized.mode,
          wholeGeometry: normalized.mode === "whole" ? normalized.geometry : null,
          wholeGeometryHash:
            normalized.mode === "whole" ? stableHash(normalized.geometry) : null,
          fragments:
            normalized.mode === "fragment"
              ? new Map([[normalized.fragmentId, normalized.geometry]])
              : new Map(),
        });
        continue;
      }
      if (existing.propertiesHash !== stableHash(normalized.properties)) {
        throw new Error(
          `Source part ${normalized.sourcePartId} has inconsistent properties across shards`,
        );
      }
      if (existing.mode !== normalized.mode) {
        throw new Error(
          `Source part ${normalized.sourcePartId} mixes whole-feature and fragment records`,
        );
      }
      if (normalized.mode === "whole") {
        if (existing.wholeGeometryHash !== stableHash(normalized.geometry)) {
          throw new Error(
            `Source part ${normalized.sourcePartId} has divergent whole geometries without fragment provenance`,
          );
        }
      } else {
        const prior = existing.fragments.get(normalized.fragmentId);
        if (prior && stableHash(prior) !== stableHash(normalized.geometry)) {
          throw new Error(
            `Fragment ${normalized.fragmentId} has inconsistent geometry across shards`,
          );
        }
        existing.fragments.set(normalized.fragmentId, normalized.geometry);
      }
    }
  }

  const sourceParts = [];
  for (const group of groups.values()) {
    const geometry =
      group.mode === "whole"
        ? group.wholeGeometry
        : clippingResultToGeometry(
            boundedUnion([...group.fragments.values()].map(toClippingGeometry)),
          );
    validatePolygonalGeometry(geometry, `source part ${group.sourcePartId}`);
    sourceParts.push({
      sourcePartId: group.sourcePartId,
      properties: group.properties,
      geometry,
    });
  }
  sourceParts.sort((left, right) => left.sourcePartId.localeCompare(right.sourcePartId));
  return {
    sourceParts,
    inputRecordCount,
    inputBytes,
    inputIndexSha256,
    inputAssetDigest: inputDigest.digest("hex"),
  };
}

function validateAndNormalizeSourceFeature({
  feature,
  expectedSourceId,
  sourceVersions,
  shardKey,
}) {
  if (!feature || feature.type !== "Feature") {
    throw new Error(`Shard ${shardKey} contains a non-Feature record`);
  }
  validatePolygonalGeometry(feature.geometry, `feature in shard ${shardKey}`);
  if (
    !feature.properties ||
    typeof feature.properties !== "object" ||
    Array.isArray(feature.properties)
  ) {
    throw new Error(`Feature in shard ${shardKey} has invalid properties`);
  }
  if (feature.properties.sourceId !== expectedSourceId) {
    throw new Error(
      `Feature in shard ${shardKey} has sourceId=${feature.properties.sourceId ?? "(missing)"}, expected ${expectedSourceId}`,
    );
  }
  const featureVersion = feature.properties.sourceVersion;
  if (
    typeof featureVersion !== "string" ||
    !featureVersion ||
    !sourceVersions.includes(featureVersion)
  ) {
    throw new Error(
      `Feature in shard ${shardKey} has sourceVersion=${featureVersion ?? "(missing)"} outside index versions ${sourceVersions.join(",")}`,
    );
  }

  const sourcePartId =
    typeof feature.properties.sourcePartId === "string" &&
    feature.properties.sourcePartId
      ? feature.properties.sourcePartId
      : deriveSourcePartId(feature, expectedSourceId);
  const properties = stripCompactionProperties(feature.properties);
  const existingFragmentId =
    typeof feature.properties.fragmentId === "string"
      ? feature.properties.fragmentId
      : null;
  if (
    feature.id !== undefined &&
    feature.id !== null &&
    !existingFragmentId &&
    properties.sourceFeatureId === undefined
  ) {
    properties.sourceFeatureId = String(feature.id);
  }
  return {
    sourcePartId,
    properties,
    geometry: feature.geometry,
    mode: existingFragmentId ? "fragment" : "whole",
    fragmentId: existingFragmentId,
  };
}

async function preflightSourcePartTopology({ sourceParts, workDir }) {
  const inputPath = join(workDir, ".topology-preflight.input.ndjson");
  const outputPath = join(workDir, ".topology-preflight.output.ndjson");
  const input = await open(inputPath, "w");
  try {
    for (const sourcePart of sourceParts) {
      await input.write(
        `${JSON.stringify({
          sourcePartId: sourcePart.sourcePartId,
          geometry: sourcePart.geometry,
        })}\n`,
      );
    }
  } finally {
    await input.close();
  }

  const helperPath = fileURLToPath(
    new URL("./preflight_polygon_topology.py", import.meta.url),
  );
  const result = spawnSync(
    "python3",
    [helperPath, "--input", inputPath, "--output", outputPath],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `OGR source topology preflight failed with status ${result.status ?? "unknown"}: ${result.error?.message ?? result.stderr?.trim() ?? "no diagnostic"}`,
    );
  }

  const sourcePartsById = new Map(
    sourceParts.map((sourcePart) => [sourcePart.sourcePartId, sourcePart]),
  );
  const invalidIds = new Set();
  let summary = null;
  const lines = createInterface({
    input: createReadStream(outputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    const record = JSON.parse(line);
    if (record.type === "summary") {
      if (summary) throw new Error("OGR topology preflight returned multiple summaries");
      summary = record;
      continue;
    }
    if (record.type !== "invalid") {
      throw new Error(`OGR topology preflight returned unknown record ${record.type}`);
    }
    const sourcePart = sourcePartsById.get(record.sourcePartId);
    if (!sourcePart) {
      throw new Error(
        `OGR topology preflight returned unknown sourcePartId=${record.sourcePartId}`,
      );
    }
    if (invalidIds.has(record.sourcePartId)) {
      throw new Error(
        `OGR topology preflight returned duplicate sourcePartId=${record.sourcePartId}`,
      );
    }
    if (
      record.sourceGeometryValidity !== "invalid" ||
      record.requiredRepairMethod !== "gdal-make-valid-linework" ||
      !Number.isFinite(record.originalAreaDegrees2)
    ) {
      throw new Error(
        `OGR topology preflight returned invalid repair provenance for ${record.sourcePartId}`,
      );
    }
    sourcePart.topologySourceGeometryValidity = "invalid-repaired";
    sourcePart.topologyRepairMethod = record.requiredRepairMethod;
    sourcePart.topologyOriginalAreaDegrees2 = record.originalAreaDegrees2;
    invalidIds.add(record.sourcePartId);
  }
  await rm(inputPath, { force: true });
  await rm(outputPath, { force: true });
  if (
    !summary ||
    typeof summary.gdalVersion !== "string" ||
    summary.checkedSourcePartCount !== sourceParts.length ||
    summary.invalidSourcePartCount !== invalidIds.size
  ) {
    throw new Error("OGR topology preflight count reconciliation failed");
  }
  for (const sourcePart of sourceParts) {
    sourcePart.topologySourceGeometryValidity ??= "valid";
    sourcePart.topologyRepairMethod ??= null;
  }
  return {
    engine: `gdal-ogr/${summary.gdalVersion}`,
    checkedSourcePartCount: summary.checkedSourcePartCount,
    invalidSourcePartCount: summary.invalidSourcePartCount,
  };
}

async function clipSourcePartToShards({
  sourcePart,
  shardDegrees,
  workDir,
  clipEngine,
}) {
  const geometryIndex = indexPolygonGeometry(sourcePart.geometry);
  const shards = shardKeysForBbox(geometryIndex.bbox, shardDegrees).map((key) => ({
    key,
    bbox: shardBbox(key, shardDegrees),
  }));
  const pathological =
    clipEngine === "gdal" ||
    sourcePart.topologyRepairMethod !== null ||
    geometryIndex.coordinateCount > POLYGON_CLIPPING_COORDINATE_LIMIT ||
    geometryIndex.ringCount > POLYGON_CLIPPING_RING_LIMIT;
  if (pathological) {
    return clipSourcePartWithGdal({
      sourcePart,
      shards,
      workDir,
      fallbackContext:
        `pathological geometry (${geometryIndex.coordinateCount} coordinates, ${geometryIndex.ringCount} rings)`,
    });
  }

  const fragments = [];
  for (const shard of shards) {
    const localGeometry = geometryForBbox(geometryIndex, shard.bbox);
    if (!localGeometry) continue;
    try {
      const clipped = polygonClipping.intersection(
        toClippingGeometry(localGeometry),
        rectangleClippingGeometry(shard.bbox),
      );
      if (!clipped.length) continue;
      const geometry = roundGeometry(clippingResultToGeometry(clipped));
      if (!(polygonArea(geometry) > 0)) continue;
      fragments.push({
        shardKey: shard.key,
        geometry,
        clipEngine: "polygon-clipping/0.15.7",
        repairMethod: null,
        sourceGeometryValidity: sourcePart.topologySourceGeometryValidity,
      });
    } catch (error) {
      try {
        return await clipSourcePartWithGdal({
          sourcePart,
          shards,
          workDir,
          fallbackContext: `polygon-clipping failed at sourcePartId=${sourcePart.sourcePartId} shardKey=${shard.key}: ${error instanceof Error ? error.message : String(error)}`,
        });
      } catch (fallbackError) {
        throw new Error(
          `Exact clipping failed for sourcePartId=${sourcePart.sourcePartId} shardKey=${shard.key}. Polygon-clipping error: ${error instanceof Error ? error.message : String(error)}. GDAL fallback error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    }
  }
  return {
    sourceArea: polygonArea(sourcePart.geometry),
    repairMethod: null,
    fragments,
  };
}

async function clipSourcePartWithGdal({
  sourcePart,
  shards,
  workDir,
  fallbackContext,
}) {
  const gdalDir = join(workDir, ".gdal-fallback");
  await mkdir(gdalDir, { recursive: true });
  const token = stableHash([
    sourcePart.sourcePartId,
    sourcePart.properties.sourceVersion,
  ]).slice(0, 24);
  const inputPath = join(gdalDir, `${token}.input.json`);
  const outputPath = join(gdalDir, `${token}.output.ndjson`);
  await writeFile(
    inputPath,
    JSON.stringify({
      geometry: sourcePart.geometry,
      shards,
    }),
    "utf8",
  );
  const helperPath = fileURLToPath(
    new URL("./clip_polygon_to_shards.py", import.meta.url),
  );
  const result = spawnSync(
    "python3",
    [helperPath, "--input", inputPath, "--output", outputPath],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `${fallbackContext}; python3 GDAL helper failed with status ${result.status ?? "unknown"}: ${result.error?.message ?? result.stderr?.trim() ?? "no diagnostic"}`,
    );
  }
  const lines = (await readFile(outputPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  await rm(inputPath, { force: true });
  await rm(outputPath, { force: true });
  const metadata = lines.find((line) => line.type === "metadata");
  if (
    !metadata ||
    !Number.isFinite(metadata.sourceAreaDegrees2) ||
    typeof metadata.gdalVersion !== "string"
  ) {
    throw new Error(`${fallbackContext}; GDAL helper returned invalid metadata`);
  }
  const clipEngine = `gdal-ogr/${metadata.gdalVersion}`;
  const sourceGeometryValidity =
    sourcePart.topologySourceGeometryValidity ??
    (metadata.sourceGeometryValid ? "valid" : "invalid-repaired");
  const repairMethod =
    sourcePart.topologyRepairMethod ?? metadata.repairMethod;
  if (repairMethod) {
    sourcePart.topologyRepairedAreaDegrees2 = metadata.sourceAreaDegrees2;
  }
  const fragments = lines
    .filter((line) => line.type === "fragment")
    .map((line) => {
      const shard = shards.find((candidate) => candidate.key === line.shardKey);
      if (!shard) {
        throw new Error(
          `${fallbackContext}; GDAL returned unexpected shardKey=${line.shardKey}`,
        );
      }
      const geometry = roundGeometry(line.geometry);
      validatePolygonalGeometry(
        geometry,
        `GDAL fragment sourcePartId=${sourcePart.sourcePartId} shardKey=${line.shardKey}`,
      );
      validateGeometryWithinBbox(
        geometry,
        shard.bbox,
        sourcePart.sourcePartId,
      );
      return {
        shardKey: line.shardKey,
        geometry,
        clipEngine,
        repairMethod,
        sourceGeometryValidity,
      };
    });
  return {
    sourceArea: metadata.sourceAreaDegrees2,
    repairMethod,
    fragments,
  };
}

function indexPolygonGeometry(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  let coordinateCount = 0;
  let ringCount = 0;
  const indexedPolygons = polygons.map((polygon) => {
    const rings = polygon.map((ring) => {
      coordinateCount += ring.length;
      ringCount += 1;
      return { ring, bbox: coordinatesBbox(ring) };
    });
    return {
      outer: rings[0],
      holes: rings.slice(1),
      bbox: rings[0].bbox,
    };
  });
  return {
    type: geometry.type,
    polygons: indexedPolygons,
    coordinateCount,
    ringCount,
    bbox: mergeBboxes(indexedPolygons.map((polygon) => polygon.bbox)),
  };
}

function geometryForBbox(indexed, bbox) {
  const polygons = indexed.polygons
    .filter((polygon) => bboxesIntersect(polygon.bbox, bbox))
    .map((polygon) => [
      polygon.outer.ring,
      ...polygon.holes
        .filter((hole) => bboxesIntersect(hole.bbox, bbox))
        .map((hole) => hole.ring),
    ]);
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

async function writeCompactedStage({
  index,
  sourceParts,
  inputRecordCount,
  inputBytes,
  inputIndexSha256,
  inputAssetDigest,
  estimatedPeakHeapBytes,
  topologyPreflight,
  clipEngine,
  stagingDir,
  expectedSourceId,
  generatedAt,
  publicPrefix,
  inputIndexPath,
}) {
  const spoolDir = join(stagingDir, ".fragment-spool");
  const shardDir = join(stagingDir, "shards");
  await mkdir(spoolDir, { recursive: true });
  await mkdir(shardDir, { recursive: true });
  const spool = createSpoolWriter(spoolDir);
  const shardCounts = new Map();
  const clipEngineCounts = new Map();
  let fragmentCount = 0;
  let repairedSourcePartCount = 0;
  let sourceArea = 0;
  let fragmentArea = 0;

  try {
    for (const sourcePart of sourceParts) {
      const clippedPart = await clipSourcePartToShards({
        sourcePart,
        shardDegrees: index.shardDegrees,
        workDir: stagingDir,
        clipEngine,
      });
      sourceArea += clippedPart.sourceArea;
      if (clippedPart.repairMethod) repairedSourcePartCount += 1;
      for (const clippedFragment of clippedPart.fragments) {
        const {
          shardKey,
          geometry,
          clipEngine,
          repairMethod,
          sourceGeometryValidity,
        } = clippedFragment;
        const bbox = shardBbox(shardKey, index.shardDegrees);
        const area = polygonArea(geometry);
        validateGeometryWithinBbox(geometry, bbox, sourcePart.sourcePartId);
        const fragmentId = stableFragmentId({
          sourceId: expectedSourceId,
          sourceVersion: sourcePart.properties.sourceVersion,
          sourcePartId: sourcePart.sourcePartId,
          shardKey,
        });
        const fragment = {
          type: "Feature",
          id: fragmentId,
          properties: {
            ...sourcePart.properties,
            sourcePartId: sourcePart.sourcePartId,
            fragmentId,
            fragmentSchema: SHARD_FRAGMENT_SCHEMA,
            fragmentShardKey: shardKey,
            fragmentClipEngine: clipEngine,
            fragmentGeometryRepair: repairMethod,
            fragmentSourceGeometryValidity: sourceGeometryValidity,
            fragmentSourceAreaBeforeRepairDegrees2:
              sourcePart.topologyOriginalAreaDegrees2 ?? null,
            fragmentSourceAreaAfterRepairDegrees2:
              sourcePart.topologyRepairedAreaDegrees2 ?? null,
          },
          geometry,
        };
        await spool.write(shardKey, JSON.stringify(fragment));
        shardCounts.set(shardKey, (shardCounts.get(shardKey) ?? 0) + 1);
        fragmentCount += 1;
        fragmentArea += area;
        clipEngineCounts.set(
          clipEngine,
          (clipEngineCounts.get(clipEngine) ?? 0) + 1,
        );
      }
    }
  } finally {
    await spool.close();
  }

  await rm(join(stagingDir, ".gdal-fallback"), {
    recursive: true,
    force: true,
  });
  assertAreaConserved(sourceArea, fragmentArea);
  const shards = [];
  for (const shardKey of [...shardCounts.keys()].sort()) {
    const spoolPath = join(spoolDir, `${shardKey}.ndjson`);
    const lines = (await readFile(spoolPath, "utf8"))
      .split("\n")
      .filter(Boolean);
    const count = shardCounts.get(shardKey);
    if (lines.length !== count) {
      throw new Error(
        `Spool for shard ${shardKey} contains ${lines.length} fragments, expected ${count}`,
      );
    }
    const fileName = `${shardKey}.geojson`;
    await writeFile(
      join(shardDir, fileName),
      `{"type":"FeatureCollection","features":[${lines.join(",")}]}\n`,
      "utf8",
    );
    shards.push({
      key: shardKey,
      url: `${publicPrefix}/shards/${fileName}`.replace(/\/+/g, "/"),
      bbox: shardBbox(shardKey, index.shardDegrees),
      count,
    });
  }
  await rm(spoolDir, { recursive: true, force: true });

  const outputIndex = {
    ...index,
    type: "FeatureShardIndex",
    sourceId: expectedSourceId,
    featureCount: sourceParts.length,
    sourcePartCount: sourceParts.length,
    fragmentCount,
    shardCount: shards.length,
    generatedAt,
    fragmentSchema: SHARD_FRAGMENT_SCHEMA,
    compaction: {
      schema: SHARD_COMPACTION_SCHEMA,
      algorithm:
        "OGR topology preflight, MakeValid(LINEWORK) repair when required, then exact polygon-clipping or OGR intersection with each axis-aligned shard bbox",
      inputIndexPath: displayPath(inputIndexPath),
      inputRecordCount,
      inputBytes,
      inputIndexSha256,
      inputAssetDigest,
      estimatedPeakHeapBytes,
      topologyPreflight,
      clipEngineRequested: clipEngine,
      duplicateInputRecords: Math.max(0, inputRecordCount - sourceParts.length),
      sourcePartCount: sourceParts.length,
      fragmentCount,
      clipEngineCounts: Object.fromEntries([...clipEngineCounts.entries()].sort()),
      repairedSourcePartCount,
      sourceAreaDegrees2: roundNumber(sourceArea, 12),
      fragmentAreaDegrees2: roundNumber(fragmentArea, 12),
      generatedAt,
    },
    shards,
  };
  await writeJson(join(stagingDir, "index.json"), outputIndex);
  return {
    inputRecordCount,
    sourcePartCount: sourceParts.length,
    fragmentCount,
    clipEngineCounts: Object.fromEntries([...clipEngineCounts.entries()].sort()),
    repairedSourcePartCount,
    duplicateInputRecords: Math.max(0, inputRecordCount - sourceParts.length),
    inputShardCount: index.shards.length,
    outputShardCount: shards.length,
    inputBytes,
    inputIndexSha256,
    inputAssetDigest,
    estimatedPeakHeapBytes,
    topologyPreflight,
    clipEngineRequested: clipEngine,
  };
}

async function validateCompactedStage({ stagingDir, expectedSourceId }) {
  const indexPath = join(stagingDir, "index.json");
  const index = await readJson(indexPath);
  validateIndex(index, indexPath, expectedSourceId);
  if (index.fragmentSchema !== SHARD_FRAGMENT_SCHEMA) {
    throw new Error(`${indexPath} is missing fragmentSchema=${SHARD_FRAGMENT_SCHEMA}`);
  }
  const fragmentIds = new Set();
  const sourcePartIds = new Set();
  const repairedSourcePartIds = new Set();
  let fragmentCount = 0;
  let fragmentArea = 0;
  let outputBytes = (await stat(indexPath)).size;
  for (const shard of index.shards) {
    validateShardEntry(shard, index.shardDegrees);
    const path = join(stagingDir, "shards", `${shard.key}.geojson`);
    outputBytes += (await stat(path)).size;
    const collection = await readJson(path);
    if (
      collection?.type !== "FeatureCollection" ||
      !Array.isArray(collection.features) ||
      collection.features.length !== shard.count
    ) {
      throw new Error(`Staged shard ${shard.key} does not match its declared count`);
    }
    for (const feature of collection.features) {
      validatePolygonalGeometry(feature.geometry, `staged fragment in ${shard.key}`);
      const properties = feature.properties ?? {};
      if (
        properties.sourceId !== expectedSourceId ||
        properties.fragmentSchema !== SHARD_FRAGMENT_SCHEMA ||
        properties.fragmentShardKey !== shard.key ||
        typeof properties.fragmentClipEngine !== "string" ||
        !["valid", "invalid-repaired"].includes(
          properties.fragmentSourceGeometryValidity,
        ) ||
        typeof properties.sourcePartId !== "string" ||
        typeof properties.fragmentId !== "string" ||
        feature.id !== properties.fragmentId
      ) {
        throw new Error(`Staged fragment in ${shard.key} has invalid provenance`);
      }
      if (fragmentIds.has(properties.fragmentId)) {
        throw new Error(`Duplicate fragmentId ${properties.fragmentId}`);
      }
      fragmentIds.add(properties.fragmentId);
      sourcePartIds.add(properties.sourcePartId);
      if (properties.fragmentSourceGeometryValidity === "invalid-repaired") {
        if (
          properties.fragmentGeometryRepair !== "gdal-make-valid-linework" ||
          !properties.fragmentClipEngine.startsWith("gdal-ogr/") ||
          !Number.isFinite(properties.fragmentSourceAreaBeforeRepairDegrees2) ||
          !Number.isFinite(properties.fragmentSourceAreaAfterRepairDegrees2) ||
          !(properties.fragmentSourceAreaAfterRepairDegrees2 > 0)
        ) {
          throw new Error(
            `Staged repaired fragment in ${shard.key} has invalid repair provenance`,
          );
        }
        repairedSourcePartIds.add(properties.sourcePartId);
      } else if (
        properties.fragmentGeometryRepair !== null ||
        properties.fragmentSourceAreaBeforeRepairDegrees2 !== null ||
        properties.fragmentSourceAreaAfterRepairDegrees2 !== null
      ) {
        throw new Error(
          `Staged valid fragment in ${shard.key} has unexpected repair provenance`,
        );
      }
      validateGeometryWithinBbox(feature.geometry, shard.bbox, properties.sourcePartId);
      fragmentArea += polygonArea(feature.geometry);
      fragmentCount += 1;
    }
  }
  if (
    index.shardCount !== index.shards.length ||
    index.fragmentCount !== fragmentCount ||
    index.sourcePartCount !== sourcePartIds.size ||
    index.featureCount !== sourcePartIds.size ||
    index.compaction?.topologyPreflight?.checkedSourcePartCount !==
      sourcePartIds.size ||
    index.compaction?.topologyPreflight?.invalidSourcePartCount !==
      repairedSourcePartIds.size ||
    index.compaction?.repairedSourcePartCount !== repairedSourcePartIds.size
  ) {
    throw new Error("Staged index count reconciliation failed");
  }
  assertAreaConserved(
    Number(index.compaction?.sourceAreaDegrees2),
    fragmentArea,
  );
  const ogrValidation = validateStageWithOgr(stagingDir);
  if (ogrValidation.validatedFragments !== fragmentCount) {
    throw new Error(
      `OGR validated ${ogrValidation.validatedFragments} fragments, expected ${fragmentCount}`,
    );
  }
  assertAreaConserved(
    Number(index.compaction?.sourceAreaDegrees2),
    Number(ogrValidation.fragmentAreaDegrees2),
  );
  return {
    validatedSourceParts: sourcePartIds.size,
    validatedFragments: fragmentCount,
    ogrValidatedFragments: ogrValidation.validatedFragments,
    ogrValidationVersion: ogrValidation.gdalVersion,
    outputBytes,
    byteRatio: roundNumber(outputBytes / Math.max(1, index.compaction.inputBytes), 6),
  };
}

function validateStageWithOgr(stagingDir) {
  const helperPath = fileURLToPath(
    new URL("../validate/validate_polygon_fragment_stage.py", import.meta.url),
  );
  const result = spawnSync(
    "python3",
    [helperPath, "--staging-dir", stagingDir],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `OGR staged-fragment validation failed with status ${result.status ?? "unknown"}: ${result.error?.message ?? result.stderr?.trim() ?? "no diagnostic"}`,
    );
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("OGR staged-fragment validation returned invalid JSON");
  }
}

async function applyStagedReplacement({ stagingDir, applyTo, backupDir }) {
  await rename(applyTo, backupDir);
  try {
    await rename(stagingDir, applyTo);
  } catch (error) {
    try {
      await rename(backupDir, applyTo);
    } catch (restoreError) {
      throw new Error(
        `Could not move staging into place or automatically restore canonical. The original remains at the explicit backup path ${backupDir}. Apply error: ${error instanceof Error ? error.message : String(error)}. Restore error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
      );
    }
    throw new Error(
      `Could not move staging into place; the original directory was restored. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validatePaths({
  inputIndexPath,
  stagingDir,
  expectedSourceId,
  generatedAt,
}) {
  if (!inputIndexPath || !stagingDir || !expectedSourceId) {
    throw new Error("inputIndexPath, stagingDir, and expectedSourceId are required");
  }
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("generatedAt must be an explicit ISO-8601 timestamp");
  }
  const input = resolve(inputIndexPath);
  const staging = resolve(stagingDir);
  if (!existsSync(input)) throw new Error(`Missing input index ${input}`);
  if (existsSync(staging)) {
    throw new Error(`Refusing to overwrite existing staging directory ${staging}`);
  }
  const inputDir = resolve(dirname(input));
  if (staging === inputDir || isInside(staging, inputDir) || isInside(inputDir, staging)) {
    throw new Error("Staging must be separate from the canonical input directory");
  }
  return {
    inputIndexPath: input,
    stagingDir: staging,
  };
}

async function preflightMemoryGuard(index, inputIndexPath, enforce = true) {
  let inputBytes = (await stat(inputIndexPath)).size;
  let largestShardBytes = 0;
  const seen = new Set();
  for (const shard of index.shards) {
    const path = resolveReferencedPath(inputIndexPath, shard.url);
    if (seen.has(path)) continue;
    const bytes = (await stat(path)).size;
    inputBytes += bytes;
    largestShardBytes = Math.max(largestShardBytes, bytes);
    seen.add(path);
  }
  // JSON.parse, reconstructed source geometries, clipping work queues, and
  // fragment serialization coexist. Four times encoded input is a deliberately
  // conservative guard; staging spools keep output fragments off the heap.
  const estimatedPeakHeapBytes = Math.ceil(inputBytes * 4);
  const heapLimitBytes = getHeapStatistics().heap_size_limit;
  const requiredMaxOldSpaceMb = Math.ceil(
    estimatedPeakHeapBytes / 0.65 / 1024 / 1024,
  );
  const safeForConfiguredHeap = estimatedPeakHeapBytes <= heapLimitBytes * 0.65;
  if (enforce && !safeForConfiguredHeap) {
    throw new Error(
      `Estimated compaction heap ${formatBytes(estimatedPeakHeapBytes)} exceeds the safe share of the Node heap limit ${formatBytes(heapLimitBytes)}. Re-run with node --max-old-space-size=${requiredMaxOldSpaceMb} (or higher). Encoded input=${formatBytes(inputBytes)}, largest shard=${formatBytes(largestShardBytes)}.`,
    );
  }
  return {
    inputBytes,
    largestShardBytes,
    estimatedPeakHeapBytes,
    heapLimitBytes,
    requiredMaxOldSpaceMb,
    safeForConfiguredHeap,
  };
}

async function computeInputAssetDigest({ index, inputIndexPath }) {
  const indexText = await readFile(inputIndexPath, "utf8");
  const inputIndexSha256 = sha256Text(indexText);
  const digest = createHash("sha256");
  digest.update(`index.json\0${inputIndexSha256}\n`);
  const seen = new Set();
  let inputBytes = Buffer.byteLength(indexText);
  for (const shard of [...index.shards].sort((left, right) =>
    left.key.localeCompare(right.key),
  )) {
    const path = resolveReferencedPath(inputIndexPath, shard.url);
    if (seen.has(path)) continue;
    const text = await readFile(path, "utf8");
    inputBytes += Buffer.byteLength(text);
    digest.update(`${shard.url}\0${sha256Text(text)}\n`);
    seen.add(path);
  }
  return {
    inputBytes,
    inputIndexSha256,
    inputAssetDigest: digest.digest("hex"),
  };
}

function validateIndex(index, label, expectedSourceId) {
  if (
    index?.type !== "FeatureShardIndex" ||
    !Array.isArray(index.shards) ||
    !Number.isFinite(index.shardDegrees) ||
    index.shardDegrees <= 0 ||
    !Number.isInteger(index.featureCount) ||
    index.featureCount < 0
  ) {
    throw new Error(`${label} is not a valid polygon FeatureShardIndex`);
  }
  if (index.sourceId !== expectedSourceId) {
    throw new Error(
      `${label} has sourceId=${index.sourceId ?? "(missing)"}, expected ${expectedSourceId}`,
    );
  }
  if (!indexSourceVersions(index).length) {
    throw new Error(`${label} has no source version provenance`);
  }
}

function validateShardEntry(shard, shardDegrees) {
  if (
    !shard ||
    typeof shard.key !== "string" ||
    typeof shard.url !== "string" ||
    !Array.isArray(shard.bbox) ||
    shard.bbox.length !== 4 ||
    !shard.bbox.every(Number.isFinite) ||
    !Number.isInteger(shard.count) ||
    shard.count < 0
  ) {
    throw new Error("FeatureShardIndex contains an invalid shard entry");
  }
  const expected = shardBbox(shard.key, shardDegrees);
  if (expected.some((value, index) => Math.abs(value - shard.bbox[index]) > EPSILON)) {
    throw new Error(`Shard ${shard.key} bbox does not match shardDegrees`);
  }
}

function validatePolygonalGeometry(geometry, label) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    throw new Error(`${label} is not Polygon or MultiPolygon geometry`);
  }
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  if (!polygons.length) throw new Error(`${label} has no polygon coordinates`);
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) {
      throw new Error(`${label} contains an empty polygon`);
    }
    for (const ring of polygon) {
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        !ring.every(
          (coordinate) =>
            Array.isArray(coordinate) &&
            coordinate.length >= 2 &&
            Number.isFinite(coordinate[0]) &&
            Number.isFinite(coordinate[1]) &&
            coordinate[0] >= -180 &&
            coordinate[0] <= 180 &&
            coordinate[1] >= -90 &&
            coordinate[1] <= 90,
        ) ||
        ring[0][0] !== ring.at(-1)[0] ||
        ring[0][1] !== ring.at(-1)[1]
      ) {
        throw new Error(`${label} contains an invalid or unclosed ring`);
      }
    }
  }
  if (!(polygonArea(geometry) > 0)) throw new Error(`${label} has zero polygon area`);
}

function validateGeometryWithinBbox(geometry, bbox, sourcePartId) {
  const geometryBounds = geometryBbox(geometry);
  if (
    geometryBounds[0] < bbox[0] - EPSILON ||
    geometryBounds[1] < bbox[1] - EPSILON ||
    geometryBounds[2] > bbox[2] + EPSILON ||
    geometryBounds[3] > bbox[3] + EPSILON
  ) {
    throw new Error(
      `Fragment for ${sourcePartId} extends outside its shard bbox`,
    );
  }
}

function deriveSourcePartId(feature, sourceId) {
  const properties = feature.properties ?? {};
  const recordIds = Array.isArray(properties.sources)
    ? properties.sources
        .map((source) => source?.record_id ?? source?.recordId)
        .filter(Boolean)
        .sort()
    : [];
  const explicit =
    feature.id ??
    properties.identifier ??
    properties.gml_id ??
    properties.osmId ??
    properties.osm_id ??
    properties.id ??
    (recordIds.length ? recordIds : null);
  const identity = explicit === null || explicit === undefined
    ? [sourceId, properties.partIndex ?? null, feature.geometry]
    : [sourceId, explicit, properties.partIndex ?? null];
  return `${sourceId}:part:${stableHash(identity).slice(0, 24)}`;
}

function stableFragmentId({ sourceId, sourceVersion, sourcePartId, shardKey }) {
  return `${sourceId}:fragment:${stableHash([
    sourceId,
    sourceVersion,
    sourcePartId,
    shardKey,
  ]).slice(0, 24)}`;
}

function stripCompactionProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !COMPACTION_PROPERTY_KEYS.has(key)),
  );
}

function indexSourceVersions(index) {
  return [
    ...new Set(
      [...(index.sourceVersions ?? []), index.sourceVersion]
        .flatMap((value) =>
          typeof value === "string" ? value.split("+").map((part) => part.trim()) : [],
        )
        .filter(Boolean),
    ),
  ].sort();
}

function boundedUnion(geometries) {
  if (!geometries.length) return [];
  let pending = geometries;
  while (pending.length > 1) {
    const next = [];
    for (let index = 0; index < pending.length; index += 16) {
      const batch = pending.slice(index, index + 16);
      const [first, ...rest] = batch;
      next.push(rest.length ? polygonClipping.union(first, ...rest) : first);
    }
    pending = next;
  }
  return toMultiPolygonCoordinates(pending[0]);
}

function clippingResultToGeometry(coordinates) {
  const multiPolygon = toMultiPolygonCoordinates(coordinates);
  if (!multiPolygon.length) return null;
  return multiPolygon.length === 1
    ? { type: "Polygon", coordinates: multiPolygon[0] }
    : { type: "MultiPolygon", coordinates: multiPolygon };
}

function toClippingGeometry(geometry) {
  return geometry.coordinates;
}

function toMultiPolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return [];
  return typeof coordinates[0]?.[0]?.[0] === "number"
    ? [coordinates]
    : coordinates;
}

function rectangleClippingGeometry([west, south, east, north]) {
  return [[[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]]];
}

function shardKeysForBbox(bbox, shardDegrees) {
  const minLonIndex = Math.floor((bbox[0] + 180) / shardDegrees);
  const maxLonIndex = Math.floor((bbox[2] + 180) / shardDegrees);
  const minLatIndex = Math.floor((bbox[1] + 90) / shardDegrees);
  const maxLatIndex = Math.floor((bbox[3] + 90) / shardDegrees);
  const keys = [];
  for (let latIndex = minLatIndex; latIndex <= maxLatIndex; latIndex += 1) {
    for (let lonIndex = minLonIndex; lonIndex <= maxLonIndex; lonIndex += 1) {
      keys.push(`${latIndex}_${lonIndex}`);
    }
  }
  return keys;
}

function shardBbox(key, shardDegrees) {
  const [latIndex, lonIndex] = key.split("_").map(Number);
  if (!Number.isInteger(latIndex) || !Number.isInteger(lonIndex)) {
    throw new Error(`Invalid shard key ${key}`);
  }
  const west = roundNumber(lonIndex * shardDegrees - 180, 12);
  const south = roundNumber(latIndex * shardDegrees - 90, 12);
  return [
    west,
    south,
    roundNumber(west + shardDegrees, 12),
    roundNumber(south + shardDegrees, 12),
  ];
}

function geometryBbox(geometry) {
  const coordinates = [];
  flattenCoordinates(geometry?.coordinates, coordinates);
  if (!coordinates.length) return null;
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

function coordinatesBbox(coordinates) {
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

function mergeBboxes(bboxes) {
  return bboxes.reduce(
    (merged, bbox) => [
      Math.min(merged[0], bbox[0]),
      Math.min(merged[1], bbox[1]),
      Math.max(merged[2], bbox[2]),
      Math.max(merged[3], bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function bboxesIntersect(left, right) {
  return (
    left[0] <= right[2] &&
    left[2] >= right[0] &&
    left[1] <= right[3] &&
    left[3] >= right[1]
  );
}

function flattenCoordinates(value, output) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    output.push(value);
    return;
  }
  value.forEach((item) => flattenCoordinates(item, output));
}

function polygonArea(geometry) {
  if (!geometry) return 0;
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  return polygons.reduce((total, polygon) => {
    const outer = Math.abs(ringArea(polygon[0] ?? []));
    const holes = polygon
      .slice(1)
      .reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
    return total + Math.max(0, outer - holes);
  }, 0);
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const left = ring[index - 1];
    const right = ring[index];
    sum += left[0] * right[1] - right[0] * left[1];
  }
  return sum / 2;
}

function assertAreaConserved(sourceArea, fragmentArea) {
  const tolerance = Math.max(1e-12, Math.abs(sourceArea) * 1e-8);
  if (
    !Number.isFinite(sourceArea) ||
    !Number.isFinite(fragmentArea) ||
    Math.abs(sourceArea - fragmentArea) > tolerance
  ) {
    throw new Error(
      `Polygon area was not conserved: source=${sourceArea}, fragments=${fragmentArea}, tolerance=${tolerance}`,
    );
  }
}

function roundGeometry(geometry, decimals = 12) {
  const factor = 10 ** decimals;
  const visit = (value) =>
    Array.isArray(value?.[0])
      ? value.map(visit)
      : value.map((coordinate) =>
          typeof coordinate === "number"
            ? Math.round(coordinate * factor) / factor
            : coordinate,
        );
  return {
    ...geometry,
    coordinates: visit(geometry.coordinates),
  };
}

function createSpoolWriter(spoolDir) {
  const handles = new Map();
  async function getHandle(key) {
    if (handles.has(key)) {
      const handle = handles.get(key);
      handles.delete(key);
      handles.set(key, handle);
      return handle;
    }
    if (handles.size >= MAX_OPEN_SPOOL_FILES) {
      const [oldestKey, oldestHandle] = handles.entries().next().value;
      handles.delete(oldestKey);
      await oldestHandle.close();
    }
    const handle = await open(join(spoolDir, `${key}.ndjson`), "a");
    handles.set(key, handle);
    return handle;
  }
  return {
    async write(key, line) {
      const handle = await getHandle(key);
      await handle.write(`${line}\n`);
    },
    async close() {
      await Promise.all([...handles.values()].map((handle) => handle.close()));
      handles.clear();
    },
  };
}

function resolveReferencedPath(indexPath, url) {
  if (String(url).startsWith("/data/")) {
    const absoluteIndex = resolve(indexPath);
    const marker = `${join("public", "data")}/`;
    const markerIndex = absoluteIndex.indexOf(marker);
    if (markerIndex < 0) {
      throw new Error(`Cannot resolve ${url} relative to non-public index ${indexPath}`);
    }
    const publicRoot = absoluteIndex.slice(0, markerIndex + "public".length);
    return join(publicRoot, String(url));
  }
  if (String(url).startsWith("/")) return String(url);
  return resolve(dirname(indexPath), String(url));
}

function derivePublicPrefix(index, label) {
  const firstUrl = index.shards.find((shard) =>
    typeof shard.url === "string" && shard.url.includes("/shards/"),
  )?.url;
  if (!firstUrl) {
    throw new Error(`${label} has no shard URL from which to derive --public-prefix`);
  }
  return firstUrl.slice(0, firstUrl.indexOf("/shards/")).replace(/\/+$/, "");
}

function displayPath(path) {
  const absolute = resolve(path);
  const cwd = `${resolve(".")}/`;
  return absolute.startsWith(cwd) ? absolute.slice(cwd.length) : absolute;
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function roundNumber(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isInside(candidate, parent) {
  return candidate.startsWith(`${parent}/`);
}

function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

async function runCli() {
  const args = parseArgs();
  if (args["preflight-only"] === "true") {
    const summary = await inspectCompactionPreflight({
      inputIndexPath: requireArg(args, "input-index", "Missing --input-index"),
      expectedSourceId: requireArg(args, "source-id", "Missing --source-id"),
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (args["apply-staged"] === "true") {
    const summary = await applyValidatedStaging({
      inputIndexPath: requireArg(args, "input-index", "Missing --input-index"),
      stagingDir: requireArg(args, "staging-dir", "Missing --staging-dir"),
      expectedSourceId: requireArg(args, "source-id", "Missing --source-id"),
      applyTo: requireArg(args, "apply-to", "Missing --apply-to"),
      backupDir: requireArg(args, "backup-dir", "Missing --backup-dir"),
      confirmApply: requireArg(args, "confirm-apply", "Missing --confirm-apply"),
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (args["apply-to"] || args["backup-dir"] || args["confirm-apply"]) {
    throw new Error(
      "Build and review staging first; use --apply-staged true in a separate command",
    );
  }
  const summary = await compactShardedPolygons({
    inputIndexPath: requireArg(args, "input-index", "Missing --input-index"),
    stagingDir: requireArg(args, "staging-dir", "Missing --staging-dir"),
    expectedSourceId: requireArg(args, "source-id", "Missing --source-id"),
    generatedAt: requireArg(
      args,
      "generated-at",
      "Missing --generated-at ISO-8601 (explicit for reproducibility)",
    ),
    publicPrefix: args["public-prefix"],
    clipEngine: args["clip-engine"] ?? "auto",
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await runCli();
}
