import type { FeatureCollection } from "geojson";
import type { FactSheetModule, Indicator } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

export function createFuaContextModule(
  fuaGeometries: FeatureCollection,
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const containing = fuaGeometries.features.filter(
    (feature) => feature.properties?.matchType === "contains-point",
  );
  const primary = containing[0] ?? fuaGeometries.features[0];
  const fuaName = primary ? readFuaName(primary.properties) : null;
  const fuaId = primary ? readFuaId(primary.properties) : null;
  const matchType = primary?.properties?.matchType;
  const memberValue =
    matchType === "contains-point"
      ? fuaName
      : fuaGeometries.features.length
        ? "nearby FUA only"
        : null;
  const caveat =
    matchType === "contains-point"
      ? "Selected point falls inside a preprocessed Eurostat GISCO Functional Urban Area geometry."
      : fuaGeometries.features.length
        ? "No containing FUA was found; nearby FUA geometries are shown only as regional context."
        : "No local preprocessed FUA geometry was available for this selected point.";

  const indicators = [
    createIndicator({
      id: "xl.fua-membership",
      label: "European FUA context",
      scale: "XL",
      value: memberValue,
      geometry: primary?.geometry,
      method:
        "Point-in-polygon lookup against the preprocessed Eurostat GISCO Functional Urban Area layer.",
      sourceIds: ["eurostat-gisco-fua"],
      sourceVersion: readSourceVersion(primary?.properties),
      confidence: matchType === "contains-point" ? "high" : "low",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "xl.fua-id",
      label: "FUA identifier",
      scale: "XL",
      value: fuaId,
      geometry: primary?.geometry,
      method:
        "Read FUA identifier from the matched preprocessed Eurostat GISCO feature where present.",
      sourceIds: ["eurostat-gisco-fua"],
      sourceVersion: readSourceVersion(primary?.properties),
      confidence: fuaId ? "high" : "low",
      caveats: [fuaId ? caveat : "Matched FUA feature does not expose a recognized FUA identifier field."],
      computedAt,
    }),
  ];

  return {
    indicators,
    modules: [
      {
        id: "xl.european-fua-context",
        title: "European FUA context",
        scale: "XL",
        indicators,
        method:
          "Selected point is tested against preprocessed GISCO FUA polygons; legacy 'European foam' wording maps to this FUA context.",
        sourceIds: ["eurostat-gisco-fua"],
        computedAt,
        confidence: matchType === "contains-point" ? "high" : "low",
        caveats: [caveat],
      },
    ],
  };
}

function readFuaName(properties: FeatureCollection["features"][number]["properties"]): string | null {
  return firstString(properties, [
    "fua_name",
    "FUA_NAME",
    "URAU_NAME",
    "name",
    "label",
  ]);
}

function readFuaId(properties: FeatureCollection["features"][number]["properties"]): string | null {
  return firstString(properties, [
    "fua_id",
    "FUA_ID",
    "URAU_CODE",
    "code",
    "id",
  ]);
}

function readSourceVersion(
  properties: FeatureCollection["features"][number]["properties"] | undefined,
): string | undefined {
  return firstString(properties, ["sourceVersion", "source_version", "year"]) ?? undefined;
}

function firstString(
  properties: FeatureCollection["features"][number]["properties"] | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
