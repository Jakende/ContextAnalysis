import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import type {
  AnalysisResult,
  FactSheetModule,
  Indicator,
  SectionLine,
  SelectedPoint,
} from "../../types";
import {
  featureCollection,
  geometryToFeature,
  polygonFromLineCorridor,
} from "../geometry";
import { createIndicator } from "../indicators/createIndicator";

type BuildingGeometry = Polygon | MultiPolygon;
type BuildingFeature = Feature<BuildingGeometry>;

type BuildingHeightInfo = {
  height: number;
  source: "measured" | "levels-estimated" | "default-estimated";
};

export function analyzeM(
  selectedPoint: SelectedPoint,
  computedAt: string,
  liveCollections: Record<string, FeatureCollection | undefined> = {},
  sectionLine?: SectionLine | null,
  terrainSamples: Array<{ distance: number; elevation: number }> = [],
): { modules: FactSheetModule[]; indicators: Indicator[]; overlays: ReturnType<typeof createMOverlays>; sectionSvg: string } {
  const overlays = createMOverlays(selectedPoint, sectionLine);
  const liveStreetFeatures = (liveCollections.streets?.features ?? []).filter(
    (feature): feature is Feature<LineString> =>
      feature.geometry.type === "LineString",
  );
  const liveBuildingFeatures = (liveCollections.buildings?.features ?? [])
    .filter(isBuildingFeature)
    .map(enrichBuildingFeature);
  const liveTreeFeatures = liveCollections.trees?.features ?? [];
  const streetFeature = nearestLineFeature(
    liveStreetFeatures,
    selectedPoint.lat,
    selectedPoint.lon,
  );
  const liveStreetName =
    typeof streetFeature?.properties?.name === "string"
      ? streetFeature.properties.name
      : undefined;
  const streetName =
    liveStreetName ?? "not available";

  if (streetFeature) {
    overlays.street = featureCollection([streetFeature]);
    overlays.corridor = featureCollection([
      geometryToFeature(polygonFromLineCorridor(streetFeature.geometry, 42), {
        id: "m-live-corridor",
        widthMeters: 42,
        sourceId: "osm-core",
      }),
    ]);
  } else {
    overlays.street = featureCollection();
    overlays.corridor = featureCollection();
  }
  const corridorBuildingFeatures = streetFeature
    ? nearestPolygonFeatures(liveBuildingFeatures, streetFeature.geometry, 70)
    : liveBuildingFeatures;
  const corridorTreeFeatures = streetFeature
    ? featuresNearLine(liveTreeFeatures, streetFeature.geometry, 55)
    : liveTreeFeatures;

  const displayedBuildingFeatures = liveBuildingFeatures.length
    ? liveBuildingFeatures
    : corridorBuildingFeatures;
  const displayedTreeFeatures = liveTreeFeatures.length
    ? liveTreeFeatures
    : corridorTreeFeatures;

  if (displayedBuildingFeatures.length) {
    overlays.buildings = featureCollection(displayedBuildingFeatures);
  } else {
    overlays.buildings = featureCollection();
  }
  if (displayedTreeFeatures.length) {
    overlays.trees = featureCollection(displayedTreeFeatures);
  } else {
    overlays.trees = featureCollection();
  }

  const streetSegment = overlays.street.features[0]?.geometry;
  const hasLiveStreet = Boolean(streetFeature);
  const hasLiveBuildings = corridorBuildingFeatures.length > 0;
  const hasLiveTrees = corridorTreeFeatures.length > 0;
  const taggedWidth = readNumericTag(streetFeature, ["width", "est_width"]);
  const measuredWidth = taggedWidth === null ? null : Math.round(taggedWidth);
  const liveBuildingHeightInfo =
    corridorBuildingFeatures
      .map((feature) => readBuildingHeight(feature))
      .sort((left, right) =>
        (left?.source === "measured" ? 0 : 1) - (right?.source === "measured" ? 0 : 1),
      )
      .find((height): height is BuildingHeightInfo => height !== null) ?? null;
  const buildingHeight = liveBuildingHeightInfo === null ? null : Math.round(liveBuildingHeightInfo.height);
  const treePresence = liveCollections.trees ? corridorTreeFeatures.length : null;
  const sectionModel = createSectionModel({
    sectionLine,
    selectedPoint,
    buildings: sectionLine ? liveBuildingFeatures : corridorBuildingFeatures,
    trees: corridorTreeFeatures,
    terrainSamples,
  });
  const sectionSvg = createSectionSvg({
    streetName,
    width: measuredWidth,
    height: buildingHeight,
    trees: treePresence,
    model: sectionModel,
  });
  const liveCaveat =
    "Live OSM/Overpass geometry was queried for this point; completeness depends on OSM tagging.";
  const fallbackCaveat =
    "No live street-level source result was available for this module; missing values are shown explicitly.";
  const caveat = hasLiveStreet || hasLiveBuildings || hasLiveTrees ? liveCaveat : fallbackCaveat;

  const indicators = [
    createIndicator({
      id: "m.street-segment",
      label: "Street segment",
      scale: "M",
      value: hasLiveStreet ? streetName : null,
      geometry: streetSegment,
      method:
        hasLiveStreet
          ? "Selected point snapped to the nearest valid live Overpass street segment within the configured M-scale radius."
          : "Live street source did not return a usable segment and no preprocessed street network is loaded.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: hasLiveStreet ? "medium" : "low",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "m.street-width",
      label: "Approximate cross-section width",
      scale: "M",
      value: measuredWidth,
      unit: "m",
      method:
        taggedWidth !== null
          ? "Street width read from live OSM width/est_width tags."
          : "Live street source did not return measured width tags and no local street cross-section data is loaded.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence:
        hasLiveStreet && taggedWidth !== null
          ? "medium"
          : "low",
      caveats: [
        caveat,
        taggedWidth === null
          ? "No OSM width/est_width tag was available; no inferred width is emitted."
          : "OSM width tags are not cadastral measurements.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "m.tree-presence",
      label: "Tree / green edge",
      scale: "M",
      value: treePresence,
      unit: "trees or rows",
      geometry: overlays.trees.features[0]?.geometry,
      method:
        hasLiveTrees
          ? "Counted live Overpass natural=tree and tree_row features along the M-scale corridor."
          : "Live tree retrieval returned no features; no fallback tree hints are emitted.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: hasLiveTrees ? "medium" : "low",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "m.building-height",
      label: "Building massing",
      scale: "M",
      value: buildingHeight,
      unit: buildingHeight === null ? undefined : "m",
      geometry: overlays.buildings.features[0]?.geometry,
      method:
        hasLiveBuildings
          ? "Read loaded building footprints and direct height tags where present; if a footprint has no measured height, the M-section uses a visibly labelled estimated height from levels or a conservative default."
          : "No live OSM building footprint/height data and no local LOD2 tiles are loaded for this point.",
      sourceIds: ["lod2-deutschland-bkg", "lod2-federal-states", "lod2-bayern", "overture-buildings", "overture-building-parts", "osm-core"],
      confidence: hasLiveBuildings && liveBuildingHeightInfo?.source === "measured" ? "medium" : "low",
      caveats: [
        caveat,
        liveBuildingHeightInfo?.source === "measured"
          ? "At least one intersecting building has a measured height attribute."
          : "Estimated heights are only used for section/3D visualization when measured height is missing and are marked as estimated.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "m.sun-shadow",
      label: "Sun / shadow hint",
      scale: "M",
      value: null,
      geometry: overlays.sun.features[0]?.geometry,
      method:
        "No sun/shadow value is emitted until a validated solar model is connected to real building and date/time inputs.",
      sourceIds: ["lod2-deutschland-bkg", "lod2-federal-states", "lod2-bayern", "overture-buildings", "dwd-cdc", "dwd-cdc-grids-germany"],
      confidence: "low",
      caveats: [
        caveat,
        "Sun and shadow are qualitative hints only until validated solar modelling is connected.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "m.frontage-condition",
      label: "Street-edge condition",
      scale: "M",
      value:
        hasLiveStreet || hasLiveBuildings || hasLiveTrees
          ? "mixed live OSM edge evidence"
          : null,
      method:
        hasLiveStreet || hasLiveBuildings || hasLiveTrees
          ? "Combines live street, building, and tree hints with the local corridor model."
          : "Live frontage-relevant street/building/tree sources did not return usable data.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: hasLiveStreet || hasLiveBuildings || hasLiveTrees ? "medium" : "low",
      caveats: [caveat, "Active frontage must be verified from field survey or richer POI/frontage data."],
      computedAt,
    }),
    createIndicator({
      id: "m.section-line",
      label: "User-defined section line",
      scale: "M",
      value: sectionLine ? `${Math.round(sectionModel.lengthMeters)} m` : null,
      unit: sectionLine ? "section length" : undefined,
      geometry: sectionLineToGeometry(sectionLine),
      method:
        sectionLine
          ? "Section is calculated from the user-defined line. Loaded building footprints, tree locations, and available OpenTopography DEM samples are projected onto the section; missing building heights are labelled as estimated."
          : "No user-defined section line is set. The section SVG stays in setup mode instead of rendering a generic street section.",
      sourceIds: ["opentopography-dem", "lod2-deutschland-bkg", "lod2-federal-states", "lod2-bayern", "overture-buildings", "osm-core", "osm-overpass"],
      confidence: sectionLine ? "medium" : "low",
      caveats: [
        sectionLine
          ? terrainSamples.length > 0
            ? "Terrain samples come from the configured local OpenTopography DEM GeoJSON; no synthetic terrain is emitted."
            : "No local OpenTopography DEM samples were found for the drawn line; the SVG uses an approximate visual baseline and does not emit measured elevation values."
          : "Set a section line in M scale to calculate a meaningful cross-section.",
      ],
      computedAt,
    }),
  ];

  const modules: FactSheetModule[] = [
    {
      id: "m.street-profile",
      title: "Street segment profile",
      scale: "M",
      indicators: indicators.slice(0, 3),
      method: "Street segment, corridor, and edge hints around selected point.",
      sourceIds: ["osm-core", "osm-overpass"],
      computedAt,
      confidence: "low",
      caveats: [caveat],
    },
    {
      id: "m.massing-sun",
      title: "Massing and sun",
      scale: "M",
      indicators: indicators.slice(3, 5),
      method: "LOD2-ready massing and approximate sun/shadow module.",
      sourceIds: ["lod2-deutschland-bkg", "lod2-federal-states", "lod2-bayern", "overture-buildings", "dwd-cdc", "dwd-cdc-grids-germany", "osm-core"],
      computedAt,
      confidence: "low",
      caveats: [caveat],
    },
    {
      id: "m.section",
      title: "Cross-section and edge condition",
      scale: "M",
      indicators: [indicators[1], indicators[5], indicators[6]],
      method:
        "User-defined section line with footprint intersections, projected tree evidence, and local DEM terrain where available.",
      sourceIds: ["osm-core", "osm-overpass", "lod2-deutschland-bkg", "lod2-federal-states", "lod2-bayern", "overture-buildings", "opentopography-dem"],
      computedAt,
      confidence: sectionLine ? "medium" : "low",
      caveats: [
        caveat,
        sectionLine
          ? "Section dimensions are driven by the drawn line rather than a generic template."
          : "No section line has been drawn yet.",
      ],
    },
  ];

  return { modules, indicators, overlays, sectionSvg };
}

export function recomputeMSectionFromAnalysis(
  analysis: AnalysisResult,
  sectionLine: SectionLine,
  terrainSamples: Array<{ distance: number; elevation: number }> = [],
): { result: AnalysisResult; sectionSvg: string } {
  const computedAt = new Date().toISOString();
  const buildings = analysis.overlays.buildings.features.filter(
    isBuildingFeature,
  ).map(enrichBuildingFeature);
  const trees = analysis.overlays.trees.features.filter(
    (feature) =>
      feature.geometry.type === "Point" || feature.geometry.type === "LineString",
  );
  const streetName = stringIndicatorValue(analysis, "m.street-segment") ?? "M-scale section";
  const width = numberIndicatorValue(analysis, "m.street-width");
  const buildingHeight =
    buildings
      .map((feature) => readBuildingHeight(feature)?.height ?? null)
      .filter((height): height is number => height !== null)
      .sort((a, b) => b - a)[0] ?? null;
  const sectionModel = createSectionModel({
    sectionLine,
    selectedPoint: analysis.selectedPoint,
    buildings,
    trees,
    terrainSamples,
  });
  const sectionSvg = createSectionSvg({
    streetName,
    width,
    height: buildingHeight,
    trees: trees.length,
    model: sectionModel,
  });
  const sectionIndicator = createIndicator({
    id: "m.section-line",
    label: "User-defined section line",
    scale: "M",
    value: `${Math.round(sectionModel.lengthMeters)} m`,
    unit: "section length",
    geometry: sectionLineToGeometry(sectionLine),
    method:
      "Section is calculated immediately from the user-defined line and the already loaded M-scale building/tree overlays plus configured local OpenTopography DEM samples where available; missing building heights are labelled as estimated.",
    sourceIds: ["opentopography-dem", "lod2-deutschland-bkg", "lod2-federal-states", "lod2-bayern", "overture-buildings", "osm-core", "osm-overpass"],
    confidence: "medium",
    caveats: [
      terrainSamples.length > 0
        ? "Terrain samples come from the configured local OpenTopography DEM GeoJSON; no synthetic terrain is emitted."
        : "Section dimensions are driven by the drawn line; no local OpenTopography DEM samples were found, so the SVG uses an approximate visual baseline without measured elevation values.",
    ],
    computedAt,
  });
  const indicators = replaceIndicator(analysis.indicators, sectionIndicator);
  const modules = analysis.modules.map((module) =>
    module.id === "m.section"
      ? {
          ...module,
          indicators: replaceIndicator(module.indicators, sectionIndicator),
          method:
            "User-defined section line with footprint intersections, projected tree evidence, and local DEM terrain where available.",
          sourceIds: uniqueSourceIds([
            ...module.sourceIds,
            "opentopography-dem",
            "lod2-deutschland-bkg",
            "lod2-federal-states",
            "lod2-bayern",
            "overture-buildings",
            "osm-core",
            "osm-overpass",
          ]),
          computedAt,
          confidence: "medium" as const,
          caveats: [
            "Section dimensions are driven by the drawn line rather than a generic template.",
          ],
        }
      : module,
  );

  return {
    sectionSvg,
    result: {
      ...analysis,
      modules,
      indicators,
      overlays: {
        ...analysis.overlays,
        sectionLine: featureCollection([createSectionLineFeature(sectionLine)]),
      },
      provenance: {
        ...analysis.provenance,
        sourceIds: uniqueSourceIds([
          ...analysis.provenance.sourceIds,
          "opentopography-dem",
          "lod2-deutschland-bkg",
          "lod2-federal-states",
          "lod2-bayern",
          "overture-buildings",
          "osm-core",
        ]),
        caveats: [
          ...analysis.provenance.caveats.filter(
            (caveat) => !caveat.includes("Section dimensions are driven"),
          ),
          "Section dimensions are driven by the user-defined section line.",
        ],
      },
    },
  };
}

function replaceIndicator(indicators: Indicator[], indicator: Indicator): Indicator[] {
  const exists = indicators.some((item) => item.id === indicator.id);
  if (!exists) return [...indicators, indicator];
  return indicators.map((item) => (item.id === indicator.id ? indicator : item));
}

function uniqueSourceIds(sourceIds: string[]): string[] {
  return [...new Set(sourceIds)];
}

function stringIndicatorValue(
  analysis: AnalysisResult,
  indicatorId: string,
): string | undefined {
  const value = analysis.indicators.find((indicator) => indicator.id === indicatorId)?.value;
  return typeof value === "string" ? value : undefined;
}

function numberIndicatorValue(
  analysis: AnalysisResult,
  indicatorId: string,
): number | null {
  const value = analysis.indicators.find((indicator) => indicator.id === indicatorId)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nearestLineFeature(
  features: Array<Feature<LineString>>,
  lat: number,
  lon: number,
): Feature<LineString> | undefined {
  return features
    .map((feature) => ({
      feature,
      distance: lineDistanceToPoint(feature.geometry, lat, lon),
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance)[0]?.feature;
}

function isBuildingFeature(feature: Feature): feature is BuildingFeature {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}

function enrichBuildingFeature(feature: BuildingFeature): BuildingFeature {
  const info = readBuildingHeight(feature);
  return {
    ...feature,
    properties: {
      ...(feature.properties ?? {}),
      ...(info
        ? {
            sectionHeightMeters: info.height,
            sectionHeightSource: info.source,
            ...(info.source === "measured" ? {} : { estimatedHeight: info.height }),
          }
        : {}),
    },
  };
}

function nearestPolygonFeatures(
  features: BuildingFeature[],
  line: LineString,
  maxDistanceMeters: number,
): BuildingFeature[] {
  return features
    .map((feature) => ({
      feature,
      distance: polygonDistanceToLine(feature.geometry, line),
    }))
    .filter((candidate) => candidate.distance <= maxDistanceMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 18)
    .map((candidate) => candidate.feature);
}

function featuresNearLine(
  features: Feature[],
  line: LineString,
  maxDistanceMeters: number,
): Feature[] {
  return features.filter(
    (feature) => featureDistanceToLine(feature, line) <= maxDistanceMeters,
  );
}

function featureDistanceToLine(feature: Feature, line: LineString): number {
  if (feature.geometry.type === "Point") {
    return lineDistanceToPoint(
      line,
      feature.geometry.coordinates[1],
      feature.geometry.coordinates[0],
    );
  }
  if (feature.geometry.type === "LineString") {
    return Math.min(
      ...feature.geometry.coordinates.map((coordinate) =>
        lineDistanceToPoint(line, coordinate[1], coordinate[0]),
      ),
    );
  }
  if (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") {
    return polygonDistanceToLine(feature.geometry, line);
  }
  return Number.POSITIVE_INFINITY;
}

function polygonDistanceToLine(geometry: BuildingGeometry, line: LineString): number {
  const rings = exteriorRings(geometry);
  if (!rings.length) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...rings.flatMap((ring) =>
      ring.map((coordinate) =>
        lineDistanceToPoint(line, coordinate[1], coordinate[0]),
      ),
    ),
  );
}

function lineDistanceToPoint(line: LineString, lat: number, lon: number): number {
  if (line.coordinates.length < 2) return Number.POSITIVE_INFINITY;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.coordinates.length; index += 1) {
    minDistance = Math.min(
      minDistance,
      segmentDistanceMeters(
        line.coordinates[index - 1],
        line.coordinates[index],
        [lon, lat],
      ),
    );
  }
  return minDistance;
}

function segmentDistanceMeters(
  start: number[],
  end: number[],
  point: number[],
): number {
  const refLat = (start[1] + end[1] + point[1]) / 3;
  const startMeters = projectMeters(start, refLat);
  const endMeters = projectMeters(end, refLat);
  const pointMeters = projectMeters(point, refLat);
  const dx = endMeters.x - startMeters.x;
  const dy = endMeters.y - startMeters.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pointMeters.x - startMeters.x) * dx + (pointMeters.y - startMeters.y) * dy) /
        lengthSquared,
    ),
  );
  const closestX = startMeters.x + t * dx;
  const closestY = startMeters.y + t * dy;
  return Math.hypot(pointMeters.x - closestX, pointMeters.y - closestY);
}

