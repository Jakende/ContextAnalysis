import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type { SectionLine, SelectedPoint } from "../types";
import { bboxAroundPoint, featureCollection } from "../analysis/geometry";

const ZENSUS_GRID_URL = "/data/processed/zensus-grid.geojson";
const SRTM_SAMPLES_URL = "/data/processed/srtm-30m/samples.geojson";
const LOD2_BUILDINGS_URL = "/data/processed/lod2-buildings.geojson";
const OVERTURE_BUILDINGS_URL = "/data/processed/overture-buildings.geojson";
const GLOBAL_BUILDING_ATLAS_URL = "/data/processed/global-building-atlas.geojson";
const BKG_BOUNDARIES_URL = "/data/processed/bkg-boundaries.geojson";
const EUROSTAT_FUA_URL = "/data/processed/eurostat-gisco-fua.geojson";
const GTFS_STOPS_URL = "/data/processed/gtfs-stops.geojson";

type TerrainSample = {
  distance: number;
  elevation: number;
};

type ProjectedPoint = {
  coordinate: number[];
  elevation: number;
};

const ZENSUS_VALUE_KEYS = [
  "populationIndex",
  "population",
  "einwohner",
  "EWZ",
  "value",
  "density",
  "pop_density",
];

const ELEVATION_KEYS = ["elevation", "elev", "height", "z", "dem"];
const BUILDING_HEIGHT_KEYS = [
  "height",
  "building:height",
  "measuredHeight",
  "measured_height",
  "Hoehe",
  "hoehe",
  "H_DACH",
  "h_dach",
  "DACH_H",
  "dach_h",
];

export async function loadZensusGridForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 6_000,
): Promise<FeatureCollection> {
  const collection = await fetchFeatureCollection(ZENSUS_GRID_URL);
  if (!collection) return featureCollection();

  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const filtered = collection.features.filter((feature) =>
    geometryIntersectsBbox(feature.geometry, bbox),
  );
  return featureCollection(classifyZensusFeatures(filtered));
}

export async function loadTerrainSamplesForSection(
  sectionLine: SectionLine,
): Promise<TerrainSample[]> {
  const collection = await fetchFeatureCollection(SRTM_SAMPLES_URL);
  if (!collection) return [];

  const terrainPoints = collection.features
    .map(toProjectedTerrainPoint)
    .filter((point): point is ProjectedPoint => point !== null);
  if (!terrainPoints.length) return [];

  const line = [
    [sectionLine.start.lon, sectionLine.start.lat],
    [sectionLine.end.lon, sectionLine.end.lat],
  ];
  const refLat = (sectionLine.start.lat + sectionLine.end.lat) / 2;
  const start = projectMeters(line[0], refLat);
  const end = projectMeters(line[1], refLat);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthMeters = Math.max(1, Math.hypot(dx, dy));
  const sampleCount = Math.max(2, Math.ceil(lengthMeters / 30) + 1);

  return Array.from({ length: sampleCount }, (_, index) => {
    const distance = (lengthMeters * index) / Math.max(1, sampleCount - 1);
    const t = distance / lengthMeters;
    const coordinate = [
      line[0][0] + (line[1][0] - line[0][0]) * t,
      line[0][1] + (line[1][1] - line[0][1]) * t,
    ];
    const nearest = nearestTerrainPoint(coordinate, terrainPoints, refLat);
    if (!nearest || nearest.distanceMeters > 80) return null;
    return { distance, elevation: nearest.point.elevation };
  }).filter((sample): sample is TerrainSample => sample !== null);
}

export async function loadLod2BuildingsForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 900,
): Promise<FeatureCollection> {
  const loaded =
    (await fetchFeatureCollectionWithSource(LOD2_BUILDINGS_URL, "lod2-bayern")) ??
    (await fetchFeatureCollectionWithSource(OVERTURE_BUILDINGS_URL, "overture-buildings")) ??
    (await fetchFeatureCollectionWithSource(GLOBAL_BUILDING_ATLAS_URL, "global-building-atlas"));
  if (!loaded) return featureCollection();

  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const buildings = loaded.collection.features
    .filter((feature) => isPolygonal(feature.geometry))
    .filter((feature) => geometryIntersectsBbox(feature.geometry, bbox))
    .map((feature) => normalizeBuildingFeature(feature, loaded.sourceId));
  return featureCollection(buildings);
}

