import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { Confidence, FactSheetModule, Indicator, SelectedPoint } from "../../types";
import { bufferPolygon, geometryToFeature } from "../geometry";
import { createIndicator } from "../indicators/createIndicator";

type MobilityMode = "walking" | "cycling" | "transit" | "driving";

type MobilityScaleConfig = {
  mode: MobilityMode;
  label: string;
  radiusMeters: number;
  timeMinutes: number;
  sourceScale: "M/L" | "L" | "XL/L";
  poiTarget: number;
  stopTarget: number;
  isochroneMode?: "walking" | "cycling" | "driving";
};

type MobilityRadiusBand = {
  id: string;
  mode: MobilityMode;
  label: string;
  bandLabel: string;
  radiusMeters: number;
  timeMinutes: number;
  sourceScale: MobilityScaleConfig["sourceScale"];
  primaryKpiRadius?: boolean;
};

type ModeSummary = {
  config: MobilityScaleConfig;
  score: number | null;
  poiCount: number;
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
    radiusMeters: 500,
    timeMinutes: 10,
    sourceScale: "M/L",
    poiTarget: 10,
    stopTarget: 4,
    isochroneMode: "walking",
  },
  {
    mode: "cycling",
    label: "Bike",
    radiusMeters: 2_500,
    timeMinutes: 10,
    sourceScale: "L",
    poiTarget: 24,
    stopTarget: 8,
    isochroneMode: "cycling",
  },
  {
    mode: "transit",
    label: "Transit",
    radiusMeters: 800,
    timeMinutes: 10,
    sourceScale: "L",
    poiTarget: 12,
    stopTarget: 8,
  },
  {
    mode: "driving",
    label: "Car",
    radiusMeters: 6_000,
    timeMinutes: 15,
    sourceScale: "XL/L",
    poiTarget: 36,
    stopTarget: 0,
    isochroneMode: "driving",
  },
];

const MOBILITY_RADIUS_BANDS: MobilityRadiusBand[] = [
  {
    id: "walking-5",
    mode: "walking",
    label: "Walking 5 min",
    bandLabel: "5 min walk",
    radiusMeters: 300,
    timeMinutes: 5,
    sourceScale: "M/L",
  },
  {
    id: "walking-10",
    mode: "walking",
    label: "Walking 10 min",
    bandLabel: "10 min walk",
    radiusMeters: 500,
    timeMinutes: 10,
    sourceScale: "M/L",
    primaryKpiRadius: true,
  },
  {
    id: "walking-15",
    mode: "walking",
    label: "Walking 15 min",
    bandLabel: "15 min walk",
    radiusMeters: 800,
    timeMinutes: 15,
    sourceScale: "M/L",
  },
  {
    id: "cycling-5",
    mode: "cycling",
    label: "Bike 5 min",
    bandLabel: "5 min bike",
    radiusMeters: 1_250,
    timeMinutes: 5,
    sourceScale: "L",
  },
  {
    id: "cycling-10",
    mode: "cycling",
    label: "Bike 10 min",
    bandLabel: "10 min bike",
    radiusMeters: 2_500,
    timeMinutes: 10,
    sourceScale: "L",
    primaryKpiRadius: true,
  },
  {
    id: "cycling-15",
    mode: "cycling",
    label: "Bike 15 min",
    bandLabel: "15 min bike",
    radiusMeters: 3_750,
    timeMinutes: 15,
    sourceScale: "L",
  },
  {
    id: "transit-5",
    mode: "transit",
    label: "Transit 5 min access",
    bandLabel: "5 min transit access",
    radiusMeters: 400,
    timeMinutes: 5,
    sourceScale: "L",
  },
  {
    id: "transit-10",
    mode: "transit",
    label: "Transit 10 min access",
    bandLabel: "10 min transit access",
    radiusMeters: 800,
    timeMinutes: 10,
    sourceScale: "L",
    primaryKpiRadius: true,
  },
  {
    id: "transit-15",
    mode: "transit",
    label: "Transit 15 min access",
    bandLabel: "15 min transit access",
    radiusMeters: 1_200,
    timeMinutes: 15,
    sourceScale: "L",
  },
  {
    id: "driving-5",
    mode: "driving",
    label: "Car 5 min",
    bandLabel: "5 min car",
    radiusMeters: 2_000,
    timeMinutes: 5,
    sourceScale: "XL/L",
  },
  {
    id: "driving-10",
    mode: "driving",
    label: "Car 10 min",
    bandLabel: "10 min car",
    radiusMeters: 4_000,
    timeMinutes: 10,
    sourceScale: "XL/L",
  },
  {
    id: "driving-15",
    mode: "driving",
    label: "Car 15 min",
    bandLabel: "15 min car",
    radiusMeters: 6_000,
    timeMinutes: 15,
    sourceScale: "XL/L",
    primaryKpiRadius: true,
  },
];

