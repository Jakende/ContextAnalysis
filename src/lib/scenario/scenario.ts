import type { Geometry } from "geojson";
import {
  SCENARIO_SCHEMA_VERSION,
  type ScenarioComparison,
  type ScenarioCoordinate,
  type ScenarioExportSummary,
  type ScenarioFeature,
  type ScenarioFeatureType,
  type ScenarioGeometryKind,
  type ScenarioLayer,
} from "./types";

const FEATURE_DEFINITIONS: Record<
  ScenarioFeatureType,
  { label: string; geometryKind: ScenarioGeometryKind }
> = {
  transit_stop: { label: "Transit stop", geometryKind: "point" },
  bike_share_station: { label: "Bike-share station", geometryKind: "point" },
  new_street: { label: "New street", geometryKind: "line" },
  green_edge: { label: "Green edge", geometryKind: "line" },
  public_space: { label: "Public space", geometryKind: "polygon" },
};

const SCENARIO_CAVEAT =
  "Scenario geometry is user-created proposal data and is never merged into authoritative source or analysis overlays.";
const KPI_CAVEAT =
  "No KPI impact is inferred. The comparison reports only deterministic proposal feature counts against a zero-intervention baseline.";

export function scenarioFeatureDefinition(type: ScenarioFeatureType) {
  return FEATURE_DEFINITIONS[type];
}

export function createEmptyScenarioLayer(
  options: { id?: string; name?: string; createdAt?: string } = {},
): ScenarioLayer {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const id = options.id ?? createId("scenario");
  const scenario: ScenarioLayer = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id,
    name: options.name ?? "Design proposal",
    createdAt,
    updatedAt: createdAt,
    provenance: {
      authorship: "user",
      creationMethod: "map-drawing",
      separationPolicy: SCENARIO_CAVEAT,
      caveats: [SCENARIO_CAVEAT, KPI_CAVEAT],
    },
    features: { type: "FeatureCollection", features: [] },
    comparison: emptyComparison(),
  };
  return scenario;
}

export function createScenarioFeature(
  type: ScenarioFeatureType,
  coordinates: ScenarioCoordinate[],
  options: { id?: string; createdAt?: string } = {},
): ScenarioFeature {
  const definition = FEATURE_DEFINITIONS[type];
  const geometry = createGeometry(definition.geometryKind, coordinates);
  const createdAt = options.createdAt ?? new Date().toISOString();
  return {
    type: "Feature",
    geometry,
    properties: {
      id: options.id ?? createId(type),
      featureType: type,
      label: definition.label,
      status: "proposed",
      authorship: "user",
      createdAt,
      creationMethod: "map-drawing",
      kpiImpactStatus: "not-modeled",
    },
  };
}

export function addScenarioFeature(
  scenario: ScenarioLayer,
  feature: ScenarioFeature,
  updatedAt = new Date().toISOString(),
): ScenarioLayer {
  const features = [...scenario.features.features, feature];
  return {
    ...scenario,
    updatedAt,
    features: { type: "FeatureCollection", features },
    comparison: buildComparison(features),
  };
}

export function removeScenarioFeature(
  scenario: ScenarioLayer,
  featureId: string,
  updatedAt = new Date().toISOString(),
): ScenarioLayer {
  const features = scenario.features.features.filter(
    (feature) => feature.properties.id !== featureId,
  );
  return {
    ...scenario,
    updatedAt,
    features: { type: "FeatureCollection", features },
    comparison: buildComparison(features),
  };
}

export function scenarioToGeoJson(scenario: ScenarioLayer): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: "urban_context_user_scenario",
      scenario: {
        schemaVersion: scenario.schemaVersion,
        id: scenario.id,
        name: scenario.name,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
        provenance: scenario.provenance,
        comparison: scenario.comparison,
      },
      features: scenario.features.features,
    },
    null,
    2,
  );
}

export function createScenarioExportSummary(
  scenario: ScenarioLayer,
): ScenarioExportSummary {
  return {
    schemaVersion: scenario.schemaVersion,
    id: scenario.id,
    name: scenario.name,
    featureCount: scenario.features.features.length,
    authorship: "user",
    creationMethod: "map-drawing",
    kpiImpactStatus: "not-modeled",
    caveats: scenario.provenance.caveats,
  };
}

function createGeometry(
  kind: ScenarioGeometryKind,
  coordinates: ScenarioCoordinate[],
): Geometry {
  if (kind === "point") {
    if (coordinates.length !== 1) {
      throw new Error("Point proposals require exactly one map coordinate.");
    }
    return { type: "Point", coordinates: validateCoordinate(coordinates[0]) };
  }
  if (kind === "line") {
    if (coordinates.length < 2) {
      throw new Error("Line proposals require at least two map coordinates.");
    }
    return { type: "LineString", coordinates: coordinates.map(validateCoordinate) };
  }
  if (coordinates.length < 3) {
    throw new Error("Public-space proposals require at least three map coordinates.");
  }
  const ring = coordinates.map(validateCoordinate);
  const first = ring[0];
  const last = ring.at(-1);
  if (!last || first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return { type: "Polygon", coordinates: [ring] };
}

function validateCoordinate(coordinate: ScenarioCoordinate): ScenarioCoordinate {
  const [lon, lat] = coordinate;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error("Scenario coordinates must be finite WGS84 longitude/latitude values.");
  }
  return [lon, lat];
}

function emptyComparison(): ScenarioComparison {
  return {
    basis: "zero-intervention-baseline",
    metrics: [],
    kpiImpact: null,
    caveats: [KPI_CAVEAT],
  };
}

function buildComparison(features: ScenarioFeature[]): ScenarioComparison {
  const metrics = Object.entries(FEATURE_DEFINITIONS).flatMap(([type, definition]) => {
    const proposed = features.filter(
      (feature) => feature.properties.featureType === type,
    ).length;
    return proposed
      ? [{
          id: `scenario.${type}.count`,
          label: `Proposed ${definition.label.toLowerCase()} count`,
          unit: "features" as const,
          current: 0,
          proposed,
          delta: proposed,
          method: "Counts user-created proposal features against a zero-intervention baseline.",
        }]
      : [];
  });
  return {
    basis: "zero-intervention-baseline",
    metrics,
    kpiImpact: null,
    caveats: [KPI_CAVEAT],
  };
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

