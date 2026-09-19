#!/usr/bin/env node
import {
  assertFeatureCollection,
  explodePolygonalFeatures,
  fetchJson,
  firstString,
  parseArgs,
  writeJson,
} from "./shared.mjs";

const DEFAULT_FUA_URL =
  "https://gisco-services.ec.europa.eu/distribution/v2/urau/geojson/URAU_RG_100K_2024_4326_FUA.geojson";
const DEFAULT_OUT = "public/data/processed/eurostat-gisco-fua.geojson";

const args = parseArgs();
const url = args.url ?? args["fua-url"] ?? DEFAULT_FUA_URL;
const country = args.country ?? process.env.UCA_COUNTRY ?? "DE";
const out = args.out ?? DEFAULT_OUT;
const sourceYear = args["source-year"] ?? "2024";
const sourceVersion = args["source-version"] ?? "GISCO Urban Audit 2024";

console.log(`Fetching GISCO FUA geometries from ${url}`);
const json = assertFeatureCollection(await fetchJson(url), "GISCO FUA");
const filtered =
  country === "all"
    ? json
    : {
        type: "FeatureCollection",
        features: json.features.filter((feature) => matchesCountry(feature.properties, country)),
      };

const normalized = explodePolygonalFeatures(filtered, (properties) => {
  const fuaId =
    firstString(properties, ["fua_id", "FUA_ID", "URAU_CODE", "urau_code", "code"]) ??
    firstString(properties, ["id"]);
  const fuaName =
    firstString(properties, ["fua_name", "FUA_NAME", "URAU_NAME", "urau_name", "name", "NAME"]) ??
    "Functional Urban Area";
  const countryCode =
    firstString(properties, ["country", "CNTR_CODE", "cntr_code", "CNTR_ID"]) ?? country;
  return {
    URAU_CODE: properties.URAU_CODE ?? properties.urau_code,
    URAU_NAME: properties.URAU_NAME ?? properties.urau_name,
    CNTR_CODE: properties.CNTR_CODE ?? properties.cntr_code,
    sourceId: "eurostat-gisco-fua",
    sourceVersion,
    source_year: sourceYear,
    fua_id: fuaId,
    fua_name: fuaName,
    country: countryCode,
    label: fuaName,
    processedAt: new Date().toISOString(),
  };
});

await writeJson(out, normalized);
console.log(`Wrote ${normalized.features.length} FUA polygon features to ${out}`);

function matchesCountry(properties, countryCode) {
  const value = firstString(properties, ["country", "CNTR_CODE", "cntr_code", "CNTR_ID"]);
  if (!value) return false;
  return value.toUpperCase() === String(countryCode).toUpperCase();
}
