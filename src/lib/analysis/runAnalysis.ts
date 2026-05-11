import type { FeatureCollection } from "geojson";
import { reverseGeocode } from "../api/geocoding";
import {
  loadBkgBoundariesForPoint,
  loadFuaGeometriesForPoint,
  loadGtfsStopsForPoint,
  loadLod2BuildingsForPoint,
  loadTerrainSamplesForSection,
  loadZensusGridForPoint,
} from "../data/localSpatial";
import { runSourceAdapters } from "../data/sourceAdapters";
import { fetchZensusWmsIndicators } from "../data/zensusWms";
import { runOverpassModules } from "../overpass/client";
import type {
  AnalysisResult,
  LayerState,
  SectionLine,
  SelectedPoint,
  Scale,
} from "../types";
import { featureCollection, geometryToFeature, pointGeometry } from "./geometry";
import { analyzeL } from "./l/analyzeL";
import { analyzeM } from "./m/analyzeM";
import { analyzeXl } from "./xl/analyzeXl";
import {
  createXlContextOverlay,
  createXlGridOverlay,
  createXlSourceOverlay,
} from "./xl/overlays";
import { createXlSourceStatusModule } from "./xl/sourceStatus";
import { createZensusGridModule } from "./xl/zensus";
import { createZensusWmsModule } from "./xl/zensusWms";

const DEFAULT_LAYER_STATE: LayerState = {
  "3D": true,
  trees: true,
  sun: false,
  section: true,
  green: true,
};

