#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs, readJson, requireArg, writeJson } from "./shared.mjs";

const MANIFEST_PATH = "public/data/processed/cache-manifest.json";
const DEFAULT_SOURCES = ["overture"];

const args = parseArgs();
const lat = Number(requireArg(args, "lat", "Missing --lat"));
const lon = Number(requireArg(args, "lon", "Missing --lon"));
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  throw new Error("--lat and --lon must be numeric WGS84 coordinates");
}

const sources = String(args.sources ?? DEFAULT_SOURCES.join(","))
  .split(",")
  .map((source) => source.trim())
  .filter(Boolean);
const radiusMeters = Number(args.radius ?? 1_000);
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const bbox = bboxAroundPoint(lat, lon, radiusMeters);
const key = pointCacheKey(lat, lon, radiusMeters);

const entries = [];

for (const source of sources) {
  if (source === "overture") {
    entries.push(await resolveOvertureBuildings({ bbox, key, sourceVersion }));
    continue;
  }
  if (source === "urban-atlas") {
    entries.push(await resolveUrbanAtlas({ key, sourceVersion }));
    continue;
  }
  throw new Error(`Unsupported --sources entry ${source}. Use overture,urban-atlas`);
}

await updateManifest(entries.filter(Boolean));

async function resolveOvertureBuildings({ bbox: bboxValue, key: keyValue, sourceVersion: version }) {
  const out = `public/data/processed/cache/overture-buildings/${keyValue}/index.json`;
  run("node", [
    "scripts/preprocess/preprocess-building-fallback.mjs",
    "--provider",
    "overture",
    "--bbox",
    bboxValue.join(","),
    "--out",
    out,
    "--source-version",
    version,
  ]);
  return {
    sourceId: "overture-buildings",
    indexUrl: publicUrl(out),
    bbox: bboxValue,
    sourceVersion: version,
    generatedAt: new Date().toISOString(),
    label: `Overture buildings ${keyValue}`,
  };
}

async function resolveUrbanAtlas({ key: keyValue, sourceVersion: version }) {
  const input = args["urban-atlas-input"];
  const fuaCode = args["urban-atlas-fua-code"];
  const fuaName = args["urban-atlas-fua-name"];
  if (!input && !fuaCode && !fuaName) {
    throw new Error(
      "Urban Atlas cache resolution requires --urban-atlas-input <FlatGeobuf/GeoJSON> or --urban-atlas-fua-code/--urban-atlas-fua-name. CDSE credentials must stay in the shell environment, not in repo files.",
    );
  }

  const out = `public/data/processed/cache/copernicus-urban-atlas/${keyValue}/index.json`;
  const commandArgs = [
    "scripts/preprocess/preprocess-thematic-geojson.mjs",
    "--provider",
    "urban-atlas",
    "--out",
    out,
    "--source-version",
    version,
  ];
  if (input) commandArgs.push("--input", input);
  if (fuaCode) commandArgs.push("--fua-code", fuaCode);
  if (fuaName) commandArgs.push("--fua-name", fuaName);
  run("node", commandArgs);
  const index = await readJson(out);
  return {
    sourceId: "copernicus-urban-atlas",
    indexUrl: publicUrl(out),
    bbox: indexBbox(index),
    sourceVersion: version,
    generatedAt: new Date().toISOString(),
    label: `Copernicus Urban Atlas ${fuaCode ?? fuaName ?? keyValue}`,
  };
}

async function updateManifest(newEntries) {
  const manifest =
    existsSync(MANIFEST_PATH)
      ? await readJson(MANIFEST_PATH)
      : { type: "UcaCacheManifest", entries: [] };
  if (manifest.type !== "UcaCacheManifest" || !Array.isArray(manifest.entries)) {
    throw new Error(`${MANIFEST_PATH} is not a valid UcaCacheManifest`);
  }
  const remaining = manifest.entries.filter(
    (entry) =>
      !newEntries.some(
        (candidate) => candidate.sourceId === entry.sourceId && candidate.indexUrl === entry.indexUrl,
      ),
  );
  manifest.entries = [...remaining, ...newEntries].sort((a, b) =>
    `${a.sourceId}:${a.indexUrl}`.localeCompare(`${b.sourceId}:${b.indexUrl}`),
  );
  await writeJson(MANIFEST_PATH, manifest);
  console.log(`Updated ${MANIFEST_PATH} with ${newEntries.length} point-cache entr${newEntries.length === 1 ? "y" : "ies"}`);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}`);
  }
}

function bboxAroundPoint(latValue, lonValue, radiusMetersValue) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(1, Math.cos((latValue * Math.PI) / 180) * metersPerDegreeLat);
  const latDelta = radiusMetersValue / metersPerDegreeLat;
  const lonDelta = radiusMetersValue / metersPerDegreeLon;
  return [
    round(lonValue - lonDelta),
    round(latValue - latDelta),
    round(lonValue + lonDelta),
    round(latValue + latDelta),
  ];
}

function pointCacheKey(latValue, lonValue, radiusMetersValue) {
  const safeLat = latValue.toFixed(4).replace("-", "s").replace(".", "_");
  const safeLon = lonValue.toFixed(4).replace("-", "w").replace(".", "_");
  return `${safeLat}_${safeLon}_${Math.round(radiusMetersValue)}m`;
}

function publicUrl(path) {
  return path.startsWith("public/") ? `/${path.slice("public/".length)}` : path;
}

function indexBbox(index) {
  const bboxes = index.shards?.map((shard) => shard.bbox).filter(Boolean) ?? [];
  if (!bboxes.length) return bbox;
  return bboxes.reduce(
    (merged, current) => [
      Math.min(merged[0], current[0]),
      Math.min(merged[1], current[1]),
      Math.max(merged[2], current[2]),
      Math.max(merged[3], current[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
