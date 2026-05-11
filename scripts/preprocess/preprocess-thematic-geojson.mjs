#!/usr/bin/env node
import {
  assertFeatureCollection,
  explodePolygonalFeatures,
  firstString,
  parseArgs,
  readJson,
  requireArg,
  writeJson,
} from "./shared.mjs";

const PROVIDERS = {
  "urban-atlas": {
    sourceId: "copernicus-urban-atlas",
    out: "public/data/processed/copernicus-urban-atlas.geojson",
    labelKeys: ["class_label", "label", "code_2018", "class", "name"],
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

const args = parseArgs();
const providerKey = requireArg(args, "provider", "Missing --provider urban-atlas|ghsl|dwd");
const provider = PROVIDERS[providerKey];
if (!provider) {
  throw new Error(`Unsupported --provider ${providerKey}. Use ${Object.keys(PROVIDERS).join(", ")}`);
}

const input = requireArg(args, "input", "Missing --input <GeoJSON FeatureCollection>");
const out = args.out ?? provider.out;
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const collection = assertFeatureCollection(await readJson(input), input);

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

await writeJson(out, normalized);
console.log(`Wrote ${normalized.features.length} ${provider.sourceId} features to ${out}`);

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

function pickUsefulProperties(properties) {
  const output = {};
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    output[key] = value;
  }
  return output;
}