export function analyzeMobilityScales(input: {
  selectedPoint: SelectedPoint;
  computedAt: string;
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
  const scoredSummaries = summaries.filter((summary) => summary.score !== null);
  const combinedScore = scoredSummaries.length
    ? Math.round(
        scoredSummaries.reduce((total, summary) => total + (summary.score ?? 0), 0) /
          scoredSummaries.length,
      )
    : null;
  const sharedCaveats = [
    "Mode radii are deterministic MVP catchments with 5/10/15-minute sub-bands; routed network distance is only used when OpenRouteService is configured and available.",
    "Reachability scoring uses the marked primary KPI band per mode while all radius sub-bands remain visible as context.",
    "Broader bike/car POI reachability is limited by the currently loaded POI source coverage unless a local POI extract is preprocessed.",
    "GTFS stop density counts preprocessed stop points and does not yet include timetable frequency or service span.",
  ];
  const indicators = [
    createIndicator({
      id: "l.mobility-scale-radii",
      label: "Mobility radii",
      scale: "L",
      value: mobilityRadiusSummary(),
      method:
        "Configured per-mode radius and time assumptions for mobility-scale analysis. Each mode has 5/10/15-minute visual radius bands; the primary KPI band is used for the mode score.",
      sourceIds: ["osm-core", "gtfs-de-local-transit", "mobilithek-gtfs", "openrouteservice-isochrones"],
      confidence: "medium",
      caveats: sharedCaveats,
      computedAt: input.computedAt,
    }),
    ...summaries.map((summary) =>
      createIndicator({
        id: `l.${summary.config.mode}-reachability-score`,
        label: `${summary.config.label} reachability`,
        scale: "L",
        value: summary.score,
        unit: "0-100",
        method:
          `${summary.config.label} score combines POIs inside the ${summary.config.radiusMeters} m radius, nearest important POI distance, ${summary.config.timeMinutes}-minute isochrone POI reachability where available, mobility infrastructure hints, and GTFS stop access where relevant.`,
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
        "Average of available walking, cycling, transit, and driving reachability scores using mode-specific primary KPI radii and matched time windows.",
      sourceIds: ["osm-core", "osm-overpass", "gtfs-de-local-transit", "mobilithek-gtfs", "openrouteservice-isochrones"],
      confidence: scoredSummaries.length >= 3 ? "medium" : "low",
      caveats: [
        ...sharedCaveats,
        scoredSummaries.length
          ? `Available mode scores: ${scoredSummaries
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
      title: "Mobility scales",
      scale: "L",
      indicators,
      method:
        "Mode-aware reachability model with separate walking, cycling, transit, and car radius sub-bands, nearest-feature distances, GTFS stop density, and time-catchment comparison.",
      sourceIds: ["osm-core", "osm-overpass", "gtfs-de-local-transit", "mobilithek-gtfs", "openrouteservice-isochrones"],
      computedAt: input.computedAt,
      confidence: scoredSummaries.length >= 3 ? "medium" : "low",
      caveats: sharedCaveats,
    },
    bufferFeatures: MOBILITY_RADIUS_BANDS.map((band) => mobilityBufferFeature(input.selectedPoint, band)),
    combinedScore,
    summaries,
  };
}

function summarizeMode(
  config: MobilityScaleConfig,
  input: {
    selectedPoint: SelectedPoint;
    pois?: FeatureCollection;
    transportStops?: FeatureCollection;
    mobilityInfrastructure?: FeatureCollection;
    isochrones?: FeatureCollection;
  },
): ModeSummary {
  const poiFeatures = input.pois?.features ?? [];
  const stopFeatures = input.transportStops?.features ?? [];
  const poisInRadius = poiFeatures.filter((feature) =>
    featureDistanceToPointMeters(feature, input.selectedPoint) <= config.radiusMeters,
  );
  const stopsInRadius = stopFeatures.filter((feature) =>
    featureDistanceToPointMeters(feature, input.selectedPoint) <= config.radiusMeters,
  );
  const nearestPoi = nearestFeature(input.selectedPoint, poiFeatures, "poi");
  const nearestStop = nearestFeature(input.selectedPoint, stopFeatures, "stop");
  const isochronePoiCount = config.isochroneMode
    ? countIsochronePois(input.pois, input.isochrones, config.isochroneMode, config.timeMinutes)
    : null;
  const infrastructureScore = scoreInfrastructure(config.mode, input.mobilityInfrastructure);
  const stopDensityPerSqkm =
    Math.round((stopsInRadius.length / Math.max(0.0001, circleAreaSqkm(config.radiusMeters))) * 10) / 10;
  const poiRadiusScore = Math.min(
    100,
    Math.round((poisInRadius.length / Math.max(1, config.poiTarget)) * 75) +
      Math.round((uniqueCategories(poisInRadius).size / 6) * 25),
  );
  const nearestPoiScore = nearestPoi
    ? scoreDistance(nearestPoi.distanceMeters, config.radiusMeters)
    : 0;
  const isochroneScore =
    isochronePoiCount === null
      ? 0
      : Math.min(100, Math.round((isochronePoiCount / Math.max(1, config.poiTarget)) * 100));
  const stopScore =
    config.mode === "driving"
      ? 0
      : Math.min(
          100,
          Math.round((stopsInRadius.length / Math.max(1, config.stopTarget)) * 65) +
            (nearestStop ? Math.round(scoreDistance(nearestStop.distanceMeters, config.radiusMeters) * 0.35) : 0),
        );
  const score = scoreMode(config.mode, {
    poiRadiusScore,
    nearestPoiScore,
    isochroneScore,
    stopScore,
    infrastructureScore,
  });
  const caveats = [
    poiFeatures.length
      ? `${poisInRadius.length} loaded POI point(s) or polygons intersect the ${config.radiusMeters} m ${config.label.toLowerCase()} radius.`
      : "No loaded POI features were available for this mode.",
    stopFeatures.length
      ? `${stopsInRadius.length} loaded GTFS/OSM stop point(s) intersect the ${config.radiusMeters} m ${config.label.toLowerCase()} radius.`
      : "No GTFS/OSM stop points were available for this mode.",
    ...(config.isochroneMode && isochronePoiCount === null
      ? [`No ${config.label.toLowerCase()} ${config.timeMinutes}-minute isochrone polygon was available.`]
      : []),
  ];

  return {
    config,
    score,
    poiCount: poisInRadius.length,
    poiCategoryCount: uniqueCategories(poisInRadius).size,
    stopCount: stopsInRadius.length,
    stopDensityPerSqkm,
    nearestPoi,
    nearestStop,
    isochronePoiCount,
    infrastructureScore,
    caveats,
  };
}

function scoreMode(
  mode: MobilityMode,
  scores: {
    poiRadiusScore: number;
    nearestPoiScore: number;
    isochroneScore: number;
    stopScore: number;
    infrastructureScore: number;
  },
): number {
  if (mode === "walking") {
    return Math.round(
      scores.poiRadiusScore * 0.25 +
        scores.nearestPoiScore * 0.3 +
        scores.isochroneScore * 0.25 +
        scores.stopScore * 0.1 +
        scores.infrastructureScore * 0.1,
    );
  }
  if (mode === "cycling") {
    return Math.round(
      scores.poiRadiusScore * 0.22 +
        scores.nearestPoiScore * 0.15 +
        scores.isochroneScore * 0.35 +
        scores.stopScore * 0.08 +
        scores.infrastructureScore * 0.2,
    );
  }
  if (mode === "transit") {
    return Math.round(
      scores.stopScore * 0.65 +
        scores.poiRadiusScore * 0.2 +
        scores.nearestPoiScore * 0.05 +
        scores.infrastructureScore * 0.1,
    );
  }
  return Math.round(
    scores.isochroneScore * 0.45 +
      scores.poiRadiusScore * 0.25 +
      scores.nearestPoiScore * 0.2 +
      scores.infrastructureScore * 0.1,
  );
}

function mobilityBufferFeature(
  selectedPoint: SelectedPoint,
  band: MobilityRadiusBand,
): Feature<Polygon> {
  return geometryToFeature(bufferPolygon(selectedPoint.lat, selectedPoint.lon, band.radiusMeters, 96), {
    id: `mobility-radius-${band.id}`,
    label: `${band.label} / ${band.radiusMeters} m`,
    mobilityMode: band.mode,
    mobilityCategory: "mobility-radii",
    radiusBand: band.id,
    radiusBandLabel: band.bandLabel,
    radiusMeters: band.radiusMeters,
    timeMinutes: band.timeMinutes,
    sourceScale: band.sourceScale,
    primaryKpiRadius: Boolean(band.primaryKpiRadius),
  }) as Feature<Polygon>;
}

function mobilityRadiusSummary(): string {
  return MODE_CONFIGS.map((config) => {
    const bands = MOBILITY_RADIUS_BANDS.filter((band) => band.mode === config.mode);
    return `${config.label.toLowerCase()}: ${bands
      .map((band) => `${band.timeMinutes}min/${band.radiusMeters}m${band.primaryKpiRadius ? " KPI" : ""}`)
      .join(", ")}`;
  }).join(" / ");
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
    summary.poiCount > 0 ||
    summary.stopCount > 0 ||
    (summary.isochronePoiCount ?? 0) > 0 ||
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
    `Radius ${summary.config.radiusMeters} m, time ${summary.config.timeMinutes} min.`,
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

function countIsochronePois(
  pois: FeatureCollection | undefined,
  isochrones: FeatureCollection | undefined,
  mode: "walking" | "cycling" | "driving",
  timeMinutes: number,
): number | null {
  const poiFeatures = pois?.features ?? [];
  if (!poiFeatures.length || !isochrones?.features.length) return null;
  const targetRangeSeconds = timeMinutes * 60;
  const polygons = isochrones.features.filter(
    (feature) =>
      (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") &&
      feature.properties?.isochroneMode === mode &&
      Number(feature.properties?.rangeSeconds ?? 0) === targetRangeSeconds,
  );
  if (!polygons.length) return null;
  return poiFeatures.filter((poi) => {
    const coordinate = representativeCoordinate(poi);
    return coordinate
      ? polygons.some((polygon) => containsCoordinate(polygon, coordinate))
      : false;
  }).length;
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
