#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import {
  fetchBuffer,
  firstString,
  parseArgs,
  writeJson,
} from "./shared.mjs";

const DEFAULT_OUT = "public/data/processed/gtfs-lines/index.json";
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
    out: "public/data/processed/gtfs-full-lines/index.json",
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
const sourceId = args["source-id"] ?? feed?.sourceId ?? "gtfs-de-local-transit";
const input = args.input;
const url = args.url ?? feed?.url;

if (!input && !url) {
  throw new Error(
    `Provide --input <gtfs.zip|directory>, --url <gtfs.zip>, or --feed ${Object.keys(FEEDS).join("|")}`,
  );
}

const workingDir = await mkdtemp(join(tmpdir(), "uca-gtfs-lines-"));

try {
  let sourcePath = input;
  if (url) {
    sourcePath = join(workingDir, basename(new URL(url).pathname) || "gtfs.zip");
    console.log(`Downloading GTFS input from ${url}`);
    await writeFile(sourcePath, await fetchBuffer(url));
  }

  const { routesPath, tripsPath, shapesPath, stopTimesPath, stopsPath } =
    await resolveGtfsPaths(sourcePath, workingDir);
  const routes = await parseCsvFile(routesPath);
  const trips = await parseCsvFile(tripsPath);
  const shapes = shapesPath ? await parseCsvFile(shapesPath) : [];

  const routeById = new Map(routes.map((row) => [row.route_id, row]));
  const shapeUsage = new Map();
  for (const trip of trips) {
    if (!trip.route_id || !trip.shape_id) continue;
    const key = `${trip.route_id}::${trip.shape_id}`;
    shapeUsage.set(key, (shapeUsage.get(key) ?? 0) + 1);
  }

  const representativeShapeByRoute = new Map();
  for (const [key, tripCount] of shapeUsage) {
    const [routeId, shapeId] = key.split("::");
    const current = representativeShapeByRoute.get(routeId);
    if (!current || tripCount > current.tripCount) {
      representativeShapeByRoute.set(routeId, { shapeId, tripCount });
    }
  }

  const pointsByShape = buildPointsByShape(shapes);
  const representativeTripByRoute = stopTimesPath
    ? await buildRepresentativeTripByRouteFromStopTimes(trips, stopTimesPath)
    : new Map();
  const stopCoordinateById = stopsPath
    ? await buildStopCoordinateByIdFromFile(stopsPath)
    : new Map();

  const features = [];
  for (const [routeId, shapeInfo] of representativeShapeByRoute) {
    const route = routeById.get(routeId);
    const points = pointsByShape.get(shapeInfo.shapeId);
    if (!route || !points?.length) continue;
    const coordinates = points
      .sort((a, b) => a.sequence - b.sequence)
      .map((point) => [point.lon, point.lat]);
    const sanitized = dedupeCoordinates(coordinates);
    if (sanitized.length < 2) continue;

    const label =
      firstString(route, ["route_short_name", "route_long_name", "route_id"]) ?? "GTFS line";
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: sanitized },
      properties: {
        sourceId,
        sourceVersion,
        provider,
        feed: args.feed ?? "custom",
        route_id: routeId,
        route_short_name: route.route_short_name ?? "",
        route_long_name: route.route_long_name ?? "",
        route_type: route.route_type ?? "",
        shape_id: shapeInfo.shapeId,
        tripCount: shapeInfo.tripCount,
        label,
        transportMode: mapGtfsRouteType(route.route_type),
        processedAt: new Date().toISOString(),
      },
    });
  }

  for (const [routeId, tripInfo] of representativeTripByRoute) {
    if (representativeShapeByRoute.has(routeId)) continue;
    const route = routeById.get(routeId);
    if (!route) continue;
    const coordinates = tripInfo.stopIds
      .map((stopId) => stopCoordinateById.get(stopId))
      .filter(Boolean);
    const sanitized = dedupeCoordinates(coordinates);
    if (sanitized.length < 2) continue;
    const label =
      firstString(route, ["route_short_name", "route_long_name", "route_id"]) ?? "GTFS line";
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: sanitized },
      properties: {
        sourceId,
        sourceVersion,
        provider,
        feed: args.feed ?? "custom",
        route_id: routeId,
        route_short_name: route.route_short_name ?? "",
        route_long_name: route.route_long_name ?? "",
        route_type: route.route_type ?? "",
        trip_id: tripInfo.tripId,
        stopCount: sanitized.length,
        label,
        geometrySource: "stop_times",
        transportMode: mapGtfsRouteType(route.route_type),
        processedAt: new Date().toISOString(),
      },
    });
  }

  if (singleFile) {
    await writeJson(out, { type: "FeatureCollection", features });
    console.log(`Wrote ${features.length} GTFS line features to ${out}`);
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
    const bbox = geometryBbox(feature.geometry.coordinates);
    const keys = shardKeysForBbox(bbox, metadata.shardDegrees);
    for (const key of keys) {
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
      url: `/data/processed/gtfs-lines/shards/${fileName}`,
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
    `Wrote ${features.length} GTFS line features into ${shardEntries.length} shards with index ${indexPath}`,
  );
}

function geometryBbox(coordinates) {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of coordinates) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