export async function runLocationAnalysis(input: {
  lat: number;
  lon: number;
  activeScale: Scale;
  layers?: LayerState;
  sectionLine?: SectionLine | null;
  enableGeocoding?: boolean;
  enableOverpass?: boolean;
}): Promise<{ result: AnalysisResult; sectionSvg: string }> {
  const computedAt = new Date().toISOString();
  const geocoding =
    input.enableGeocoding === false
      ? {
          status: "skipped" as const,
          cacheKey: undefined,
          label: undefined,
          address: undefined,
          municipality: undefined,
          district: undefined,
          sourceStatus: undefined,
        }
      : await reverseGeocode(input.lat, input.lon, { allowCache: false });

  const selectedPoint: SelectedPoint = {
    lat: input.lat,
    lon: input.lon,
    label: geocoding.label,
    address: geocoding.address,
    municipality: geocoding.municipality,
    district: geocoding.district,
    point: pointGeometry(input.lat, input.lon),
  };

  const overpass = await runOverpassModules({
    lat: input.lat,
    lon: input.lon,
    enabled: input.enableOverpass ?? true,
    allowCache: false,
  });
  const zensusGrid = await loadZensusGridForPoint(selectedPoint);
  const zensusWmsIndicators = await fetchZensusWmsIndicators(selectedPoint, computedAt);
  const lod2Buildings = await loadLod2BuildingsForPoint(selectedPoint);
  const bkgBoundaries = await loadBkgBoundariesForPoint(selectedPoint);
  const fuaGeometries = await loadFuaGeometriesForPoint(selectedPoint);
  const gtfsStops = await loadGtfsStopsForPoint(selectedPoint);
  const terrainSamples = input.sectionLine
    ? await loadTerrainSamplesForSection(input.sectionLine)
    : [];
  const analysisCollections: Record<string, FeatureCollection> = {
    ...overpass.collections,
    buildings: mergeCollections(
      lod2Buildings,
      overpass.collections.buildings ?? featureCollection(),
    ),
    transportStops: mergeCollections(
      gtfsStops,
      overpass.collections.transportStops ?? featureCollection(),
    ),
  };
  const xl = analyzeXl(selectedPoint, computedAt);
  const l = analyzeL(selectedPoint, computedAt, 500, analysisCollections);
  const m = analyzeM(
    selectedPoint,
    computedAt,
    analysisCollections,
    input.sectionLine,
    terrainSamples,
  );
  const sourceFetches = await runSourceAdapters({
    district: xl.district,
    computedAt,
    geocoding: {
      enabled: input.enableGeocoding !== false,
      status: geocoding.status,
      cacheKey: geocoding.cacheKey,
      sourceStatus: geocoding.sourceStatus,
      error: "error" in geocoding ? geocoding.error : undefined,
    },
    overpassQueries: overpass.provenance,
    overpassCollections: overpass.collections,
  });
  const xlSourceStatus = createXlSourceStatusModule(sourceFetches, computedAt);
  const zensus = createZensusGridModule(zensusGrid, computedAt);
  const zensusWms = createZensusWmsModule(zensusWmsIndicators, computedAt);

  const allModules = [
    ...xl.modules,
    ...zensusWms.modules,
    ...zensus.modules,
    ...xlSourceStatus.modules,
    ...l.modules,
    ...m.modules,
  ];
  const allIndicators = [
    ...xl.indicators,
    ...zensusWms.indicators,
    ...zensus.indicators,
    ...xlSourceStatus.indicators,
    ...l.indicators,
    ...m.indicators,
  ];
  const sourceIds = [
    ...new Set([
      ...allIndicators.flatMap((indicator) => indicator.sourceIds),
      ...sourceFetches.map((receipt) => receipt.sourceId),
    ]),
  ];

  const overpassCaveats = overpass.provenance.flatMap(
    (query) => query.caveats,
  );

  const result: AnalysisResult = {
    app: "Urban Context Analysis",
    analysisVersion: "0.1.0",
    selectedPoint,
    activeScale: input.activeScale,
    modules: allModules,
    indicators: allIndicators,
    overlays: {
      selectedPoint: geometryToFeature(pointGeometry(input.lat, input.lon), {
        label: selectedPoint.label ?? "selected point",
      }) as AnalysisResult["overlays"]["selectedPoint"],
      xlContext: createXlContextOverlay(selectedPoint, bkgBoundaries),
      xlGrid: createXlGridOverlay(selectedPoint, sourceFetches, zensusGrid),
      xlSources: createXlSourceOverlay(selectedPoint, sourceFetches, fuaGeometries),
      lBuffer: mergeCollections(l.overlays.lBuffer),
      mStreetSegment: mergeCollections(m.overlays.street, m.overlays.corridor),
      green: mergeCollections(l.overlays.green),
      trees: mergeCollections(l.overlays.trees, m.overlays.trees),
      buildings: mergeCollections(m.overlays.buildings),
      pois: mergeCollections(overpass.collections.pois ?? featureCollection()),
      transport: mergeCollections(
        analysisCollections.transportStops,
        analysisCollections.transportLines ?? featureCollection(),
      ),
      mobility: mergeCollections(
        overpass.collections.mobilityInfrastructure ?? featureCollection(),
      ),
      barriers: mergeCollections(overpass.collections.barriers ?? featureCollection()),
      development: mergeCollections(
        overpass.collections.developmentHints ?? featureCollection(),
      ),
      sun: mergeCollections(m.overlays.sun),
      sectionLine: mergeCollections(m.overlays.sectionLine),
    },
    mapState: {
      center: [input.lon, input.lat],
      zoom: 15.2,
      layers: input.layers ?? DEFAULT_LAYER_STATE,
    },
    provenance: {
      createdAt: computedAt,
      sourceIds,
      sourceFetches,
      overpassQueries: overpass.provenance,
      geocoding: {
        enabled: input.enableGeocoding !== false,
        sourceId: "osm-nominatim",
        status: geocoding.status,
        cacheKey: geocoding.cacheKey,
        error: "error" in geocoding ? geocoding.error : undefined,
      },
      caveats: [
        "Analysis is generated from structured indicators, not free-form LLM metrics.",
        "Fresh live/API retrieval is requested for every new selected point; cached Nominatim or Overpass payloads are not used for point analysis.",
        ...("error" in geocoding && geocoding.error
          ? [`Reverse geocoding unavailable: ${geocoding.error}`]
          : []),
        ...overpassCaveats,
        ...sourceFetches.flatMap((receipt) => receipt.caveats),
      ],
    },
  };
  return { result, sectionSvg: m.sectionSvg };
}

function mergeCollections(...collections: FeatureCollection[]): FeatureCollection {
  return featureCollection(collections.flatMap((collection) => collection.features));
}
