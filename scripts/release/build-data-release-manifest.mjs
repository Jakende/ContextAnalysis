#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_SCHEMA = "uca-data-release-manifest/1.1";
export const CACHE_CONTROL = "public, max-age=31536000, immutable";
export const REGRESSION_CITIES = [
  { id: "munich", label: "Munich centre", lat: 48.13613, lon: 11.58082 },
  { id: "frankfurt", label: "Frankfurt centre", lat: 50.11092, lon: 8.68213 },
  { id: "rosenheim", label: "Rosenheim small-city", lat: 47.85637, lon: 12.12247 },
];

const SOURCE_DEFINITIONS = [
  {
    id: "bkg-geobasis",
    assetPrefix: "processed/bkg-boundaries.geojson",
    kind: "geojson",
    indexPath: "processed/bkg-boundaries.geojson",
  },
  {
    id: "eurostat-gisco-fua",
    assetPrefix: "processed/eurostat-gisco-fua.geojson",
    kind: "geojson",
    indexPath: "processed/eurostat-gisco-fua.geojson",
  },
  {
    id: "gtfs-de-local-transit",
    assetPrefix: "processed/gtfs-stops/",
    kind: "sharded",
    indexPath: "processed/gtfs-stops/index.json",
  },
  {
    id: "gtfs-de-local-transit-lines",
    assetPrefix: "processed/gtfs-lines/",
    kind: "sharded",
    indexPath: "processed/gtfs-lines/index.json",
  },
  {
    id: "copernicus-urban-atlas",
    assetPrefix: "processed/copernicus-urban-atlas/",
    kind: "sharded",
    indexPath: "processed/copernicus-urban-atlas/index.json",
  },
  {
    id: "overture-buildings",
    assetPrefix: "processed/overture-buildings/",
    kind: "sharded",
    indexPath: "processed/overture-buildings/index.json",
  },
];
export const CANONICAL_SOURCE_IDS = SOURCE_DEFINITIONS.map((source) => source.id);

export async function buildDataReleaseManifest({
  dataRoot = "public/data",
  output = "public/data/data-release-manifest.json",
  write = true,
} = {}) {
  const absoluteDataRoot = resolve(dataRoot);
  const absoluteOutput = resolve(output);
  const files = await listReleaseFiles(absoluteDataRoot, absoluteOutput);
  const assets = [];
  const concurrency = 24;
  for (let offset = 0; offset < files.length; offset += concurrency) {
    const batch = files.slice(offset, offset + concurrency);
    assets.push(
      ...(await Promise.all(
        batch.map(async (absolutePath) => {
          const info = await stat(absolutePath);
          const path = toPosix(relative(absoluteDataRoot, absolutePath));
          return {
            path,
            bytes: info.size,
            sha256: await sha256File(absolutePath),
            sourceId: sourceIdForAsset(path),
          };
        }),
      )),
    );
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));

  const sources = [];
  for (const definition of SOURCE_DEFINITIONS) {
    sources.push(await buildSourceEntry(definition, absoluteDataRoot, assets));
  }

  const assetDigest = digestAssets(assets);
  const releaseDigest = digestRelease(assets, sources);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    releaseId: `uca-data-${releaseDigest.slice(0, 16)}`,
    releaseDigest,
    assetDigest,
    cacheControl: CACHE_CONTROL,
    dataRootContract:
      "VITE_GEODATA_BASE_URL points to the immutable release root containing processed/.",
    excluded: [
      "processed/cache/**",
      "processed/cache-manifest.json",
      "**/.DS_Store",
      "data-release-manifest.json",
    ],
    coverageStates: ["available", "empty", "missing"],
    regressionCities: REGRESSION_CITIES,
    sources,
    assets,
    totals: {
      assets: assets.length,
      bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    },
  };

  if (write) {
    await mkdir(dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return manifest;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolvePromise);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export function digestAssets(assets) {
  const hash = createHash("sha256");
  for (const asset of assets) {
    hash.update(`${asset.path}\0${asset.bytes}\0${asset.sha256}\n`);
  }
  return hash.digest("hex");
}

export function digestRelease(assets, sources) {
  const hash = createHash("sha256");
  hash.update(`${MANIFEST_SCHEMA}\n${digestAssets(assets)}\n`);
  hash.update(JSON.stringify(sources));
  return hash.digest("hex");
}

async function listReleaseFiles(root, output) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = toPosix(relative(root, absolutePath));
      if (isExcluded(path, absolutePath, output)) continue;
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }
  await visit(root);
  return files;
}

