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

export type LayerId =
  | "3D"
  | "trees"
  | "sun"
  | "section"
  | "green"
  | "blue"
  | "xlContext"
  | "zensusWms"
  | "xlGrid"
  | "xlSources"
  | "urbanAtlas"
  | "lBuffer"
  | "transitLocal"
  | "transitRegional"
  | "transportAll"
  | "transitBus"
  | "transitTram"
  | "transitSubway"
  | "transitLightRail"
  | "transitRail"
  | "transitOther"
  | "mobility"
  | "mobilityBike"
  | "mobilityPedestrian"
  | "mobilitySupport"
  | "isochrones"
  | "isochroneWalking"
  | "isochroneCycling"
  | "isochroneDriving"
  | "pois"
  | "poiEducation"
  | "poiHealth"
  | "poiCivic"
  | "poiCommerce"
  | "poiFoodCulture"
  | "poiLeisureTourism"
  | "gastronomy"
  | "development"
  | "parkingAreas"
  | "buildingFootprints"
  | "streets"
  | "barriers"
  | "contours";

export type LayerState = Record<LayerId, boolean>;

export type LayerVisualStyle = {
  color: string;
  width: number;
};

export type LayerStyleState = Record<LayerId, LayerVisualStyle>;

export type AnalysisLoadStep = {
  id: string;
  label: string;
  detail: string;
  status: "queued" | "running" | "ok" | "failed" | "skipped";
};

export type AnalysisPhase =
  | "idle"
  | "running"
  | "local-ready"
  | "enhancing"
  | "complete"
  | "failed";

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

export type DataSourceRunStatus =
  | "requested"
  | "fetched"
  | "cache-hit"
  | "empty"
  | "missing-credentials"
  | "missing"
  | "failed"
  | "skipped";

export type DataSourceRunPhase =
  | "preflight"
  | "geocoding"
  | "live-api"
  | "preprocessed"
  | "tile-service"
  | "indicator";

export type DataSourceRunEvent = {
  id: string;
  sourceId?: string;
  label: string;
  phase: DataSourceRunPhase;
  status: DataSourceRunStatus;
  requestedAt: string;
  finishedAt?: string;
  elapsedMs?: number;
  scale?: Scale[];
  url?: string;
  localPath?: string;
  recordCount?: number;
  featureCount?: number;
  detail: string;
  caveats: string[];
  error?: string;
};

export type AnalysisProvenance = {
  createdAt: string;
  sourceIds: string[];
  sourceFetches: SourceFetchReceipt[];
  dataSourceRun: DataSourceRunEvent[];
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
  urbanAtlas: FeatureCollection;
  lBuffer: FeatureCollection;
  mStreetSegment: FeatureCollection;
  green: FeatureCollection;
  blue: FeatureCollection;
  trees: FeatureCollection;
  buildings: FeatureCollection;
  pois: FeatureCollection;
  gastronomy: FeatureCollection;
  parkingAreas: FeatureCollection;
  transport: FeatureCollection;
  mobility: FeatureCollection;
  isochrones: FeatureCollection;
  barriers: FeatureCollection;
  development: FeatureCollection;
  sun: FeatureCollection;
  contours: FeatureCollection;
  sectionLine: FeatureCollection;
  osmRaw: FeatureCollection;
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
  buildFallbackQuery?: (params: QueryParams) => string;
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
  dataSourceRun: DataSourceRunEvent[];
  overpassQueries: OverpassProvenance[];
  files: Array<{
    name: string;
    mediaType: string;
    role: string;
  }>;
  caveats: string[];
};
