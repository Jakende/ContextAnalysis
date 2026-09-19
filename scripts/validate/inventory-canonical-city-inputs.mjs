#!/usr/bin/env node
import { existsSync } from "node:fs";
import { parseArgs, readJson } from "../preprocess/shared.mjs";
import { inspectPointCache } from "../preprocess/promote-point-cache.mjs";

const CACHE_MANIFEST = "public/data/processed/cache-manifest.json";
const TARGETS = [
  {
    cityId: "frankfurt",
    label: "Frankfurt centre",
    bbox: [8.668122, 50.101937, 8.696138, 50.119903],
  },
  {
    cityId: "rosenheim",
    label: "Rosenheim small-city",
    bbox: [12.108475, 47.847387, 12.136465, 47.865353],
  },
];
const SOURCE_IDS = ["copernicus-urban-atlas", "overture-buildings"];

const args = parseArgs();
if (!existsSync(CACHE_MANIFEST)) {
  throw new Error(`Missing ${CACHE_MANIFEST}`);
}
const manifest = await readJson(CACHE_MANIFEST);
if (manifest?.type !== "UcaCacheManifest" || !Array.isArray(manifest.entries)) {
  throw new Error(`${CACHE_MANIFEST} is not a valid UcaCacheManifest`);
}

const results = [];
for (const target of TARGETS) {
  for (const sourceId of SOURCE_IDS) {
    const declaredCandidates = manifest.entries
      .filter(
        (entry) =>
          entry.sourceId === sourceId &&
          Array.isArray(entry.bbox) &&
          bboxesIntersect(entry.bbox, target.bbox),
      )
      .sort((left, right) => left.indexUrl.localeCompare(right.indexUrl));
    const usableCandidates = [];
    for (const candidate of declaredCandidates) {
      const cacheIndexPath = publicUrlToPath(candidate.indexUrl);
      if (!existsSync(cacheIndexPath)) continue;
      try {
        const inspection = await inspectPointCache({
          cacheIndexPath,
          expectedSourceId: sourceId,
          requiredBbox: target.bbox,
        });
        if (inspection.intersectingFeatureCount > 0) {
          usableCandidates.push({
            cacheIndexPath,
            sourceVersions: inspection.sourceVersions,
            uniqueFeatures: inspection.features.length,
            intersectingFeatures: inspection.intersectingFeatureCount,
          });
        }
      } catch {
        // Invalid candidates are not promoted; the inventory reports no usable input.
      }
    }
    results.push({
      cityId: target.cityId,
      cityLabel: target.label,
      sourceId,
      requiredBbox: target.bbox,
      status: usableCandidates.length ? "ready" : "blocked",
      declaredCandidates: declaredCandidates.length,
      usableCandidates,
      blocker: usableCandidates.length
        ? null
        : `No provenance-bearing local point cache intersects the fixed ${target.label} regression bbox.`,
    });
  }
}

const output = {
  schema: "uca-canonical-city-input-inventory/1",
  cacheManifest: CACHE_MANIFEST,
  summary: {
    ready: results.filter((result) => result.status === "ready").length,
    blocked: results.filter((result) => result.status === "blocked").length,
  },
  results,
};
console.log(JSON.stringify(output, null, 2));

if (args["require-all"] === "true" && output.summary.blocked > 0) {
  process.exitCode = 1;
}

function bboxesIntersect(left, right) {
  return (
    left[0] <= right[2] &&
    left[2] >= right[0] &&
    left[1] <= right[3] &&
    left[3] >= right[1]
  );
}

function publicUrlToPath(url) {
  return String(url).startsWith("/") ? `public${url}` : String(url);
}
