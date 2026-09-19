import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { Confidence, FactSheetModule, Indicator, SelectedPoint } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

type MobilityMode = "walking" | "cycling" | "transit" | "driving";

type MobilityScaleConfig = {
  mode: MobilityMode;
  label: string;
  indicatorLabel: string;
  timeMinutes: number;
  sourceScale: "M/L" | "L" | "XL/L";
  poiTarget: number;
  stopTarget: number;
  aggregateWeight: number;
  isochroneMode?: "walking" | "cycling" | "driving";
};

type ModeSummary = {
  config: MobilityScaleConfig;
  score: number | null;
  reachablePoiCount: number | null;
  poiCategoryCount: number;
  stopCount: number;
  stopDensityPerSqkm: number;
  nearestPoi: NearestFeature | null;
  nearestStop: NearestFeature | null;
  isochronePoiCount: number | null;
  infrastructureScore: number;
  caveats: string[];
};

type NearestFeature = {
  label: string;
  category: string;
  distanceMeters: number;
};

export const MOBILITY_ANALYSIS_RADIUS_METERS = 1_500;

const MODE_CONFIGS: MobilityScaleConfig[] = [
  {
    mode: "walking",
    label: "Walking",
    indicatorLabel: "Walking KPI",
    timeMinutes: 10,
    sourceScale: "M/L",
    poiTarget: 10,
    stopTarget: 4,
    aggregateWeight: 0.35,
    isochroneMode: "walking",
  },
  {
    mode: "cycling",
    label: "Cycling",
    indicatorLabel: "Cycling KPI",
    timeMinutes: 10,
    sourceScale: "L",
    poiTarget: 24,
    stopTarget: 8,
    aggregateWeight: 0.25,
    isochroneMode: "cycling",
  },
  {
    mode: "transit",
    label: "Transit",
    indicatorLabel: "Transit KPI",
    timeMinutes: 10,
    sourceScale: "L",
    poiTarget: 12,
    stopTarget: 8,
    aggregateWeight: 0.25,
  },
  {
    mode: "driving",
    label: "Car driving",
    indicatorLabel: "Car-driving KPI",
    timeMinutes: 15,
    sourceScale: "XL/L",
    poiTarget: 36,
    stopTarget: 0,
    aggregateWeight: 0,
    isochroneMode: "driving",
  },
];