export async function loadBkgBoundariesForPoint(
  selectedPoint: SelectedPoint,
): Promise<FeatureCollection> {
  const collection = await fetchFeatureCollection(BKG_BOUNDARIES_URL);
  if (!collection) return featureCollection();

  const point: [number, number] = [selectedPoint.lon, selectedPoint.lat];
  const containing = collection.features.filter(
    (feature) => isPolygonal(feature.geometry) && geometryContainsPoint(feature.geometry, point),
  );
  const features = containing.length
    ? containing
    : collection.features.filter((feature) =>
        geometryIntersectsBbox(feature.geometry, bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, 12_000)),
      );
  return featureCollection(
    features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceId: "bkg-geobasis",
        label:
          feature.properties?.name ??
          feature.properties?.GEN ??
          feature.properties?.gemeinde ??
          "BKG boundary",
      },
    })),
  );
}

export async function loadFuaGeometriesForPoint(
  selectedPoint: SelectedPoint,
): Promise<FeatureCollection> {
  const collection = await fetchFeatureCollection(EUROSTAT_FUA_URL);
  if (!collection) return featureCollection();

  const point: [number, number] = [selectedPoint.lon, selectedPoint.lat];
  const containing = collection.features.filter(
    (feature) => isPolygonal(feature.geometry) && geometryContainsPoint(feature.geometry, point),
  );
  const features = containing.length
    ? containing
    : collection.features.filter((feature) =>
        geometryIntersectsBbox(feature.geometry, bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, 35_000)),
      );
  return featureCollection(
    features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceId: "eurostat-gisco-fua",
        label:
          feature.properties?.fua_name ??
          feature.properties?.FUA_NAME ??
          feature.properties?.name ??
          "Functional Urban Area",
      },
    })),
  );
}

export async function loadGtfsStopsForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 1_000,
): Promise<FeatureCollection> {
  const collection = await fetchFeatureCollection(GTFS_STOPS_URL);
  if (!collection) return featureCollection();

  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const point = [selectedPoint.lon, selectedPoint.lat];
  const stops = collection.features
    .filter((feature) => feature.geometry.type === "Point")
    .filter((feature) => geometryIntersectsBbox(feature.geometry, bbox))
    .filter((feature) => distanceMeters(point, (feature.geometry as Point).coordinates) <= radiusMeters)
    .map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceId: "mobilithek-gtfs",
        transportMode: feature.properties?.transportMode ?? "transit",
      },
    }));
  return featureCollection(stops);
}

async function fetchFeatureCollection(url: string): Promise<FeatureCollection | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const json = (await response.json()) as FeatureCollection;
    if (json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}

async function fetchFeatureCollectionWithSource(
  url: string,
  sourceId: string,
): Promise<{ collection: FeatureCollection; sourceId: string } | null> {
  const collection = await fetchFeatureCollection(url);
  return collection ? { collection, sourceId } : null;
}

function classifyZensusFeatures(features: Feature[]): Feature[] {
  const values = features
    .map(readZensusValue)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (!values.length) return features;

  const lowBreak = quantile(values, 0.33);
  const highBreak = quantile(values, 0.66);
  return features.map((feature) => {
    const value = readZensusValue(feature);
    if (value === null) return feature;
    const zensusClass = value <= lowBreak ? "low" : value <= highBreak ? "medium" : "high";
    return {
      ...feature,
      properties: {
        ...feature.properties,
        populationIndex: value,
        zensusClass,
        valueStatus: "measured",
        sourceId: "zensus-grid-2022",
      },
    };
  });
}

function quantile(values: number[], fraction: number): number {
  const index = Math.max(0, Math.min(values.length - 1, Math.floor(values.length * fraction)));
  return values[index];
}

