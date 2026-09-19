#!/usr/bin/env node
import {
  assertFeatureCollection,
  explodePolygonalFeatures,
  fetchJson,
  firstString,
  parseArgs,
  parseBbox,
  writeJson,
} from "./shared.mjs";

const DEFAULT_WFS_URL = "https://sgx.geodatenzentrum.de/wfs_vg250";
const DEFAULT_TYPE_NAMES = "vg250:vg250_krs,vg250:vg250_lan";
const DEFAULT_OUT = "public/data/processed/bkg-boundaries.geojson";

const args = parseArgs();
const wfsUrl = args["wfs-url"] ?? DEFAULT_WFS_URL;
const typeNames = String(args["type-names"] ?? DEFAULT_TYPE_NAMES)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const bbox = parseBbox(args.bbox ?? process.env.UCA_AOI_BBOX);
const out = args.out ?? DEFAULT_OUT;
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const decimals = Number(args.precision ?? "4");

if (!typeNames.length) {
  throw new Error("No BKG WFS type names configured");
}

const downloaded = [];
for (const typeName of typeNames) {
  const url = buildWfsUrl(wfsUrl, typeName, bbox);
  console.log(`Fetching ${typeName}`);
  const json = assertFeatureCollection(await fetchJson(url), typeName);
  downloaded.push(...json.features.map((feature) => ({ ...feature, _ucaTypeName: typeName })));
}

const normalized = explodePolygonalFeatures(
  { type: "FeatureCollection", features: downloaded },
  (properties, feature) => {
    const typeName = feature._ucaTypeName ?? properties.typeName;
    const label =
      firstString(properties, ["name", "GEN", "gen", "gemeinde", "BEZ"]) ??
      "BKG boundary";
    return {
      AGS: properties.AGS ?? properties.ags,
      ARS: properties.ARS ?? properties.ars,
      GEN: properties.GEN ?? properties.gen,
      BEZ: properties.BEZ ?? properties.bez,
      NUTS: properties.NUTS ?? properties.nuts,
      sourceId: "bkg-geobasis",
      sourceVersion,
      typeName,
      label,
      name: label,
      boundaryLevel: boundaryLevelFromTypeName(typeName),
      processedAt: new Date().toISOString(),
    };
  },
  { decimals },
);

await writeJson(out, normalized);
console.log(`Wrote ${normalized.features.length} BKG polygon features to ${out}`);

function buildWfsUrl(baseUrl, typeName, bboxValue) {
  const url = new URL(baseUrl);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", typeName);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "EPSG:4326");
  if (bboxValue) {
    url.searchParams.set(
      "bbox",
      `${bboxValue.west},${bboxValue.south},${bboxValue.east},${bboxValue.north},EPSG:4326`,
    );
  }
  return url.toString();
}

function boundaryLevelFromTypeName(typeName) {
  if (typeName.includes("gem")) return "municipality";
  if (typeName.includes("krs")) return "district";
  if (typeName.includes("lan")) return "state";
  return "boundary";
}