function isExcluded(path, absolutePath, output) {
  return (
    absolutePath === output ||
    path === "data-release-manifest.json" ||
    path === "processed/cache" ||
    path.startsWith("processed/cache/") ||
    path === "processed/cache-manifest.json" ||
    path.endsWith("/.DS_Store") ||
    path === ".DS_Store"
  );
}

async function buildSourceEntry(definition, dataRoot, assets) {
  const matchingAssets = assets.filter((asset) =>
    definition.assetPrefix.endsWith("/")
      ? asset.path.startsWith(definition.assetPrefix)
      : asset.path === definition.assetPrefix,
  );
  const indexAbsolutePath = join(dataRoot, definition.indexPath);
  let metadata = null;
  try {
    metadata = JSON.parse(await readFile(indexAbsolutePath, "utf8"));
  } catch {
    // A missing/invalid index is represented as `missing` in every city.
  }

  const profile =
    definition.kind === "sharded"
      ? profileShardedSource(metadata, dataRoot)
      : profileGeoJsonSource(metadata, definition.indexPath, dataRoot);
  const coverageFootprint = buildCoverageFootprint(profile.coverageCells, definition.kind);
  const cityGate = {};
  for (const city of REGRESSION_CITIES) {
    const point =
      definition.kind === "sharded"
        ? shardedPointProbe(profile, city)
        : geoJsonPointProbe(metadata, city);
    cityGate[city.id] = {
      point,
      footprint: {
        containment: coverageFootprint
          ? pointInCoverageCells([city.lon, city.lat], profile.coverageCells)
            ? "inside"
            : "outside"
          : "unknown",
        method: coverageFootprint?.method ?? "unavailable",
      },
    };
  }

  const firstProperties = metadata?.features?.[0]?.properties ?? {};
  return {
    sourceId: definition.id,
    indexPath: definition.indexPath,
    sourceVersion:
      metadata?.sourceVersion ??
      firstProperties.sourceVersion ??
      firstProperties.source_year ??
      firstProperties.sourceYear ??
      null,
    featureCount:
      numericOrNull(metadata?.featureCount) ??
      (Array.isArray(metadata?.features) ? metadata.features.length : null),
    assets: matchingAssets.length,
    bytes: matchingAssets.reduce((sum, asset) => sum + asset.bytes, 0),
    inventory: profile.inventory,
    coverageFootprint,
    cityGate,
  };
}

function profileShardedSource(index, dataRoot) {
  if (index?.type !== "FeatureShardIndex" || !Array.isArray(index.shards)) {
    return {
      coverageCells: [],
      shards: [],
      inventory: {
        declaredFeatureCount: numericOrNull(index?.featureCount),
        validFeatureCount: 0,
        declaredShardCount: numericOrNull(index?.shardCount),
        indexedShardCount: 0,
        validShardCount: 0,
        referencedAssetCount: 0,
        presentReferencedAssetCount: 0,
        missingReferencedAssetCount: 0,
        missingReferencedAssets: [],
        invalidShardCount: 0,
        featureCountMethod: "sum-of-present-valid-shard-record-counts",
      },
    };
  }
  const validShards = [];
  let invalidShardCount = 0;
  for (const [position, shard] of index.shards.entries()) {
    const bbox = normalizeBbox(shard?.bbox);
    const count = nonNegativeIntegerOrNull(shard?.count);
    const relativePath = normalizeReferencedAsset(shard?.url);
    if (!bbox || count === null || !relativePath) {
      invalidShardCount += 1;
      continue;
    }
    validShards.push({
      key: String(shard.key ?? position),
      bbox,
      count,
      relativePath,
      present: fileExists(join(dataRoot, relativePath)),
    });
  }
  validShards.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath) || left.key.localeCompare(right.key),
  );
  const missingReferencedAssets = [
    ...new Set(validShards.filter((shard) => !shard.present).map((shard) => shard.relativePath)),
  ].sort();
  const presentShards = validShards.filter((shard) => shard.present);
  return {
    coverageCells: uniqueSortedBboxes(validShards.map((shard) => shard.bbox)),
    shards: validShards,
    inventory: {
      declaredFeatureCount: numericOrNull(index.featureCount),
      validFeatureCount: presentShards.reduce((sum, shard) => sum + shard.count, 0),
      declaredShardCount: numericOrNull(index.shardCount),
      indexedShardCount: index.shards.length,
      validShardCount: validShards.length,
      referencedAssetCount: new Set(validShards.map((shard) => shard.relativePath)).size,
      presentReferencedAssetCount: new Set(
        presentShards.map((shard) => shard.relativePath),
      ).size,
      missingReferencedAssetCount: missingReferencedAssets.length,
      missingReferencedAssets,
      invalidShardCount,
      featureCountMethod: "sum-of-present-valid-shard-record-counts",
    },
  };
}

