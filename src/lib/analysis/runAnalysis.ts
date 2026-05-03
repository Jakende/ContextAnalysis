import type { FeatureCollection } from "geojson";
import { reverseGeocode } from "../api/geocoding";
import { runSourceAdapters } from "../data/sourceAdapters";
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
  const xl = analyzeXl(selectedPoint, computedAt);
  const l = analyzeL(selectedPoint, computedAt, 500, overpass.collections);
  const m = analyzeM(selectedPoint, computedAt, overpass.collections, input.sectionLine);
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

  const allModules = [
    ...xl.modules,
    ...xlSourceStatus.modules,
    ...l.modules,
    ...m.modules,
  ];
  const allIndicators = [
    ...xl.indicators,
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
      xlContext: createXlContextOverlay(selectedPoint),
      xlGrid: createXlGridOverlay(selectedPoint, sourceFetches),
      xlSources: createXlSourceOverlay(selectedPoint, sourceFetches),
      lBuffer: mergeCollections(l.overlays.lBuffer),
      mStreetSegment: mergeCollections(m.overlays.street, m.overlays.corridor),
      green: mergeCollections(l.overlays.green),
      trees: mergeCollections(l.overlays.trees, m.overlays.trees),
      buildings: mergeCollections(m.overlays.buildings),
      pois: mergeCollections(overpass.collections.pois ?? featureCollection()),
      transport: mergeCollections(
        overpass.collections.transportStops ?? featureCollection(),
        overpass.collections.transportLines ?? featureCollection(),
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