export function analyzeMobilityScales(input: {
  selectedPoint: SelectedPoint;
  computedAt: string;
  evidenceRadiusMeters?: number;
  evidenceAreaSqkm?: number;
  pois?: FeatureCollection;
  transportStops?: FeatureCollection;
  mobilityInfrastructure?: FeatureCollection;
  isochrones?: FeatureCollection;
}): {
  indicators: Indicator[];
  module: FactSheetModule;
  bufferFeatures: Feature<Polygon>[];
  combinedScore: number | null;
  summaries: ModeSummary[];
} {
  const summaries = MODE_CONFIGS.map((config) => summarizeMode(config, input));
  const qualitySummaries = summaries.filter(
    (summary) => summary.score !== null && summary.config.aggregateWeight > 0,
  );
  const combinedScore = qualitySummaries.length
    ? weightedModeScore(qualitySummaries)
    : null;
  const sharedCaveats = [
    "Reachability scoring uses routed OpenRouteService isochrone polygons where configured and available; geometric mode radii are not used as reachability evidence.",
    "If a routed isochrone is unavailable for a mode, that mode is scored only from direct source evidence such as nearest features, transit stops, and infrastructure hints, with low-confidence caveats.",
    "Bike/car POI reachability is limited by the currently loaded POI source coverage unless a local POI extract is preprocessed.",
    "GTFS stop density counts preprocessed stop points and does not yet include timetable frequency or service span.",
    "Car-driving reachability is retained as comparison context but has zero weight in the multimodal urban-quality score.",
  ];
  const indicators = [
    ...summaries.map((summary) =>
      createIndicator({
        id: `l.${summary.config.mode}-reachability-score`,
        label: summary.config.indicatorLabel,
        scale: "L",
        value: summary.score,
        unit: "0-100",
        method:
          `${summary.config.indicatorLabel} prioritizes POIs inside the ${summary.config.timeMinutes}-minute routed isochrone where available, plus nearest important POI distance, mode-relevant infrastructure hints, and GTFS/OSM stop access where relevant.`,
        sourceIds: sourceIdsForMode(summary.config.mode),
        confidence: confidenceForMode(summary),
        caveats: [
          ...summary.caveats,
          modeDetail(summary),
        ],
        computedAt: input.computedAt,
      }),
    ),
    createIndicator({
      id: "l.multimodal-reachability-score",
      label: "Multimodal reachability",
      scale: "L",
      value: combinedScore,
      unit: "0-100",
      method:
        "Weighted aggregation of urban-quality mode KPIs: walking 41.2%, cycling 29.4%, and transit 29.4% after normalizing their 35:25:25 weights. Car-driving is reported separately with zero composite weight. Each active mode uses routed isochrones where available and direct source evidence where no routed catchment exists.",
      sourceIds: ["osm-core", "osm-overpass", "gtfs-de-local-transit", "mobilithek-gtfs", "openrouteservice-isochrones"],
      confidence: qualitySummaries.length >= 3 ? "medium" : "low",
      caveats: [
        ...sharedCaveats,
        qualitySummaries.length
          ? `Available contributing mode scores: ${qualitySummaries
              .map((summary) => `${summary.config.label.toLowerCase()} ${summary.score}`)
              .join(" / ")}.`
          : "No mode had enough loaded POI, stop, infrastructure, or isochrone evidence to score.",
      ],
      computedAt: input.computedAt,
    }),
    createIndicator({
      id: "l.nearest-gtfs-stop-distance",
      label: "Nearest transit stop",
      scale: "L",
      value: nearestStopDistance(summaries),
      unit: "m",
      method:
        "Calculated straight-line distance from the selected point to the nearest loaded GTFS/OSM transit stop point.",
      sourceIds: ["gtfs-de-local-transit", "mobilithek-gtfs", "osm-overpass", "osm-core"],
      confidence: input.transportStops?.features.length ? "high" : "low",
      caveats: [
        nearestStopDistance(summaries) !== null
          ? "Distance uses loaded stop geometry; timetable and platform access quality are not yet evaluated."
          : "No transit stop point was loaded close enough to calculate a nearest-stop distance.",
      ],
      computedAt: input.computedAt,
    }),
  ];

  return {
    indicators,
    module: {
      id: "l.mobility-scales",
      title: "Mobility reachability",
      scale: "L",
      indicators,
      method:
        "Mode-aware reachability model with one explicit KPI each for walking, cycling, transit, and car driving. The urban-quality aggregate uses walking, cycling, and transit only; driving remains context.",
      sourceIds: ["osm-core", "osm-overpass", "gtfs-de-local-transit", "mobilithek-gtfs", "openrouteservice-isochrones"],
      computedAt: input.computedAt,
      confidence: qualitySummaries.length >= 3 ? "medium" : "low",
      caveats: sharedCaveats,
    },
    bufferFeatures: [],
    combinedScore,
    summaries,
  };
}

