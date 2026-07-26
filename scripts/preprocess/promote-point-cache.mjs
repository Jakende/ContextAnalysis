#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFeatureCollection,
  parseArgs,
  parseBbox,
  readJson,
  requireArg,
  writeJson,
} from "./shared.mjs";

export async function inspectPointCache({
  cacheIndexPath,
  expectedSourceId,
  requiredBbox,
}) {
  const cache = await readJson(cacheIndexPath);
  const features = deduplicateFeatures(
    await loadFeatures(cache, cacheIndexPath),
    expectedSourceId,
  );
  const sourceVersions = sourceVersionsFor(cache, features);
  const intersectingFeatureCount = features.filter((feature) =>
    bboxesIntersect(geometryBbox(feature.geometry), requiredBbox),
  ).length;

  return {
    cache,
    features,
    sourceVersions,
    intersectingFeatureCount,
  };
}

export async function promotePointCache({
  cacheIndexPath,
  canonicalIndexPath,
  expectedSourceId,
  requiredBbox,
  generatedAt,
  dryRun = false,
}) {
  assertSafePaths(cacheIndexPath, canonicalIndexPath);
  if (!Array.isArray(requiredBbox) || requiredBbox.length !== 4) {
    throw new Error("requiredBbox must be [west, south, east, north]");
  }
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("generatedAt must be an explicit ISO-8601 timestamp");
  }

  const canonical = await readJson(canonicalIndexPath);
  assertShardIndex(canonical, canonicalIndexPath, expectedSourceId);
  const inspection = await inspectPointCache({
    cacheIndexPath,
    expectedSourceId,
    requiredBbox,
  });
  if (inspection.intersectingFeatureCount === 0) {
    throw new Error(
      `${cacheIndexPath} has no ${expectedSourceId} polygon intersecting required bbox ${requiredBbox.join(",")}`,
    );
  }

  const shardEntries = new Map(canonical.shards.map((entry) => [entry.key, entry]));
  const shardCollections = new Map();
  const shardKeysByFeature = new Map();
  const affectedKeys = new Set();
  for (const feature of inspection.features) {
    const keys = shardKeysForBbox(geometryBbox(feature.geometry), canonical.shardDegrees);
    shardKeysByFeature.set(featureKey(feature), keys);
    keys.forEach((key) => affectedKeys.add(key));
  }

  for (const key of affectedKeys) {
    const entry = shardEntries.get(key);
    const collection = entry
      ? assertFeatureCollection(
          await readJson(resolveReferencedPath(canonicalIndexPath, entry.url)),
          entry.url,
        )
      : { type: "FeatureCollection", features: [] };
    shardCollections.set(key, collection);
  }

  const existingKeys = new Set(
    [...shardCollections.values()].flatMap((collection) =>
      collection.features.map(featureKey),
    ),
  );
  const newFeatures = inspection.features.filter(
    (feature) => !existingKeys.has(featureKey(feature)),
  );

  const additionsByShard = new Map();
  for (const feature of newFeatures) {
    for (const key of shardKeysByFeature.get(featureKey(feature))) {
      const additions = additionsByShard.get(key) ?? [];
      additions.push(feature);
      additionsByShard.set(key, additions);
    }
  }

  const sourceVersions = expandSourceVersions([
    ...(canonical.sourceVersions?.length
      ? canonical.sourceVersions
      : [canonical.sourceVersion]),
    ...inspection.sourceVersions,
  ]);
  const summary = {
    sourceId: expectedSourceId,
    cacheIndexPath,
    canonicalIndexPath,
    requiredBbox,
    inputFeatures: inspection.features.length,
    intersectingInputFeatures: inspection.intersectingFeatureCount,
    addedFeatures: newFeatures.length,
    affectedShards: affectedKeys.size,
    sourceVersions,
    dryRun,
  };
  if (dryRun) return summary;

  const indexDir = dirname(canonicalIndexPath);
  for (const [key, additions] of additionsByShard) {
    const collection = shardCollections.get(key);
    const merged = deduplicateFeatures(
      [...collection.features, ...additions],
      expectedSourceId,
    );
    const shardPath = join(indexDir, "shards", `${key}.geojson`);
    await writeJson(shardPath, { type: "FeatureCollection", features: merged });
    shardEntries.set(key, {
      key,
      url: publicShardUrl(indexDir, `${key}.geojson`),
      bbox: shardBbox(key, canonical.shardDegrees),
      count: merged.length,
    });
  }

  const coverageInput = {
    cacheIndexPath: publicPath(cacheIndexPath),
    requiredBbox,
    sourceVersions: inspection.sourceVersions,
    inputFeatures: inspection.features.length,
    intersectingInputFeatures: inspection.intersectingFeatureCount,
    promotedAt: generatedAt,
  };
  const coverageInputs = [
    ...(canonical.coverageInputs ?? []).filter(
      (entry) => entry.cacheIndexPath !== coverageInput.cacheIndexPath,
    ),
    coverageInput,
  ].sort((left, right) =>
    left.cacheIndexPath.localeCompare(right.cacheIndexPath),
  );
  const shards = [...shardEntries.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  await writeJson(canonicalIndexPath, {
    ...canonical,
    sourceVersion: sourceVersions.join("+"),
    sourceVersions,
    featureCount: canonical.featureCount + newFeatures.length,
    shardCount: shards.length,
    generatedAt,
    coverageInputs,
    shards,
  });
  return summary;
}

