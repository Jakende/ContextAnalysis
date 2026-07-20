import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { FactSheetModule, Indicator, SelectedPoint } from "../../types";
import {
  bufferPolygon,
  featureCollection,
  geometryToFeature,
} from "../geometry";
import { createIndicator } from "../indicators/createIndicator";
import { analyzeMobilityScales } from "../mobility/mobilityScales";

export function analyzeL(
  selectedPoint: SelectedPoint,
  computedAt: string,
  radiusMeters = 500,
  liveCollections: Record<string, FeatureCollection | undefined> = {},
  contextGeometry?: Polygon | MultiPolygon,
): { modules: FactSheetModule[]; indicators: Indicator[]; overlays: ReturnType<typeof createLOverlays> } {
  const liveGreenBlue = liveCollections.greenBlue;
  const liveTransportStops = liveCollections.transportStops;
  const liveTransportLines = liveCollections.transportLines;
  const liveMobility = liveCollections.mobilityInfrastructure;
  const liveIsochrones = liveCollections.isochrones;
  const livePois = liveCollections.pois;
  const liveDevelopment = liveCollections.developmentHints;
  const liveLandUse = liveCollections.landUse;
  const liveTrees = liveCollections.trees;
  const contextAreaSqm = contextGeometry
    ? geometryAreaSqm(contextGeometry)
    : circleAreaSqm(radiusMeters);
  const contextDescription = contextGeometry
    ? "uploaded or drawn project boundary"
    : `${radiusMeters} m radius`;
  const transportStopsRadius = filterCollectionToContext(
    liveTransportStops,
    selectedPoint,
    radiusMeters,
    contextGeometry,
  );
  const transportLinesRadius = filterCollectionToContext(
    liveTransportLines,
    selectedPoint,
    radiusMeters,
    contextGeometry,
  );
  const mobilityRadius = filterCollectionToContext(
    liveMobility,
    selectedPoint,
    radiusMeters,
    contextGeometry,
  );
  const poisRadius = filterCollectionToContext(
    livePois,
    selectedPoint,
    radiusMeters,
    contextGeometry,
  );
  const developmentRadius = filterCollectionToContext(
    liveDevelopment,
    selectedPoint,
    radiusMeters,
    contextGeometry,
  );
  const treesRadius = filterCollectionToContext(
    liveTrees,
    selectedPoint,
    radiusMeters,
    contextGeometry,
  );
  const mobilityScales = analyzeMobilityScales({
    selectedPoint,
    computedAt,
    evidenceRadiusMeters: radiusMeters,
    evidenceAreaSqkm: contextAreaSqm / 1_000_000,
    pois: poisRadius,
    transportStops: transportStopsRadius,
    mobilityInfrastructure: mobilityRadius,
    isochrones: liveIsochrones,
  });
  const overlays = createLOverlays(
    selectedPoint,
    radiusMeters,
    mobilityScales.bufferFeatures,
    contextGeometry,
  );
  const urbanAtlas = liveCollections.urbanAtlas;
  const urbanAtlasRadius = urbanAtlas
    ? featureCollection(
        urbanAtlas.features.filter((feature) =>
          featureTouchesAnalysisContext(feature, selectedPoint, radiusMeters, contextGeometry),
        ),
      )
    : undefined;
  const urbanAtlasFeatures = urbanAtlasRadius?.features.length ?? 0;
  const landUseRadius = liveLandUse
    ? featureCollection(
        liveLandUse.features.filter((feature) =>
          featureTouchesAnalysisContext(feature, selectedPoint, radiusMeters, contextGeometry),
        ),
      )
    : undefined;
  const greenBlueRadius = liveGreenBlue
    ? featureCollection(
        liveGreenBlue.features.filter((feature) =>
          featureTouchesAnalysisContext(feature, selectedPoint, radiusMeters, contextGeometry),
        ),
      )
    : undefined;
  const hasLiveGreenResponse = liveGreenBlue !== undefined;
  const measuredGreenArea = greenBlueRadius ? collectionAreaSqm(greenBlueRadius, isGreenFeature) : 0;
  const greenPercent =
    hasLiveGreenResponse && measuredGreenArea > 0
      ? Math.min(100, Math.round((measuredGreenArea / Math.max(1, contextAreaSqm)) * 10_000) / 100)
      : null;
  const exactTransitStops = transportStopsRadius?.features.length;
  const exactTransitLines = transportLinesRadius?.features.filter(
    (feature) => feature.geometry.type === "LineString",
  ).length;
  const exactMobilityFeatures = mobilityRadius?.features.length;
  const exactPois = poisRadius?.features.length;
  const exactLandUseFeatures = landUseRadius?.features.length;
  const landUseSummary = summarizeLandUse(landUseRadius, contextAreaSqm);
  const transitSummary = summarizeTransitStops(transportStopsRadius, contextAreaSqm);
  const transitLineSummary = summarizeTransitLines(transportLinesRadius);
  const poiSummary = summarizeFeatureCategories(poisRadius, "poiCategory");
  const mobilitySummary = summarizeFeatureCategories(mobilityRadius, "mobilityMode");
  const isochroneSummary = summarizeFeatureCategories(liveIsochrones, "isochroneMode");
  const hasFallbackIsochrones = liveIsochrones?.features.some(
    (feature) => feature.properties?.retrievalStatus === "fallback",
  ) ?? false;
  const isochroneReachability = summarizeIsochroneReachability(poisRadius, liveIsochrones);
  const developmentSummary = summarizeFeatureCategories(developmentRadius, "landuse", "amenity", "disused", "abandoned");
  const landUseEntropyScore = calculateLandUseEntropyScore(landUseSummary);
  const poiDiversityScore = calculatePoiDiversityScore(poisRadius);
  const landUseMix = combineUrbanMixIndex(landUseEntropyScore, poiDiversityScore);
  const transitStops = transitSummary?.uniqueStopCount ?? exactTransitStops ?? null;
  const mobilityHints = exactMobilityFeatures ?? null;
  const mobilityScore = calculateMobilityScore({
    transitStops,
    transitDensity: transitSummary?.stopDensityPerSqkm ?? null,
    transitModeCounts: transitSummary?.modeCounts ?? [],
    mobilityCollection: mobilityRadius,
    isochroneCollection: liveIsochrones,
    activeReachabilityScore: isochroneReachability?.activeScore ?? null,
    multimodalReachabilityScore: mobilityScales.combinedScore,
  });
  const infrastructurePois = exactPois ?? null;
  const socialInfrastructureScore = calculateSocialInfrastructureScore(
    selectedPoint,
    poisRadius,
  );
  const treeCanopyScore = calculateTreeCanopyScore({
    trees: treesRadius,
    greenPercent,
    radiusMeters,
    contextAreaSqm,
  });
  const stationAxisScore = calculateStationAxisScore({
    selectedPoint,
    transitStops: transportStopsRadius,
    transitSummary,
    transitLineSummary,
  });
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
      label: contextGeometry ? "Project analysis area" : "Analysis radius",
      scale: "L",
      value: contextGeometry ? Math.round((contextAreaSqm / 10_000) * 100) / 100 : radiusMeters,
      unit: contextGeometry ? "ha" : "m",
      geometry: overlays.lBuffer.features[0]?.geometry,
      method: contextGeometry
        ? "Uploaded or drawn project boundary used as the L-scale analysis extent."
        : "Geometric buffer around selected point.",
      sourceIds: ["osm-core"],
      confidence: "medium",
      caveats: [
        contextGeometry
          ? "Feature evidence is included against the project boundary; network catchments remain separate accessibility evidence."
          : "MVP uses a geometric buffer. Network catchments are a later preprocessing enhancement.",
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
          ? `Computed from loaded Urban Atlas and/or live Overpass green/blue polygon area intersecting the ${contextDescription}.`
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
              "Polygon areas are approximated from intersecting source polygons and capped at 100%; exact clipping to the circular buffer or project boundary remains a geometry-processing refinement.",
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
      confidence: urbanAtlasFeatures > 0 || exactLandUseFeatures !== undefined ? "medium" : "low",
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
      confidence: urbanAtlasFeatures > 0 || exactLandUseFeatures !== undefined ? "medium" : "low",
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
      unit: contextGeometry ? "within project area" : "within radius",
      method:
        exactTransitStops !== undefined
          ? `Counted unique GTFS and live Overpass stop/platform/station points inside the ${contextDescription}, de-duplicated by rounded coordinate and name where possible.`
          : "Live transport stop retrieval was unavailable; no fallback count is emitted.",
      sourceIds: ["osm-core", "mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass"],
      confidence: transportStopsRadius ? "high" : "low",
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
      confidence: transportStopsRadius ? "high" : "low",
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
      confidence: transportStopsRadius ? "medium" : "low",
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
      geometry: transportLinesRadius?.features.find(
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
          ? `Counted live Overpass mobility infrastructure features inside the ${contextDescription} for cycleways, parking, charging, sharing, and pedestrian/cycle classes.${mobilitySummary ? ` Main classes: ${mobilitySummary}.` : ""}`
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
        "Compared routed OpenRouteService walking, cycling, and driving isochrone polygons by configured travel-time ranges and counted reachable POIs for each mode/time where POI points are available. Geometric fallback polygons are excluded from reachable counts.",
      sourceIds: ["openrouteservice-isochrones", "osm-core", "osm-overpass"],
      confidence: isochroneReachability?.confidence ?? "low",
      caveats: [
        isochroneSummary
          ? `Isochrone modes present: ${isochroneSummary}.`
          : "No isochrone polygons were available for mode/time comparison.",
        ...(isochroneReachability?.caveats ?? [
          hasFallbackIsochrones
            ? "Only geometric fallback catchments were available; they remain visual context and are excluded from routed POI reachability."
            : "POI reachability requires both POI points and routed isochrone polygons.",
        ]),
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
        ...(isochroneReachability?.caveats ?? [
          hasFallbackIsochrones
            ? "Only geometric fallback catchments were available; they remain visual context and are excluded from routed POI reachability."
            : "POI reachability requires both POI points and routed isochrone polygons.",
        ]),
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
        "Composite KPI from public-transport stop availability and density, transit mode hierarchy, OSM walking/cycling infrastructure hints, and walking/cycling/transit reachability. Car-driving reachability remains a separate context indicator and has zero composite weight.",
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
          ? `Counted live Overpass amenity/shop POIs relevant to social and civic infrastructure inside the ${contextDescription}.${poiSummary ? ` Main categories: ${poiSummary}.` : ""}`
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
      id: "l.tree-canopy-score",
      label: "Tree Canopy",
      scale: "L",
      value: treeCanopyScore.value,
      unit: "0-100",
      geometry: treesRadius?.features[0]?.geometry ?? overlays.green.features[0]?.geometry,
      method:
        treeCanopyScore.value !== null
          ? "Proxy score from loaded OSM tree/tree-row evidence and green/open-space share in the L-scale context."
          : "No tree, tree-row, or green-space evidence was available for a tree-canopy proxy.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: treeCanopyScore.confidence,
      caveats: [
        ...treeCanopyScore.caveats,
        "This is not measured canopy cover; it distinguishes mapped trees/tree rows from true canopy coverage.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.tree-canopy-evidence",
      label: "Tree canopy evidence",
      scale: "L",
      value: treeCanopyScore.detail,
      method:
        "Summarized tree count, tree-row evidence, and green/open-space support used by the Tree Canopy KPI.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: treeCanopyScore.confidence,
      caveats: treeCanopyScore.caveats,
      computedAt,
    }),
    createIndicator({
      id: "l.station-axis-score",
      label: "Station Axis",
      scale: "L",
      value: stationAxisScore.value,
      unit: "0-100",
      geometry: transportLinesRadius?.features.find(
        (feature) => feature.geometry.type === "LineString",
      )?.geometry ?? transportStopsRadius?.features.find((feature) => feature.geometry.type === "Point")?.geometry,
      method:
        stationAxisScore.value !== null
          ? "Screening score from nearest transit stop/station distance, mode hierarchy, stop density, and public-transport line or corridor evidence."
          : "No transit stop or line evidence was available for a station-axis proxy.",
      sourceIds: ["mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass", "osm-core"],
      confidence: stationAxisScore.confidence,
      caveats: [
        ...stationAxisScore.caveats,
        "Station Axis is a corridor/access screening metric, not a routing-grade accessibility model.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.station-axis-evidence",
      label: "Station axis evidence",
      scale: "L",
      value: stationAxisScore.detail,
      method:
        "Summarized nearest stop/station distance, high-capacity mode presence, stop density, and line evidence used by the Station Axis KPI.",
      sourceIds: ["mobilithek-gtfs", "gtfs-de-local-transit", "osm-overpass", "osm-core"],
      confidence: stationAxisScore.confidence,
      caveats: stationAxisScore.caveats,
      computedAt,
    }),
    createIndicator({
      id: "l.development-potential",
      label: "Development potential hints",
      scale: "L",
      value:
        (developmentRadius?.features.length ?? 0) > 0
          ? `${developmentRadius?.features.length} live OSM potential hints inside the ${contextDescription}`
          : developmentRadius
            ? "no live OSM development hints"
            : null,
      method:
        developmentRadius?.features.length
          ? `Read live Overpass brownfield, construction, parking, disused, abandoned and related development-hint classes.${developmentSummary ? ` Main tags: ${developmentSummary}.` : ""}`
          : "Live development-hint source did not return a usable response and no local preprocessing is loaded.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      confidence: developmentRadius ? "medium" : "low",
      caveats: [
        developmentRadius ? liveCaveat : caveat,
        "This is a screening hint, not a planning-law assessment.",
      ],
      computedAt,
    }),
    ...mobilityScales.indicators,
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
      confidence: urbanAtlasFeatures > 0 ? "medium" : "low",
      caveats: [caveat, urbanAtlasCaveat],
    },
    {
      id: "l.access-infrastructure",
      title: "Access and infrastructure",
      scale: "L",
      indicators: indicators.slice(5, 20),
      method: "Counts, class hints, mode/time isochrone comparison, and POI reachability within the selected context.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs", "gtfs-de-local-transit", "openrouteservice-isochrones"],
      computedAt,
      confidence: transportStopsRadius ? "medium" : "low",
      caveats: [
        transportStopsRadius
          ? `GTFS/OSM stop data were filtered to the ${contextDescription}; service frequency is not yet evaluated.`
          : caveat,
      ],
    },
    mobilityScales.module,
    {
      id: "l.potential",
      title: "Development hints",
      scale: "L",
      indicators: [indicators[20]],
      method: "Screening rules from open-data class hints.",
      sourceIds: ["osm-core", "copernicus-urban-atlas", "urban-atlas-2021-catalog"],
      computedAt,
      confidence: "low",
      caveats: indicators[20].caveats,
    },
  ];

  if (greenBlueRadius) {
    overlays.green = featureCollection(
      greenBlueRadius.features.filter((feature) => isGreenFeature(feature) && !isBlueFeature(feature)),
    );
    overlays.blue = featureCollection(greenBlueRadius.features.filter(isBlueFeature));
  }
  if (treesRadius) {
    overlays.trees = treesRadius;
  }

  return { modules, indicators, overlays };
}

