import type { FeatureCollection } from "geojson";
import type { Indicator } from "../types";
/** Boundary only. No external preprocessing adapter is enabled in this MVP. */
export type PreprocessedContextArtifact = {
  schema: "verplant-preprocessed/1.0.0";
  adapterId: string;
  pinnedRevision: string;
  sourceId: string;
  sourceVersion: string;
  attribution: string;
  license: string;
  crs: "EPSG:4326";
  coverage: FeatureCollection;
  features: FeatureCollection;
  indicators: Indicator[];
  computedAt: string;
  method: string;
  caveats: string[];
  geometryValidation: { tool: string; version: string; passed: boolean };
};
export type FutureHandoff = {
  caseId: string;
  runId: string;
  action: "learn" | "participate" | "collaborate";
  /** learn may only use IDs from a future curated internal content registry. */
  internalContentIds: string[];
  needs: string[];
  explicitlyRequestedAt: string;
};
