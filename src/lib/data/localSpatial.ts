import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Point,
} from "geojson";
import type { SectionLine, SelectedPoint } from "../types";
import {
  bboxAroundPoint,
  featureCollection,
  metersToLatitudeDegrees,
  metersToLongitudeDegrees,
} from "../analysis/geometry";

const ZENSUS_GRID_URL = "/data/processed/zensus-grid.geojson";
const DEM_SAMPLES_URL = "/data/processed/opentopography-dem/samples.geojson";
const CONTOUR_LINES_URL = "/data/processed/opentopography-contours/contours.geojson";
export const CONTOUR_FALLBACK_SOURCE_ID = "uca-contour-fallback";
const LOD2_BUILDINGS_URL = "/data/processed/lod2-buildings.geojson";
const LOD2_DEUTSCHLAND_INDEX_URL = "/data/processed/lod2-deutschland/index.json";
const LOD2_FEDERAL_STATES_INDEX_URL = "/data/processed/lod2-federal-states/index.json";
const OVERTURE_BUILDINGS_URL = "/data/processed/overture-buildings.geojson";
const OVERTURE_BUILDINGS_INDEX_URL = "/data/processed/overture-buildings/index.json";
const GLOBAL_BUILDING_ATLAS_URL = "/data/processed/global-building-atlas.geojson";
const BKG_BOUNDARIES_URL = "/data/processed/bkg-boundaries.geojson";
const EUROSTAT_FUA_URL = "/data/processed/eurostat-gisco-fua.geojson";
const GTFS_STOPS_URL = "/data/processed/gtfs-stops.geojson";
const GTFS_STOPS_INDEX_URL = "/data/processed/gtfs-stops/index.json";
const GTFS_LINES_URL = "/data/processed/gtfs-lines.geojson";
const GTFS_LINES_INDEX_URL = "/data/processed/gtfs-lines/index.json";
const URBAN_ATLAS_URL = "/data/processed/copernicus-urban-atlas.geojson";
const URBAN_ATLAS_INDEX_URL = "/data/processed/copernicus-urban-atlas/index.json";
const CACHE_MANIFEST_URL = "/data/processed/cache-manifest.json";

const jsonRequestCache = new Map<string, Promise<unknown | null>>();
const featureCollectionRequestCache = new Map<
  string,
  Promise<FeatureCollection | null>
>();

type TerrainSample = {
  distance: number;
  elevation: number;
};

type ProjectedPoint = {
  coordinate: number[];
  elevation: number;
};

type FeatureShardIndex = {
  type: "FeatureShardIndex";
  sourceId?: string;
  sourceVersion?: string;
  featureCount?: number;
  shardCount?: number;
  generatedAt?: string;
  shards: Array<{
    key: string;
    url: string;
    bbox: [number, number, number, number];
    count: number;
  }>;
};

type CacheManifest = {
  type: "UcaCacheManifest";
  entries: Array<{
    sourceId: string;
    indexUrl: string;
    bbox: [number, number, number, number];
    sourceVersion?: string;
    generatedAt?: string;
    label?: string;
  }>;
};

export type ShardedSourcePointStatus = {
  sourceId: string;
  indexUrl: string;
  status: "ok" | "empty" | "missing" | "failed";
  sourceVersion?: string;
  generatedAt?: string;
  featureCount?: number;
  shardCount?: number;
  selectedShardCount: number;
  loadedFeatureCount: number;
  caveats: string[];
  error?: string;
};

type ShardedSourcePointLoad = ShardedSourcePointStatus & {
  collection: FeatureCollection;
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
  const collection = await fetchFeatureCollection(DEM_SAMPLES_URL);
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

export async function loadContourLinesForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 1_200,
): Promise<FeatureCollection> {
  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);

  const collection = await fetchFeatureCollection(CONTOUR_LINES_URL);
  if (!collection) {
    return createFallbackContourLines(
      selectedPoint,
      radiusMeters,
      `Local OpenTopography contour GeoJSON was not available at ${CONTOUR_LINES_URL}.`,
    );
  }

  const features = collection.features
    .filter((feature) => geometryIntersectsBbox(feature.geometry, bbox))
    .flatMap(normalizeContourFeature);

  if (!features.length) {
    return createFallbackContourLines(
      selectedPoint,
      radiusMeters,
      "The local OpenTopography contour dataset loaded, but no contour lines intersected this M-scale analysis area.",
    );
  }

  return featureCollection(features);
}

