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
  const urbanAtlasRadius = urbanAtlas
    ? featureCollection(
        urbanAtlas.features.filter((feature) =>
          featureTouchesRadius(feature, selectedPoint, radiusMeters),
        ),
      )
    : undefined;
  const urbanAtlasFeatures = urbanAtlasRadius?.features.length ?? 0;
  const landUseRadius = liveLandUse
    ? featureCollection(
        liveLandUse.features.filter((feature) =>
          featureTouchesRadius(feature, selectedPoint, radiusMeters),
        ),
      )
    : undefined;
  const greenBlueRadius = liveGreenBlue
    ? featureCollection(
        liveGreenBlue.features.filter((feature) =>
          featureTouchesRadius(feature, selectedPoint, radiusMeters),
        ),
      )
    : undefined;
  const hasLiveGreenResponse = liveGreenBlue !== undefined;
  const measuredGreenArea = greenBlueRadius ? collectionAreaSqm(greenBlueRadius, isGreenFeature) : 0;
  const greenPercent =
    hasLiveGreenResponse && measuredGreenArea > 0
      ? Math.min(100, Math.round((measuredGreenArea / circleAreaSqm(radiusMeters)) * 10_000) / 100)
      : null;
  const exactTransitStops = liveTransportStops?.features.length;
  const exactTransitLines = liveTransportLines?.features.filter(
    (feature) => feature.geometry.type === "LineString",
  ).length;
  const exactMobilityFeatures = liveMobility?.features.length;
  const exactPois = livePois?.features.length;
  const exactLandUseFeatures = landUseRadius?.features.length;
  const landUseClasses = landUseRadius ? uniqueLandUseClasses(landUseRadius) : [];
  const landUseSummary = summarizeLandUse(landUseRadius, radiusMeters);
  const transitSummary = summarizeTransitStops(liveTransportStops, radiusMeters);
  const landUseMix =
    exactLandUseFeatures === undefined && urbanAtlasFeatures === 0
      ? null
      : Math.min(
          0.95,
          Math.round((0.25 + Math.min(landUseClasses.length || exactLandUseFeatures || 0, 18) / 24) * 100) / 100,
        );
  const transitStops = transitSummary?.uniqueStopCount ?? exactTransitStops ?? null;
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
          ? "Computed from loaded Urban Atlas and/or live Overpass green/blue polygon area intersecting the configured radius."
          : "Live green/blue source did not return a usable response and no local preprocessed polygons are loaded.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: hasLiveGreenResponse ? "medium" : "low",
      caveats: [
        caveat,
        greenPercent !== null
          ? urbanAtlasCaveat
          : "No synthetic green percentage is emitted without real polygon area.",
        ...(greenPercent !== null
          ? [
              "Polygon areas are approximated from intersecting source polygons and capped at 100%; exact clipping to the circular buffer is a later geometry-processing refinement.",
            ]
          : []),
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
      id: "l.land-use-dominant",
      label: "Dominant land-use family",
      scale: "L",
      value: landUseSummary?.dominantFamily ?? null,
      unit: landUseSummary ? `${landUseSummary.dominantSharePercent}%` : undefined,
      method:
        landUseSummary !== null
          ? "Grouped loaded Urban Atlas and OSM polygon classes into analytical land-use families and ranked them by approximate polygon area inside the L-scale context."
          : "No polygonal land-use source returned usable classes for this point.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: urbanAtlasFeatures > 0 ? "high" : exactLandUseFeatures !== undefined ? "medium" : "low",
      caveats: [
        landUseSummary !== null ? urbanAtlasCaveat : fallbackCaveat,
        "Families are analytical classes derived from source labels/codes, not official zoning categories.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.land-use-family-share",
      label: "Land-use family shares",
      scale: "L",
      value: landUseSummary ? formatFamilyShares(landUseSummary.familyShares) : null,
      unit: "%",
      method:
        landUseSummary !== null
          ? "Computed approximate area shares for built, green/blue, transport, industrial, social/open, and underused land-use families."
          : "No polygonal land-use source returned usable classes for this point.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: urbanAtlasFeatures > 0 ? "high" : exactLandUseFeatures !== undefined ? "medium" : "low",
      caveats: [
        landUseSummary !== null ? urbanAtlasCaveat : fallbackCaveat,
        "Shares are approximate because MVP geometry uses intersecting polygons, not exact clipped overlay areas.",
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
          ? "Counted unique GTFS and live Overpass stop/platform/station points inside the radius, de-duplicated by rounded coordinate and name where possible."
          : "Live transport stop retrieval was unavailable; no fallback count is emitted.",
      sourceIds: ["osm-core", "mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass"],
      confidence: liveTransportStops ? "high" : "low",
      caveats: [
        exactTransitStops !== undefined
          ? "GTFS stop points are preferred where preprocessed; OSM stop points may still duplicate station/platform concepts."
          : fallbackCaveat,
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.transit-stop-density",
      label: "Transit stop density",
      scale: "L",
      value: transitSummary?.stopDensityPerSqkm ?? null,
      unit: "stops/km²",
      method:
        transitSummary !== null
          ? "Computed from unique GTFS/OSM stop count divided by the configured L-scale buffer area."
          : "No stop collection was available for density calculation.",
      sourceIds: ["mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass", "osm-core"],
      confidence: liveTransportStops ? "high" : "low",
      caveats: [
        transitSummary !== null
          ? "Density reflects stop/platform availability, not service frequency or timetable quality."
          : fallbackCaveat,
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.transit-mode-mix",
      label: "Transit mode mix",
      scale: "L",
      value: transitSummary ? formatModeMix(transitSummary.modeCounts) : null,
      method:
        transitSummary !== null
          ? "Grouped GTFS and OSM stop features by available transportMode tags."
          : "No stop collection was available for mode-mix calculation.",
      sourceIds: ["mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass", "osm-core"],
      confidence: liveTransportStops ? "medium" : "low",
      caveats: [
        transitSummary !== null
          ? "GTFS stop mode is provider-derived when available; generic stops remain classified as transit."
          : fallbackCaveat,
      ],
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
          ? "Loaded live Overpass route relations for bus/tram/subway/light-rail/train plus physical rail, busway, bus-lane, and platform geometries inside the L-scale context; geometries are grouped by transport mode for map rendering."
          : "Live public-transport line retrieval was unavailable.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactTransitLines !== undefined ? "medium" : "low",
      caveats: [
        exactTransitLines !== undefined ? liveCaveat : fallbackCaveat,
        "Displayed line geometry is taken from live Overpass/OSM corridor and route data; GTFS remains in use for stop access and mode availability, not for drawn line connections.",
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
      indicators: indicators.slice(0, 5),
      method: "Radius buffer with explicit green/open-space class mapping.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      computedAt,
      confidence: urbanAtlasFeatures > 0 ? "high" : "low",
      caveats: [caveat, urbanAtlasCaveat],
    },
    {
      id: "l.access-infrastructure",
      title: "Access and infrastructure",
      scale: "L",
      indicators: indicators.slice(5, 11),
      method: "Counts and class hints within the selected walkable radius.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs", "gtfs-de-local-transit"],
      computedAt,
      confidence: liveTransportStops ? "medium" : "low",
      caveats: [
        liveTransportStops
          ? "GTFS/OSM stop data were loaded for this point; service frequency is not yet evaluated."
          : caveat,
      ],
    },
    {
      id: "l.potential",
      title: "Development hints",
      scale: "L",
      indicators: [indicators[11]],
      method: "Screening rules from open-data class hints.",
      sourceIds: ["osm-core", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      computedAt,
      confidence: "low",
      caveats: indicators[11].caveats,
    },
  ];

  if (greenBlueRadius) {
    overlays.green = featureCollection(
      greenBlueRadius.features.filter((feature) => isGreenFeature(feature) && !isBlueFeature(feature)),
    );
    overlays.blue = featureCollection(greenBlueRadius.features.filter(isBlueFeature));
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
    blue: featureCollection(),
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

type LandUseSummary = {
  dominantFamily: string;
  dominantSharePercent: number;
  familyShares: Array<{ family: string; percent: number; areaSqm: number }>;
};

type TransitSummary = {
  uniqueStopCount: number;
  stopDensityPerSqkm: number;
  modeCounts: Array<{ mode: string; count: number }>;
};

function summarizeLandUse(
  collection: FeatureCollection | undefined,
  radiusMeters: number,
): LandUseSummary | null {
  if (!collection?.features.length) return null;
  const areaByFamily = new Map<string, number>();
  for (const feature of collection.features) {
    const area = featureAreaSqm(feature);
    if (area <= 0) continue;
    const family = classifyLandUseFamily(feature);
    areaByFamily.set(family, (areaByFamily.get(family) ?? 0) + area);
  }
  const totalArea = [...areaByFamily.values()].reduce((total, area) => total + area, 0);
  if (totalArea <= 0) return null;
  const contextArea = circleAreaSqm(radiusMeters);
  const familyShares = [...areaByFamily.entries()]
    .map(([family, areaSqm]) => ({
      family,
      areaSqm,
      percent: Math.min(100, Math.round((areaSqm / contextArea) * 10_000) / 100),
    }))
    .sort((left, right) => right.areaSqm - left.areaSqm);
  const dominant = familyShares[0];
  return {
    dominantFamily: dominant.family,
    dominantSharePercent: dominant.percent,
    familyShares,
  };
}

function summarizeTransitStops(
  collection: FeatureCollection | undefined,
  radiusMeters: number,
): TransitSummary | null {
  if (!collection?.features.length) return null;
  const uniqueStops = new Map<string, { mode: string }>();
  for (const feature of collection.features) {
    if (feature.geometry.type !== "Point") continue;
    const coordinates = feature.geometry.coordinates;
    const label = String(
      feature.properties?.stop_name ??
        feature.properties?.name ??
        feature.properties?.label ??
        "",
    )
      .toLowerCase()
      .trim();
    const key = [
      coordinates[0].toFixed(5),
      coordinates[1].toFixed(5),
      label.slice(0, 48),
    ].join(":");
    uniqueStops.set(key, { mode: normalizeTransitMode(feature) });
  }
  const modeMap = new Map<string, number>();
  for (const stop of uniqueStops.values()) {
    modeMap.set(stop.mode, (modeMap.get(stop.mode) ?? 0) + 1);
  }
  const contextAreaSqkm = circleAreaSqm(radiusMeters) / 1_000_000;
  return {
    uniqueStopCount: uniqueStops.size,
    stopDensityPerSqkm:
      Math.round((uniqueStops.size / Math.max(0.0001, contextAreaSqkm)) * 10) / 10,
    modeCounts: [...modeMap.entries()]
      .map(([mode, count]) => ({ mode, count }))
      .sort((left, right) => right.count - left.count || left.mode.localeCompare(right.mode)),
  };
}

function formatFamilyShares(
  shares: Array<{ family: string; percent: number }>,
): string {
  return shares
    .slice(0, 5)
    .map((share) => `${share.family}: ${share.percent}`)
    .join(" / ");
}

function formatModeMix(modeCounts: Array<{ mode: string; count: number }>): string {
  if (!modeCounts.length) return "not available";
  return modeCounts.map((item) => `${item.mode}: ${item.count}`).join(" / ");
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

function readCodeValue(feature: Feature): string {
  const value =
    feature.properties?.code_2021 ??
    feature.properties?.code_2018 ??
    feature.properties?.code ??
    feature.properties?.class_code;
  return value === undefined || value === null ? "" : String(value).toLowerCase();
}

function classifyLandUseFamily(feature: Feature): string {
  const code = readCodeValue(feature);
  const label = readClassValue(feature) ?? "";
  if (
    code.startsWith("14") ||
    code.startsWith("2") ||
    code.startsWith("3") ||
    code.startsWith("5") ||
    /green|forest|wood|water|wetland|agricultur|pasture|meadow|grass|allotment|park|garden/.test(label)
  ) {
    return "green/blue";
  }
  if (
    code.startsWith("122") ||
    /road|rail|port|airport|transport|parking|bus|tram|subway/.test(label)
  ) {
    return "transport";
  }
  if (
    code.startsWith("121") ||
    /industrial|commercial|public|military|private units|retail|office/.test(label)
  ) {
    return "industrial/service";
  }
  if (
    code.startsWith("134") ||
    /without current use|construction|brownfield|vacant|dump|disused|abandoned/.test(label)
  ) {
    return "underused";
  }
  if (/sport|leisure|cemetery|school|university|hospital|civic|social/.test(label)) {
    return "social/open";
  }
  if (
    code.startsWith("111") ||
    code.startsWith("112") ||
    code.startsWith("113") ||
    /urban fabric|residential|building|built/.test(label)
  ) {
    return "built/residential";
  }
  return "other";
}

function normalizeTransitMode(feature: Feature): string {
  const mode = String(feature.properties?.transportMode ?? "").toLowerCase();
  if (mode) return mode;
  const railway = String(feature.properties?.railway ?? "").toLowerCase();
  const route = String(feature.properties?.route ?? "").toLowerCase();
  const highway = String(feature.properties?.highway ?? "").toLowerCase();
  if (route === "tram" || railway === "tram_stop" || railway === "tram") return "tram";
  if (route === "subway" || railway === "subway") return "subway";
  if (route === "train" || railway === "station" || railway === "halt" || railway === "rail") {
    return "rail";
  }
  if (route === "bus" || highway === "bus_stop") return "bus";
  return "transit";
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
      classValue.includes("green") ||
      classValue.includes("forest")
    );
  }
  return true;
}

function isBlueFeature(feature: Feature): boolean {
  const sourceId = String(feature.properties?.sourceId ?? "");
  const natural = String(feature.properties?.natural ?? "").toLowerCase();
  const water = String(feature.properties?.water ?? "").toLowerCase();
  const waterway = String(feature.properties?.waterway ?? "").toLowerCase();
  const classValue = readClassValue(feature) ?? "";
  if (sourceId === "copernicus-urban-atlas") {
    return (
      classValue.startsWith("5") ||
      classValue.includes("water") ||
      classValue.includes("wetland")
    );
  }
  return natural === "water" || natural === "wetland" || Boolean(water) || Boolean(waterway);
}

function featureTouchesRadius(
  feature: Feature,
  selectedPoint: SelectedPoint,
  radiusMeters: number,
): boolean {
  if (feature.geometry.type === "Point") {
    return (
      distanceBetweenCoordinates(
        [selectedPoint.lon, selectedPoint.lat],
        feature.geometry.coordinates,
      ) <= radiusMeters
    );
  }
  const bbox = featureBbox(feature);
  if (!bbox) return false;
  return bboxDistanceToPointMeters(bbox, [selectedPoint.lon, selectedPoint.lat]) <= radiusMeters;
}

function featureBbox(feature: Feature): [number, number, number, number] | null {
  const coords: number[][] = [];
  collectGeometryCoordinates(feature.geometry, coords);
  if (!coords.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of coords) {
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  return [west, south, east, north];
}

function collectGeometryCoordinates(
  geometry: Feature["geometry"],
  coords: number[][],
): void {
  if (geometry.type === "Point") coords.push(geometry.coordinates);
  if (geometry.type === "LineString") coords.push(...geometry.coordinates);
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) coords.push(...ring);
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) coords.push(...ring);
    }
  }
}

function bboxDistanceToPointMeters(
  bbox: [number, number, number, number],
  point: number[],
): number {
  const clampedLon = Math.max(bbox[0], Math.min(point[0], bbox[2]));
  const clampedLat = Math.max(bbox[1], Math.min(point[1], bbox[3]));
  return distanceBetweenCoordinates(point, [clampedLon, clampedLat]);
}

function distanceBetweenCoordinates(left: number[], right: number[]): number {
  const referenceLat = (left[1] + right[1]) / 2;
  const leftMeters = projectMeters(left, referenceLat);
  const rightMeters = projectMeters(right, referenceLat);
  return Math.hypot(leftMeters.x - rightMeters.x, leftMeters.y - rightMeters.y);
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
