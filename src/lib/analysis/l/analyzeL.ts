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
  const liveIsochrones = liveCollections.isochrones;
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
  const landUseSummary = summarizeLandUse(landUseRadius, radiusMeters);
  const transitSummary = summarizeTransitStops(liveTransportStops, radiusMeters);
  const transitLineSummary = summarizeTransitLines(liveTransportLines);
  const poiSummary = summarizeFeatureCategories(livePois, "poiCategory");
  const mobilitySummary = summarizeFeatureCategories(liveMobility, "mobilityMode");
  const isochroneSummary = summarizeFeatureCategories(liveIsochrones, "isochroneMode");
  const isochroneReachability = summarizeIsochroneReachability(livePois, liveIsochrones);
  const developmentSummary = summarizeFeatureCategories(liveDevelopment, "landuse", "amenity", "disused", "abandoned");
  const landUseEntropyScore = calculateLandUseEntropyScore(landUseSummary);
  const poiDiversityScore = calculatePoiDiversityScore(livePois);
  const landUseMix = combineUrbanMixIndex(landUseEntropyScore, poiDiversityScore);
  const transitStops = transitSummary?.uniqueStopCount ?? exactTransitStops ?? null;
  const mobilityHints = exactMobilityFeatures ?? null;
  const mobilityScore = calculateMobilityScore({
    transitStops,
    transitDensity: transitSummary?.stopDensityPerSqkm ?? null,
    transitModeCounts: transitSummary?.modeCounts ?? [],
    mobilityCollection: liveMobility,
    isochroneCollection: liveIsochrones,
    activeReachabilityScore: isochroneReachability?.activeScore ?? null,
  });
  const infrastructurePois = exactPois ?? null;
  const socialInfrastructureScore = calculateSocialInfrastructureScore(
    selectedPoint,
    livePois,
  );
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
          ? "Computed from area-based land-use family entropy at 60% and POI category diversity at 40% where both inputs are available."
          : "Live land-use source did not return a usable response and no local Urban Atlas preprocessing is loaded.",
      sourceIds: ["osm-core", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: landUseEntropyScore !== null && poiDiversityScore !== null
        ? "medium"
        : urbanAtlasFeatures > 0 || exactLandUseFeatures !== undefined
          ? "low"
          : "low",
      caveats: [
        exactLandUseFeatures !== undefined || urbanAtlasFeatures > 0
          ? urbanAtlasCaveat
          : fallbackCaveat,
        landUseEntropyScore !== null
          ? `Land-use entropy subscore: ${landUseEntropyScore}.`
          : "Land-use entropy subscore was not available.",
        poiDiversityScore !== null
          ? `POI diversity subscore: ${poiDiversityScore}.`
          : "POI diversity subscore was not available.",
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
      id: "l.transit-line-details",
      label: "Public transport line details",
      scale: "L",
      value: transitLineSummary?.lineLabels.length
        ? transitLineSummary.lineLabels.slice(0, 24).join(" / ")
        : null,
      unit:
        transitLineSummary && transitLineSummary.lineLabels.length > 24
          ? `showing 24 of ${transitLineSummary.lineLabels.length} lines`
          : undefined,
      method:
        transitLineSummary !== null
          ? "Extracted route refs, names, networks, operators, relation IDs and transport modes from live Overpass relation/member tags and way tags."
          : "No public-transport line collection was available for line-detail extraction.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: transitLineSummary !== null ? "medium" : "low",
      caveats: [
        transitLineSummary !== null
          ? "Line details are only as complete as OSM route relation and way tagging. Full raw tags are preserved in GeoJSON/GPKG properties."
          : fallbackCaveat,
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
          ? `Counted live Overpass mobility infrastructure features for cycleways, parking, charging, sharing, and pedestrian/cycle classes.${mobilitySummary ? ` Main classes: ${mobilitySummary}.` : ""}`
          : "Live mobility infrastructure retrieval was unavailable; no fallback class count is emitted.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactMobilityFeatures !== undefined ? "medium" : "low",
      caveats: [exactMobilityFeatures !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.isochrone-mode-time-comparison",
      label: "Isochrone mode/time comparison",
      scale: "L",
      value: isochroneReachability?.comparison ?? null,
      method:
        "Compared OpenRouteService walking, cycling, and driving isochrone polygons by configured travel-time ranges and counted reachable POIs for each mode/time where POI points are available.",
      sourceIds: ["openrouteservice-isochrones", "osm-core", "osm-overpass"],
      confidence: isochroneReachability?.confidence ?? "low",
      caveats: [
        isochroneSummary
          ? `Isochrone modes present: ${isochroneSummary}.`
          : "No isochrone polygons were available for mode/time comparison.",
        ...(isochroneReachability?.caveats ?? ["POI reachability requires both POI points and isochrone polygons."]),
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.active-poi-reachability-score",
      label: "Walk/cycle POI reachability",
      scale: "L",
      value: isochroneReachability?.activeScore ?? null,
      unit: "0-100",
      method:
        "Scored how many loaded POIs and POI categories are reachable inside walking and cycling isochrones, with walking weighted more strongly than cycling. Driving is reported as comparison context only.",
      sourceIds: ["openrouteservice-isochrones", "osm-core", "osm-overpass"],
      confidence: isochroneReachability?.confidence ?? "low",
      caveats: [
        ...(isochroneReachability?.caveats ?? ["POI reachability requires both POI points and isochrone polygons."]),
        "Driving reachability is shown for comparison but does not increase this active mobility score.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.mobility-score",
      label: "Mobility score",
      scale: "L",
      value: mobilityScore.value,
      unit: "0-100",
      method:
        "Composite KPI from public-transport stop availability and density, transit mode hierarchy, OSM walking/cycling infrastructure hints, OpenRouteService walking/cycling isochrone context, and POI reachability by active modes. Driving isochrones are comparison context only.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs", "gtfs-de-local-transit", "openrouteservice-isochrones"],
      confidence: mobilityScore.confidence,
      caveats: [
        ...mobilityScore.caveats,
        isochroneSummary
          ? `Isochrone modes present: ${isochroneSummary}.`
          : "No isochrone polygons were available for the mobility score.",
      ],
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
          ? `Counted live Overpass amenity/shop POIs relevant to social and civic infrastructure inside the radius.${poiSummary ? ` Main categories: ${poiSummary}.` : ""}`
          : "Live POI retrieval was unavailable; no fallback POI count is emitted.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactPois !== undefined ? "medium" : "low",
      caveats: [exactPois !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.social-infrastructure-score",
      label: "Social infrastructure access",
      scale: "L",
      value: socialInfrastructureScore.value,
      unit: "0-100",
      method:
        "Distance-first essential-service score from education/childcare, healthcare, grocery/commerce, and civic/admin POIs. Each category combines nearest-distance access at 75% and category count at 25%.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: socialInfrastructureScore.confidence,
      caveats: [
        ...socialInfrastructureScore.caveats,
        exactPois !== undefined ? liveCaveat : fallbackCaveat,
      ],
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
          ? `Read live Overpass brownfield, construction, parking, disused, abandoned and related development-hint classes.${developmentSummary ? ` Main tags: ${developmentSummary}.` : ""}`
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
      indicators: indicators.slice(5, 16),
      method: "Counts, class hints, mode/time isochrone comparison, and POI reachability within the selected context.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs", "gtfs-de-local-transit", "openrouteservice-isochrones"],
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
      indicators: [indicators[16]],
      method: "Screening rules from open-data class hints.",
      sourceIds: ["osm-core", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      computedAt,
      confidence: "low",
      caveats: indicators[16].caveats,
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

function calculateLandUseEntropyScore(summary: LandUseSummary | null): number | null {
  if (!summary?.familyShares.length) return null;
  const areas = summary.familyShares
    .map((share) => share.areaSqm)
    .filter((area) => area > 0);
  const total = areas.reduce((sum, area) => sum + area, 0);
  if (total <= 0 || areas.length <= 1) return areas.length === 1 ? 25 : null;
  const entropy = areas.reduce((sum, area) => {
    const share = area / total;
    return sum - share * Math.log(share);
  }, 0);
  const maxEntropy = Math.log(Math.max(2, 7));
  return Math.round((entropy / maxEntropy) * 100);
}

function calculatePoiDiversityScore(collection: FeatureCollection | undefined): number | null {
  if (!collection?.features.length) return null;
  const counts = new Map<string, number>();
  for (const feature of collection.features) {
    const category = String(feature.properties?.poiCategory ?? "").trim();
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const values = [...counts.values()].filter((count) => count > 0);
  const total = values.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return null;
  if (values.length === 1) return 25;
  const entropy = values.reduce((sum, count) => {
    const share = count / total;
    return sum - share * Math.log(share);
  }, 0);
  const maxEntropy = Math.log(Math.max(2, 7));
  return Math.round((entropy / maxEntropy) * 100);
}

function combineUrbanMixIndex(
  landUseEntropyScore: number | null,
  poiDiversityScore: number | null,
): number | null {
  if (landUseEntropyScore === null && poiDiversityScore === null) return null;
  if (landUseEntropyScore !== null && poiDiversityScore !== null) {
    return Math.round((landUseEntropyScore * 0.6 + poiDiversityScore * 0.4)) / 100;
  }
  const score = landUseEntropyScore ?? poiDiversityScore ?? 0;
  return Math.round(score) / 100;
}

type IsochroneReachabilitySummary = {
  comparison: string;
  activeScore: number;
  confidence: "high" | "medium" | "low";
  caveats: string[];
};

function summarizeIsochroneReachability(
  pois: FeatureCollection | undefined,
  isochrones: FeatureCollection | undefined,
): IsochroneReachabilitySummary | null {
  const poiPoints = (pois?.features ?? []).filter(
    (feature) => feature.geometry.type === "Point",
  );
  const polygons = (isochrones?.features ?? []).filter(
    (feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon",
  );
  if (!poiPoints.length || !polygons.length) return null;

  const modes = ["walking", "cycling", "driving"] as const;
  const ranges = uniqueIsochroneRanges(polygons);
  const rows = modes.flatMap((mode) =>
    ranges.map((rangeSeconds) => {
      const modePolygons = polygons.filter(
        (feature) =>
          feature.properties?.isochroneMode === mode &&
          Number(feature.properties?.rangeSeconds ?? 0) === rangeSeconds,
      );
      const reachable = reachablePoiFeatures(poiPoints, modePolygons);
      const categories = new Set(
        reachable
          .map((feature) => String(feature.properties?.poiCategory ?? "other"))
          .filter(Boolean),
      );
      return {
        mode,
        rangeSeconds,
        count: reachable.length,
        categoryCount: categories.size,
      };
    }),
  );
  const totalPois = Math.max(1, poiPoints.length);
  const walkingScore = scoreReachabilityMode(rows, "walking", totalPois);
  const cyclingScore = scoreReachabilityMode(rows, "cycling", totalPois);
  const activeScore = Math.round(walkingScore * 0.7 + cyclingScore * 0.3);
  const hasFallback = polygons.some((feature) => feature.properties?.retrievalStatus === "fallback");
  const comparison = modes
    .map((mode) => {
      const modeRows = rows.filter((row) => row.mode === mode);
      return `${mode}: ${modeRows
        .map((row) => `${Math.round(row.rangeSeconds / 60)}min ${row.count} POIs`)
        .join(", ")}`;
    })
    .join(" / ");

  return {
    comparison,
    activeScore,
    confidence: hasFallback ? "low" : "medium",
    caveats: [
      `${poiPoints.length} loaded POI point(s) were tested against ${polygons.length} isochrone polygon(s).`,
      "Reachability counts reflect loaded POIs only; unmapped or uncategorized facilities are not inferred.",
      hasFallback
        ? "Some or all isochrones are geometric fallback buffers, not routed network catchments."
        : "Routed OpenRouteService isochrones were used where API/cache data were available.",
    ],
  };
}

function uniqueIsochroneRanges(features: Feature[]): number[] {
  const ranges = [
    ...new Set(
      features
        .map((feature) => Number(feature.properties?.rangeSeconds ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ].sort((left, right) => left - right);
  return ranges.length ? ranges : [300, 600, 900];
}

function reachablePoiFeatures(pois: Feature[], polygons: Feature[]): Feature[] {
  if (!polygons.length) return [];
  const reachable = new Map<string, Feature>();
  for (const poi of pois) {
    if (poi.geometry.type !== "Point") continue;
    const coordinates = poi.geometry.coordinates;
    if (!polygons.some((polygon) => containsCoordinate(polygon, coordinates))) continue;
    const key = [
      coordinates[0].toFixed(6),
      coordinates[1].toFixed(6),
      String(poi.properties?.name ?? poi.properties?.id ?? ""),
    ].join(":");
    reachable.set(key, poi);
  }
  return [...reachable.values()];
}

function scoreReachabilityMode(
  rows: Array<{ mode: string; rangeSeconds: number; count: number; categoryCount: number }>,
  mode: "walking" | "cycling",
  totalPois: number,
): number {
  const modeRows = rows.filter((row) => row.mode === mode);
  const at5 = modeRows.find((row) => row.rangeSeconds === 300) ?? modeRows[0];
  const at10 = modeRows.find((row) => row.rangeSeconds === 600) ?? modeRows[1] ?? at5;
  const at15 = modeRows.find((row) => row.rangeSeconds === 900) ?? modeRows[modeRows.length - 1] ?? at10;
  if (!at15) return 0;
  const target = Math.min(totalPois, mode === "walking" ? 24 : 36);
  const accessScore = Math.min(100, Math.round((at15.count / Math.max(1, target)) * 100));
  const closeScore = Math.min(100, Math.round((((at5?.count ?? 0) * 0.6 + (at10?.count ?? 0) * 0.4) / Math.max(1, target * 0.55)) * 100));
  const categoryScore = Math.min(100, Math.round((at15.categoryCount / 6) * 100));
  return Math.round(accessScore * 0.45 + closeScore * 0.35 + categoryScore * 0.2);
}

function calculateMobilityScore(input: {
  transitStops: number | null;
  transitDensity: number | null;
  transitModeCounts: Array<{ mode: string; count: number }>;
  mobilityCollection: FeatureCollection | undefined;
  isochroneCollection: FeatureCollection | undefined;
  activeReachabilityScore: number | null;
}): { value: number | null; confidence: "high" | "medium" | "low"; caveats: string[] } {
  const modeCounts = summarizeMobilityModeCounts(input.mobilityCollection);
  const isochroneScore = calculateActiveIsochroneScore(input.isochroneCollection);
  const reachabilityScore = input.activeReachabilityScore ?? isochroneScore;
  const hasIsochrones = isochroneScore > 0;
  const hasFallbackIsochrones = input.isochroneCollection?.features.some(
    (feature) =>
      feature.properties?.retrievalStatus === "fallback" &&
      ["walking", "cycling"].includes(String(feature.properties?.isochroneMode ?? "")),
  );
  const availableInputs = [
    input.transitStops !== null,
    input.transitDensity !== null,
    input.transitModeCounts.length > 0,
    input.mobilityCollection !== undefined,
    hasIsochrones,
    input.activeReachabilityScore !== null,
  ].filter(Boolean).length;
  if (availableInputs === 0) {
    return {
      value: null,
      confidence: "low",
      caveats: ["No transport, mobility, or isochrone inputs were available."],
    };
  }

  const transitCountScore =
    input.transitStops === null
      ? 0
      : Math.min(100, Math.round((input.transitStops / 10) * 100));
  const transitDensityScore =
    input.transitDensity === null
      ? 0
      : Math.min(100, Math.round((input.transitDensity / 18) * 100));
  const transitAccessScore = Math.round(transitCountScore * 0.6 + transitDensityScore * 0.4);
  const transitModeScore = calculateTransitModeScore(input.transitModeCounts);
  const walkingCyclingScore = Math.min(
    100,
    Math.round(((modeCounts.bike * 8 + modeCounts.pedestrian * 6 + modeCounts.support * 3) / 120) * 100),
  );
  const score = Math.round(
    transitAccessScore * 0.25 +
      transitModeScore * 0.15 +
      walkingCyclingScore * 0.2 +
      isochroneScore * 0.15 +
      reachabilityScore * 0.25,
  );

  return {
    value: score,
    confidence: availableInputs >= 3 && !hasFallbackIsochrones ? "medium" : "low",
    caveats: [
      "Mobility score is a deterministic screening KPI, not a routing or service-quality model.",
      hasFallbackIsochrones
        ? "OpenRouteService routed isochrones were unavailable; geometric fallback catchments reduce confidence."
        : "OpenRouteService routed isochrones increase context but do not include timetable quality.",
      "Driving isochrones are rendered as context but do not increase the mobility score.",
      `Mobility subscores: transit access ${transitAccessScore}, transit mode hierarchy ${transitModeScore}, walking/cycling infrastructure ${walkingCyclingScore}, walking/cycling isochrone context ${isochroneScore}, active POI reachability ${reachabilityScore}.`,
    ],
  };
}

function calculateTransitModeScore(modeCounts: Array<{ mode: string; count: number }>): number {
  const weights: Record<string, number> = {
    bus: 18,
    tram: 25,
    subway: 30,
    light_rail: 25,
    rail: 25,
    station: 20,
    transit: 12,
  };
  const modes = new Set(modeCounts.filter((item) => item.count > 0).map((item) => item.mode));
  return Math.min(
    100,
    [...modes].reduce((total, mode) => total + (weights[mode] ?? 12), 0),
  );
}

function calculateActiveIsochroneScore(collection: FeatureCollection | undefined): number {
  if (!collection?.features.length) return 0;
  let score = 0;
  for (const mode of ["walking", "cycling"]) {
    const features = collection.features.filter(
      (feature) => feature.properties?.isochroneMode === mode,
    );
    if (features.some((feature) => feature.properties?.retrievalStatus === "live" || feature.properties?.retrievalStatus === "cached")) {
      score += 40;
    } else if (features.some((feature) => feature.properties?.retrievalStatus === "fallback")) {
      score += 18;
    }
  }
  return Math.min(80, score);
}

function summarizeMobilityModeCounts(
  collection: FeatureCollection | undefined,
): { bike: number; pedestrian: number; support: number } {
  const counts = { bike: 0, pedestrian: 0, support: 0 };
  for (const feature of collection?.features ?? []) {
    const mode = String(feature.properties?.mobilityMode ?? "");
    if (mode === "bike") counts.bike += 1;
    if (mode === "pedestrian") counts.pedestrian += 1;
    if (mode === "support") counts.support += 1;
  }
  return counts;
}

function calculateSocialInfrastructureScore(
  selectedPoint: SelectedPoint,
  collection: FeatureCollection | undefined,
): { value: number | null; confidence: "high" | "medium" | "low"; caveats: string[] } {
  if (!collection?.features.length) {
    return {
      value: null,
      confidence: "low",
      caveats: ["No social, civic, health, education, or commerce POIs were available."],
    };
  }
  const categories = [
    { id: "education", label: "education/childcare", weight: 0.25 },
    { id: "health", label: "healthcare", weight: 0.3 },
    { id: "commerce", label: "grocery/commerce", weight: 0.25 },
    { id: "civic", label: "civic/admin", weight: 0.2 },
  ];
  const rows = categories.map((category) => {
    const features = collection.features.filter(
      (feature) => feature.properties?.poiCategory === category.id && feature.geometry.type === "Point",
    );
    const distances = features.map((feature) =>
      distanceBetweenCoordinates(
        [selectedPoint.lon, selectedPoint.lat],
        feature.geometry.type === "Point" ? feature.geometry.coordinates : [selectedPoint.lon, selectedPoint.lat],
      ),
    );
    const nearest = distances.length ? Math.min(...distances) : null;
    const distanceScore = nearest === null ? 0 : distanceToServiceScore(nearest);
    const countScore = Math.min(100, features.length * 25);
    return {
      ...category,
      count: features.length,
      nearest,
      score: Math.round(distanceScore * 0.75 + countScore * 0.25),
    };
  });
  const availableRows = rows.filter((row) => row.count > 0);
  if (!availableRows.length) {
    return {
      value: null,
      confidence: "low",
      caveats: ["Loaded POIs did not include essential-service categories for social infrastructure scoring."],
    };
  }
  const weightTotal = availableRows.reduce((total, row) => total + row.weight, 0);
  const value = Math.round(
    availableRows.reduce((total, row) => total + row.score * row.weight, 0) /
      Math.max(0.0001, weightTotal),
  );
  return {
    value,
    confidence: availableRows.length >= 3 ? "medium" : "low",
    caveats: [
      `Essential categories available: ${availableRows.map((row) => `${row.label}: ${row.count}`).join(" / ")}.`,
      "Distance thresholds: 500 m = 100, 800 m = 70, 1,000 m = 40, beyond 1,000 m = 0.",
      "POI categories are OSM-derived and may miss facilities that are not mapped.",
    ],
  };
}

function distanceToServiceScore(distanceMeters: number): number {
  if (distanceMeters <= 500) return 100;
  if (distanceMeters <= 800) return 70;
  if (distanceMeters <= 1_000) return 40;
  return 0;
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

type TransitLineSummary = {
  lineLabels: string[];
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

function summarizeTransitLines(
  collection: FeatureCollection | undefined,
): TransitLineSummary | null {
  if (!collection?.features.length) return null;
  const lineLabels = new Set<string>();
  const modeCounts = new Map<string, number>();
  for (const feature of collection.features) {
    if (feature.geometry.type !== "LineString") continue;
    const mode = normalizeTransitMode(feature);
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
    const labels = readLineLabels(feature);
    for (const label of labels) lineLabels.add(label);
  }
  return {
    lineLabels: [...lineLabels].sort((left, right) => left.localeCompare(right, "de")),
    modeCounts: [...modeCounts.entries()]
      .map(([mode, count]) => ({ mode, count }))
      .sort((left, right) => right.count - left.count || left.mode.localeCompare(right.mode)),
  };
}

function readLineLabels(feature: Feature): string[] {
  const properties = feature.properties ?? {};
  const mode = normalizeTransitMode(feature);
  const refs = splitProperty(properties.routeRefs ?? properties.ref);
  const names = splitProperty(properties.routeNames ?? properties.name);
  const networks = splitProperty(properties.routeNetworks ?? properties.network);
  const operators = splitProperty(properties.routeOperators ?? properties.operator);
  const relations = splitProperty(properties.routeRelations ?? properties.relationId);
  const froms = splitProperty(properties.routeFroms);
  const tos = splitProperty(properties.routeTos);
  const explicitLabels = splitProperty(properties.lineLabel);
  if (explicitLabels.length) return explicitLabels.map((label) => `${mode}: ${label}`);
  const maxLength = Math.max(refs.length, names.length, networks.length, operators.length, relations.length, froms.length, tos.length, 1);
  return Array.from({ length: maxLength }, (_, index) => {
    const fromTo = froms[index] || tos[index] ? `${froms[index] ?? "?"}->${tos[index] ?? "?"}` : undefined;
    const parts = [
      refs[index] ? `ref ${refs[index]}` : undefined,
      names[index],
      fromTo,
      networks[index] ? `network ${networks[index]}` : undefined,
      operators[index] ? `operator ${operators[index]}` : undefined,
      relations[index] ? `relation ${relations[index]}` : undefined,
    ].filter(Boolean);
    return `${mode}: ${parts.length ? parts.join(" / ") : String(properties.osmId ?? properties.id ?? "unnamed")}`;
  });
}

function splitProperty(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function summarizeFeatureCategories(
  collection: FeatureCollection | undefined,
  ...keys: string[]
): string | null {
  if (!collection?.features.length) return null;
  const counts = new Map<string, number>();
  for (const feature of collection.features) {
    const key = keys.find((candidate) => feature.properties?.[candidate] !== undefined);
    const value = key ? String(feature.properties?.[key]) : "other";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([label, count]) => `${label}: ${count}`);
  return summary.length ? summary.join(" / ") : null;
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
  if (geometry.type === "LineString") pushCoordinates(coords, geometry.coordinates);
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) pushCoordinates(coords, ring);
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) pushCoordinates(coords, ring);
    }
  }
}

function pushCoordinates(target: number[][], coordinates: number[][]): void {
  for (const coordinate of coordinates) target.push(coordinate);
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