function summarizeMode(
  config: MobilityScaleConfig,
  input: {
    selectedPoint: SelectedPoint;
    evidenceRadiusMeters?: number;
    evidenceAreaSqkm?: number;
    pois?: FeatureCollection;
    transportStops?: FeatureCollection;
    mobilityInfrastructure?: FeatureCollection;
    isochrones?: FeatureCollection;
  },
): ModeSummary {
  const poiFeatures = input.pois?.features ?? [];
  const stopFeatures = input.transportStops?.features ?? [];
  const evidenceRadiusMeters = input.evidenceRadiusMeters ?? MOBILITY_ANALYSIS_RADIUS_METERS;
  const evidenceAreaSqkm =
    input.evidenceAreaSqkm ?? circleAreaSqkm(evidenceRadiusMeters);
  const nearestPoi = nearestFeature(input.selectedPoint, poiFeatures, "poi");
  const nearestStop = nearestFeature(input.selectedPoint, stopFeatures, "stop");
  const isochroneReachability = config.isochroneMode
    ? isochronePoiReachability(input.pois, input.isochrones, config.isochroneMode, config.timeMinutes)
    : null;
  const isochronePoiCount = isochroneReachability?.count ?? null;
  const infrastructureScore = scoreInfrastructure(config.mode, input.mobilityInfrastructure);
  const stopDensityPerSqkm =
    Math.round((stopFeatures.length / Math.max(0.0001, evidenceAreaSqkm)) * 10) / 10;
  const isochronePoiScore = Math.min(
    100,
    isochroneReachability
      ? Math.round((isochroneReachability.count / Math.max(1, config.poiTarget)) * 75) +
          Math.round((isochroneReachability.categoryCount / 6) * 25)
      : 0,
  );
  const nearestPoiScore = nearestPoi
    ? scoreDistance(nearestPoi.distanceMeters, evidenceRadiusMeters)
    : 0;
  const stopScore =
    config.mode === "driving"
      ? 0
      : Math.min(
          100,
          Math.round((stopFeatures.length / Math.max(1, config.stopTarget)) * 65) +
            (nearestStop ? Math.round(scoreDistance(nearestStop.distanceMeters, evidenceRadiusMeters) * 0.35) : 0),
        );
  const hasDirectEvidence = config.mode === "transit"
    ? stopFeatures.length > 0 || infrastructureScore > 0
    : isochroneReachability !== null ||
      nearestPoi !== null ||
      (config.mode !== "driving" && stopFeatures.length > 0) ||
      infrastructureScore > 0;
  const score = hasDirectEvidence
    ? scoreMode(config.mode, {
        isochronePoiScore,
        nearestPoiScore,
        stopScore,
        infrastructureScore,
      })
    : null;
  const caveats = [
    poiFeatures.length
      ? isochronePoiCount === null
        ? `No routed ${config.label.toLowerCase()} catchment was available, so loaded POIs were not counted as reachable for this mode.`
        : `${isochronePoiCount} loaded POI point(s) or polygons intersect the ${config.timeMinutes}-minute ${config.label.toLowerCase()} isochrone.`
      : "No loaded POI features were available for this mode.",
    stopFeatures.length
      ? `${stopFeatures.length} loaded GTFS/OSM stop point(s) were available inside the configured analysis context.`
      : "No GTFS/OSM stop points were available for this mode.",
    ...(config.isochroneMode && isochronePoiCount === null
      ? [`No routed ${config.label.toLowerCase()} ${config.timeMinutes}-minute isochrone polygon was available; geometric fallbacks do not count as routed evidence.`]
      : []),
  ];

  return {
    config,
    score,
    reachablePoiCount: isochronePoiCount,
    poiCategoryCount: isochroneReachability?.categoryCount ?? 0,
    stopCount: stopFeatures.length,
    stopDensityPerSqkm,
    nearestPoi,
    nearestStop,
    isochronePoiCount,
    infrastructureScore,
    caveats,
  };
}

function weightedModeScore(summaries: ModeSummary[]): number {
  const totalWeight = summaries.reduce((total, summary) => total + summary.config.aggregateWeight, 0);
  if (totalWeight <= 0) return 0;
  return Math.round(
    summaries.reduce(
      (total, summary) => total + (summary.score ?? 0) * summary.config.aggregateWeight,
      0,
    ) / totalWeight,
  );
}

function scoreMode(
  mode: MobilityMode,
  scores: {
    isochronePoiScore: number;
    nearestPoiScore: number;
    stopScore: number;
    infrastructureScore: number;
  },
): number {
  if (mode === "walking") {
    return Math.round(
      scores.isochronePoiScore * 0.55 +
        scores.nearestPoiScore * 0.2 +
        scores.stopScore * 0.1 +
        scores.infrastructureScore * 0.15,
    );
  }
  if (mode === "cycling") {
    return Math.round(
      scores.isochronePoiScore * 0.55 +
        scores.nearestPoiScore * 0.15 +
        scores.stopScore * 0.08 +
        scores.infrastructureScore * 0.22,
    );
  }
  if (mode === "transit") {
    return Math.round(
      scores.stopScore * 0.65 +
        scores.isochronePoiScore * 0.15 +
        scores.nearestPoiScore * 0.05 +
        scores.infrastructureScore * 0.15,
    );
  }
  return Math.round(
    scores.isochronePoiScore * 0.7 +
      scores.nearestPoiScore * 0.2 +
      scores.infrastructureScore * 0.1,
  );
}

