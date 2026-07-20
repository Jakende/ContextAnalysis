#!/usr/bin/env node
import { existsSync } from "node:fs";
import { parseArgs, readJson } from "../preprocess/shared.mjs";

const args = parseArgs();
const REGRESSION_POINTS = [
  { id: "munich", label: "Munich centre", lat: 48.13613, lon: 11.58082 },
  { id: "frankfurt", label: "Frankfurt centre", lat: 50.11092, lon: 8.68213 },
  { id: "rosenheim", label: "Rosenheim small-city", lat: 47.85637, lon: 12.12247 },
];

const radiusMeters = Number(args.radius ?? 1_000);
const points =
  args.regression === "true" || args.preset === "regression"
    ? REGRESSION_POINTS
    : [
        {
          id: "custom",
          label: "Custom point",
          lat: Number(args.lat ?? 48.13613),
          lon: Number(args.lon ?? 11.58082),
        },
      ];

for (const point of points) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    throw new Error("--lat and --lon must be numeric WGS84 coordinates");
  }
}

const runs = [];
for (const point of points) {
  runs.push(await runPointChecks(point));
}

const output = {
  mode: points.length > 1 ? "regression" : "single-point",
  radiusMeters,
  generatedAt: new Date().toISOString(),
  points: runs,
};

console.log(JSON.stringify(output, null, 2));

const hardFailures = runs.flatMap((run) =>
  run.checks.filter((check) =>
    ["failed", "missing", "missing-credentials"].includes(check.status),
  ),
);
if (hardFailures.length) {
  process.exitCode = 1;
}

async function runPointChecks(point) {
  const bbox = bboxAroundPoint(point.lat, point.lon, radiusMeters);
  const checks = [
    await geoJsonPointCoverage({
      id: "bkg-geobasis",
      label: "BKG boundaries",
      path: "public/data/processed/bkg-boundaries.geojson",
      point,
      pointRequired: true,
    }),
    await geoJsonPointCoverage({
      id: "eurostat-gisco-fua",
      label: "Eurostat GISCO FUA",
      path: "public/data/processed/eurostat-gisco-fua.geojson",
      point,
      pointRequired: false,
    }),
    await shardedCoverage({
      id: "gtfs-de-local-transit",
      label: "GTFS.DE local transit stops",
      indexPath: "public/data/processed/gtfs-stops/index.json",
      bbox,
    }),
    await shardedCoverage({
      id: "copernicus-urban-atlas",
      label: "Copernicus Urban Atlas",
      indexPath: "public/data/processed/copernicus-urban-atlas/index.json",
      bbox,
    }),
    await shardedCoverage({
      id: "overture-buildings",
      label: "Overture buildings canonical shards",
      indexPath: "public/data/processed/overture-buildings/index.json",
      bbox,
    }),
    await zensusWmsProbe(),
  ];

  return {
    id: point.id,
    label: point.label,
    point: { lat: point.lat, lon: point.lon },
    bbox,
    checks,
  };
}

async function geoJsonPointCoverage({ id, label, path, point, pointRequired }) {
  if (!existsSync(path)) {
    return result(id, label, "missing", `Missing ${path}`);
  }
  try {
    const collection = await readJson(path);
    const features = Array.isArray(collection.features) ? collection.features : [];
    const hits = features.filter((feature) =>
      pointInGeometry([point.lon, point.lat], feature.geometry),
    );
    if (hits.length) {
      return result(id, label, "fetched", `${hits.length} point-covering feature(s).`, {
        featureCount: hits.length,
      });
    }
    return result(
      id,
      label,
      pointRequired ? "empty" : "skipped",
      pointRequired
        ? "Dataset exists, but no feature covers the selected point."
        : "Dataset exists, but selected point is outside this optional coverage.",
      { featureCount: 0 },
    );
  } catch (error) {
    return result(id, label, "failed", errorMessage(error));
  }
}

async function shardedCoverage({ id, label, indexPath, bbox: targetBbox }) {
  if (!existsSync(indexPath)) {
    return result(id, label, "missing", `Missing ${indexPath}`);
  }
  try {
    const index = await readJson(indexPath);
    const shards = (index.shards ?? []).filter((shard) =>
      Array.isArray(shard.bbox) && bboxesIntersect(shard.bbox, targetBbox),
    );
    let featureCount = 0;
    for (const shard of shards) {
      const shardPath = publicUrlToPath(shard.url);
      if (!existsSync(shardPath)) continue;
      const collection = await readJson(shardPath);
      featureCount += Array.isArray(collection.features)
        ? collection.features.length
        : 0;
    }
    return result(
      id,
      label,
      featureCount > 0 ? "fetched" : "empty",
      `${shards.length} shard(s), ${featureCount} feature(s).`,
      { featureCount, recordCount: shards.length },
    );
  } catch (error) {
    return result(id, label, "failed", errorMessage(error));
  }
}

async function zensusWmsProbe() {
  const url =
    "https://www.wms.nrw.de/wms/zensusatlas?service=WMS&request=GetCapabilities&version=1.3.0";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "UrbanContextAnalysis/0.1 data-source-test" },
    });
    const text = await response.text();
    const layerCount = (text.match(/<Name>[^<]+_[0-9]+(?:km|m)<\/Name>/g) ?? [])
      .length;
    return result(
      "zensus-grid-2022",
      "Zensus 2022 WMS",
      response.ok && layerCount > 0 ? "fetched" : "failed",
      `HTTP ${response.status}; ${layerCount} grid layer name(s).`,
      { recordCount: layerCount },
    );
  } catch (error) {
    return result("zensus-grid-2022", "Zensus 2022 WMS", "failed", errorMessage(error));
  }
}

function result(id, label, status, detail, counts = {}) {
  return {
    id,
    label,
    status,
    detail,
    ...counts,
  };
}

function bboxAroundPoint(latValue, lonValue, radiusMetersValue) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(
    1,
    Math.cos((latValue * Math.PI) / 180) * metersPerDegreeLat,
  );
  const latDelta = radiusMetersValue / metersPerDegreeLat;
  const lonDelta = radiusMetersValue / metersPerDegreeLon;
  return [
    round(lonValue - lonDelta),
    round(latValue - latDelta),
    round(lonValue + lonDelta),
    round(latValue + latDelta),
  ];
}

function bboxesIntersect(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  }
  return false;
}

function pointInPolygon(point, polygon) {
  const [outer, ...holes] = polygon;
  return pointInRing(point, outer) && !holes.some((ring) => pointInRing(point, ring));
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function publicUrlToPath(url) {
  return String(url).startsWith("/") ? `public${url}` : String(url);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
