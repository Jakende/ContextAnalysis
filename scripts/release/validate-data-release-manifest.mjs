#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CANONICAL_SOURCE_IDS,
  MANIFEST_SCHEMA,
  REGRESSION_CITIES,
  digestAssets,
  digestRelease,
  sha256File,
} from "./build-data-release-manifest.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key, value.join("=") || true];
  }),
);
const manifestPath = resolve(args.manifest || "public/data/data-release-manifest.json");
const dataRoot = resolve(args["data-root"] || "public/data");
const verifyHashes = args["verify-hashes"] !== "false";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];

if (manifest.schema !== MANIFEST_SCHEMA) errors.push(`Unexpected schema: ${manifest.schema}`);
if (!Array.isArray(manifest.assets) || !manifest.assets.length) errors.push("Manifest has no assets.");
if (!Array.isArray(manifest.sources) || !manifest.sources.length) errors.push("Manifest has no sources.");
const paths = (manifest.assets ?? []).map((asset) => asset.path);
if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) errors.push("Assets are not sorted.");
if (new Set(paths).size !== paths.length) errors.push("Asset paths are not unique.");

for (const path of paths) {
  if (path.startsWith("processed/cache/") || path === "processed/cache-manifest.json") {
    errors.push(`Generated point cache leaked into release: ${path}`);
  }
}

const sourceIds = (manifest.sources ?? []).map((source) => source.sourceId);
for (const sourceId of CANONICAL_SOURCE_IDS) {
  if (!sourceIds.includes(sourceId)) errors.push(`Canonical source is missing: ${sourceId}`);
}
if (new Set(sourceIds).size !== sourceIds.length) errors.push("Source IDs are not unique.");

for (const source of manifest.sources ?? []) {
  validateSourceFootprint(source, errors);
  validateInventory(source, errors);
  for (const city of REGRESSION_CITIES) {
    const gate = source.cityGate?.[city.id];
    const status = gate?.point?.status;
    if (!["available", "empty", "missing"].includes(status)) {
      errors.push(`${source.sourceId}/${city.id} has invalid point status: ${status}`);
    }
    const containment = gate?.footprint?.containment;
    if (!["inside", "outside", "unknown"].includes(containment)) {
      errors.push(
        `${source.sourceId}/${city.id} has invalid footprint containment: ${containment}`,
      );
    }
    if (source.coverageFootprint && containment === "unknown") {
      errors.push(`${source.sourceId}/${city.id} has a footprint but unknown containment.`);
    }
  }
}

for (const asset of manifest.assets ?? []) {
  const path = join(dataRoot, asset.path);
  try {
    const info = await stat(path);
    if (info.size !== asset.bytes) errors.push(`${asset.path} byte size changed.`);
    if (verifyHashes && (await sha256File(path)) !== asset.sha256) {
      errors.push(`${asset.path} SHA-256 changed.`);
    }
  } catch {
    errors.push(`${asset.path} is missing.`);
  }
}

const assetDigest = digestAssets(manifest.assets ?? []);
if (manifest.assetDigest !== assetDigest) errors.push("Asset digest does not match asset table.");
const releaseDigest = digestRelease(manifest.assets ?? [], manifest.sources ?? []);
if (manifest.releaseDigest !== releaseDigest) {
  errors.push("Release digest does not match the asset and source coverage contract.");
}
if (manifest.releaseId !== `uca-data-${releaseDigest.slice(0, 16)}`) {
  errors.push("Release ID does not match release digest.");
}

function validateSourceFootprint(source, errors) {
  const footprint = source.coverageFootprint;
  if (!footprint) {
    errors.push(`${source.sourceId} has no coverage footprint.`);
    return;
  }
  if (!isValidBbox(footprint.bbox)) {
    errors.push(`${source.sourceId} has an invalid coverage bbox.`);
  }
  if (typeof footprint.method !== "string" || !footprint.method) {
    errors.push(`${source.sourceId} has no footprint method.`);
  }
  if (!Array.isArray(footprint.limitations) || !footprint.limitations.length) {
    errors.push(`${source.sourceId} has no footprint limitations.`);
  }
  const geometry = footprint.geometry;
  if (geometry?.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates)) {
    errors.push(`${source.sourceId} has no polygonal coverage geometry.`);
    return;
  }
  if (!Number.isInteger(footprint.unitCount) || footprint.unitCount <= 0) {
    errors.push(`${source.sourceId} has an invalid footprint unit count.`);
  }
  if (!Number.isInteger(footprint.polygonCount) || footprint.polygonCount <= 0) {
    errors.push(`${source.sourceId} has an invalid footprint polygon count.`);
  }
  if (geometry.coordinates.length !== footprint.polygonCount) {
    errors.push(`${source.sourceId} footprint polygon count does not match its geometry.`);
  }
  if (footprint.polygonCount > footprint.unitCount) {
    errors.push(`${source.sourceId} footprint has more polygons than source units.`);
  }
  for (const [position, polygon] of geometry.coordinates.entries()) {
    const ring = polygon?.[0];
    if (!Array.isArray(ring) || ring.length !== 5) {
      errors.push(`${source.sourceId} footprint polygon ${position} is not a bbox ring.`);
      continue;
    }
    for (const coordinate of ring) {
      if (!isValidCoordinate(coordinate)) {
        errors.push(`${source.sourceId} footprint polygon ${position} has invalid coordinates.`);
        break;
      }
    }
    if (JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1])) {
      errors.push(`${source.sourceId} footprint polygon ${position} is not closed.`);
    }
  }
}

function validateInventory(source, errors) {
  const inventory = source.inventory;
  if (!inventory) {
    errors.push(`${source.sourceId} has no inventory reconciliation.`);
    return;
  }
  for (const key of [
    "validFeatureCount",
    "referencedAssetCount",
    "presentReferencedAssetCount",
    "missingReferencedAssetCount",
  ]) {
    if (!Number.isInteger(inventory[key]) || inventory[key] < 0) {
      errors.push(`${source.sourceId} has invalid inventory.${key}.`);
    }
  }
  if (typeof inventory.featureCountMethod !== "string" || !inventory.featureCountMethod) {
    errors.push(`${source.sourceId} has no feature count method.`);
  }
  const missing = inventory.missingReferencedAssets;
  if (!Array.isArray(missing)) {
    errors.push(`${source.sourceId} has no missing asset list.`);
    return;
  }
  if (missing.length !== inventory.missingReferencedAssetCount) {
    errors.push(`${source.sourceId} missing asset count does not match its list.`);
  }
  if (new Set(missing).size !== missing.length) {
    errors.push(`${source.sourceId} missing asset list is not unique.`);
  }
  if (JSON.stringify(missing) !== JSON.stringify([...missing].sort())) {
    errors.push(`${source.sourceId} missing asset list is not sorted.`);
  }
  if (
    inventory.presentReferencedAssetCount + inventory.missingReferencedAssetCount !==
    inventory.referencedAssetCount
  ) {
    errors.push(`${source.sourceId} referenced asset reconciliation does not balance.`);
  }
}

function isValidBbox(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[0] >= -180 &&
    value[2] <= 180 &&
    value[1] >= -90 &&
    value[3] <= 90 &&
    value[0] <= value[2] &&
    value[1] <= value[3]
  );
}

function isValidCoordinate(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        valid: true,
        releaseId: manifest.releaseId,
        assets: manifest.assets.length,
        verifyHashes,
      },
      null,
      2,
    ),
  );
}