function projectMeters(coordinate: number[], referenceLat: number) {
  const latRadians = (referenceLat * Math.PI) / 180;
  return {
    x: coordinate[0] * 111_320 * Math.cos(latRadians),
    y: coordinate[1] * 111_320,
  };
}

function readNumericTag(
  feature: Feature | undefined,
  keys: string[],
): number | null {
  if (!feature?.properties) return null;
  for (const key of keys) {
    const raw = feature.properties[key];
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const numeric = Number(String(raw).replace(",", ".").replace(/[^\d.]/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function readBuildingHeight(feature: Feature): BuildingHeightInfo | null {
  const direct = readNumericTag(feature, [
    "height",
    "building:height",
    "measuredHeight",
    "measured_height",
    "heightMeters",
    "sectionHeightMeters",
  ]);
  if (direct !== null && direct > 0) {
    return { height: clampHeight(direct), source: "measured" };
  }
  const levels = readNumericTag(feature, [
    "building:levels",
    "levels",
    "building_levels",
    "render_levels",
  ]);
  if (levels !== null && levels > 0) {
    return { height: clampHeight(levels * 3.2), source: "levels-estimated" };
  }
  if (feature.properties?.building || feature.properties?.sourceId === "overture-buildings") {
    return { height: 11.5, source: "default-estimated" };
  }
  return null;
}

function clampHeight(height: number): number {
  return Math.max(2.5, Math.min(180, height));
}

function pointCoordinatesForTree(feature: Feature): number[][] {
  if (feature.geometry.type === "Point") {
    return [feature.geometry.coordinates as Point["coordinates"]];
  }
  if (feature.geometry.type === "LineString") {
    return sampleLineCoordinates(feature.geometry.coordinates, 18);
  }
  return [];
}

function sampleLineCoordinates(coordinates: number[][], everyMeters: number): number[][] {
  if (coordinates.length < 2) return coordinates;
  const sampled: number[][] = [];
  let carried = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const length = segmentDistanceMeters(start, end, [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
    ]);
    const steps = Math.max(1, Math.floor((length + carried) / everyMeters));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / Math.max(1, steps);
      sampled.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
    carried = (length + carried) % everyMeters;
  }
  return sampled;
}

function createMOverlays(_selectedPoint: SelectedPoint, sectionLine?: SectionLine | null) {
  return {
    street: featureCollection(),
    corridor: featureCollection(),
    buildings: featureCollection(),
    trees: featureCollection(),
    sun: featureCollection(),
    sectionLine: sectionLine
      ? featureCollection([createSectionLineFeature(sectionLine)])
      : featureCollection(),
  };
}

type SectionModel = {
  line: SectionLine | null;
  lengthMeters: number;
  terrainStatus: "measured" | "approximate";
  terrainSamples: Array<{ distance: number; elevation: number }>;
  buildings: Array<{
    start: number;
    end: number;
    height: number;
    heightSource: BuildingHeightInfo["source"];
    side: "left" | "right" | "center";
    setbackMeters: number;
    sourceId?: string;
    label: string;
  }>;
  trees: Array<{ distance: number; canopyHeight: number; side: "left" | "right" | "center" }>;
};

function sectionLineToGeometry(sectionLine?: SectionLine | null): LineString | undefined {
  if (!sectionLine) return undefined;
  return {
    type: "LineString",
    coordinates: [
      [sectionLine.start.lon, sectionLine.start.lat],
      [sectionLine.end.lon, sectionLine.end.lat],
    ],
  };
}

function createSectionLineFeature(sectionLine: SectionLine): Feature<LineString> {
  return geometryToFeature(sectionLineToGeometry(sectionLine)!, {
    id: "m-user-section-line",
    sourceId: "user-defined-section",
  }) as Feature<LineString>;
}

function createSectionModel(input: {
  sectionLine?: SectionLine | null;
  selectedPoint: SelectedPoint;
  buildings: BuildingFeature[];
  trees: Feature[];
  terrainSamples?: Array<{ distance: number; elevation: number }>;
}): SectionModel {
  if (!input.sectionLine) {
    return {
      line: null,
      lengthMeters: 0,
      terrainStatus: "approximate",
      terrainSamples: [],
      buildings: [],
      trees: [],
    };
  }

  const line = sectionLineToGeometry(input.sectionLine);
  if (!line) {
    return {
      line: null,
      lengthMeters: 0,
      terrainStatus: "approximate",
      terrainSamples: [],
      buildings: [],
      trees: [],
    };
  }

  const start = line.coordinates[0];
  const end = line.coordinates[1];
  const refLat = (start[1] + end[1]) / 2;
  const startMeters = projectMeters(start, refLat);
  const endMeters = projectMeters(end, refLat);
  const dx = endMeters.x - startMeters.x;
  const dy = endMeters.y - startMeters.y;
  const lengthMeters = Math.max(1, Math.hypot(dx, dy));

  return {
    line: input.sectionLine,
    lengthMeters,
    terrainStatus: input.terrainSamples?.length ? "measured" : "approximate",
    terrainSamples: input.terrainSamples?.length
      ? input.terrainSamples
      : createApproximateTerrainSamples(lengthMeters),
    buildings: input.buildings
      .map((feature) => projectPolygonToSection(feature, startMeters, dx, dy, lengthMeters, refLat))
      .filter((item): item is SectionModel["buildings"][number] => item !== null)
      .sort((left, right) => left.start - right.start || left.setbackMeters - right.setbackMeters)
      .slice(0, 80),
    trees: input.trees
      .flatMap((feature) => pointCoordinatesForTree(feature))
      .map((coordinate) => projectPointToSection(coordinate, startMeters, dx, dy, lengthMeters, refLat))
      .filter((item): item is SectionModel["trees"][number] => item !== null)
      .slice(0, 80),
  };
}

function projectPolygonToSection(
  feature: BuildingFeature,
  startMeters: { x: number; y: number },
  dx: number,
  dy: number,
  lengthMeters: number,
  refLat: number,
): SectionModel["buildings"][number] | null {
  const heightInfo = readBuildingHeight(feature);
  if (!heightInfo || heightInfo.height <= 0) return null;
  const rings = exteriorRings(feature.geometry);
  const candidates = rings
    .map((ring) => {
      const projected = ring.map((coordinate) =>
        projectCoordinateToSection(coordinate, startMeters, dx, dy, lengthMeters, refLat),
      );
      return (
        projectedRingIntersection(projected, lengthMeters) ??
        projectedRingNearInterval(projected, lengthMeters)
      );
    })
    .filter((item): item is { start: number; end: number; setbackMeters: number; side: "left" | "right" | "center" } => item !== null)
    .sort((left, right) => left.setbackMeters - right.setbackMeters || (right.end - right.start) - (left.end - left.start));
  const interval = candidates[0];
  if (!interval) return null;
  return {
    start: interval.start,
    end: interval.end,
    height: heightInfo.height,
    heightSource: heightInfo.source,
    side: interval.side,
    setbackMeters: interval.setbackMeters,
    sourceId: typeof feature.properties?.sourceId === "string" ? feature.properties.sourceId : undefined,
    label: buildingLabel(feature),
  };
}

function projectedRingIntersection(
  projected: Array<{ distance: number; sideOffset: number }>,
  lengthMeters: number,
): { start: number; end: number; setbackMeters: number; side: "left" | "right" | "center" } | null {
  if (projected.length < 3) return null;
  const cuts = [0, lengthMeters];
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    if (current.sideOffset === 0) cuts.push(current.distance);
    const crosses =
      (current.sideOffset < 0 && next.sideOffset > 0) ||
      (current.sideOffset > 0 && next.sideOffset < 0);
    if (!crosses) continue;
    const t = current.sideOffset / (current.sideOffset - next.sideOffset);
    const distance = current.distance + (next.distance - current.distance) * t;
    if (distance >= 0 && distance <= lengthMeters) cuts.push(distance);
  }
  const sortedCuts = uniqueSorted(cuts.map((distance) => clamp(distance, 0, lengthMeters)));
  const intervals: Array<{ start: number; end: number }> = [];
  for (let index = 1; index < sortedCuts.length; index += 1) {
    const start = sortedCuts[index - 1];
    const end = sortedCuts[index];
    if (end - start < 0.75) continue;
    const mid = (start + end) / 2;
    if (ringContainsProjectedPoint(projected, mid, 0)) {
      intervals.push({ start, end });
    }
  }
  if (!intervals.length) return null;
  const best = intervals.sort((left, right) => right.end - right.start - (left.end - left.start))[0];
  return {
    ...best,
    setbackMeters: 0,
    side: "center",
  };
}

function projectedRingNearInterval(
  projected: Array<{ distance: number; sideOffset: number }>,
  lengthMeters: number,
): { start: number; end: number; setbackMeters: number; side: "left" | "right" | "center" } | null {
  if (projected.length < 3) return null;
  const minProjectedDistance = Math.min(...projected.map((point) => point.distance));
  const maxProjectedDistance = Math.max(...projected.map((point) => point.distance));
  if (maxProjectedDistance < -24 || minProjectedDistance > lengthMeters + 24) return null;
  const overlapStart = clamp(minProjectedDistance, 0, lengthMeters);
  const overlapEnd = clamp(maxProjectedDistance, 0, lengthMeters);
  if (overlapEnd - overlapStart < 0.75) return null;
  const inRange = projected.filter((point) => point.distance >= -32 && point.distance <= lengthMeters + 32);
  const candidates = inRange.length ? inRange : projected;
  const closest = candidates.reduce((best, point) =>
    Math.abs(point.sideOffset) < Math.abs(best.sideOffset) ? point : best,
  );
  const setbackMeters = Math.abs(closest.sideOffset);
  if (setbackMeters > 72) return null;
  const distances = candidates.map((point) => clamp(point.distance, 0, lengthMeters));
  const minDistance = Math.min(overlapStart, ...distances);
  const maxDistance = Math.max(overlapEnd, ...distances);
  const center = clamp((overlapStart + overlapEnd) / 2 || average(distances), 0, lengthMeters);
  const fallbackHalfWidth = Math.max(4, Math.min(18, (maxDistance - minDistance) / 2 || 8));
  return {
    start: clamp(Math.min(minDistance, center - fallbackHalfWidth), 0, lengthMeters),
    end: clamp(Math.max(maxDistance, center + fallbackHalfWidth), 0, lengthMeters),
    setbackMeters,
    side: sideFromOffset(closest.sideOffset),
  };
}

function projectPointToSection(
  coordinate: number[],
  startMeters: { x: number; y: number },
  dx: number,
  dy: number,
  lengthMeters: number,
  refLat: number,
): SectionModel["trees"][number] | null {
  const projected = projectCoordinateToSection(coordinate, startMeters, dx, dy, lengthMeters, refLat);
  if (projected.distance < 0 || projected.distance > lengthMeters) return null;
  if (Math.abs(projected.sideOffset) > 35) return null;
  return {
    distance: projected.distance,
    canopyHeight: 9,
    side: sideFromOffset(projected.sideOffset),
  };
}

function projectCoordinateToSection(
  coordinate: number[],
  startMeters: { x: number; y: number },
  dx: number,
  dy: number,
  lengthMeters: number,
  refLat: number,
): { distance: number; sideOffset: number } {
  const point = projectMeters(coordinate, refLat);
  const px = point.x - startMeters.x;
  const py = point.y - startMeters.y;
  const distance = (px * dx + py * dy) / lengthMeters;
  const sideOffset = (px * -dy + py * dx) / lengthMeters;
  return { distance, sideOffset };
}

function exteriorRings(geometry: BuildingGeometry): number[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates[0] ?? []];
  return geometry.coordinates.map((polygon) => polygon[0] ?? []).filter((ring) => ring.length > 0);
}

function ringContainsProjectedPoint(
  ring: Array<{ distance: number; sideOffset: number }>,
  distance: number,
  sideOffset: number,
): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const last = ring[previous];
    const intersects =
      current.sideOffset > sideOffset !== last.sideOffset > sideOffset &&
      distance <
        ((last.distance - current.distance) * (sideOffset - current.sideOffset)) /
          ((last.sideOffset - current.sideOffset) || Number.EPSILON) +
          current.distance;
    if (intersects) inside = !inside;
  }
  return inside;
}