function profileGeoJsonSource(collection, indexPath, dataRoot) {
  const sourcePresent = fileExists(join(dataRoot, indexPath));
  const features =
    collection?.type === "FeatureCollection" && Array.isArray(collection.features)
      ? collection.features
      : [];
  const coverageCells = [];
  let invalidFeatureCount = 0;
  for (const feature of features) {
    const bbox = geometryBbox(feature?.geometry);
    if (!bbox) invalidFeatureCount += 1;
    else coverageCells.push(bbox);
  }
  return {
    coverageCells: uniqueSortedBboxes(coverageCells),
    shards: [],
    inventory: {
      declaredFeatureCount: features.length,
      validFeatureCount: sourcePresent ? features.length - invalidFeatureCount : 0,
      declaredShardCount: null,
      indexedShardCount: null,
      validShardCount: null,
      referencedAssetCount: 1,
      presentReferencedAssetCount: sourcePresent ? 1 : 0,
      missingReferencedAssetCount: sourcePresent ? 0 : 1,
      missingReferencedAssets: sourcePresent ? [] : [indexPath],
      invalidFeatureCount,
      featureCountMethod: "valid-polygon-and-multipolygon-features",
    },
  };
}

function shardedPointProbe(profile, city) {
  if (!profile.shards.length) {
    return { status: "missing", method: "1-km-query-window", shards: 0, features: 0 };
  }
  const bbox = bboxAroundPoint(city.lat, city.lon, 1_000);
  const shards = profile.shards.filter((shard) => bboxesIntersect(shard.bbox, bbox));
  if (!shards.length) {
    return { status: "empty", method: "1-km-query-window", shards: 0, features: 0 };
  }
  const presentShards = shards.filter((shard) => shard.present);
  const features = presentShards.reduce((sum, shard) => sum + shard.count, 0);
  const missingAssets = shards.length - presentShards.length;
  const status =
    features > 0 ? "available" : missingAssets > 0 ? "missing" : "empty";
  return {
    status,
    method: "1-km-query-window",
    radiusMeters: 1_000,
    shards: shards.length,
    features,
    ...(missingAssets ? { missingAssets } : {}),
  };
}

function geoJsonPointProbe(collection, city) {
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    return { status: "missing", method: "exact-point-in-feature", features: 0 };
  }
  const point = [city.lon, city.lat];
  const features = collection.features.filter((feature) =>
    pointInGeometry(point, feature.geometry),
  ).length;
  return {
    status: features > 0 ? "available" : "empty",
    method: "exact-point-in-feature",
    features,
  };
}

function buildCoverageFootprint(cells, kind) {
  if (!cells.length) return null;
  const polygons = kind === "sharded" ? mergeCoverageCells(cells) : cells;
  return {
    bbox: combinedBbox(cells),
    geometry: {
      type: "MultiPolygon",
      coordinates: polygons.map((bbox) => [bboxRing(bbox)]),
    },
    method: kind === "sharded" ? "shard-index-bbox-cells" : "feature-bbox-envelopes",
    unitCount: cells.length,
    polygonCount: polygons.length,
    limitations:
      kind === "sharded"
        ? [
            "The footprint describes indexed shard cells, not continuous feature presence inside every cell.",
            "Adjacent grid cells are merged into rectangles for compact delivery; disconnected cells remain separate polygons.",
            "The declared footprint includes valid index cells even when a referenced shard asset is missing; inventory and point probes report that gap separately.",
          ]
        : [
            "The footprint uses per-feature bounding envelopes so holes and concave edges may be overstated.",
            "Exact city point status is tested against the source feature geometry, not this conservative envelope.",
          ],
  };
}

function mergeCoverageCells(cells) {
  let merged = cells.map((bbox) => [...bbox]);
  while (true) {
    const horizontal = mergeRectangles(merged, "horizontal");
    const vertical = mergeRectangles(horizontal, "vertical");
    if (vertical.length === merged.length) return vertical.sort(compareBboxes);
    merged = vertical;
  }
}

