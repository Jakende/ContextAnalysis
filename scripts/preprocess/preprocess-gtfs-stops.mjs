#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  fetchBuffer,
  firstString,
  parseArgs,
  requireArg,
  writeJson,
} from "./shared.mjs";

const DEFAULT_OUT = "public/data/processed/gtfs-stops/index.json";
const FEEDS = {
  "gtfs-de-local-transit": {
    url: "https://download.gtfs.de/germany/nv_free/latest.zip",
    provider: "GTFS.DE local public transit",
    sourceId: "gtfs-de-local-transit",
    out: DEFAULT_OUT,
  },
  "gtfs-de-full": {
    url: "https://download.gtfs.de/germany/free/latest.zip",
    provider: "GTFS.DE full Germany",
    sourceId: "gtfs-de-full",
    out: "public/data/processed/gtfs-full-stops/index.json",
  },
  "gtfs-de-regional-rail": {
    url: "https://download.gtfs.de/germany/rv_free/latest.zip",
    provider: "GTFS.DE regional rail",
    sourceId: "gtfs-de-regional-rail",
    out: "public/data/processed/gtfs-regional-rail-stops/index.json",
  },
  "gtfs-de-long-distance-rail": {
    url: "https://download.gtfs.de/germany/fv_free/latest.zip",
    provider: "GTFS.DE long-distance rail",
    sourceId: "gtfs-de-long-distance-rail",
    out: "public/data/processed/gtfs-long-distance-rail-stops/index.json",
  },
};

const args = parseArgs();
const feed = args.feed ? FEEDS[args.feed] : null;
if (args.feed && !feed) {
  throw new Error(`Unsupported --feed ${args.feed}. Use ${Object.keys(FEEDS).join(", ")}`);
}

const out = args.out ?? feed?.out ?? DEFAULT_OUT;
const shardDegrees = Number(args["shard-degrees"] ?? 0.25);
const singleFile = args["single-file"] === "true";
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const provider = args.provider ?? feed?.provider ?? "GTFS feed provider";
const sourceId = args["source-id"] ?? feed?.sourceId ?? "mobilithek-gtfs";
const input = args.input;
const url = args.url ?? feed?.url;

if (!input && !url) {
  throw new Error(
    `Provide --input <gtfs.zip|directory|stops.txt>, --url <gtfs.zip|stops.txt>, or --feed ${Object.keys(FEEDS).join("|")}`,
  );
}

const workingDir = await mkdtemp(join(tmpdir(), "uca-gtfs-"));

try {
  let sourcePath = input;
  if (url) {
    sourcePath = join(workingDir, basename(new URL(url).pathname) || "gtfs.zip");
    console.log(`Downloading GTFS input from ${url}`);
    await writeFile(sourcePath, await fetchBuffer(url));
  }

  const stopsPath = await resolveStopsPath(sourcePath, workingDir);
  const rows = parseCsv(await readFile(stopsPath, "utf8"));
  const features = rows
    .map((row) => {
      const lat = Number(row.stop_lat);
      const lon = Number(row.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          sourceId,
          sourceVersion,
          provider,
          feed: args.feed ?? "custom",
          stop_id: row.stop_id,
          stop_name: row.stop_name,
          label: firstString(row, ["stop_name", "stop_id"]) ?? "GTFS stop",
          transportMode: row.location_type === "1" ? "station" : "transit",
          processedAt: new Date().toISOString(),
        },
      };
    })
    .filter(Boolean);

  if (singleFile) {
    await writeJson(out, { type: "FeatureCollection", features });
    console.log(`Wrote ${features.length} GTFS stop features to ${out}`);
  } else {
    await writeShardedGeoJson(out, features, {
      sourceId,
      sourceVersion,
      provider,
      feed: args.feed ?? "custom",
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
    const [lon, lat] = feature.geometry.coordinates;
    const key = shardKey(lon, lat, metadata.shardDegrees);
    const shardFeatures = shards.get(key) ?? [];
    shardFeatures.push(feature);
    shards.set(key, shardFeatures);
  }

  const shardEntries = [];
  for (const [key, shardFeatures] of shards) {
    const fileName = `${key}.geojson`;
    const shardPath = join(shardDir, fileName);
    await writeJson(shardPath, { type: "FeatureCollection", features: shardFeatures });
    shardEntries.push({
      key,
      url: `/data/processed/gtfs-stops/shards/${fileName}`,
      bbox: shardBbox(key, metadata.shardDegrees),
      count: shardFeatures.length,
    });
  }

  shardEntries.sort((a, b) => a.key.localeCompare(b.key));
  await writeJson(indexPath, {
    type: "FeatureShardIndex",
    sourceId: metadata.sourceId,
    sourceVersion: metadata.sourceVersion,
    provider: metadata.provider,
    feed: metadata.feed,
    shardDegrees: metadata.shardDegrees,
    featureCount: features.length,
    shardCount: shardEntries.length,
    generatedAt: new Date().toISOString(),
    shards: shardEntries,
  });
  console.log(
    `Wrote ${features.length} GTFS stop features into ${shardEntries.length} shards with index ${indexPath}`,
  );
}

function shardKey(lon, lat, shardDegrees) {
  const lonIndex = Math.floor((lon + 180) / shardDegrees);
  const latIndex = Math.floor((lat + 90) / shardDegrees);
  return `${latIndex}_${lonIndex}`;
}

function shardBbox(key, shardDegrees) {
  const [latIndex, lonIndex] = key.split("_").map(Number);
  const west = lonIndex * shardDegrees - 180;
  const south = latIndex * shardDegrees - 90;
  return [west, south, west + shardDegrees, south + shardDegrees];
}

async function resolveStopsPath(sourcePath, workingDir) {
  if (!sourcePath) throw new Error("Missing GTFS source path");
  if (sourcePath.endsWith(".txt")) return sourcePath;
  if (!sourcePath.endsWith(".zip")) return join(sourcePath, "stops.txt");
  ensureCommand("unzip");
  const result = spawnSync("unzip", ["-o", sourcePath, "stops.txt", "-d", workingDir], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
  return join(workingDir, "stops.txt");
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
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
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function ensureCommand(command) {
  const result = spawnSync(command, ["-v"], { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command} is required to read zipped GTFS feeds`);
  }
}