function normalizeContourFeature(feature: Feature): Feature<LineString>[] {
  if (feature.geometry.type === "LineString") {
    return [
      {
        ...feature,
        geometry: feature.geometry,
        properties: {
          ...(feature.properties ?? {}),
          sourceId: feature.properties?.sourceId ?? "opentopography-contours",
          contourStatus: "measured",
        },
      },
    ];
  }

  if (feature.geometry.type !== "MultiLineString") return [];

  const geometry = feature.geometry as MultiLineString;
  return geometry.coordinates
    .filter((coordinates) => coordinates.length >= 2)
    .map((coordinates, index) => ({
      ...feature,
      id: feature.id === undefined ? undefined : `${String(feature.id)}:${index}`,
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        ...(feature.properties ?? {}),
        sourceId: feature.properties?.sourceId ?? "opentopography-contours",
        contourStatus: "measured",
        contourPart: index + 1,
      },
    }));
}

function createFallbackContourLines(
  selectedPoint: SelectedPoint,
  radiusMeters: number,
  caveat: string,
): FeatureCollection {
  const lineCount = 9;
  const pointCount = 40;
  const maxOffset = radiusMeters * 0.84;
  const spacing = (maxOffset * 2) / Math.max(1, lineCount - 1);
  const features: Feature<LineString>[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const baseOffset = -maxOffset + spacing * index;
    const coordinates: number[][] = [];
    for (let step = 0; step <= pointCount; step += 1) {
      const t = step / pointCount;
      const xMeters = -radiusMeters + radiusMeters * 2 * t;
      const waveMeters =
        Math.sin(t * Math.PI * 2.4 + index * 0.7) * radiusMeters * 0.045;
      const yMeters = baseOffset + xMeters * 0.1 + waveMeters;
      if (Math.abs(yMeters) > radiusMeters * 1.08) continue;
      coordinates.push([
        selectedPoint.lon + metersToLongitudeDegrees(xMeters, selectedPoint.lat),
        selectedPoint.lat + metersToLatitudeDegrees(yMeters),
      ]);
    }
    if (coordinates.length < 2) continue;
    features.push({
      type: "Feature",
      id: `fallback-contour-${index + 1}`,
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        label: "Approximate contour guide",
        contourStatus: "fallback",
        interval: "visual",
        relativeElevation: index - Math.floor(lineCount / 2),
        sourceId: CONTOUR_FALLBACK_SOURCE_ID,
        sourceLabel: "Contour fallback",
        caveat:
          `${caveat} These guide lines are generated only to keep the contour overlay inspectable; they are not measured terrain and are not used as elevation metrics.`,
      },
    });
  }

  return featureCollection(features);
}