function readZensusValue(feature: Feature): number | null {
  for (const key of ZENSUS_VALUE_KEYS) {
    const value = feature.properties?.[key];
    const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function toProjectedTerrainPoint(feature: Feature): ProjectedPoint | null {
  if (feature.geometry.type !== "Point") return null;
  const elevation = readElevation(feature);
  if (elevation === null) return null;
  return {
    coordinate: (feature.geometry as Point).coordinates,
    elevation,
  };
}

function readElevation(feature: Feature): number | null {
  for (const key of ELEVATION_KEYS) {
    const value = feature.properties?.[key];
    const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function normalizeBuildingFeature(feature: Feature, sourceId: string): Feature {
  const height = readFirstNumericProperty(feature, BUILDING_HEIGHT_KEYS);
  return {
    ...feature,
    properties: {
      ...feature.properties,
      ...(height === null ? {} : { height }),
      sourceId,
      heightSource: height === null ? "missing" : sourceId,
    },
  };
}

function readFirstNumericProperty(feature: Feature, keys: string[]): number | null {
  for (const key of keys) {
    const value = feature.properties?.[key];
    const numeric = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function nearestTerrainPoint(
  coordinate: number[],
  terrainPoints: ProjectedPoint[],
  refLat: number,
): { point: ProjectedPoint; distanceMeters: number } | null {
  const projected = projectMeters(coordinate, refLat);
  let nearest: { point: ProjectedPoint; distanceMeters: number } | null = null;
  for (const point of terrainPoints) {
    const candidate = projectMeters(point.coordinate, refLat);
    const distanceMeters = Math.hypot(projected.x - candidate.x, projected.y - candidate.y);
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { point, distanceMeters };
    }
  }
  return nearest;
}

function distanceMeters(a: number[], b: number[]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(1, Math.cos(lat) * metersPerDegreeLat);
  const dx = (b[0] - a[0]) * metersPerDegreeLon;
  const dy = (b[1] - a[1]) * metersPerDegreeLat;
  return Math.hypot(dx, dy);
}

function geometryIntersectsBbox(
  geometry: Geometry,
  bbox: [number, number, number, number],
): boolean {
  const geometryBbox = getGeometryBbox(geometry);
  if (!geometryBbox) return false;
  return (
    geometryBbox[0] <= bbox[2] &&
    geometryBbox[2] >= bbox[0] &&
    geometryBbox[1] <= bbox[3] &&
    geometryBbox[3] >= bbox[1]
  );
}

function geometryContainsPoint(geometry: Geometry, point: [number, number]): boolean {
  if (geometry.type === "Polygon") return polygonContainsPoint(geometry.coordinates, point);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, point));
  }
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.some((item) => geometryContainsPoint(item, point));
  }
  return false;
}

function polygonContainsPoint(polygon: number[][][], point: [number, number]): boolean {
  if (!ringContainsPoint(polygon[0] ?? [], point)) return false;
  return !polygon.slice(1).some((hole) => ringContainsPoint(hole, point));
}

function ringContainsPoint(ring: number[][], point: [number, number]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = ring[index][0];
    const yi = ring[index][1];
    const xj = ring[previous][0];
    const yj = ring[previous][1];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPolygonal(geometry: Geometry): boolean {
  return (
    geometry.type === "Polygon" ||
    geometry.type === "MultiPolygon" ||
    (geometry.type === "GeometryCollection" &&
      geometry.geometries.some((item) => isPolygonal(item)))
  );
}

function getGeometryBbox(geometry: Geometry): [number, number, number, number] | null {
  const coordinates = flattenCoordinates(geometry);
  if (!coordinates.length) return null;
  return coordinates.reduce<[number, number, number, number]>(
    (bbox, coordinate) => [
      Math.min(bbox[0], coordinate[0]),
      Math.min(bbox[1], coordinate[1]),
      Math.max(bbox[2], coordinate[0]),
      Math.max(bbox[3], coordinate[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function flattenCoordinates(geometry: Geometry): number[][] {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") {
    return geometry.coordinates;
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiLineString") {
    return geometry.coordinates.flat();
  }
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(flattenCoordinates);
  }
  return [];
}

function projectMeters(coordinate: number[], referenceLat: number) {
  const latRadians = (referenceLat * Math.PI) / 180;
  return {
    x: coordinate[0] * 111_320 * Math.cos(latRadians),
    y: coordinate[1] * 111_320,
  };
}
