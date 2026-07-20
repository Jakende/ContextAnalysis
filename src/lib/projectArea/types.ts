import type { MultiPolygon, Polygon } from "geojson";

export const PROJECT_AREA_SCHEMA_VERSION = "1.0.0" as const;

export type ProjectAreaCoordinate = [lon: number, lat: number];

export type ProjectAreaBbox = [
  west: number,
  south: number,
  east: number,
  north: number,
];

export type ProjectAreaGeometry = Polygon | MultiPolygon;

export type ProjectAreaSource =
  | "upload"
  | "draw-polygon"
  | "draw-rectangle";

/**
 * Canonical, serializable project boundary shared by map, analysis and exports.
 * Coordinates are always WGS84 longitude/latitude.
 */
export type ProjectArea = {
  schemaVersion: typeof PROJECT_AREA_SCHEMA_VERSION;
  id: string;
  label: string;
  source: ProjectAreaSource;
  fileName?: string;
  geometry: ProjectAreaGeometry;
  bbox: ProjectAreaBbox;
  /** Geometric area centroid. It can lie outside a strongly concave polygon. */
  centroid: ProjectAreaCoordinate;
  /** A point guaranteed to be on or inside one polygon component. */
  representativePoint: ProjectAreaCoordinate;
  /** Approximate geodesic area on a spherical Earth model. */
  areaSqm: number;
  createdAt: string;
  caveats: string[];
};

export type ProjectAreaDrawingMode = "polygon" | "rectangle" | null;

export type ProjectAreaCreationOptions = {
  label?: string;
  fileName?: string;
  createdAt?: string;
};