export async function loadLod2BuildingsForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 1_200,
): Promise<FeatureCollection> {
  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const sources = [
    {
      sourceId: "lod2-deutschland-bkg",
      load: async () =>
        (await loadManifestBackedShardedSourceForPoint({
          sourceId: "lod2-deutschland-bkg",
          indexUrl: LOD2_DEUTSCHLAND_INDEX_URL,
          selectedPoint,
          radiusMeters,
        })).collection,
    },
    {
      sourceId: "lod2-federal-states",
      load: async () =>
        (await loadManifestBackedShardedSourceForPoint({
          sourceId: "lod2-federal-states",
          indexUrl: LOD2_FEDERAL_STATES_INDEX_URL,
          selectedPoint,
          radiusMeters,
        })).collection,
    },
    {
      sourceId: "lod2-bayern",
      load: () => fetchFeatureCollection(LOD2_BUILDINGS_URL),
    },
    {
      sourceId: "overture-buildings",
      load: async () =>
        (await loadManifestBackedShardedSourceForPoint({
          sourceId: "overture-buildings",
          indexUrl: OVERTURE_BUILDINGS_INDEX_URL,
          selectedPoint,
          radiusMeters,
        })).collection,
    },
    {
      sourceId: "overture-buildings",
      load: () => fetchFeatureCollection(OVERTURE_BUILDINGS_URL),
    },
    {
      sourceId: "global-building-atlas",
      load: () => fetchFeatureCollection(GLOBAL_BUILDING_ATLAS_URL),
    },
  ];

  for (const source of sources) {
    const collection = await source.load();
    if (!collection) continue;
    const buildings = collection.features
      .filter((feature) => isPolygonal(feature.geometry))
      .filter((feature) => geometryIntersectsBbox(feature.geometry, bbox))
      .map((feature) => normalizeBuildingFeature(feature, source.sourceId));
    if (buildings.length > 0) return featureCollection(buildings);
  }

  return featureCollection();
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
  const matchType = containing.length ? "contains-point" : "nearby-context";
  return featureCollection(
    features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceId: "eurostat-gisco-fua",
        matchType,
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
  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const collection =
    (await fetchGtfsShardsForBbox(bbox)) ?? (await fetchFeatureCollection(GTFS_STOPS_URL));
  if (!collection) return featureCollection();

  const point = [selectedPoint.lon, selectedPoint.lat];
  const stops = collection.features
    .filter((feature) => feature.geometry.type === "Point")
    .filter((feature) => geometryIntersectsBbox(feature.geometry, bbox))
    .filter((feature) => distanceMeters(point, (feature.geometry as Point).coordinates) <= radiusMeters)
    .map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceId: feature.properties?.sourceId ?? "mobilithek-gtfs",
        transportMode: feature.properties?.transportMode ?? "transit",
      },
    }));
  return featureCollection(stops);
}

export async function loadGtfsLinesForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 1_000,
): Promise<FeatureCollection> {
  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const collection =
    (await fetchGtfsLineShardsForBbox(bbox)) ?? (await fetchFeatureCollection(GTFS_LINES_URL));
  if (!collection) return featureCollection();

  const lines = collection.features
    .filter((feature) => feature.geometry.type === "LineString")
    .flatMap((feature) => {
      if (!geometryIntersectsBbox(feature.geometry, bbox)) return [];
      if (feature.properties?.geometrySource === "stop_times") {
        return createLocalGtfsStopTimeSegments(feature, bbox).map((segmentFeature, index) => ({
          ...segmentFeature,
          properties: {
            ...segmentFeature.properties,
            sourceId: segmentFeature.properties?.sourceId ?? "gtfs-de-local-transit",
            transportMode: segmentFeature.properties?.transportMode ?? "transit",
            clipSegmentIndex: index,
          },
        }));
      }
      const clippedSegments = clipLineStringFeatureToBbox(feature, bbox);
      return clippedSegments.map((clippedFeature, index) => ({
        ...clippedFeature,
        properties: {
          ...clippedFeature.properties,
          sourceId: clippedFeature.properties?.sourceId ?? "gtfs-de-local-transit",
          transportMode: clippedFeature.properties?.transportMode ?? "transit",
          clipSegmentIndex: index,
        },
      }));
    });
  const deduped = new Map<string, Feature>();
  for (const feature of lines) {
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const key = String(
      properties.route_id ??
        properties.shape_id ??
        properties.id ??
        JSON.stringify(
          clippedLineCoordinates(feature.geometry) ?? feature.geometry,
        ),
    );
    if (!deduped.has(key)) deduped.set(key, feature);
  }
  return featureCollection([...deduped.values()]);
}

export async function loadUrbanAtlasForPoint(
  selectedPoint: SelectedPoint,
  radiusMeters = 1_000,
): Promise<FeatureCollection> {
  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, radiusMeters);
  const sharded = await loadManifestBackedShardedSourceForPoint({
    sourceId: "copernicus-urban-atlas",
    indexUrl: URBAN_ATLAS_INDEX_URL,
    selectedPoint,
    radiusMeters,
  });
  const collection =
    sharded.status === "ok"
      ? sharded.collection
      : await fetchFeatureCollection(URBAN_ATLAS_URL);
  if (!collection) return featureCollection();

  const features = collection.features
    .filter((feature) => isPolygonal(feature.geometry))
    .filter((feature) => geometryIntersectsBbox(feature.geometry, bbox))
    .map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        sourceId: "copernicus-urban-atlas",
        sourceFamily: "urban-atlas-2021-catalog",
        urbanAtlasClass: readUrbanAtlasClass(feature),
      },
    }));
  return featureCollection(features);
}

