#!/usr/bin/env node
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertFeatureCollection,
  explodePolygonalFeatures,
  fetchBuffer,
  fetchText,
  firstString,
  parseArgs,
  readJson,
  requireArg,
  writeJson,
} from "./shared.mjs";

const PROVIDERS = {
  "urban-atlas": {
    sourceId: "copernicus-urban-atlas",
    out: "public/data/processed/copernicus-urban-atlas/index.json",
    labelKeys: [
      "class_label",
      "class_2018",
      "class_2021",
      "label",
      "code_2018",
      "code_2021",
      "class",
      "name",
    ],
  },
  ghsl: {
    sourceId: "ghsl-jrc",
    out: "public/data/processed/ghsl.geojson",
    labelKeys: ["label", "class", "gridcode", "name"],
  },
  dwd: {
    sourceId: "dwd-cdc",
    out: "public/data/processed/dwd-climate.geojson",
    labelKeys: ["station_name", "name", "label"],
  },
};

const URBAN_ATLAS_2021_CATALOG =
  "https://s3.waw3-1.cloudferro.com/swift/v1/CatalogueCSV/land_cover_use_in_priority_areas/urban_atlas/clms_ua_land-cover-land-use_europe_V025ha_3yearly_v1/clms_ua_land-cover-land-use_europe_V025ha_3yearly_v1_flatgeobuf.csv";

const args = parseArgs();
const providerKey = requireArg(args, "provider", "Missing --provider urban-atlas|ghsl|dwd");
const provider = PROVIDERS[providerKey];
if (!provider) {
  throw new Error(`Unsupported --provider ${providerKey}. Use ${Object.keys(PROVIDERS).join(", ")}`);
}

const out = args.out ?? provider.out;
const singleFile = args["single-file"] === "true";
const shardDegrees = Number(args["shard-degrees"] ?? 0.05);
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);

const workingDir = await mkdtemp(join(tmpdir(), "uca-thematic-"));

try {
  const input = await resolveInputPath(args, providerKey, workingDir);
  const collection = assertFeatureCollection(await loadVectorCollection(input, workingDir), input);

  const normalized =
    providerKey === "dwd"
      ? normalizeAnyGeometry(collection, provider, sourceVersion)
      : explodePolygonalFeatures(
          collection,
          (properties) => ({
            ...pickUsefulProperties(properties),
            sourceId: provider.sourceId,
            sourceVersion,
            label:
              firstString(properties, provider.labelKeys) ??
              provider.sourceId,
            processedAt: new Date().toISOString(),
          }),
        );

  if (singleFile || !out.endsWith("index.json")) {
    await writeJson(out, normalized);
    console.log(`Wrote ${normalized.features.length} ${provider.sourceId} features to ${out}`);
  } else {
    await writeShardedGeoJson(out, normalized.features, {
      sourceId: provider.sourceId,
      sourceVersion,
      shardDegrees,
    });
  }
} finally {
  await rmQuiet(workingDir);
}

async function writeShardedGeoJson(indexPath, features, metadata) {
  if (!Number.isFinite(metadata.shardDegrees) || metadata.shardDegrees <= 0) {
    throw new Error("--shard-degrees must be a positive number");
  }
  const indexDir = indexPath.replace(/\/[^/]+$/, "");
  const shardDir = join(indexDir, "shards");
  const { mkdir } = await import("node:fs/promises");
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
    await writeJson(join(shardDir, fileName), {
      type: "FeatureCollection",
      features: shardFeatures,
    });
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
    `Wrote ${features.length} ${metadata.sourceId} features into ${shardEntries.length} shards with index ${indexPath}`,
  );
}

async function resolveInputPath(argsValue, providerKeyValue, workingDirValue) {
  if (argsValue.input) return argsValue.input;
  if (argsValue.url || argsValue["download-url"]) {
    return downloadToWorkdir(argsValue.url ?? argsValue["download-url"], workingDirValue);
  }
  if (providerKeyValue === "urban-atlas" && (argsValue["catalog-url"] || argsValue["fua-code"] || argsValue["fua-name"])) {
    const catalogUrl = argsValue["catalog-url"] ?? URBAN_ATLAS_2021_CATALOG;
    const downloadUrl = await resolveUrbanAtlasDownload(catalogUrl, {
      fuaCode: argsValue["fua-code"],
      fuaName: argsValue["fua-name"],
      sourceVersion: argsValue["source-version"],
    });
    console.log(`Resolved Urban Atlas catalog entry to ${downloadUrl}`);
    return downloadToWorkdir(downloadUrl, workingDirValue);
  }
  throw new Error(
    "Missing input. Provide --input <GeoJSON|FlatGeobuf>, --url <download>, or for Urban Atlas --fua-code/--fua-name with optional --catalog-url.",
  );
}

