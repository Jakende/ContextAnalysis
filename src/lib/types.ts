import type { Feature, FeatureCollection, Geometry, Point } from "geojson";

export type Scale = "XL" | "L" | "M";

export type Confidence = "high" | "medium" | "low";

export type DataSource = {
  id: string;
  label: string;
  type:
    | "live-api"
    | "tile-service"
    | "local-file"
    | "local-tile"
    | "external-download";
  url?: string;
  localPath?: string;
  license?: string;
  attribution: string;
  scale: Scale[];
  updateMode: "live" | "preprocessed" | "manual";
  notes?: string;
};

export type Indicator = {
  id: string;
  label: string;
  scale: Scale;
  value: number | string | boolean | null;
  unit?: string;
  geometry?: Geometry;
  method: string;
  sourceIds: string[];
  sourceVersion?: string;
  computedAt: string;
  confidence: Confidence;
  caveats: string[];
};

export type FactSheetModule = {
  id: string;
  title: string;
  scale: Scale;
  indicators: Indicator[];
  method: string;
  sourceIds: string[];
  computedAt: string;
  confidence: Confidence;
  caveats: string[];
};

export type SelectedPoint = {
  lat: number;
  lon: number;
  label?: string;
  address?: string;
  municipality?: string;
  district?: string;
  point: Point;
};

export type SectionLine = {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
};

export type LayerId = "3D" | "trees" | "sun" | "section" | "green";

export type LayerState = Record<LayerId, boolean>;

export type OverpassEndpointStatus = {
  endpoint: string;
  ok: boolean;
  elapsedMs: number;
  error?: string;
};

export type OverpassProvenance = {
  id: string;
  query: string;
  cacheKey: string;
  endpoint?: string;
  status: "cached" | "ok" | "failed" | "skipped";
  elapsedMs?: number;
  featureCount?: number;
  endpointStatus: OverpassEndpointStatus[];
  caveats: string[];
};

export type SourceFetchStatus =
  | "ok"
  | "cached"
  | "failed"
  | "missing"
  | "skipped";

export type SourceFetchReceipt = {
  sourceId: string;
  label: string;
  type: DataSource["type"];
  status: SourceFetchStatus;
  queriedAt: string;
  elapsedMs: number;
  url?: string;
  localPath?: string;
  recordCount?: number;
  featureCount?: number;
  sourceVersion?: string;
  method: string;
  caveats: string[];
  error?: string;
};

export type AnalysisProvenance = {
  createdAt: string;
  sourceIds: string[];
  sourceFetches: SourceFetchReceipt[];
  overpassQueries: OverpassProvenance[];
  geocoding: {
    enabled: boolean;
    sourceId: string;
    status: "ok" | "failed" | "skipped";
    cacheKey?: string;
    error?: string;
  };
  caveats: string[];
};

export type MapOverlayCollection = {
  selectedPoint: Feature<Point, { label: string }>;
  xlContext: FeatureCollection;
  xlGrid: FeatureCollection;
  xlSources: FeatureCollection;
  lBuffer: FeatureCollection;
  mStreetSegment: FeatureCollection;
  green: FeatureCollection;
  trees: FeatureCollection;
  buildings: FeatureCollection;
  pois: FeatureCollection;
  transport: FeatureCollection;
  mobility: FeatureCollection;
  barriers: FeatureCollection;
  development: FeatureCollection;
  sun: FeatureCollection;
  sectionLine: FeatureCollection;
};

export type AnalysisResult = {
  app: "Urban Context Analysis";
  analysisVersion: string;
  selectedPoint: SelectedPoint;
  activeScale: Scale;
  modules: FactSheetModule[];
  indicators: Indicator[];
  overlays: MapOverlayCollection;
  mapState: {
    center: [number, number];
    zoom: number;
    layers: LayerState;
  };
  provenance: AnalysisProvenance;
};

export type QueryParams = {
  lat: number;
  lon: number;
  radiusMeters: number;
  bbox?: [number, number, number, number];
};

export type OverpassModule = {
  id: string;
  scale: Scale;
  radiusMeters?: number;
  bboxRequired?: boolean;
  buildQuery: (params: QueryParams) => string;
  parse: (response: unknown) => FeatureCollection;
};

export type ExportManifest = {
  app: "Urban Context Analysis";
  exportVersion: "0.1.0";
  selectedPoint: {
    lat: number;
    lon: number;
  };
  createdAt: string;
  scales: Scale[];
  sources: DataSource[];
  sourceFetches: SourceFetchReceipt[];
  overpassQueries: OverpassProvenance[];
  files: Array<{
    name: string;
    mediaType: string;
    role: string;
  }>;
  caveats: string[];
};
