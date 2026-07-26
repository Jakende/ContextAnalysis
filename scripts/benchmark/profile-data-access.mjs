#!/usr/bin/env node
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_ACCESS_PROFILE_SCHEMA = "uca-data-access-profile/1.0";

const DEFAULT_SOURCES = [
  {
    sourceId: "copernicus-urban-atlas",
    indexPath: "processed/copernicus-urban-atlas/index.json",
    role: "exact-polygon-analysis",
  },
  {
    sourceId: "overture-buildings",
    indexPath: "processed/overture-buildings/index.json",
    role: "exact-polygon-analysis",
    maxRuntimeRadiusMeters: 1_500,
  },
  {
    sourceId: "gtfs-de-local-transit",
    indexPath: "processed/gtfs-stops/index.json",
    role: "point-analysis",
  },
  {
    sourceId: "gtfs-de-local-transit-lines",
    indexSourceId: "gtfs-de-local-transit",
    indexPath: "processed/gtfs-lines/index.json",
    role: "line-analysis",
  },
];

export const DATA_ACCESS_THRESHOLDS = {
  maxRequestsPerObservation: 16,
  maxTransferBytesPerObservation: 25_000_000,
  maxSingleShardBytes: 8_000_000,
};

export async function buildDataAccessProfile({
  dataRoot = "public/data",
  manifestPath = "public/data/data-release-manifest.json",
  output,
  write = Boolean(output),
  sources = DEFAULT_SOURCES,
  radiiMeters = [1_000, 2_500],
} = {}) {
  const absoluteDataRoot = resolve(dataRoot);
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const manifestAssets = new Map(
    (manifest.assets ?? []).map((asset) => [asset.path, asset]),
  );
  const observations = [];

  for (const city of manifest.regressionCities ?? []) {
    for (const radiusMeters of radiiMeters) {
      for (const source of sources) {
        const effectiveRadiusMeters = Math.min(
          radiusMeters,
          source.maxRuntimeRadiusMeters ?? radiusMeters,
        );
        observations.push(
          await profileObservation({
            city,
            requestedRadiusMeters: radiusMeters,
            effectiveRadiusMeters,
            queryBbox: bboxAroundPoint(
              city.lat,
              city.lon,
              effectiveRadiusMeters,
            ),
            source,
            dataRoot: absoluteDataRoot,
            manifestAssets,
          }),
        );
      }
    }
  }

  const thresholdFailures = observations.filter(
    (observation) => observation.thresholdStatus === "fail",
  );
  const report = {
    schema: DATA_ACCESS_PROFILE_SCHEMA,
    releaseId: manifest.releaseId,
    releaseDigest: manifest.releaseDigest,
    measurement: {
      method:
        "Deterministic request and byte profile from the immutable shard indexes and manifest. It measures the browser payload implied by bbox selection; it does not estimate network latency.",
      contexts: radiiMeters.map((radiusMeters) => ({
        radiusMeters,
        diameterMeters: radiusMeters * 2,
      })),
      thresholds: DATA_ACCESS_THRESHOLDS,
    },
    summary: {
      status: thresholdFailures.length ? "optimize" : "pass",
      observations: observations.length,
      available: observations.filter((item) => item.status === "available")
        .length,
      empty: observations.filter((item) => item.status === "empty").length,
      thresholdFailures: thresholdFailures.length,
      maximumRequests: Math.max(
        0,
        ...observations.map((item) => item.selectedShards),
      ),
      maximumTransferBytes: Math.max(
        0,
        ...observations.map((item) => item.transferBytes),
      ),
      maximumSingleShardBytes: Math.max(
        0,
        ...observations.map((item) => item.maximumShardBytes),
      ),
    },
    decision: {
      currentFormat: "bbox-indexed-sharded-geojson",
      status: thresholdFailures.length ? "optimization-required" : "retain",
      rule:
        "Retain static sharded GeoJSON while every representative observation stays within the request, transfer, and shard-size thresholds. If exact polygon/line analysis remains above threshold after geometry clipping and shard compaction, move that analytical source to an indexed spatial API or another exact range-readable vector format; PMTiles remains a display path, not evidence for exact metrics.",
      failingSourceIds: [
        ...new Set(thresholdFailures.map((item) => item.sourceId)),
      ].sort(),
    },
    observations,
  };

  if (write && output) {
    const absoluteOutput = resolve(output);
    await mkdir(dirname(absoluteOutput), { recursive: true });
    await writeFile(
      absoluteOutput,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  }
  return report;
}

async function profileObservation({
  city,
  requestedRadiusMeters,
  effectiveRadiusMeters,
  queryBbox,
  source,
  dataRoot,
  manifestAssets,
}) {
  const index = JSON.parse(
    await readFile(join(dataRoot, source.indexPath), "utf8"),
  );
  if (index?.type !== "FeatureShardIndex" || !Array.isArray(index.shards)) {
    throw new Error(`${source.indexPath} is not a FeatureShardIndex.`);
  }
  const expectedIndexSourceId = source.indexSourceId ?? source.sourceId;
  if (index.sourceId !== expectedIndexSourceId) {
    throw new Error(
      `${source.indexPath} declares ${String(index.sourceId)}, expected ${expectedIndexSourceId}.`,
    );
  }
  const shards = index.shards.filter(
    (shard) =>
      validBbox(shard?.bbox) && bboxesIntersect(shard.bbox, queryBbox),
  );
  const payloads = [];
  for (const shard of shards) {
    const path = normalizeAssetPath(shard.url);
    const manifestAsset = manifestAssets.get(path);
    if (!manifestAsset) {
      throw new Error(
        `${source.sourceId} references ${path}, which is absent from the immutable manifest.`,
      );
    }
    const fileInfo = await stat(join(dataRoot, path));
    if (fileInfo.size !== manifestAsset.bytes) {
      throw new Error(`${path} byte size differs from the immutable manifest.`);
    }
    payloads.push({
      path,
      bytes: manifestAsset.bytes,
      declaredRecords: Number(shard.count) || 0,
    });
  }
  const transferBytes = payloads.reduce((sum, item) => sum + item.bytes, 0);
  const maximumShardBytes = Math.max(
    0,
    ...payloads.map((item) => item.bytes),
  );
  const selectedShards = payloads.length;
  const failedThresholds = [
    ...(selectedShards > DATA_ACCESS_THRESHOLDS.maxRequestsPerObservation
      ? ["requests"]
      : []),
    ...(transferBytes >
    DATA_ACCESS_THRESHOLDS.maxTransferBytesPerObservation
      ? ["transfer-bytes"]
      : []),
    ...(maximumShardBytes > DATA_ACCESS_THRESHOLDS.maxSingleShardBytes
      ? ["single-shard-bytes"]
      : []),
  ];
  return {
    cityId: city.id,
    sourceId: source.sourceId,
    sourceVersion: index.sourceVersion ?? null,
    role: source.role,
    requestedRadiusMeters,
    effectiveRadiusMeters,
    queryBbox,
    status: selectedShards ? "available" : "empty",
    selectedShards,
    declaredRecords: payloads.reduce(
      (sum, item) => sum + item.declaredRecords,
      0,
    ),
    transferBytes,
    maximumShardBytes,
    thresholdStatus: failedThresholds.length ? "fail" : "pass",
    failedThresholds,
    payloads,
  };
}

function bboxAroundPoint(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111_320;
  const lonDelta =
    radiusMeters /
    Math.max(1, Math.cos((lat * Math.PI) / 180) * 111_320);
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta];
}

function validBbox(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[0] <= value[2] &&
    value[1] <= value[3]
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

function normalizeAssetPath(value) {
  const path = String(value ?? "")
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/?data\//, "")
    .replace(/^\/+/, "");
  if (!path || path.split("/").includes("..")) {
    throw new Error(`Invalid shard asset path: ${String(value)}`);
  }
  return path;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const [key, ...values] = argument.replace(/^--/, "").split("=");
      return [key, values.join("=") || true];
    }),
  );
  const output =
    args.output === "false"
      ? undefined
      : args.output || "docs/data-quality/data-access-profile.json";
  const report = await buildDataAccessProfile({
    dataRoot: args["data-root"] || "public/data",
    manifestPath:
      args.manifest || "public/data/data-release-manifest.json",
    output,
    write: Boolean(output),
  });
  console.log(JSON.stringify(report.summary, null, 2));
  if (args.enforce === "true" && report.summary.status !== "pass") {
    process.exitCode = 1;
  }
}
