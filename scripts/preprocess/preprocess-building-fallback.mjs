#!/usr/bin/env node
import {
  assertFeatureCollection,
  explodePolygonalFeatures,
  firstNumber,
  firstString,
  parseArgs,
  readJson,
  requireArg,
  writeJson,
} from "./shared.mjs";

const PROVIDERS = {
  overture: {
    sourceId: "overture-buildings",
    out: "public/data/processed/overture-buildings.geojson",
  },
  "global-building-atlas": {
    sourceId: "global-building-atlas",
    out: "public/data/processed/global-building-atlas.geojson",
  },
  lod2: {
    sourceId: "lod2-bayern",
    out: "public/data/processed/lod2-buildings.geojson",
  },
};

const args = parseArgs();
const providerKey = args.provider ?? "overture";
const provider = PROVIDERS[providerKey];
if (!provider) {
  throw new Error(`Unsupported --provider ${providerKey}. Use ${Object.keys(PROVIDERS).join(", ")}`);
}

const input = requireArg(
  args,
  "input",
  "Missing --input. Provide a locally prepared GeoJSON FeatureCollection; do not live-query global building services.",
);
const out = args.out ?? provider.out;
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const allowEstimatedLevels = args["levels-height-m"] ? Number(args["levels-height-m"]) : null;
const licenseMode = args["license-mode"] ?? "preserve";

if (providerKey === "global-building-atlas" && licenseMode === "preserve") {
  throw new Error(
    "GlobalBuildingAtlas has mixed license classes. Pass --license-mode odbl-only or --license-mode reviewed to make the decision explicit.",
  );
}

const collection = assertFeatureCollection(await readJson(input), input);
const normalized = explodePolygonalFeatures(collection, (properties) => {
  const measuredHeight = firstNumber(properties, [
    "height",
    "building:height",
    "measuredHeight",
    "measured_height",
    "Hoehe",
    "hoehe",
    "H_DACH",
    "h_dach",
    "DACH_H",
    "dach_h",
    "roof_height",
  ]);
  const levels = firstNumber(properties, ["building:levels", "levels", "num_floors"]);
  const estimatedHeight =
    measuredHeight === undefined && allowEstimatedLevels && levels
      ? levels * allowEstimatedLevels
      : undefined;
  const height = measuredHeight ?? estimatedHeight;
  const label = firstString(properties, ["name", "id", "building_id"]) ?? "building";

  return {
    ...properties,
    sourceId: provider.sourceId,
    sourceVersion,
    label,
    ...(height !== undefined
      ? {
          height,
          heightSource: measuredHeight !== undefined ? "measured-or-source" : "estimated-levels",
          heightEstimated: measuredHeight === undefined,
        }
      : {}),
    licenseMode,
    processedAt: new Date().toISOString(),
  };
});

await writeJson(out, normalized);
console.log(`Wrote ${normalized.features.length} ${provider.sourceId} polygon features to ${out}`);
