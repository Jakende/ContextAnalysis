#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertFeatureCollection,
  explodePolygonalFeatures,
  firstNumber,
  firstString,
  parseArgs,
  readJson,
  requireArg,
  writeJson,
} from "./shared.mjs";

const PROVIDERS = {
  overture: {
    sourceId: "overture-buildings",
    out: "public/data/processed/overture-buildings/index.json",
  },
  "overture-building-parts": {
    sourceId: "overture-building-parts",
    out: "public/data/processed/overture-building-parts/index.json",
    overtureType: "building_part",
  },
  "global-building-atlas": {
    sourceId: "global-building-atlas",
    out: "public/data/processed/global-building-atlas.geojson",
  },
  lod2: {
    sourceId: "lod2-bayern",
    out: "public/data/processed/lod2-buildings.geojson",
  },
};

const args = parseArgs();
const providerKey = args.provider ?? "overture";
const provider = PROVIDERS[providerKey];
if (!provider) {
  throw new Error(`Unsupported --provider ${providerKey}. Use ${Object.keys(PROVIDERS).join(", ")}`);
}

const out = args.out ?? provider.out;
const singleFile = args["single-file"] === "true";
const shardDegrees = Number(args["shard-degrees"] ?? 0.02);
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const allowEstimatedLevels = args["levels-height-m"] ? Number(args["levels-height-m"]) : null;
const licenseMode = args["license-mode"] ?? "preserve";

if (providerKey === "global-building-atlas" && licenseMode === "preserve") {
  throw new Error(
    "GlobalBuildingAtlas has mixed license classes. Pass --license-mode odbl-only or --license-mode reviewed to make the decision explicit.",
  );
}

const workingDir = await mkdtemp(join(tmpdir(), "uca-buildings-"));

try {
  const input = args.input ?? maybeDownloadOverture(args, provider, workingDir);
  if (!input) {
    throw new Error(
      "Missing --input. For Overture, provide --bbox west,south,east,north to download with the overturemaps CLI, or provide a locally prepared GeoJSON FeatureCollection.",
    );
  }
  const collection = assertFeatureCollection(await readJson(input), input);
  const normalized = explodePolygonalFeatures(collection, (properties) => {
    const measuredHeight = firstNumber(properties, [
      "height",
      "building:height",
      "measuredHeight",
      "measured_height",
      "Hoehe",
      "hoehe",
      "H_DACH",
      "h_dach",
      "DACH_H",
      "dach_h",
      "roof_height",
    ]);
    const levels = firstNumber(properties, ["building:levels", "levels", "num_floors"]);
    const estimatedHeight =
      measuredHeight === undefined && allowEstimatedLevels && levels
        ? levels * allowEstimatedLevels
        : undefined;
    const height = measuredHeight ?? estimatedHeight;
    const label = firstString(properties, ["name", "id", "building_id"]) ?? "building";

    return {
      ...properties,
      sourceId: provider.sourceId,
      sourceVersion,
      label,
      ...(height !== undefined
        ? {
            height,
            heightSource: measuredHeight !== undefined ? "measured-or-source" : "estimated-levels",
            heightEstimated: measuredHeight === undefined,
          }
        : {}),
      licenseMode,
      processedAt: new Date().toISOString(),
    };
  });

  if (singleFile || !out.endsWith("index.json")) {
    await writeJson(out, normalized);
    console.log(`Wrote ${normalized.features.length} ${provider.sourceId} polygon features to ${out}`);
  } else {
    await writeShardedGeoJson(out, normalized.features, {
      sourceId: provider.sourceId,
      sourceVersion,
      shardDegrees,
    });
  }
} finally {
  await rm(workingDir, { recursive: true, force: true });
}

async function writeShardedGeoJson(indexPath, features, metadata) {
  if (!Number.isFinite(metadata.shardDegrees) || metadata.shardDegrees <= 0) {
    throw new Error("--shard-degrees must be a positive number");
  }
  const indexDir = indexPath.replace(/\/[^/]+$/, "");
  const shardDir = join(indexDir, "shards");
  await mkdir(shardDir, { recursive: true });
  const shards = new Map();
  for (const feature of features) {
    const bbox = geometryBbox(feature.geometry);
    if (!bbox) continue;
    for (const key of shardKeysForBbox(bbox, metadata.shardDegrees)) {
      const shardFeatures = shards.get(key) ?? [];
      shardFeatures.push(feature);
      shards.set(key, shardFeatures);
    }
  }

  const shardEntries = [];
  for (const [key, shardFeatures] of shards) {
    const fileName = `${key}.geojson`;
    const shardPath = join(shardDir, fileName);
    await writeJson(shardPath, { type: "FeatureCollection", features: shardFeatures });
    shardEntries.push({
      key,
      url: publicShardUrl(indexDir, fileName),
      bbox: shardBbox(key, metadata.shardDegrees),
      count: shardFeatures.length,
    });
  }

  shardEntries.sort((a, b) => a.key.localeCompare(b.key));
  await writeJson(indexPath, {
    type: "FeatureShardIndex",
    sourceId: metadata.sourceId,
    sourceVersion: metadata.sourceVersion,
    shardDegrees: metadata.shardDegrees,
    featureCount: features.length,
    shardCount: shardEntries.length,
    generatedAt: new Date().toISOString(),
    shards: shardEntries,
  });
  console.log(
    `Wrote ${features.length} ${metadata.sourceId} polygon features into ${shardEntries.length} shards with index ${indexPath}`,
  );
}

function publicShardUrl(indexDir, fileName) {
  const publicPrefix = "public";
  const publicDir = indexDir.startsWith(publicPrefix) ? indexDir.slice(publicPrefix.length) : indexDir;
  return `${publicDir}/shards/${fileName}`.replace(/\/+/g, "/");
}

function shardKeysForBbox(bbox, shardDegreesValue) {
  const minLonIndex = Math.floor((bbox[0] + 180) / shardDegreesValue);
  const maxLonIndex = Math.floor((bbox[2] + 180) / shardDegreesValue);
  const minLatIndex = Math.floor((bbox[1] + 90) / shardDegreesValue);
  const maxLatIndex = Math.floor((bbox[3] + 90) / shardDegreesValue);
  const keys = [];
  for (let latIndex = minLatIndex; latIndex <= maxLatIndex; latIndex += 1) {
    for (let lonIndex = minLonIndex; lonIndex <= maxLonIndex; lonIndex += 1) {
      keys.push(`${latIndex}_${lonIndex}`);
    }
  }
  return keys;
}

function shardBbox(key, shardDegreesValue) {
  const [latIndex, lonIndex] = key.split("_").map(Number);
  const west = lonIndex * shardDegreesValue - 180;
  const south = latIndex * shardDegreesValue - 90;
  return [west, south, west + shardDegreesValue, south + shardDegreesValue];
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
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    output.push(value);
    return;
  }
  value.forEach((item) => flattenCoordinates(item, output));
}

function maybeDownloadOverture(argsValue, providerValue, workingDirValue) {
  if (!providerValue.sourceId.startsWith("overture-") || !argsValue.bbox) return null;
  ensureCommand("overturemaps");
  const target = join(workingDirValue, "overture.geojson");
  const type = providerValue.overtureType ?? "building";
  const result = spawnSync(
    "overturemaps",
    ["download", "--bbox", argsValue.bbox, "-f", "geojson", "--type", type, "-o", target],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`overturemaps download failed: ${result.stderr || result.stdout}`);
  }
  return target;
}

function ensureCommand(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required for direct Overture downloads. Install the Overture Maps CLI or pass --input.`);
  }
}