function uniqueSorted(values: number[]): number[] {
  return [...values]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
    .filter((value, index, array) => index === 0 || Math.abs(value - array[index - 1]) > 0.35);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sideFromOffset(offset: number): "left" | "right" | "center" {
  if (offset < -3) return "left";
  if (offset > 3) return "right";
  return "center";
}

function average(values: number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function createApproximateTerrainSamples(lengthMeters: number): Array<{ distance: number; elevation: number }> {
  const sampleCount = Math.max(4, Math.min(10, Math.ceil(lengthMeters / 18)));
  return Array.from({ length: sampleCount }, (_, index) => {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    return {
      distance: lengthMeters * t,
      elevation: Math.sin(t * Math.PI * 1.4) * 0.35 + t * 0.45,
    };
  });
}

function buildingLabel(feature: Feature): string {
  return String(
    feature.properties?.name ??
      feature.properties?.building ??
      feature.properties?.sourceId ??
      "building",
  );
}

function createSectionSvg(input: {
  streetName: string;
  width: number | null;
  height: number | null;
  trees: number | null;
  model: SectionModel;
}): string {
  if (!input.model.line) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 420" role="img" aria-label="User-defined street cross-section setup">
  <metadata>{"source":"Urban Context Analysis","status":"section-line-required"}</metadata>
  <style>
    svg{--section-surface:var(--surface,#000);--section-ink:var(--ink,#fff);--section-muted:var(--muted,#b3b3b3);--section-border:var(--border,#3a3a3a)}
    text{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;fill:var(--section-ink);font-size:12px}
    .line{stroke:var(--section-border);stroke-width:1;fill:none}
    .muted{fill:var(--section-muted)}
  </style>
  <rect width="920" height="420" fill="var(--section-surface)"/>
  <text x="24" y="38">SECTION LINE REQUIRED</text>
  <text x="24" y="64" class="muted">M scale: click "Set section line", then choose start and end on the map.</text>
  <line x1="112" y1="286" x2="808" y2="132" class="line" stroke-dasharray="8 6"/>
  <circle cx="112" cy="286" r="10" fill="none" stroke="var(--section-ink)"/>
  <circle cx="808" cy="132" r="10" fill="none" stroke="var(--section-ink)"/>
</svg>`;
  }

  const model = input.model;
  const hasTerrain = model.terrainSamples.length > 0;
  const hasMeasuredTerrain = model.terrainStatus === "measured";
  const minElevation = hasTerrain
    ? Math.min(...model.terrainSamples.map((sample) => sample.elevation))
    : 0;
  const maxElevation = hasTerrain
    ? Math.max(...model.terrainSamples.map((sample) => sample.elevation))
    : minElevation;
  const terrainRange = Math.max(0.25, maxElevation - minElevation);
  const maxBuilding = Math.max(24, ...model.buildings.map((building) => building.height));
  const heightDomain = Math.max(18, maxBuilding + 8);
  const xForDistance = (distance: number) =>
    64 + (distance / Math.max(1, model.lengthMeters)) * 792;
  const profileBaseY = 332;
  const profileTopY = 72;
  const yForRelativeHeight = (height: number, groundY: number) =>
    groundY - (height / heightDomain) * 230;
  const yForTerrainSample = (sample: { elevation: number }) =>
    profileBaseY -
    ((sample.elevation - minElevation) / terrainRange) *
      (hasMeasuredTerrain ? 52 : 16);
  const terrainYForDistance = (distance: number): number => {
    const samples = model.terrainSamples;
    if (!samples.length) return profileBaseY;
    if (distance <= samples[0].distance) {
      return yForTerrainSample(samples[0]);
    }
    const last = samples[samples.length - 1];
    if (distance >= last.distance) {
      return yForTerrainSample(last);
    }
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const next = samples[index];
      if (distance <= next.distance) {
        const span = next.distance - previous.distance || 1;
        const t = (distance - previous.distance) / span;
        return (
          yForTerrainSample(previous) * (1 - t) +
          yForTerrainSample(next) * t
        );
      }
    }
    return profileBaseY;
  };
  const terrainPath = model.terrainSamples
    .map((sample, index) => {
      const x = xForDistance(sample.distance);
      const y = yForTerrainSample(sample);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const gridStep = model.lengthMeters <= 90 ? 10 : model.lengthMeters <= 240 ? 25 : 50;
  const gridSvg = Array.from(
    { length: Math.floor(model.lengthMeters / gridStep) + 1 },
    (_, index) => index * gridStep,
  )
    .filter((distance) => distance <= model.lengthMeters)
    .map((distance) => {
      const x = xForDistance(distance);
      return `<line x1="${x.toFixed(1)}" y1="${profileTopY}" x2="${x.toFixed(1)}" y2="${profileBaseY + 16}" class="grid"/>
    <text x="${(x - 4).toFixed(1)}" y="${profileBaseY + 34}" class="tick">${Math.round(distance)}</text>`;
    })
    .join("\n    ");
  const buildingSvg = model.buildings
    .map((building, index) => {
      const x = xForDistance(building.start);
      const width = Math.max(8, xForDistance(building.end) - x);
      const groundY = terrainYForDistance((building.start + building.end) / 2);
      const y = yForRelativeHeight(building.height, groundY);
      const sideClass =
        building.side === "left"
          ? "building-left"
          : building.side === "right"
            ? "building-right"
            : "building-center";
      const heightClass = building.heightSource === "measured" ? "measured" : "estimated";
      const label = `${Math.round(building.height)}m${building.heightSource === "measured" ? "" : " est"}`;
      const labelX = Math.min(818, Math.max(66, x + 3));
      return `<g class="building ${sideClass} ${heightClass}" data-source="${escapeXml(building.sourceId ?? "unknown")}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${(groundY - y).toFixed(1)}"/>
      <line x1="${x.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${(x + width).toFixed(1)}" y2="${groundY.toFixed(1)}" class="base"/>
      <text x="${labelX.toFixed(1)}" y="${Math.max(24, y - 6).toFixed(1)}" class="building-label">${escapeXml(label)}</text>
    </g>`;
    })
    .join("\n    ");
  const treeSvg = model.trees
    .map((tree) => {
      const x = xForDistance(tree.distance);
      const groundY = terrainYForDistance(tree.distance);
      const crownY = yForRelativeHeight(tree.canopyHeight, groundY);
      return `<line x1="${x.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(crownY + 18).toFixed(1)}" class="tree-trunk"/>
    <circle cx="${x.toFixed(1)}" cy="${crownY.toFixed(1)}" r="13" class="tree-crown"/>`;
    })
    .join("\n    ");
  const widthLabel = input.width === null ? "NA" : `${input.width}M`;
  const lengthLabel = `${Math.round(model.lengthMeters)}M`;
  const treeLabel = model.trees.length ? String(model.trees.length) : "0";
  const terrainLabel = hasMeasuredTerrain ? "OPENTOPOGRAPHY DEM" : "APPROX TERRAIN BASELINE";
  const measuredBuildingCount = model.buildings.filter((building) => building.heightSource === "measured").length;
  const estimatedBuildingCount = model.buildings.length - measuredBuildingCount;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 420" role="img" aria-label="User-defined terrain and building cross-section">
  <metadata>{"source":"Urban Context Analysis structured M-scale section","terrain":"${hasMeasuredTerrain ? "opentopography-dem" : "approximate-baseline"}","street":"${escapeXml(input.streetName)}","buildings":${model.buildings.length}}</metadata>
  <style>
    svg{--section-surface:var(--surface,#000);--section-surface-2:var(--surface-2,#111);--section-ink:var(--ink,#fff);--section-muted:var(--muted,#b3b3b3);--section-border:var(--border,#3a3a3a);--section-grid:rgba(127,127,127,.22);--section-terrain:#d8bc52;--section-building:#6da9c8;--section-building-2:#9b8cc8;--section-tree:#5fa86b}
    text{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;fill:var(--section-ink);font-size:11px}
    .axis,.line{stroke:var(--section-border);stroke-width:1;fill:none}
    .grid{stroke:var(--section-grid);stroke-width:1}
    .tick{fill:var(--section-muted);font-size:9px}
    .muted{fill:var(--section-muted)}
    .terrain{stroke:var(--section-terrain);stroke-width:2.4;fill:none}
    .terrain.approx{stroke-dasharray:7 5;stroke-width:1.6}
    .terrain-fill{fill:rgba(216,188,82,.08)}
    .building rect{stroke-width:1.2}
    .building.measured rect{fill:rgba(109,169,200,.42);stroke:var(--section-building)}
    .building.estimated rect{fill:rgba(109,169,200,.22);stroke:var(--section-building);stroke-dasharray:5 3}
    .building-right rect{fill:rgba(155,140,200,.24);stroke:var(--section-building-2)}
    .building .base{stroke:rgba(255,255,255,.45);stroke-width:1}
    .building-label{fill:var(--section-muted);font-size:9px}
    .tree-trunk{stroke:var(--section-muted);stroke-width:1}
    .tree-crown{fill:rgba(95,168,107,.24);stroke:var(--section-tree);stroke-width:1}
    .note{font-size:10px;fill:var(--section-muted)}
  </style>
  <rect width="920" height="420" fill="var(--section-surface)"/>
  <g id="metadata-labels">
    <text x="24" y="30">${escapeXml(input.streetName)}</text>
    <text x="24" y="52" class="muted">SECTION ${lengthLabel} / ${terrainLabel} / STREET WIDTH ${widthLabel} / BUILDINGS ${model.buildings.length} (${measuredBuildingCount} measured, ${estimatedBuildingCount} estimated) / TREES ${treeLabel}</text>
  </g>
  <g id="profile">
    ${gridSvg}
    <path d="M 64 ${profileBaseY} ${terrainPath.replace(/^M /, "L ")} L 856 ${profileBaseY} Z" class="terrain-fill"/>
    ${buildingSvg || `<text x="72" y="106" class="muted">NO BUILDING FOOTPRINT INTERSECTS OR TOUCHES THE SECTION CORRIDOR</text>`}
    ${treeSvg || `<text x="72" y="126" class="muted">NO TREE LOCATION INTERSECTION WITH SECTION LINE</text>`}
    <path d="${terrainPath}" class="terrain${hasMeasuredTerrain ? "" : " approx"}"/>
    <line x1="64" y1="${profileBaseY}" x2="856" y2="${profileBaseY}" class="axis"/>
  </g>
  <g id="scale-bar">
    <line x1="64" y1="382" x2="${xForDistance(Math.min(50, model.lengthMeters)).toFixed(1)}" y2="382" stroke="var(--section-ink)"/>
    <text x="64" y="400" class="muted">0</text>
    <text x="${Math.max(94, xForDistance(Math.min(50, model.lengthMeters)) - 18).toFixed(1)}" y="400" class="muted">${Math.min(50, Math.round(model.lengthMeters))}M</text>
  </g>
  <text x="24" y="402" class="note">${hasMeasuredTerrain ? "Terrain profile uses local OpenTopography DEM samples." : "DEM samples are missing; terrain is an approximate visual baseline only."} Estimated building heights are dashed.</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[char] ?? char;
  });
}