function assertSafePaths(cacheIndexPath, canonicalIndexPath) {
  const cache = resolve(cacheIndexPath);
  const canonical = resolve(canonicalIndexPath);
  if (!cache.includes(`${join("public", "data", "processed", "cache")}/`)) {
    throw new Error("Cache input must be below public/data/processed/cache/");
  }
  if (!canonical.includes(`${join("public", "data", "processed")}/`)) {
    throw new Error("Canonical index must be below public/data/processed/");
  }
  if (canonical.includes(`${join("public", "data", "processed", "cache")}/`)) {
    throw new Error("Canonical index must not be inside the point cache");
  }
}

function assertShardIndex(index, label, expectedSourceId) {
  if (
    index?.type !== "FeatureShardIndex" ||
    !Array.isArray(index.shards) ||
    !Number.isFinite(index.shardDegrees) ||
    index.shardDegrees <= 0 ||
    !Number.isInteger(index.featureCount)
  ) {
    throw new Error(`${label} is not a valid FeatureShardIndex`);
  }
  if (index.sourceId !== expectedSourceId) {
    throw new Error(
      `${label} sourceId ${index.sourceId ?? "(missing)"} does not match ${expectedSourceId}`,
    );
  }
}

async function loadFeatures(value, indexPath) {
  if (value?.type === "FeatureCollection") {
    return assertFeatureCollection(value, indexPath).features;
  }
  if (value?.type !== "FeatureShardIndex" || !Array.isArray(value.shards)) {
    throw new Error(`${indexPath} is neither a FeatureCollection nor FeatureShardIndex`);
  }
  const features = [];
  for (const shard of value.shards) {
    if (!shard?.url) throw new Error(`${indexPath} contains a shard without a URL`);
    const collection = assertFeatureCollection(
      await readJson(resolveReferencedPath(indexPath, shard.url)),
      shard.url,
    );
    features.push(...collection.features);
  }
  return features;
}

function deduplicateFeatures(features, expectedSourceId) {
  const unique = new Map();
  for (const feature of features) {
    if (!["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)) {
      throw new Error(`Point cache contains a non-polygonal ${feature?.geometry?.type ?? "null"} geometry`);
    }
    if (!geometryBbox(feature.geometry)) {
      throw new Error("Point cache contains a polygon without valid numeric coordinates");
    }
    if (feature.properties?.sourceId !== expectedSourceId) {
      throw new Error(
        `Point-cache feature sourceId ${feature.properties?.sourceId ?? "(missing)"} does not match ${expectedSourceId}`,
      );
    }
    unique.set(featureKey(feature), feature);
  }
  return [...unique.values()];
}

function sourceVersionsFor(cache, features) {
  const versions = expandSourceVersions([
    ...(cache.sourceVersions ?? []),
    cache.sourceVersion,
    ...features.map((feature) => feature.properties?.sourceVersion),
  ]);
  if (!versions.length) {
    throw new Error("Point cache has no sourceVersion provenance");
  }
  return versions;
}

function featureKey(feature) {
  const properties = feature.properties ?? {};
  const recordIds = Array.isArray(properties.sources)
    ? properties.sources
        .map((source) => source?.record_id ?? source?.recordId)
        .filter(Boolean)
        .sort()
    : [];
  const identity = {
    sourceId: properties.sourceId,
    recordIds,
    identifier: properties.identifier ?? properties.id ?? null,
    partIndex: properties.partIndex ?? null,
    geometry: feature.geometry,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function resolveReferencedPath(indexPath, url) {
  if (String(url).startsWith("/data/")) return `public${url}`;
  if (String(url).startsWith("/")) return String(url);
  return join(dirname(indexPath), String(url));
}

function publicShardUrl(indexDir, fileName) {
  const publicDir = indexDir.startsWith("public")
    ? indexDir.slice("public".length)
    : indexDir;
  return `${publicDir}/shards/${fileName}`.replace(/\/+/g, "/");
}

function publicPath(path) {
  return path.startsWith("public/") ? `/${path.slice("public/".length)}` : path;
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
  const west = lonIndex * shardDegrees - 180;
  const south = latIndex * shardDegrees - 90;
  return [west, south, west + shardDegrees, south + shardDegrees];
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

function flattenCoordinates(value, output) {
  if (!Array.isArray(value)) return;
  if (
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  ) {
    output.push(value);
    return;
  }
  value.forEach((item) => flattenCoordinates(item, output));
}

function bboxesIntersect(left, right) {
  return (
    Array.isArray(left) &&
    left[0] <= right[2] &&
    left[2] >= right[0] &&
    left[1] <= right[3] &&
    left[3] >= right[1]
  );
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))]
    .sort();
}

function expandSourceVersions(values) {
  return uniqueSorted(
    values.flatMap((value) =>
      typeof value === "string" ? value.split("+").map((part) => part.trim()) : [],
    ),
  );
}

async function runCli() {
  const args = parseArgs();
  const requiredBbox = parseBbox(
    requireArg(args, "required-bbox", "Missing --required-bbox west,south,east,north"),
  );
  const summary = await promotePointCache({
    cacheIndexPath: requireArg(args, "cache-index", "Missing --cache-index"),
    canonicalIndexPath: requireArg(args, "canonical-index", "Missing --canonical-index"),
    expectedSourceId: requireArg(args, "source-id", "Missing --source-id"),
    requiredBbox: [
      requiredBbox.west,
      requiredBbox.south,
      requiredBbox.east,
      requiredBbox.north,
    ],
    generatedAt: requireArg(
      args,
      "generated-at",
      "Missing --generated-at ISO-8601 (explicit for reproducibility)",
    ),
    dryRun: args["dry-run"] === "true",
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await runCli();
}