function createLOverlays(
  selectedPoint: SelectedPoint,
  radiusMeters: number,
  mobilityScaleBuffers: ReturnType<typeof analyzeMobilityScales>["bufferFeatures"] = [],
  contextGeometry?: Polygon | MultiPolygon,
) {
  const { lat, lon } = selectedPoint;
  const lBuffer = featureCollection([
    geometryToFeature(contextGeometry ?? bufferPolygon(lat, lon, radiusMeters), {
      id: contextGeometry ? "l-project-area" : "l-buffer",
      label: contextGeometry ? "L project area" : `L context ${radiusMeters} m`,
      radiusMeters,
      contextType: contextGeometry ? "project-area" : "radius",
    }),
    ...mobilityScaleBuffers,
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
    (feature) =>
      (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") &&
      isRoutedIsochrone(feature),
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
    confidence: "medium",
    caveats: [
      `${poiPoints.length} loaded POI point(s) were tested against ${polygons.length} isochrone polygon(s).`,
      "Reachability counts reflect loaded POIs only; unmapped or uncategorized facilities are not inferred.",
      "Only live or cached routed OpenRouteService isochrones contribute to reachability; geometric fallback buffers are excluded.",
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
  multimodalReachabilityScore: number | null;
}): { value: number | null; confidence: "high" | "medium" | "low"; caveats: string[] } {
  const modeCounts = summarizeMobilityModeCounts(input.mobilityCollection);
  const isochroneScore = calculateActiveIsochroneScore(input.isochroneCollection);
  const reachabilityScore =
    input.multimodalReachabilityScore ??
    input.activeReachabilityScore ??
    isochroneScore;
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
    input.multimodalReachabilityScore !== null,
  ].filter(Boolean).length;
  if (availableInputs === 0) {
    return {
      value: null,
      confidence: "low",
      caveats: ["No transport, mobility, or isochrone inputs were available."],
    };
  }

  if (input.multimodalReachabilityScore !== null) {
    return {
      value: input.multimodalReachabilityScore,
      confidence: availableInputs >= 3 && !hasFallbackIsochrones ? "medium" : "low",
      caveats: [
        "Mobility Access KPI is now the weighted multimodal reachability score, not a separate radius-based calculation.",
        "Contributing weights are walking 35, cycling 25, and transit 25, normalized across available active/transit modes; car driving has zero urban-quality weight.",
        hasFallbackIsochrones
          ? "OpenRouteService routed isochrones were unavailable for at least one active mode; geometric fallback catchments were excluded from scoring and lower confidence."
          : "OpenRouteService routed isochrones are used where available, but transit timetable quality and service frequency are not yet scored.",
        `Mode-based multimodal score: ${input.multimodalReachabilityScore}. Supporting active POI score ${input.activeReachabilityScore ?? "not available"}, active isochrone context ${isochroneScore}.`,
      ],
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
    transitAccessScore * 0.2 +
      transitModeScore * 0.12 +
      walkingCyclingScore * 0.16 +
      isochroneScore * 0.12 +
      reachabilityScore * 0.4,
  );

  return {
    value: score,
    confidence: availableInputs >= 3 && !hasFallbackIsochrones ? "medium" : "low",
    caveats: [
      "Mobility score is a deterministic screening KPI, not a routing or service-quality model.",
      hasFallbackIsochrones
        ? "OpenRouteService routed isochrones were unavailable; geometric fallback catchments were excluded from scoring and lower confidence."
        : "OpenRouteService routed isochrones increase context but do not include timetable quality.",
      "Driving reachability is retained as comparison context and has zero weight in this urban-quality score.",
      `Mobility subscores: transit access ${transitAccessScore}, transit mode hierarchy ${transitModeScore}, walking/cycling infrastructure ${walkingCyclingScore}, walking/cycling isochrone context ${isochroneScore}, multimodal reachability ${reachabilityScore}.`,
    ],
  };
}

function calculateTreeCanopyScore(input: {
  trees: FeatureCollection | undefined;
  greenPercent: number | null;
  radiusMeters: number;
  contextAreaSqm?: number;
}): { value: number | null; confidence: "high" | "medium" | "low"; detail: string; caveats: string[] } {
  const features = input.trees?.features ?? [];
  const treeCount = features.filter((feature) => feature.geometry.type === "Point").length;
  const treeRows = features.filter((feature) => feature.geometry.type === "LineString").length;
  const greenScore =
    input.greenPercent === null
      ? null
      : Math.min(100, Math.round((input.greenPercent / 35) * 100));
  if (!features.length && greenScore === null) {
    return {
      value: null,
      confidence: "low",
      detail: "not available",
      caveats: ["No OSM tree/tree-row features or green/open-space percentage were available."],
    };
  }

  const areaSqkm = (input.contextAreaSqm ?? circleAreaSqm(input.radiusMeters)) / 1_000_000;
  const treeDensity = treeCount / Math.max(0.0001, areaSqkm);
  const treeCountScore = Math.min(100, Math.round((treeDensity / 65) * 100));
  const treeRowScore = Math.min(100, treeRows * 35);
  const fallbackGreenScore = greenScore ?? 0;
  const value = Math.round(
    treeCountScore * 0.45 +
      treeRowScore * 0.25 +
      fallbackGreenScore * 0.3,
  );
  const confidence =
    features.length >= 12
      ? "medium"
      : features.length > 0 || greenScore !== null
        ? "low"
        : "low";

  return {
    value,
    confidence,
    detail: `trees ${treeCount}, tree rows ${treeRows}, density ${Math.round(treeDensity)} trees/km2, green support ${greenScore ?? "n/a"}`,
    caveats: [
      `${treeCount} mapped tree point(s) and ${treeRows} tree-row feature(s) were loaded in the L-scale context.`,
      greenScore !== null
        ? `Green/open-space support score from green percentage: ${greenScore}.`
        : "No green/open-space percentage was available as supporting canopy context.",
      "Tree density target for the proxy is 65 mapped tree points per km2; sparse OSM tagging lowers confidence.",
    ],
  };
}

function calculateStationAxisScore(input: {
  selectedPoint: SelectedPoint;
  transitStops: FeatureCollection | undefined;
  transitSummary: TransitSummary | null;
  transitLineSummary: TransitLineSummary | null;
}): { value: number | null; confidence: "high" | "medium" | "low"; detail: string; caveats: string[] } {
  const stopPoints = (input.transitStops?.features ?? []).filter(
    (feature) => feature.geometry.type === "Point",
  );
  const lineCount = input.transitLineSummary?.lineLabels.length ?? 0;
  if (!stopPoints.length && lineCount === 0) {
    return {
      value: null,
      confidence: "low",
      detail: "not available",
      caveats: ["No GTFS/OSM transit stop or line evidence was available."],
    };
  }

  const nearestStop = nearestTransitStop(input.selectedPoint, stopPoints);
  const nearestDistance = nearestStop?.distance ?? null;
  const distanceScore =
    nearestDistance === null ? 0 : stationDistanceScore(nearestDistance);
  const modeScore = calculateTransitModeScore(input.transitSummary?.modeCounts ?? []);
  const densityScore =
    input.transitSummary?.stopDensityPerSqkm === undefined
      ? 0
      : Math.min(100, Math.round((input.transitSummary.stopDensityPerSqkm / 18) * 100));
  const lineScore = Math.min(100, lineCount * 16);
  const value = Math.round(
    distanceScore * 0.35 +
      modeScore * 0.25 +
      lineScore * 0.25 +
      densityScore * 0.15,
  );
  const highCapacityModes = (input.transitSummary?.modeCounts ?? [])
    .filter((item) => ["tram", "subway", "light_rail", "rail"].includes(item.mode) && item.count > 0)
    .map((item) => item.mode);
  const confidence =
    stopPoints.length > 0 && lineCount > 0
      ? "medium"
      : stopPoints.length > 0
        ? "low"
        : "low";

  return {
    value,
    confidence,
    detail: `nearest ${nearestDistance === null ? "n/a" : `${Math.round(nearestDistance)} m`}, modes ${formatModeMix(input.transitSummary?.modeCounts ?? [])}, lines ${lineCount}`,
    caveats: [
      nearestDistance === null
        ? "Nearest stop distance was not available."
        : `Nearest loaded stop/station is approximately ${Math.round(nearestDistance)} m away.`,
      highCapacityModes.length
        ? `High-capacity modes detected: ${highCapacityModes.join(", ")}.`
        : "No tram, subway, light-rail, or rail mode was detected in the loaded stop evidence.",
      `${lineCount} public-transport line label(s) were extracted from loaded Overpass route/corridor evidence.`,
      "GTFS stop points are preferred where preprocessed; OSM line relations may be incomplete.",
    ],
  };
}

function nearestTransitStop(
  selectedPoint: SelectedPoint,
  features: Feature[],
): { feature: Feature; distance: number } | null {
  const distances = features
    .filter((feature) => feature.geometry.type === "Point")
    .map((feature) => ({
      feature,
      distance: distanceBetweenCoordinates(
        [selectedPoint.lon, selectedPoint.lat],
        feature.geometry.type === "Point" ? feature.geometry.coordinates : [selectedPoint.lon, selectedPoint.lat],
      ),
    }))
    .sort((left, right) => left.distance - right.distance);
  return distances[0] ?? null;
}

function stationDistanceScore(distanceMeters: number): number {
  if (distanceMeters <= 300) return 100;
  if (distanceMeters <= 500) return 80;
  if (distanceMeters <= 800) return 55;
  if (distanceMeters <= 1_200) return 25;
  return 0;
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
    if (features.some(isRoutedIsochrone)) {
      score += 40;
    }
  }
  return Math.min(80, score);
}

function isRoutedIsochrone(feature: Feature): boolean {
  return feature.properties?.retrievalStatus === "live" ||
    feature.properties?.retrievalStatus === "cached";
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
  contextAreaSqm: number,
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
  const familyShares = [...areaByFamily.entries()]
    .map(([family, areaSqm]) => ({
      family,
      areaSqm,
      percent: Math.min(100, Math.round((areaSqm / Math.max(1, contextAreaSqm)) * 10_000) / 100),
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
  contextAreaSqm: number,
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
  const contextAreaSqkm = contextAreaSqm / 1_000_000;
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

function filterCollectionToContext(
  collection: FeatureCollection | undefined,
  selectedPoint: SelectedPoint,
  radiusMeters: number,
  contextGeometry?: Polygon | MultiPolygon,
): FeatureCollection | undefined {
  if (!collection) return undefined;
  return featureCollection(
    collection.features.filter((feature) =>
      featureTouchesAnalysisContext(
        feature,
        selectedPoint,
        radiusMeters,
        contextGeometry,
      ),
    ),
  );
}

function featureTouchesAnalysisContext(
  feature: Feature,
  selectedPoint: SelectedPoint,
  radiusMeters: number,
  contextGeometry?: Polygon | MultiPolygon,
): boolean {
  if (!contextGeometry) {
    return featureTouchesRadius(feature, selectedPoint, radiusMeters);
  }
  const featureCoordinates: number[][] = [];
  collectGeometryCoordinates(feature.geometry, featureCoordinates);
  if (featureCoordinates.some((coordinate) => geometryContainsCoordinate(contextGeometry, coordinate))) {
    return true;
  }
  const contextCoordinates: number[][] = [];
  collectGeometryCoordinates(contextGeometry, contextCoordinates);
  if (
    (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") &&
    contextCoordinates.some((coordinate) => containsCoordinate(feature, coordinate))
  ) {
    return true;
  }
  const featureSegments = geometrySegments(feature.geometry);
  const contextSegments = geometrySegments(contextGeometry);
  return featureSegments.some(([featureStart, featureEnd]) =>
    contextSegments.some(([contextStart, contextEnd]) =>
      segmentsIntersect(featureStart, featureEnd, contextStart, contextEnd),
    ),
  );
}

function featureTouchesRadius(
  feature: Feature,
  selectedPoint: SelectedPoint,
  radiusMeters: number,
): boolean {
  const selectedCoordinate = [selectedPoint.lon, selectedPoint.lat];
  if (feature.geometry.type === "Point") {
    return (
      distanceBetweenCoordinates(
        selectedCoordinate,
        feature.geometry.coordinates,
      ) <= radiusMeters
    );
  }
  if (
    (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") &&
    containsCoordinate(feature, selectedCoordinate)
  ) {
    return true;
  }
  const coordinates: number[][] = [];
  collectGeometryCoordinates(feature.geometry, coordinates);
  if (
    coordinates.some(
      (coordinate) =>
        distanceBetweenCoordinates(selectedCoordinate, coordinate) <= radiusMeters,
    )
  ) {
    return true;
  }
  return geometrySegments(feature.geometry).some(
    ([start, end]) =>
      pointToSegmentDistanceMeters(selectedCoordinate, start, end) <= radiusMeters,
  );
}

function geometryContainsCoordinate(
  geometry: Polygon | MultiPolygon,
  coordinate: number[],
): boolean {
  if (geometry.type === "Polygon") {
    return polygonContainsCoordinate(geometry.coordinates, coordinate);
  }
  return geometry.coordinates.some((polygon) =>
    polygonContainsCoordinate(polygon, coordinate),
  );
}

function geometrySegments(
  geometry: Feature["geometry"],
): Array<[number[], number[]]> {
  const segments: Array<[number[], number[]]> = [];
  const appendLine = (coordinates: number[][]) => {
    for (let index = 1; index < coordinates.length; index += 1) {
      segments.push([coordinates[index - 1], coordinates[index]]);
    }
  };
  if (geometry.type === "LineString") appendLine(geometry.coordinates);
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    for (const line of geometry.coordinates) appendLine(line);
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) appendLine(ring);
    }
  }
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) {
      segments.push(...geometrySegments(child));
    }
  }
  return segments;
}

function segmentsIntersect(
  leftStart: number[],
  leftEnd: number[],
  rightStart: number[],
  rightEnd: number[],
): boolean {
  const orientation = (a: number[], b: number[], c: number[]) =>
    (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  const onSegment = (a: number[], b: number[], c: number[]) =>
    b[0] <= Math.max(a[0], c[0]) + Number.EPSILON &&
    b[0] + Number.EPSILON >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + Number.EPSILON &&
    b[1] + Number.EPSILON >= Math.min(a[1], c[1]);
  const first = orientation(leftStart, leftEnd, rightStart);
  const second = orientation(leftStart, leftEnd, rightEnd);
  const third = orientation(rightStart, rightEnd, leftStart);
  const fourth = orientation(rightStart, rightEnd, leftEnd);
  if ((first > 0) !== (second > 0) && (third > 0) !== (fourth > 0)) return true;
  if (Math.abs(first) <= Number.EPSILON && onSegment(leftStart, rightStart, leftEnd)) return true;
  if (Math.abs(second) <= Number.EPSILON && onSegment(leftStart, rightEnd, leftEnd)) return true;
  if (Math.abs(third) <= Number.EPSILON && onSegment(rightStart, leftStart, rightEnd)) return true;
  return Math.abs(fourth) <= Number.EPSILON && onSegment(rightStart, leftEnd, rightEnd);
}

function geometryAreaSqm(geometry: Polygon | MultiPolygon): number {
  return geometry.type === "Polygon"
    ? polygonAreaSqm(geometry)
    : multiPolygonAreaSqm(geometry);
}

function collectGeometryCoordinates(
  geometry: Feature["geometry"],
  coords: number[][],
): void {
  if (geometry.type === "Point") coords.push(geometry.coordinates);
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") {
    pushCoordinates(coords, geometry.coordinates);
  }
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) pushCoordinates(coords, ring);
  }
  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) pushCoordinates(coords, line);
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) pushCoordinates(coords, ring);
    }
  }
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) {
      collectGeometryCoordinates(child, coords);
    }
  }
}

function pushCoordinates(target: number[][], coordinates: number[][]): void {
  for (const coordinate of coordinates) target.push(coordinate);
}

function pointToSegmentDistanceMeters(
  point: number[],
  segmentStart: number[],
  segmentEnd: number[],
): number {
  const referenceLat = point[1];
  const projectedPoint = projectMeters(point, referenceLat);
  const projectedStart = projectMeters(segmentStart, referenceLat);
  const projectedEnd = projectMeters(segmentEnd, referenceLat);
  const dx = projectedEnd.x - projectedStart.x;
  const dy = projectedEnd.y - projectedStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    return Math.hypot(
      projectedPoint.x - projectedStart.x,
      projectedPoint.y - projectedStart.y,
    );
  }
  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((projectedPoint.x - projectedStart.x) * dx +
        (projectedPoint.y - projectedStart.y) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    projectedPoint.x - (projectedStart.x + ratio * dx),
    projectedPoint.y - (projectedStart.y + ratio * dy),
  );
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