function shardKeysForBbox(bbox, shardDegrees) {
  const [west, south, east, north] = bbox;
  const minLonIndex = Math.floor((west + 180) / shardDegrees);
  const maxLonIndex = Math.floor((east + 180) / shardDegrees);
  const minLatIndex = Math.floor((south + 90) / shardDegrees);
  const maxLatIndex = Math.floor((north + 90) / shardDegrees);
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

async function resolveGtfsPaths(sourcePath, workingDir) {
  if (!sourcePath) throw new Error("Missing GTFS source path");
  if (!sourcePath.endsWith(".zip")) {
    return {
      routesPath: join(sourcePath, "routes.txt"),
      tripsPath: join(sourcePath, "trips.txt"),
      shapesPath: await optionalPath(join(sourcePath, "shapes.txt")),
      stopTimesPath: await optionalPath(join(sourcePath, "stop_times.txt")),
      stopsPath: await optionalPath(join(sourcePath, "stops.txt")),
    };
  }
  ensureCommand("unzip");
  const listed = spawnSync("unzip", ["-Z1", sourcePath], { encoding: "utf8" });
  if (listed.status !== 0) {
    throw new Error(`unzip list failed: ${listed.stderr || listed.stdout}`);
  }
  const available = new Set(listed.stdout.split(/\r?\n/).filter(Boolean));
  const entries = ["routes.txt", "trips.txt", "shapes.txt", "stop_times.txt", "stops.txt"].filter(
    (entry) => available.has(entry),
  );
  const result = spawnSync("unzip", ["-o", sourcePath, ...entries, "-d", workingDir], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
  return {
    routesPath: join(workingDir, "routes.txt"),
    tripsPath: join(workingDir, "trips.txt"),
    shapesPath: available.has("shapes.txt") ? join(workingDir, "shapes.txt") : null,
    stopTimesPath: available.has("stop_times.txt") ? join(workingDir, "stop_times.txt") : null,
    stopsPath: available.has("stops.txt") ? join(workingDir, "stops.txt") : null,
  };
}

async function optionalPath(path) {
  try {
    await readFile(path, "utf8");
    return path;
  } catch {
    return null;
  }
}

function mapGtfsRouteType(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return "transit";
  if (value === 0 || (value >= 900 && value < 1000)) return "tram";
  if (value === 1 || (value >= 400 && value < 500)) return "subway";
  if (value === 2 || (value >= 100 && value < 200)) return "rail";
  if (value === 3 || (value >= 700 && value < 800)) return "bus";
  return "transit";
}

function dedupeCoordinates(coordinates) {
  const output = [];
  for (const coordinate of coordinates) {
    const previous = output.at(-1);
    if (previous && previous[0] === coordinate[0] && previous[1] === coordinate[1]) continue;
    output.push(coordinate);
  }
  return output;
}

function buildPointsByShape(shapes) {
  const pointsByShape = new Map();
  for (const row of shapes) {
    if (!row.shape_id) continue;
    const lat = Number(row.shape_pt_lat);
    const lon = Number(row.shape_pt_lon);
    const sequence = Number(row.shape_pt_sequence);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(sequence)) continue;
    const points = pointsByShape.get(row.shape_id) ?? [];
    points.push({ lat, lon, sequence });
    pointsByShape.set(row.shape_id, points);
  }
  return pointsByShape;
}

async function buildStopCoordinateByIdFromFile(path) {
  const stops = await parseCsvFile(path);
  const stopCoordinateById = new Map();
  for (const row of stops) {
    const lat = Number(row.stop_lat);
    const lon = Number(row.stop_lon);
    if (!row.stop_id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stopCoordinateById.set(row.stop_id, [lon, lat]);
  }
  return stopCoordinateById;
}

async function buildRepresentativeTripByRouteFromStopTimes(trips, stopTimesPath) {
  const routeByTrip = new Map();
  for (const trip of trips) {
    if (!trip.trip_id || !trip.route_id) continue;
    routeByTrip.set(trip.trip_id, trip.route_id);
  }
  const representativeTripByRoute = new Map();
  const stream = createReadStream(stopTimesPath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  let currentTripId = null;
  let currentStops = [];
  for await (const rawLine of reader) {
    const line = headers ? rawLine : rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    if (!row.trip_id || !row.stop_id) continue;
    if (currentTripId !== null && row.trip_id !== currentTripId) {
      commitRepresentativeTrip(routeByTrip, representativeTripByRoute, currentTripId, currentStops);
      currentStops = [];
    }
    currentTripId = row.trip_id;
    currentStops.push(row.stop_id);
  }
  if (currentTripId !== null && currentStops.length > 0) {
    commitRepresentativeTrip(routeByTrip, representativeTripByRoute, currentTripId, currentStops);
  }
  return representativeTripByRoute;
}

function commitRepresentativeTrip(routeByTrip, representativeTripByRoute, tripId, stopIds) {
  const routeId = routeByTrip.get(tripId);
  if (!routeId || stopIds.length < 2) return;
  const dedupedStops = [];
  for (const stopId of stopIds) {
    if (dedupedStops.at(-1) === stopId) continue;
    dedupedStops.push(stopId);
  }
  if (dedupedStops.length < 2) return;
  const current = representativeTripByRoute.get(routeId);
  if (!current || dedupedStops.length > current.stopIds.length) {
    representativeTripByRoute.set(routeId, { tripId, stopIds: dedupedStops });
  }
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

async function parseCsvFile(path) {
  const rows = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  for await (const rawLine of reader) {
    const line = headers ? rawLine : rawLine.replace(/^\uFEFF/, "");
    if (!line) continue;
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const values = parseCsvLine(line);
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }
  return rows;
}

function ensureCommand(command) {
  const result = spawnSync(command, ["-v"], { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command} is required to read zipped GTFS feeds`);
  }
}