function mergeRectangles(rectangles, direction) {
  const groups = new Map();
  for (const rectangle of rectangles) {
    const key =
      direction === "horizontal"
        ? `${coordinateKey(rectangle[1])}:${coordinateKey(rectangle[3])}`
        : `${coordinateKey(rectangle[0])}:${coordinateKey(rectangle[2])}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([...rectangle]);
  }
  const result = [];
  for (const group of groups.values()) {
    group.sort(direction === "horizontal" ? compareWestEast : compareSouthNorth);
    let current = group[0];
    for (let index = 1; index < group.length; index += 1) {
      const next = group[index];
      const touches =
        direction === "horizontal"
          ? next[0] <= current[2] + 1e-9
          : next[1] <= current[3] + 1e-9;
      if (touches) {
        if (direction === "horizontal") current[2] = Math.max(current[2], next[2]);
        else current[3] = Math.max(current[3], next[3]);
      } else {
        result.push(current);
        current = next;
      }
    }
    result.push(current);
  }
  return result;
}

function compareWestEast(left, right) {
  return left[0] - right[0] || left[2] - right[2];
}

function compareSouthNorth(left, right) {
  return left[1] - right[1] || left[3] - right[3];
}

function coordinateKey(value) {
  return Number(value).toFixed(9);
}

function geometryBbox(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let coordinates = 0;
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      Number.isFinite(Number(value[0])) &&
      Number.isFinite(Number(value[1]))
    ) {
      const lon = Number(value[0]);
      const lat = Number(value[1]);
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return;
      bbox[0] = Math.min(bbox[0], lon);
      bbox[1] = Math.min(bbox[1], lat);
      bbox[2] = Math.max(bbox[2], lon);
      bbox[3] = Math.max(bbox[3], lat);
      coordinates += 1;
      return;
    }
    for (const child of value) visit(child);
  }
  visit(geometry.coordinates);
  return coordinates >= 4 ? normalizeBbox(bbox) : null;
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map(Number);
  if (
    !bbox.every(Number.isFinite) ||
    bbox[0] < -180 ||
    bbox[2] > 180 ||
    bbox[1] < -90 ||
    bbox[3] > 90 ||
    bbox[0] > bbox[2] ||
    bbox[1] > bbox[3]
  ) {
    return null;
  }
  return bbox;
}

function uniqueSortedBboxes(values) {
  const unique = new Map();
  for (const bbox of values) unique.set(bbox.join(","), bbox);
  return [...unique.values()].sort(compareBboxes);
}

function compareBboxes(left, right) {
  for (let index = 0; index < 4; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function combinedBbox(cells) {
  return cells.reduce(
    (bbox, cell) => [
      Math.min(bbox[0], cell[0]),
      Math.min(bbox[1], cell[1]),
      Math.max(bbox[2], cell[2]),
      Math.max(bbox[3], cell[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function bboxRing([west, south, east, north]) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

function pointInCoverageCells([lon, lat], cells) {
  return cells.some(
    ([west, south, east, north]) =>
      lon >= west && lon <= east && lat >= south && lat <= north,
  );
}

function normalizeReferencedAsset(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const relativePath = value
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/?data\//, "")
    .replace(/^\/+/, "");
  if (!relativePath || relativePath.split("/").includes("..")) return null;
  return relativePath;
}

function fileExists(path) {
  return existsSync(path);
}

function sourceIdForAsset(path) {
  return SOURCE_DEFINITIONS.find((definition) =>
    definition.assetPrefix.endsWith("/")
      ? path.startsWith(definition.assetPrefix)
      : path === definition.assetPrefix,
  )?.id ?? null;
}

function bboxAroundPoint(lat, lon, radiusMeters) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(
    1,
    Math.cos((lat * Math.PI) / 180) * metersPerDegreeLat,
  );
  const latDelta = radiusMeters / metersPerDegreeLat;
  const lonDelta = radiusMeters / metersPerDegreeLon;
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta];
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

function pointInRing([x, y], ring = []) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function numericOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function nonNegativeIntegerOrNull(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const [key, ...value] = argument.replace(/^--/, "").split("=");
      return [key, value.join("=") || true];
    }),
  );
  const manifest = await buildDataReleaseManifest({
    dataRoot: args["data-root"] || "public/data",
    output: args.output || "public/data/data-release-manifest.json",
  });
  console.log(
    JSON.stringify(
      {
        output: args.output || "public/data/data-release-manifest.json",
        releaseId: manifest.releaseId,
        assets: manifest.totals.assets,
        bytes: manifest.totals.bytes,
      },
      null,
      2,
    ),
  );
}