function sourceIdsForMode(mode: MobilityMode): string[] {
  if (mode === "transit") {
    return ["gtfs-de-local-transit", "mobilithek-gtfs", "osm-overpass", "osm-core"];
  }
  if (mode === "driving") {
    return ["openrouteservice-isochrones", "osm-core", "osm-overpass"];
  }
  return ["openrouteservice-isochrones", "osm-core", "osm-overpass", "gtfs-de-local-transit", "mobilithek-gtfs"];
}

function confidenceForMode(summary: ModeSummary): Confidence {
  const hasCoreEvidence =
    (summary.reachablePoiCount ?? 0) > 0 ||
    summary.stopCount > 0 ||
    summary.infrastructureScore > 0;
  if (!hasCoreEvidence) return "low";
  const hasFallbackIsochrone = summary.config.isochroneMode && summary.isochronePoiCount === null;
  return hasFallbackIsochrone ? "low" : "medium";
}

function modeDetail(summary: ModeSummary): string {
  const nearestPoi = summary.nearestPoi
    ? `${summary.nearestPoi.label} (${Math.round(summary.nearestPoi.distanceMeters)} m)`
    : "not available";
  const nearestStop = summary.nearestStop
    ? `${summary.nearestStop.label} (${Math.round(summary.nearestStop.distanceMeters)} m)`
    : "not available";
  return [
    `Routed time window: ${summary.config.timeMinutes} min.`,
    `Nearest important POI: ${nearestPoi}.`,
    `Nearest transit stop: ${nearestStop}.`,
    `GTFS/OSM stop density: ${summary.stopDensityPerSqkm} stops/km2.`,
    summary.isochronePoiCount === null
      ? "Time-catchment POIs: not available."
      : `Time-catchment POIs: ${summary.isochronePoiCount}.`,
  ].join(" ");
}

function nearestStopDistance(summaries: ModeSummary[]): number | null {
  const distances = summaries
    .map((summary) => summary.nearestStop?.distanceMeters)
    .filter((distance): distance is number => Number.isFinite(distance));
  return distances.length ? Math.round(Math.min(...distances)) : null;
}

function nearestFeature(
  selectedPoint: SelectedPoint,
  features: Feature[],
  fallbackCategory: string,
): NearestFeature | null {
  let nearest: NearestFeature | null = null;
  for (const feature of features) {
    const distanceMeters = featureDistanceToPointMeters(feature, selectedPoint);
    if (!Number.isFinite(distanceMeters)) continue;
    if (nearest && distanceMeters >= nearest.distanceMeters) continue;
    nearest = {
      label: featureLabel(feature),
      category: featureCategory(feature, fallbackCategory),
      distanceMeters,
    };
  }
  return nearest;
}

