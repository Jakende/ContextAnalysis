#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs, readJson } from "../preprocess/shared.mjs";

const CITIES = [
  {
    id: "munich",
    label: "Munich centre",
    bbox: [11.56733, 48.127147, 11.59431, 48.145113],
  },
  {
    id: "frankfurt",
    label: "Frankfurt centre",
    bbox: [8.668122, 50.101937, 8.696138, 50.119903],
  },
  {
    id: "rosenheim",
    label: "Rosenheim small-city",
    bbox: [12.108475, 47.847387, 12.136465, 47.865353],
  },
];
const SOURCES = [
  {
    sourceId: "copernicus-urban-atlas",
    indexPath: "public/data/processed/copernicus-urban-atlas/index.json",
  },
  {
    sourceId: "overture-buildings",
    indexPath: "public/data/processed/overture-buildings/index.json",
  },
];
const REQUIRED_AVAILABLE = new Set([
  "munich:copernicus-urban-atlas",
  "munich:overture-buildings",
  "frankfurt:overture-buildings",
  "rosenheim:copernicus-urban-atlas",
  "rosenheim:overture-buildings",
]);

const args = parseArgs();
const results = [];
for (const city of CITIES) {
  for (const source of SOURCES) {
    results.push(await inspectCoverage(city, source));
  }
}

const failedRequired = results.filter(
  (result) =>
    REQUIRED_AVAILABLE.has(`${result.cityId}:${result.sourceId}`) &&
    result.status !== "available",
);
const unavailable = results.filter((result) => result.status !== "available");
const output = {
  schema: "uca-canonical-city-coverage-check/1",
  summary: {
    available: results.length - unavailable.length,
    unavailable: unavailable.length,
    failedRequired: failedRequired.length,
  },
  results,
};
console.log(JSON.stringify(output, null, 2));

if (failedRequired.length || (args["require-all"] === "true" && unavailable.length)) {
  process.exitCode = 1;
}

async function inspectCoverage(city, source) {
  if (!existsSync(source.indexPath)) {
    return result(city, source, "missing", 0, 0, 0);
  }
  const index = await readJson(source.indexPath);
  if (
    index?.type !== "FeatureShardIndex" ||
    index.sourceId !== source.sourceId ||
    !Array.isArray(index.shards)
  ) {
    return result(city, source, "invalid", 0, 0, 0);
  }
  const shards = index.shards.filter(
    (shard) => Array.isArray(shard.bbox) && bboxesIntersect(shard.bbox, city.bbox),
  );
  const uniqueRecords = new Set();
  let records = 0;
  let missingShards = 0;
  for (const shard of shards) {
    const path = publicUrlToPath(shard.url);
    if (!existsSync(path)) {
      missingShards += 1;
      continue;
    }
    const collection = await readJson(path);
    for (const feature of collection.features ?? []) {
      records += 1;
      if (bboxesIntersect(geometryBbox(feature.geometry), city.bbox)) {
        uniqueRecords.add(featureKey(feature));
      }
    }
  }
  const status =
    missingShards > 0
      ? "missing"
      : uniqueRecords.size > 0
        ? "available"
        : "empty";
  return {
    ...result(city, source, status, shards.length, records, uniqueRecords.size),
    sourceVersion: index.sourceVersion ?? null,
    missingShards,
  };
}

function result(city, source, status, shards, records, intersectingRecords) {
  return {
    cityId: city.id,
    cityLabel: city.label,
    sourceId: source.sourceId,
    indexPath: source.indexPath,
    bbox: city.bbox,
    status,
    shards,
    records,
    intersectingRecords,
  };
}

function featureKey(feature) {
  return createHash("sha256")
    .update(JSON.stringify({ geometry: feature.geometry, sourceId: feature.properties?.sourceId }))
    .digest("hex");
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

function publicUrlToPath(url) {
  return String(url).startsWith("/") ? `public${url}` : String(url);
}
