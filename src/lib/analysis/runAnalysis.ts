import type { FeatureCollection } from "geojson";
import { reverseGeocode } from "../api/geocoding";
import {
  loadBkgBoundariesForPoint,
  loadContourLinesForPoint,
  loadFuaGeometriesForPoint,
  loadGtfsStopsForPoint,
  loadLod2BuildingsForPoint,
  loadTerrainSamplesForSection,
  loadUrbanAtlasForPoint,
  loadZensusGridForPoint,
} from "../data/localSpatial";
import { runSourceAdapters } from "../data/sourceAdapters";
import { createDataSourceRunReport } from "../data/sourceRun";
import { fetchZensusWmsIndicators } from "../data/zensusWms";
import { fetchOpenRouteServiceIsochrones } from "../mobility/openRouteService";
import { runOverpassModules } from "../overpass/client";
import type {
  AnalysisResult,
  DataSourceRunEvent,
  LayerState,
  SectionLine,
  SelectedPoint,
  Scale,
  AnalysisLoadStep,
} from "../types";
import { featureCollection, geometryToFeature, pointGeometry } from "./geometry";
import { createKpiMatrixModule } from "./kpi/kpiMatrix";
import { analyzeL } from "./l/analyzeL";
import { analyzeM } from "./m/analyzeM";
import { analyzeXl } from "./xl/analyzeXl";
import { createFuaContextModule } from "./xl/fua";
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
  sun: true,
  section: true,
  green: true,
  blue: true,
  xlContext: true,
  zensusWms: true,
  xlGrid: true,
  xlSources: true,
  urbanAtlas: false,
  lBuffer: true,
  transitLocal: false,
  transitRegional: false,
  transportAll: false,
  transitBus: false,
  transitTram: false,
  transitSubway: false,
  transitLightRail: false,
  transitRail: false,
  transitOther: false,
  mobility: false,
  mobilityBike: false,
  mobilityPedestrian: false,
  mobilitySupport: false,
  isochrones: false,
  pois: false,
  poiEducation: false,
  poiHealth: false,
  poiCivic: false,
  poiCommerce: false,
  poiFoodCulture: false,
  poiLeisureTourism: false,
  gastronomy: false,
  development: false,
  parkingAreas: false,
  buildingFootprints: false,
  streets: true,
  barriers: false,
  contours: true,
};

