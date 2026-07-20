import type { Feature, FeatureCollection, Geometry } from "geojson";

export const SCENARIO_SCHEMA_VERSION = "0.1.0" as const;

export type ScenarioFeatureType =
  | "transit_stop"
  | "bike_share_station"
  | "new_street"
  | "green_edge"
  | "public_space";

export type ScenarioGeometryKind = "point" | "line" | "polygon";

export type ScenarioCoordinate = [number, number];

export type ScenarioFeatureProperties = {
  id: string;
  featureType: ScenarioFeatureType;
  label: string;
  status: "proposed";
  authorship: "user";
  createdAt: string;
  creationMethod: "map-drawing";
  kpiImpactStatus: "not-modeled";
};

export type ScenarioFeature = Feature<Geometry, ScenarioFeatureProperties>;

export type ScenarioComparisonMetric = {
  id: string;
  label: string;
  unit: "features";
  current: number;
  proposed: number;
  delta: number;
  method: string;
};

export type ScenarioComparison = {
  basis: "zero-intervention-baseline";
  metrics: ScenarioComparisonMetric[];
  kpiImpact: null;
  caveats: string[];
};

export type ScenarioLayer = {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  provenance: {
    authorship: "user";
    creationMethod: "map-drawing";
    separationPolicy: string;
    caveats: string[];
  };
  features: FeatureCollection<Geometry, ScenarioFeatureProperties>;
  comparison: ScenarioComparison;
};

export type ScenarioExportSummary = {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  id: string;
  name: string;
  featureCount: number;
  authorship: "user";
  creationMethod: "map-drawing";
  kpiImpactStatus: "not-modeled";
  caveats: string[];
};