async function loadVectorCollection(inputPath, workingDirValue) {
  const extension = extname(inputPath).toLowerCase();
  if (extension === ".json" || extension === ".geojson") {
    return readJson(inputPath);
  }
  return convertWithOgr2ogr(inputPath, workingDirValue);
}

async function downloadToWorkdir(url, workingDirValue) {
  const fileName = basename(new URL(url).pathname) || "downloaded-vector";
  const target = join(workingDirValue, fileName);
  console.log(`Downloading thematic source from ${url}`);
  await writeFile(target, await fetchBuffer(url));
  return target;
}

async function resolveUrbanAtlasDownload(catalogUrl, { fuaCode, fuaName, sourceVersion: sourceVersionValue }) {
  const rows = parseCsv(await fetchText(catalogUrl));
  const matches = rows.filter((row) => matchesUrbanAtlasRow(row, fuaCode, fuaName));
  const selected =
    matches.find((row) => matchesSourceVersion(row, sourceVersionValue)) ??
    matches[0];
  if (!selected) {
    throw new Error(
      `No Urban Atlas catalog row matched ${fuaCode ? `fua-code=${fuaCode}` : ""}${fuaName ? ` fua-name=${fuaName}` : ""}`,
    );
  }
  const downloadUrl = firstUrl(selected);
  if (!downloadUrl) {
    throw new Error("Matched Urban Atlas catalog row did not contain a download URL");
  }
  return downloadUrl;
}

function matchesSourceVersion(row, sourceVersionValue) {
  if (!sourceVersionValue) return false;
  const normalizedVersion = normalizeSearchValue(sourceVersionValue);
  return Object.values(row).some((value) => normalizeSearchValue(value).includes(normalizedVersion));
}

function matchesUrbanAtlasRow(row, fuaCode, fuaName) {
  const values = Object.values(row).map((value) => normalizeSearchValue(value));
  const normalizedCode = normalizeSearchValue(fuaCode);
  const normalizedName = normalizeSearchValue(fuaName);
  if (normalizedCode && values.some((value) => value === normalizedCode || value.includes(normalizedCode))) {
    return true;
  }
  if (normalizedName && values.some((value) => value.includes(normalizedName))) {
    return true;
  }
  return false;
}

function firstUrl(row) {
  const s3Path = Object.values(row).find(
    (value) => typeof value === "string" && value.startsWith("s3://"),
  );
  if (s3Path) {
    throw new Error(
      `Matched Urban Atlas catalog row uses CDSE S3 access (${s3Path}). Configure CDSE S3 credentials or provide a downloaded FlatGeobuf/GeoJSON via --input.`,
    );
  }
  const urls = Object.values(row).filter(
    (value) => typeof value === "string" && /^https?:\/\//i.test(value),
  );
  return (
    urls.find((value) => /\.(fgb|flatgeobuf)(\?|$)/i.test(value)) ??
    urls.find((value) => /\.(geojson|json|gpkg|zip)(\?|$)/i.test(value)) ??
    urls[0]
  );
}

function normalizeSearchValue(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ü/g, "u")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function convertWithOgr2ogr(inputPath, workingDirValue) {
  ensureCommand("ogr2ogr");
  const convertedPath = join(workingDirValue, "converted.geojson");
  const result = spawnSync(
    "ogr2ogr",
    ["-f", "GeoJSON", "-t_srs", "EPSG:4326", convertedPath, inputPath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ogr2ogr failed: ${result.stderr || result.stdout}`);
  }
  return readJson(convertedPath);
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

function ensureCommand(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required to convert non-GeoJSON thematic inputs`);
  }
}

function normalizeAnyGeometry(collectionValue, providerValue, sourceVersionValue) {
  return {
    type: "FeatureCollection",
    features: collectionValue.features
      .filter((feature) => feature.geometry)
      .map((feature) => ({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          ...pickUsefulProperties(feature.properties ?? {}),
          sourceId: providerValue.sourceId,
          sourceVersion: sourceVersionValue,
          label:
            firstString(feature.properties ?? {}, providerValue.labelKeys) ??
            providerValue.sourceId,
          processedAt: new Date().toISOString(),
        },
      })),
  };
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const delimiter = detectDelimiter(headerLine);
  const headers = parseCsvLine(headerLine, delimiter);
  return lines.map((line) => {
    const values = parseCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function detectDelimiter(line) {
  const commaCount = (line.match(/,/g) ?? []).length;
  const semicolonCount = (line.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvLine(line, delimiter = ",") {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

async function rmQuiet(path) {
  const { rm } = await import("node:fs/promises");
  await rm(path, { recursive: true, force: true });
}

function pickUsefulProperties(properties) {
  const output = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    output[key] = value;
  }
  return output;
}