export async function runLocationAnalysis(input: {
  lat: number;
  lon: number;
  activeScale: Scale;
  layers?: LayerState;
  sectionLine?: SectionLine | null;
  preflightSourceRun?: DataSourceRunEvent[];
  onProgress?: (step: AnalysisLoadStep) => void;
  enableGeocoding?: boolean;
  enableOverpass?: boolean;
}): Promise<{ result: AnalysisResult; sectionSvg: string }> {
  const computedAt = new Date().toISOString();
  emitProgress(input.onProgress, {
    id: "geocoding",
    label: "Nominatim reverse lookup",
    detail: "Fetching reverse address context from Nominatim without cache fallback.",
    status: input.enableGeocoding === false ? "skipped" : "running",
  });
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
  emitProgress(input.onProgress, {
    id: "geocoding",
    label: "Nominatim reverse lookup",
    detail:
      geocoding.status === "ok"
        ? "Reverse address context loaded."
        : "Reverse geocoding unavailable; analysis continues with coordinates.",
    status: geocoding.status === "ok" ? "ok" : geocoding.status,
  });

  const selectedPoint: SelectedPoint = {
    lat: input.lat,
    lon: input.lon,
    label: geocoding.label,
    address: geocoding.address,
    municipality: geocoding.municipality,
    district: geocoding.district,
    point: pointGeometry(input.lat, input.lon),
  };

  emitProgress(input.onProgress, {
    id: "overpass",
    label: "Overpass OSM modules",
    detail: "Fetching OSM features through deterministic Overpass modules.",
    status: input.enableOverpass === false ? "skipped" : "running",
  });
  const overpass = await runOverpassModules({
    lat: input.lat,
    lon: input.lon,
    enabled: input.enableOverpass ?? true,
    allowCache: true,
  });
  emitProgress(input.onProgress, {
    id: "overpass",
    label: "Overpass OSM modules",
    detail: `${Object.values(overpass.collections).reduce((total, collection) => total + collection.features.length, 0)} OSM feature(s) normalized.`,
    status: overpass.provenance.some((query) => query.status === "ok" || query.status === "cached")
      ? "ok"
      : overpass.provenance.some((query) => query.status === "failed")
        ? "failed"
        : "skipped",
  });

  emitProgress(input.onProgress, {
    id: "local-data",
    label: "Local, WMS, and sharded datasets",
    detail: "Loading Zensus WMS/grid, BKG, FUA, GTFS, Urban Atlas, and building sources.",
    status: "running",
  });
  const zensusGrid = await loadZensusGridForPoint(selectedPoint);
  const zensusWmsIndicators = await fetchZensusWmsIndicators(selectedPoint, computedAt);
  const lod2Buildings = await loadLod2BuildingsForPoint(selectedPoint);
  const bkgBoundaries = await loadBkgBoundariesForPoint(selectedPoint);
  const fuaGeometries = await loadFuaGeometriesForPoint(selectedPoint);
  const gtfsStops = await loadGtfsStopsForPoint(selectedPoint);
  const urbanAtlas = await loadUrbanAtlasForPoint(selectedPoint);
  const contourLines = await loadContourLinesForPoint(selectedPoint);
  const isochrones = await fetchOpenRouteServiceIsochrones(selectedPoint, computedAt);
  const terrainSamples = input.sectionLine
    ? await loadTerrainSamplesForSection(input.sectionLine)
    : [];
  emitProgress(input.onProgress, {
    id: "local-data",
    label: "Local, WMS, and sharded datasets",
    detail: `${bkgBoundaries.features.length} BKG / ${fuaGeometries.features.length} FUA / ${gtfsStops.features.length} GTFS stops / ${urbanAtlas.features.length} Urban Atlas / ${lod2Buildings.features.length} building / ${contourLines.features.length} contour / ${isochrones.collection.features.length} isochrone feature(s).`,
    status: "ok",
  });

  emitProgress(input.onProgress, {
    id: "indicators",
    label: "XL/L/M indicators",
    detail: "Computing deterministic indicators and map overlays.",
    status: "running",
  });
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
    urbanAtlas,
    landUse: mergeCollections(
      urbanAtlas,
      overpass.collections.landUse ?? featureCollection(),
    ),
    greenBlue: mergeCollections(
      urbanAtlas,
      overpass.collections.greenBlue ?? featureCollection(),
    ),
    isochrones: isochrones.collection,
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
  const sourceFetches = [
    ...(await runSourceAdapters({
    district: xl.district,
    selectedPoint,
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
    localCollections: {
      "bkg-geobasis": bkgBoundaries,
      "eurostat-gisco-fua": fuaGeometries,
      "zensus-grid-2022": zensusGrid,
      "copernicus-urban-atlas": urbanAtlas,
      "urban-atlas-2021-catalog": urbanAtlas,
      "gtfs-de-local-transit": gtfsStops,
      "mobilithek-gtfs": gtfsStops,
      "opentopography-contours": contourLines,
    },
    })),
    isochrones.receipt,
  ];
  const xlSourceStatus = createXlSourceStatusModule(sourceFetches, computedAt);
  const fua = createFuaContextModule(fuaGeometries, computedAt);
  const zensus = createZensusGridModule(zensusGrid, computedAt);
  const zensusWms = createZensusWmsModule(zensusWmsIndicators, computedAt);
  const kpi = createKpiMatrixModule(
    [
      ...xl.indicators,
      ...fua.indicators,
      ...zensusWms.indicators,
      ...zensus.indicators,
      ...xlSourceStatus.indicators,
      ...l.indicators,
      ...m.indicators,
    ],
    computedAt,
  );
  emitProgress(input.onProgress, {
    id: "indicators",
    label: "XL/L/M indicators",
    detail: `${sourceFetches.length} source receipt(s), ${xl.indicators.length + fua.indicators.length + zensusWms.indicators.length + zensus.indicators.length + xlSourceStatus.indicators.length + l.indicators.length + m.indicators.length} indicator(s).`,
    status: "ok",
  });

  const allModules = [
    ...xl.modules,
    ...fua.modules,
    ...zensusWms.modules,
    ...zensus.modules,
    ...xlSourceStatus.modules,
    ...l.modules,
    ...kpi.modules,
    ...m.modules,
  ];
  const allIndicators = [
    ...xl.indicators,
    ...fua.indicators,
    ...zensusWms.indicators,
    ...zensus.indicators,
    ...xlSourceStatus.indicators,
    ...l.indicators,
    ...kpi.indicators,
    ...m.indicators,
  ];
  const sourceIds = [
    ...new Set([
      ...allIndicators.flatMap((indicator) => indicator.sourceIds),
      ...sourceFetches.map((receipt) => receipt.sourceId),
      ...(input.preflightSourceRun ?? []).flatMap((event) =>
        event.sourceId ? [event.sourceId] : [],
      ),
    ]),
  ];

  const overpassCaveats = overpass.provenance.flatMap(
    (query) => query.caveats,
  );
  const rawOverpassFeatures = mergeCollections(
    ...Object.entries(overpass.collections).map(([moduleId, collection]) =>
      tagFeatures(collection, { overpassModuleId: moduleId }),
    ),
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
      urbanAtlas,
      lBuffer: mergeCollections(l.overlays.lBuffer),
      mStreetSegment: mergeCollections(m.overlays.street, m.overlays.corridor),
      green: mergeCollections(l.overlays.green),
      blue: mergeCollections(l.overlays.blue),
      trees: mergeCollections(l.overlays.trees, m.overlays.trees),
      buildings: mergeCollections(
        analysisCollections.buildings ?? featureCollection(),
        m.overlays.buildings,
      ),
      pois: mergeCollections(overpass.collections.pois ?? featureCollection()),
      gastronomy: mergeCollections(overpass.collections.gastronomy ?? featureCollection()),
      parkingAreas: mergeCollections(overpass.collections.parkingAreas ?? featureCollection()),
      transport: mergeCollections(
        analysisCollections.transportStops,
        analysisCollections.transportLines ?? featureCollection(),
      ),
      mobility: mergeCollections(
        overpass.collections.mobilityInfrastructure ?? featureCollection(),
      ),
      isochrones: isochrones.collection,
      barriers: mergeCollections(overpass.collections.barriers ?? featureCollection()),
      development: mergeCollections(
        overpass.collections.developmentHints ?? featureCollection(),
      ),
      sun: mergeCollections(m.overlays.sun),
      contours: contourLines,
      sectionLine: mergeCollections(m.overlays.sectionLine),
      osmRaw: rawOverpassFeatures,
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
      dataSourceRun: createDataSourceRunReport({
        createdAt: computedAt,
        preflightEvents: input.preflightSourceRun,
        sourceFetches,
      }),
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
        "Fresh live/API retrieval is requested for every new selected point; cached Overpass payloads may be used for the exact same query when all live endpoints fail.",
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

function tagFeatures(
  collection: FeatureCollection,
  properties: Record<string, string>,
): FeatureCollection {
  return featureCollection(
    collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        ...properties,
      },
    })),
  );
}

function emitProgress(
  onProgress: ((step: AnalysisLoadStep) => void) | undefined,
  step: AnalysisLoadStep,
): void {
  onProgress?.(step);
}