export async function inspectPointSourceCoverage(input: {
  sourceId: string;
  selectedPoint: SelectedPoint;
  radiusMeters: number;
  indexUrl?: string;
}): Promise<ShardedSourcePointStatus> {
  const indexUrl = input.indexUrl ?? indexUrlForSource(input.sourceId);
  if (!indexUrl) {
    return {
      sourceId: input.sourceId,
      indexUrl: "",
      status: "missing",
      selectedShardCount: 0,
      loadedFeatureCount: 0,
      caveats: ["No sharded index URL is configured for point-aware source coverage."],
      error: "Missing sharded index URL",
    };
  }
  const result = await loadManifestBackedShardedSourceForPoint({ ...input, indexUrl });
  const { collection: _collection, ...status } = result;
  return status;
}

async function fetchGtfsShardsForBbox(
  bbox: [number, number, number, number],
): Promise<FeatureCollection | null> {
  return fetchFeatureShardsForBbox(GTFS_STOPS_INDEX_URL, bbox);
}

async function fetchGtfsLineShardsForBbox(
  bbox: [number, number, number, number],
): Promise<FeatureCollection | null> {
  return fetchFeatureShardsForBbox(GTFS_LINES_INDEX_URL, bbox);
}

async function fetchFeatureShardsForBbox(
  indexUrl: string,
  bbox: [number, number, number, number],
): Promise<FeatureCollection | null> {
  const result = await fetchFeatureShardsForBboxWithStatus(indexUrl, bbox, "unknown");
  return result.status === "missing" || result.status === "failed" ? null : result.collection;
}

async function loadShardedSourceForPoint(input: {
  sourceId: string;
  indexUrl: string;
  selectedPoint: SelectedPoint;
  radiusMeters: number;
}): Promise<ShardedSourcePointLoad> {
  const bbox = bboxAroundPoint(input.selectedPoint.lat, input.selectedPoint.lon, input.radiusMeters);
  return fetchFeatureShardsForBboxWithStatus(input.indexUrl, bbox, input.sourceId);
}

async function loadManifestBackedShardedSourceForPoint(input: {
  sourceId: string;
  indexUrl: string;
  selectedPoint: SelectedPoint;
  radiusMeters: number;
}): Promise<ShardedSourcePointLoad> {
  const bbox = bboxAroundPoint(input.selectedPoint.lat, input.selectedPoint.lon, input.radiusMeters);
  const canonical = await fetchFeatureShardsForBboxWithStatus(
    input.indexUrl,
    bbox,
    input.sourceId,
  );
  if (canonical.status === "ok") {
    const features = deduplicateFeatures(canonical.collection.features);
    return {
      ...canonical,
      collection: featureCollection(features),
      loadedFeatureCount: features.length,
      caveats: [
        ...canonical.caveats,
        "Canonical indexed coverage was used exclusively; overlapping point-cache extracts were not merged.",
      ],
    };
  }

  const manifestUrls = await findManifestIndexUrls(
    input.sourceId,
    bbox,
    [input.selectedPoint.lon, input.selectedPoint.lat],
  );
  const fallbackLoads: ShardedSourcePointLoad[] = [];
  for (const indexUrl of manifestUrls) {
    if (indexUrl === input.indexUrl) continue;
    const load = await fetchFeatureShardsForBboxWithStatus(indexUrl, bbox, input.sourceId);
    fallbackLoads.push(load);
    if (load.status === "ok") {
      const features = deduplicateFeatures(load.collection.features);
      return {
        ...load,
        collection: featureCollection(features),
        loadedFeatureCount: features.length,
        caveats: [
          ...load.caveats,
          "Canonical coverage was unavailable; one best-matching point cache was used without merging overlapping extracts.",
        ],
      };
    }
  }

  return fallbackLoads.find((load) => load.status === "empty") ?? canonical ?? {
    sourceId: input.sourceId,
    indexUrl: input.indexUrl,
    status: "missing",
    selectedShardCount: 0,
    loadedFeatureCount: 0,
    collection: featureCollection(),
    caveats: ["No sharded local cache is configured for this point."],
  };
}