function isochronePoiReachability(
  pois: FeatureCollection | undefined,
  isochrones: FeatureCollection | undefined,
  mode: "walking" | "cycling" | "driving",
  timeMinutes: number,
): { count: number; categoryCount: number } | null {
  const poiFeatures = pois?.features ?? [];
  if (!poiFeatures.length || !isochrones?.features.length) return null;
  const targetRangeSeconds = timeMinutes * 60;
  const polygons = isochrones.features.filter(
    (feature) =>
      (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") &&
      feature.properties?.isochroneMode === mode &&
      Number(feature.properties?.rangeSeconds ?? 0) === targetRangeSeconds &&
      isRoutedIsochrone(feature),
  );
  if (!polygons.length) return null;
  const reachable = poiFeatures.filter((poi) => {
    const coordinate = representativeCoordinate(poi);
    return coordinate
      ? polygons.some((polygon) => containsCoordinate(polygon, coordinate))
      : false;
  });
  return {
    count: reachable.length,
    categoryCount: uniqueCategories(reachable).size,
  };
}

function isRoutedIsochrone(feature: Feature): boolean {
  return feature.properties?.retrievalStatus === "live" ||
    feature.properties?.retrievalStatus === "cached";
}

function scoreInfrastructure(
  mode: MobilityMode,
  mobilityInfrastructure: FeatureCollection | undefined,
): number {
  if (!mobilityInfrastructure?.features.length) return 0;
  const relevant = mobilityInfrastructure.features.filter((feature) => {
    const mobilityMode = String(feature.properties?.mobilityMode ?? "");
    if (mode === "walking") return mobilityMode === "pedestrian" || mobilityMode === "support";
    if (mode === "cycling") return mobilityMode === "bike" || mobilityMode === "support";
    if (mode === "transit") return mobilityMode === "pedestrian" || mobilityMode === "support";
    return mobilityMode === "support";
  });
  return Math.min(100, Math.round((relevant.length / 12) * 100));
}

function uniqueCategories(features: Feature[]): Set<string> {
  return new Set(features.map((feature) => featureCategory(feature, "other")).filter(Boolean));
}

function featureCategory(feature: Feature, fallback: string): string {
  return String(
    feature.properties?.poiCategory ??
      feature.properties?.transportMode ??
      feature.properties?.amenity ??
      feature.properties?.shop ??
      feature.properties?.leisure ??
      fallback,
  );
}

function featureLabel(feature: Feature): string {
  return String(
    feature.properties?.name ??
      feature.properties?.stop_name ??
      feature.properties?.label ??
      feature.properties?.amenity ??
      feature.properties?.shop ??
      feature.properties?.poiCategory ??
      "unnamed",
  );
}

function scoreDistance(distanceMeters: number, radiusMeters: number): number {
  if (distanceMeters <= radiusMeters * 0.35) return 100;
  if (distanceMeters <= radiusMeters * 0.65) return 72;
  if (distanceMeters <= radiusMeters) return 45;
  return 15;
}

function featureDistanceToPointMeters(feature: Feature, selectedPoint: SelectedPoint): number {
  const coordinate = representativeCoordinate(feature);
  if (!coordinate) return Infinity;
  return distanceBetweenCoordinates([selectedPoint.lon, selectedPoint.lat], coordinate);
}

function representativeCoordinate(feature: Feature): number[] | null {
  if (feature.geometry.type === "Point") return (feature.geometry as Point).coordinates;
  const coordinates: number[][] = [];
  collectCoordinates(feature.geometry, coordinates);
  if (!coordinates.length) return null;
  const sum = coordinates.reduce(
    (total, coordinate) => [total[0] + coordinate[0], total[1] + coordinate[1]],
    [0, 0],
  );
  return [sum[0] / coordinates.length, sum[1] / coordinates.length];
}

function collectCoordinates(geometry: Feature["geometry"], output: number[][]): void {
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
  }
}

function pushCoordinates(target: number[][], coordinates: number[][]): void {
  for (const coordinate of coordinates) target.push(coordinate);
}

function containsCoordinate(feature: Feature, coordinate: number[]): boolean {
  if (feature.geometry.type === "Polygon") {
    return polygonContainsCoordinate(feature.geometry.coordinates, coordinate);
  }
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.some((polygon) =>
      polygonContainsCoordinate(polygon, coordinate),
    );
  }
  return false;
}

function polygonContainsCoordinate(
  polygonCoordinates: number[][][],
  coordinate: number[],
): boolean {
  const outer = polygonCoordinates[0];
  if (!outer || !ringContainsCoordinate(outer, coordinate)) return false;
  return !polygonCoordinates.slice(1).some((hole) => ringContainsCoordinate(hole, coordinate));
}

function ringContainsCoordinate(ring: number[][], coordinate: number[]): boolean {
  const [x, y] = coordinate;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function circleAreaSqkm(radiusMeters: number): number {
  return (Math.PI * radiusMeters * radiusMeters) / 1_000_000;
}

function distanceBetweenCoordinates(left: number[], right: number[]): number {
  const referenceLat = (left[1] + right[1]) / 2;
  const leftMeters = projectMeters(left, referenceLat);
  const rightMeters = projectMeters(right, referenceLat);
  return Math.hypot(leftMeters.x - rightMeters.x, leftMeters.y - rightMeters.y);
}

function projectMeters(coordinate: number[], referenceLat: number): { x: number; y: number } {
  const latRadians = (referenceLat * Math.PI) / 180;
  return {
    x: coordinate[0] * 111_320 * Math.cos(latRadians),
    y: coordinate[1] * 111_320,
  };
}
