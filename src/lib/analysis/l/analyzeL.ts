import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { FactSheetModule, Indicator, SelectedPoint } from "../../types";
import {
  bufferPolygon,
  featureCollection,
  geometryToFeature,
} from "../geometry";
import { createIndicator } from "../indicators/createIndicator";

export function analyzeL(
  selectedPoint: SelectedPoint,
  computedAt: string,
  radiusMeters = 500,
  liveCollections: Record<string, FeatureCollection | undefined> = {},
): { modules: FactSheetModule[]; indicators: Indicator[]; overlays: ReturnType<typeof createLOverlays> } {
  const overlays = createLOverlays(selectedPoint, radiusMeters);
  const liveGreenBlue = liveCollections.greenBlue;
  const liveTransportStops = liveCollections.transportStops;
  const liveTransportLines = liveCollections.transportLines;
  const liveMobility = liveCollections.mobilityInfrastructure;
  const livePois = liveCollections.pois;
  const liveDevelopment = liveCollections.developmentHints;
  const liveLandUse = liveCollections.landUse;
  const liveTrees = liveCollections.trees;
  const urbanAtlas = liveCollections.urbanAtlas;
  const urbanAtlasFeatures = urbanAtlas?.features.length ?? 0;
  const hasLiveGreenResponse = liveGreenBlue !== undefined;
  const measuredGreenArea = liveGreenBlue ? collectionAreaSqm(liveGreenBlue, isGreenFeature) : 0;
  const greenPercent =
    hasLiveGreenResponse && measuredGreenArea > 0
      ? Math.round((measuredGreenArea / circleAreaSqm(radiusMeters)) * 10_000) / 100
      : null;
  const exactTransitStops = liveTransportStops?.features.length;
  const exactTransitLines = liveTransportLines?.features.filter(
    (feature) => feature.geometry.type === "LineString",
  ).length;
  const exactMobilityFeatures = liveMobility?.features.length;
  const exactPois = livePois?.features.length;
  const exactLandUseFeatures = liveLandUse?.features.length;
  const landUseClasses = liveLandUse ? uniqueLandUseClasses(liveLandUse) : [];
  const landUseMix =
    exactLandUseFeatures === undefined && urbanAtlasFeatures === 0
      ? null
      : Math.min(
          0.95,
          Math.round((0.25 + Math.min(landUseClasses.length || exactLandUseFeatures || 0, 18) / 24) * 100) / 100,
        );
  const transitStops = exactTransitStops ?? null;
  const mobilityHints = exactMobilityFeatures ?? null;
  const infrastructurePois = exactPois ?? null;
  const liveCaveat =
    "Live OSM/Overpass data were queried for this point; completeness depends on OSM tagging.";
  const fallbackCaveat =
    "No live OSM result was available for this module and no local preprocessed dataset is loaded; value is not available.";
  const caveat = hasLiveGreenResponse ? liveCaveat : fallbackCaveat;
  const urbanAtlasCaveat =
    urbanAtlasFeatures > 0
      ? "Preprocessed Copernicus Urban Atlas polygons were loaded for this point and used before OSM-only fallback classes."
      : "No local Copernicus Urban Atlas polygon was available for this point.";

  const indicators = [
    createIndicator({
      id: "l.radius",
      label: "Analysis radius",
      scale: "L",
      value: radiusMeters,
      unit: "m",
      geometry: overlays.lBuffer.features[0]?.geometry,
      method: "Geometric buffer around selected point.",
      sourceIds: ["osm-core"],
      confidence: "medium",
      caveats: [
        "MVP uses a geometric buffer. Network catchments are a later preprocessing enhancement.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.green-percentage",
      label: "Green percentage",
      scale: "L",
      value: greenPercent,
      unit: "%",
      geometry:
        liveGreenBlue?.features.find((feature) => feature.geometry.type === "Polygon")
          ?.geometry ?? overlays.green.features[0]?.geometry,
      method:
        greenPercent !== null
          ? "Computed from loaded Urban Atlas and/or live Overpass green/blue polygon area inside the configured radius."
          : "Live green/blue source did not return a usable response and no local preprocessed polygons are loaded.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: hasLiveGreenResponse ? "medium" : "low",
      caveats: [
        caveat,
        greenPercent !== null
          ? urbanAtlasCaveat
          : "No synthetic green percentage is emitted without real polygon area.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.land-use-mix",
      label: "Land-use mix index",
      scale: "L",
      value: landUseMix,
      unit: "0-1",
      method:
        exactLandUseFeatures !== undefined || urbanAtlasFeatures > 0
          ? "Computed as a class-diversity proxy from loaded Urban Atlas polygons and live OSM landuse/leisure/amenity polygons."
          : "Live land-use source did not return a usable response and no local Urban Atlas preprocessing is loaded.",
      sourceIds: ["osm-core", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: urbanAtlasFeatures > 0 ? "high" : exactLandUseFeatures !== undefined ? "medium" : "low",
      caveats: [
        exactLandUseFeatures !== undefined || urbanAtlasFeatures > 0
          ? urbanAtlasCaveat
          : fallbackCaveat,
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.transit-stops",
      label: "Public transport stops",
      scale: "L",
      value: transitStops,
      unit: "within radius",
      method:
        exactTransitStops !== undefined
          ? "Counted live Overpass public_transport, bus_stop, railway station/halt/tram_stop features inside the radius."
          : "Live transport stop retrieval was unavailable; no fallback count is emitted.",
      sourceIds: ["osm-core", "mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass"],
      confidence: exactTransitStops !== undefined ? "medium" : "low",
      caveats: [exactTransitStops !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.transit-lines",
      label: "Public transport lines",
      scale: "L",
      value: exactTransitLines ?? null,
      unit: "line geometries",
      geometry: liveTransportLines?.features.find(
        (feature) => feature.geometry.type === "LineString",
      )?.geometry,
      method:
        exactTransitLines !== undefined
          ? "Loaded live Overpass public-transport route relations and rail/tram line ways within the L-scale context; geometries are grouped by transport mode for map rendering."
          : "Live public-transport line retrieval was unavailable.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs", "gtfs-de-local-transit"],
      confidence: exactTransitLines !== undefined ? "medium" : "low",
      caveats: [
        exactTransitLines !== undefined ? liveCaveat : fallbackCaveat,
        "OSM route relation completeness varies; GTFS/Mobilithek preprocessing remains the authoritative next step for services and frequencies.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.mobility-infrastructure",
      label: "Mobility infrastructure hints",
      scale: "L",
      value: mobilityHints,
      unit: exactMobilityFeatures !== undefined ? "features" : undefined,
      method:
        exactMobilityFeatures !== undefined
          ? "Counted live Overpass mobility infrastructure features for cycleways, parking, charging, sharing, and pedestrian/cycle classes."
          : "Live mobility infrastructure retrieval was unavailable; no fallback class count is emitted.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactMobilityFeatures !== undefined ? "medium" : "low",
      caveats: [exactMobilityFeatures !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.social-civic-pois",
      label: "Social/civic POIs",
      scale: "L",
      value: infrastructurePois,
      unit: "features",
      method:
        exactPois !== undefined
          ? "Counted live Overpass amenity/shop POIs relevant to social and civic infrastructure inside the radius."
          : "Live POI retrieval was unavailable; no fallback POI count is emitted.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactPois !== undefined ? "medium" : "low",
      caveats: [exactPois !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.development-potential",
      label: "Development potential hints",
      scale: "L",
      value:
        (liveDevelopment?.features.length ?? 0) > 0
          ? `${liveDevelopment?.features.length} live OSM potential hints`
          : liveDevelopment
            ? "no live OSM development hints"
            : null,
      method:
        liveDevelopment?.features.length
          ? "Read live Overpass brownfield, construction, parking, disused, abandoned and related development-hint classes."
          : "Live development-hint source did not return a usable response and no local preprocessing is loaded.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: liveDevelopment ? "medium" : "low",
      caveats: [
        liveDevelopment ? liveCaveat : caveat,
        "This is a screening hint, not a planning-law assessment.",
      ],
      computedAt,
    }),
  ];

  const modules: FactSheetModule[] = [
    {
      id: "l.land-use-green",
      title: "Land use and green/blue",
      scale: "L",
      indicators: indicators.slice(0, 3),
      method: "Radius buffer with explicit green/open-space class mapping.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      computedAt,
      confidence: "low",
      caveats: [caveat],
    },
    {
      id: "l.access-infrastructure",
      title: "Access and infrastructure",
      scale: "L",
      indicators: indicators.slice(3, 7),
      method: "Counts and class hints within the selected walkable radius.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs", "gtfs-de-local-transit"],
      computedAt,
      confidence: "low",
      caveats: [caveat],
    },
    {
      id: "l.potential",
      title: "Development hints",
      scale: "L",
      indicators: [indicators[7]],
      method: "Screening rules from open-data class hints.",
      sourceIds: ["osm-core", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      computedAt,
      confidence: "low",
      caveats: indicators[7].caveats,
    },
  ];

  if (liveGreenBlue) {
    overlays.green = featureCollection(liveGreenBlue.features.filter(isGreenFeature));
  }
  if (liveTrees) {
    overlays.trees = liveTrees;
  }

  return { modules, indicators, overlays };
}

function createLOverlays(
  selectedPoint: SelectedPoint,
  radiusMeters: number,
) {
  const { lat, lon } = selectedPoint;
  const lBuffer = featureCollection([
    geometryToFeature(bufferPolygon(lat, lon, radiusMeters), {
      id: "l-buffer",
      radiusMeters,
    }),
  ]);

  return {
    lBuffer,
    green: featureCollection(),
    trees: featureCollection(),
  };
}

function circleAreaSqm(radiusMeters: number): number {
  return Math.PI * radiusMeters * radiusMeters;
}

function collectionAreaSqm(
  collection: FeatureCollection,
  filterFeature: (feature: Feature) => boolean = () => true,
): number {
  return collection.features.reduce(
    (total, feature) => total + (filterFeature(feature) ? featureAreaSqm(feature) : 0),
    0,
  );
}

function featureAreaSqm(feature: Feature): number {
  if (feature.geometry.type === "Polygon") {
    return polygonAreaSqm(feature.geometry);
  }
  if (feature.geometry.type === "MultiPolygon") {
    return multiPolygonAreaSqm(feature.geometry);
  }
  return 0;
}

function multiPolygonAreaSqm(geometry: MultiPolygon): number {
  return geometry.coordinates.reduce(
    (total, polygonCoordinates) =>
      total + polygonAreaSqm({ type: "Polygon", coordinates: polygonCoordinates }),
    0,
  );
}

function polygonAreaSqm(geometry: Polygon): number {
  const outerArea = ringAreaSqm(geometry.coordinates[0] ?? []);
  const holesArea = geometry.coordinates
    .slice(1)
    .reduce((total, ring) => total + ringAreaSqm(ring), 0);
  return Math.max(0, outerArea - holesArea);
}

function uniqueLandUseClasses(collection: FeatureCollection): string[] {
  const classes = collection.features
    .map((feature) => readClassValue(feature))
    .filter((value): value is string => Boolean(value));
  return [...new Set(classes)];
}

function readClassValue(feature: Feature): string | null {
  const value =
    feature.properties?.urbanAtlasClass ??
    feature.properties?.label ??
    feature.properties?.landuse ??
    feature.properties?.leisure ??
    feature.properties?.natural ??
    feature.properties?.amenity ??
    feature.properties?.class ??
    feature.properties?.code;
  return value === undefined || value === null ? null : String(value).toLowerCase();
}

function isGreenFeature(feature: Feature): boolean {
  const sourceId = String(feature.properties?.sourceId ?? "");
  const classValue = readClassValue(feature) ?? "";
  if (sourceId === "copernicus-urban-atlas") {
    return (
      classValue.startsWith("141") ||
      classValue.startsWith("142") ||
      classValue.startsWith("2") ||
      classValue.startsWith("3") ||
      classValue.startsWith("5") ||
      classValue.includes("green") ||
      classValue.includes("forest") ||
      classValue.includes("water")
    );
  }
  return true;
}

function ringAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const referenceLat =
    ring.reduce((total, coordinate) => total + coordinate[1], 0) / ring.length;
  const projected = ring.map((coordinate) => projectMeters(coordinate, referenceLat));
  let area = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    area +=
      projected[index].x * projected[index + 1].y -
      projected[index + 1].x * projected[index].y;
  }
  return Math.abs(area) / 2;
}

function projectMeters(coordinate: number[], referenceLat: number) {
  const latRadians = (referenceLat * Math.PI) / 180;
  return {
    x: coordinate[0] * 111_320 * Math.cos(latRadians),
    y: coordinate[1] * 111_320,
  };
}