async function fetchFeatureShardsForBboxWithStatus(
  indexUrl: string,
  bbox: [number, number, number, number],
  sourceId: string,
): Promise<ShardedSourcePointLoad> {
  try {
    const index = (await fetchJson(indexUrl)) as FeatureShardIndex | FeatureCollection | null;
    if (!index) {
      return {
        sourceId,
        indexUrl,
        status: "missing",
        selectedShardCount: 0,
        loadedFeatureCount: 0,
        collection: featureCollection(),
        caveats: [`No local sharded index was available at ${indexUrl}.`],
        error: "Index unavailable",
      };
    }
    if (index.type === "FeatureCollection") {
      const features = index.features.filter((feature) =>
        feature.geometry ? geometryIntersectsBbox(feature.geometry, bbox) : false,
      );
      return {
        sourceId,
        indexUrl,
        status: features.length > 0 ? "ok" : "empty",
        featureCount: index.features.length,
        shardCount: 1,
        selectedShardCount: features.length > 0 ? 1 : 0,
        loadedFeatureCount: features.length,
        collection: featureCollection(features),
        caveats:
          features.length > 0
            ? []
            : ["The point cache is present, but no features intersect the selected analysis area."],
      };
    }
    if (index.type !== "FeatureShardIndex" || !Array.isArray(index.shards)) {
      return {
        sourceId,
        indexUrl,
        status: "failed",
        sourceVersion: index.sourceVersion,
        generatedAt: index.generatedAt,
        featureCount: index.featureCount,
        shardCount: index.shardCount,
        selectedShardCount: 0,
        loadedFeatureCount: 0,
        collection: featureCollection(),
        caveats: [`The local sharded index at ${indexUrl} has an invalid format.`],
        error: "Invalid FeatureShardIndex",
      };
    }
    const shards = index.shards.filter((shard) => bboxIntersects(shard.bbox, bbox));
    if (!shards.length) {
      return {
        sourceId: index.sourceId ?? sourceId,
        indexUrl,
        status: "empty",
        sourceVersion: index.sourceVersion,
        generatedAt: index.generatedAt,
        featureCount: index.featureCount,
        shardCount: index.shardCount ?? index.shards.length,
        selectedShardCount: 0,
        loadedFeatureCount: 0,
        collection: featureCollection(),
        caveats: ["The preprocessed dataset is present, but the selected point is outside its cached shard coverage."],
      };
    }
    const collections = await Promise.all(
      shards.map((shard) => fetchFeatureCollection(shard.url)),
    );
    const features = deduplicateFeatures(
      collections.flatMap((collection) => collection?.features ?? []),
    );
    return {
      sourceId: index.sourceId ?? sourceId,
      indexUrl,
      status: features.length > 0 ? "ok" : "empty",
      sourceVersion: index.sourceVersion,
      generatedAt: index.generatedAt,
      featureCount: index.featureCount,
      shardCount: index.shardCount ?? index.shards.length,
      selectedShardCount: shards.length,
      loadedFeatureCount: features.length,
      collection: featureCollection(features),
      caveats:
        features.length > 0
          ? []
          : ["Intersecting cache shards exist, but no features were loaded from them."],
    };
  } catch (error) {
    return {
      sourceId,
      indexUrl,
      status: "failed",
      selectedShardCount: 0,
      loadedFeatureCount: 0,
      collection: featureCollection(),
      caveats: ["The local sharded dataset could not be read during point analysis."],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function indexUrlForSource(sourceId: string): string | undefined {
  if (sourceId === "overture-buildings") return OVERTURE_BUILDINGS_INDEX_URL;
  if (sourceId === "copernicus-urban-atlas" || sourceId === "urban-atlas-2021-catalog") {
    return URBAN_ATLAS_INDEX_URL;
  }
  if (sourceId === "gtfs-de-local-transit" || sourceId === "mobilithek-gtfs") {
    return GTFS_STOPS_INDEX_URL;
  }
  return undefined;
}

async function findManifestIndexUrls(
  sourceId: string,
  bbox: [number, number, number, number],
  point: [number, number],
): Promise<string[]> {
  const manifest = await fetchCacheManifest();
  if (!manifest) return [];
  return manifest.entries
    .filter((entry) => entry.sourceId === sourceId && bboxIntersects(entry.bbox, bbox))
    .sort((left, right) => {
      const leftContains = bboxContainsPoint(left.bbox, point) ? 1 : 0;
      const rightContains = bboxContainsPoint(right.bbox, point) ? 1 : 0;
      if (leftContains !== rightContains) return rightContains - leftContains;
      const freshness = String(right.generatedAt ?? "").localeCompare(
        String(left.generatedAt ?? ""),
      );
      if (freshness !== 0) return freshness;
      return bboxArea(left.bbox) - bboxArea(right.bbox);
    })
    .map((entry) => entry.indexUrl);
}

async function fetchCacheManifest(): Promise<CacheManifest | null> {
  const manifest = (await fetchJson(CACHE_MANIFEST_URL)) as CacheManifest | null;
  if (manifest?.type !== "UcaCacheManifest" || !Array.isArray(manifest.entries)) return null;
  return manifest;
}

async function fetchFeatureCollection(url: string): Promise<FeatureCollection | null> {
  const cached = featureCollectionRequestCache.get(url);
  if (cached) return cached;
  const request = fetchJson(url).then((json) => {
    const collection = json as FeatureCollection | null;
    if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      return null;
    }
    return collection;
  });
  featureCollectionRequestCache.set(url, request);
  return request;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const cached = jsonRequestCache.get(url);
  if (cached) return cached;
  const request = fetch(url)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  jsonRequestCache.set(url, request);
  return request;
}

function bboxContainsPoint(
  bbox: [number, number, number, number],
  point: [number, number],
): boolean {
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function bboxArea(bbox: [number, number, number, number]): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function deduplicateFeatures(features: Feature[]): Feature[] {
  const seen = new Set<string>();
  const output: Feature[] = [];
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const stableId =
      feature.id ??
      properties.id ??
      properties.osmId ??
      properties.osm_id ??
      properties.gml_id ??
      properties.stop_id ??
      properties.identifier;
    const key = stableId === undefined || stableId === null
      ? `${feature.geometry.type}:${JSON.stringify(feature.geometry)}`
      : `${properties.sourceId ?? "unknown"}:${String(stableId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(feature);
  }
  return output;
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

function readUrbanAtlasClass(feature: Feature): string {
  const value =
    feature.properties?.code_2021 ??
    feature.properties?.code_2018 ??
    feature.properties?.code ??
    feature.properties?.CODE_2021 ??
    feature.properties?.CODE_2018 ??
    feature.properties?.CODE ??
    feature.properties?.class_2021 ??
    feature.properties?.class_2018 ??
    feature.properties?.class ??
    feature.properties?.label;
  return String(value ?? "unknown");
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
  return bboxIntersects(geometryBbox, bbox);
}

function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return (
    a[0] <= b[2] &&
    a[2] >= b[0] &&
    a[1] <= b[3] &&
    a[3] >= b[1]
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

function clipLineStringFeatureToBbox(
  feature: Feature,
  bbox: [number, number, number, number],
): Feature[] {
  if (feature.geometry.type !== "LineString") return [];
  const segments = clipLineStringToBbox(feature.geometry.coordinates, bbox);
  return segments.map((coordinates) => ({
    ...feature,
    geometry: {
      type: "LineString",
      coordinates,
    },
  }));
}

function createLocalGtfsStopTimeSegments(
  feature: Feature,
  bbox: [number, number, number, number],
): Feature[] {
  if (feature.geometry.type !== "LineString") return [];
  const coordinates = feature.geometry.coordinates;
  const localSegments: Feature[] = [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const clipped = clipSegmentToBbox(start, end, bbox);
    if (!clipped) continue;
    if (distanceMeters(start, end) > 800) continue;
    const [clippedStart, clippedEnd] = clipped;
    if (sameCoordinate(clippedStart, clippedEnd)) continue;
    localSegments.push({
      ...feature,
      geometry: {
        type: "LineString",
        coordinates: [clippedStart, clippedEnd],
      },
      properties: {
        ...feature.properties,
        geometrySource: "stop_times_local_segment",
      },
    });
  }
  return localSegments;
}

function clippedLineCoordinates(geometry: Geometry): number[][] | null {
  return geometry.type === "LineString" ? geometry.coordinates : null;
}

function clipLineStringToBbox(
  coordinates: number[][],
  bbox: [number, number, number, number],
): number[][][] {
  const segments: number[][][] = [];
  let current: number[][] = [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const clipped = clipSegmentToBbox(coordinates[index - 1], coordinates[index], bbox);
    if (!clipped) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    if (!current.length) {
      current.push(start, end);
      continue;
    }
    const last = current[current.length - 1];
    if (sameCoordinate(last, start)) {
      if (!sameCoordinate(last, end)) current.push(end);
      continue;
    }
    if (current.length > 1) segments.push(current);
    current = [start, end];
  }
  if (current.length > 1) segments.push(current);
  return segments
    .map((segment) => dedupeSequentialCoordinates(segment))
    .filter((segment) => segment.length > 1);
}

function clipSegmentToBbox(
  start: number[],
  end: number[],
  bbox: [number, number, number, number],
): [number[], number[]] | null {
  const [west, south, east, north] = bbox;
  let [x1, y1] = start;
  let [x2, y2] = end;
  let code1 = computeOutCode(x1, y1, bbox);
  let code2 = computeOutCode(x2, y2, bbox);
  while (true) {
    if (!(code1 | code2)) {
      return [
        [x1, y1],
        [x2, y2],
      ];
    }
    if (code1 & code2) {
      return null;
    }
    const outCode = code1 || code2;
    let x = 0;
    let y = 0;
    if (outCode & 8) {
      x = x1 + ((x2 - x1) * (north - y1)) / ((y2 - y1) || Number.EPSILON);
      y = north;
    } else if (outCode & 4) {
      x = x1 + ((x2 - x1) * (south - y1)) / ((y2 - y1) || Number.EPSILON);
      y = south;
    } else if (outCode & 2) {
      y = y1 + ((y2 - y1) * (east - x1)) / ((x2 - x1) || Number.EPSILON);
      x = east;
    } else if (outCode & 1) {
      y = y1 + ((y2 - y1) * (west - x1)) / ((x2 - x1) || Number.EPSILON);
      x = west;
    }
    if (outCode === code1) {
      x1 = x;
      y1 = y;
      code1 = computeOutCode(x1, y1, bbox);
    } else {
      x2 = x;
      y2 = y;
      code2 = computeOutCode(x2, y2, bbox);
    }
  }
}

function computeOutCode(
  x: number,
  y: number,
  bbox: [number, number, number, number],
): number {
  const [west, south, east, north] = bbox;
  let code = 0;
  if (x < west) code |= 1;
  else if (x > east) code |= 2;
  if (y < south) code |= 4;
  else if (y > north) code |= 8;
  return code;
}

function sameCoordinate(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function dedupeSequentialCoordinates(coordinates: number[][]): number[][] {
  const output: number[][] = [];
  for (const coordinate of coordinates) {
    const previous = output[output.length - 1];
    if (previous && sameCoordinate(previous, coordinate)) continue;
    output.push(coordinate);
  }
  return output;
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
  const output: number[][] = [];
  collectCoordinates(geometry, output);
  return output;
}

function collectCoordinates(geometry: Geometry, output: number[][]): void {
  if (geometry.type === "Point") {
    output.push(geometry.coordinates);
    return;
  }
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") {
    pushCoordinates(output, geometry.coordinates);
    return;
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiLineString") {
    for (const ring of geometry.coordinates) pushCoordinates(output, ring);
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) pushCoordinates(output, ring);
    }
    return;
  }
  if (geometry.type === "GeometryCollection") {
    for (const item of geometry.geometries) collectCoordinates(item, output);
  }
}

function pushCoordinates(target: number[][], coordinates: number[][]): void {
  for (const coordinate of coordinates) target.push(coordinate);
}

function projectMeters(coordinate: number[], referenceLat: number) {
  const latRadians = (referenceLat * Math.PI) / 180;
  return {
    x: coordinate[0] * 111_320 * Math.cos(latRadians),
    y: coordinate[1] * 111_320,
  };
}
