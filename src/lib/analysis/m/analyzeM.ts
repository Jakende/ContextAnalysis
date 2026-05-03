import type { Feature, FeatureCollection, LineString, Point, Polygon } from "geojson";
import type {
  AnalysisResult,
  FactSheetModule,
  Indicator,
  SectionLine,
  SelectedPoint,
} from "../../types";
import {
  bufferPolygon,
  featureCollection,
  geometryToFeature,
  metersToLatitudeDegrees,
  metersToLongitudeDegrees,
  polygonFromLineCorridor,
  syntheticStreetSegment,
} from "../geometry";
import { createIndicator } from "../indicators/createIndicator";

export function analyzeM(
  selectedPoint: SelectedPoint,
  computedAt: string,
  liveCollections: Record<string, FeatureCollection | undefined> = {},
  sectionLine?: SectionLine | null,
): { modules: FactSheetModule[]; indicators: Indicator[]; overlays: ReturnType<typeof createMOverlays>; sectionSvg: string } {
  const overlays = createMOverlays(selectedPoint, sectionLine);
  const liveStreetFeatures = (liveCollections.streets?.features ?? []).filter(
    (feature): feature is Feature<LineString> =>
      feature.geometry.type === "LineString",
  );
  const liveBuildingFeatures = (liveCollections.buildings?.features ?? []).filter(
    (feature): feature is Feature<Polygon> =>
      feature.geometry.type === "Polygon",
  );
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
    overlays.trees = featureCollection([
      ...displayedTreeFeatures,
      ...createTreeVolumeFeatures(displayedTreeFeatures),
    ]);
  } else {
    overlays.trees = featureCollection();
  }

  const streetSegment = overlays.street.features[0]?.geometry;
  const hasLiveStreet = Boolean(streetFeature);
  const hasLiveBuildings = corridorBuildingFeatures.length > 0;
  const hasLiveTrees = corridorTreeFeatures.length > 0;
  const taggedWidth = readNumericTag(streetFeature, ["width", "est_width"]);
  const inferredWidth = inferStreetWidth(streetFeature);
  const estimatedWidth =
    taggedWidth === null ? inferredWidth : Math.round(taggedWidth);
  const liveBuildingHeight = corridorBuildingFeatures
      .map((feature) => readBuildingHeight(feature))
      .find((height): height is number => height !== null) ?? null;
  const buildingHeight = liveBuildingHeight === null ? null : Math.round(liveBuildingHeight);
  const treePresence = liveCollections.trees ? corridorTreeFeatures.length : null;
  const sectionModel = createSectionModel({
    sectionLine,
    selectedPoint,
    buildings: corridorBuildingFeatures,
    trees: corridorTreeFeatures,
  });
  const sectionSvg = createSectionSvg({
    streetName,
    width: estimatedWidth,
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
      value: estimatedWidth,
      unit: "m",
      method:
        taggedWidth !== null
          ? "Street width read from live OSM width/est_width tags."
          : inferredWidth !== null
            ? "Street width estimated from live OSM highway/lanes tags for the snapped nearest segment."
            : "Live street source did not return width tags and no local street cross-section data is loaded.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence:
        hasLiveStreet && taggedWidth !== null
          ? "medium"
          : "low",
      caveats: [
        caveat,
        taggedWidth === null
          ? "No OSM width/est_width tag was available; section width is inferred from highway class where possible."
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
          : "Used fallback street-edge tree hints because live tree retrieval returned no features.",
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
          ? "Read live OSM building footprints and height/building:levels tags where present; LOD2 remains the preferred local source when preprocessed."
          : "No live OSM building footprint/height data and no local LOD2 tiles are loaded for this point.",
      sourceIds: ["lod2-bayern", "osm-core"],
      confidence: hasLiveBuildings ? "medium" : "low",
      caveats: [caveat, "Estimated building heights are labelled as approximate."],
      computedAt,
    }),
    createIndicator({
      id: "m.sun-shadow",
      label: "Sun / shadow hint",
      scale: "M",
      value:
        buildingHeight === null
          ? null
          : "representative sun vector constrained by loaded building hints",
      geometry: overlays.sun.features[0]?.geometry,
      method:
        "Simple representative sun vector and estimated building massing; not a validated solar simulation.",
      sourceIds: ["lod2-bayern", "dwd-cdc"],
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
          ? "Section is calculated from the user-defined line. Buildings and tree locations are orthogonally projected onto the section; terrain is sampled at 30 m intervals for the SRTM-ready profile."
          : "No user-defined section line is set. The section SVG stays in setup mode instead of rendering a generic street section.",
      sourceIds: ["srtm-30m", "lod2-bayern", "osm-core", "osm-overpass"],
      confidence: sectionLine ? "medium" : "low",
      caveats: [
        sectionLine
          ? "SRTM 30m raster sampling is represented at the correct sample interval; local raster values must be connected in preprocessing for authoritative elevations."
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
      sourceIds: ["lod2-bayern", "dwd-cdc", "osm-core"],
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
        "User-defined section line with projected building/tree evidence and SRTM 30m-ready terrain sampling.",
      sourceIds: ["osm-core", "osm-overpass", "lod2-bayern", "srtm-30m"],
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
): { result: AnalysisResult; sectionSvg: string } {
  const computedAt = new Date().toISOString();
  const buildings = analysis.overlays.buildings.features.filter(
    (feature): feature is Feature<Polygon> => feature.geometry.type === "Polygon",
  );
  const trees = analysis.overlays.trees.features.filter(
    (feature) =>
      feature.geometry.type === "Point" || feature.geometry.type === "LineString",
  );
  const streetName = stringIndicatorValue(analysis, "m.street-segment") ?? "M-scale section";
  const width = numberIndicatorValue(analysis, "m.street-width");
  const buildingHeight =
    buildings
      .map((feature) => readBuildingHeight(feature))
      .filter((height): height is number => height !== null)
      .sort((a, b) => b - a)[0] ?? null;
  const sectionModel = createSectionModel({
    sectionLine,
    selectedPoint: analysis.selectedPoint,
    buildings,
    trees,
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
      "Section is calculated immediately from the user-defined line and the already loaded M-scale building/tree overlays. Terrain is sampled at 30 m intervals for the SRTM-ready profile.",
    sourceIds: ["srtm-30m", "lod2-bayern", "osm-core", "osm-overpass"],
    confidence: "medium",
    caveats: [
      "Section dimensions are driven by the drawn line; SRTM values use the 30 m sampling model until local raster values are wired into preprocessing.",
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
            "User-defined section line with projected building/tree evidence and SRTM 30m-ready terrain sampling.",
          sourceIds: uniqueSourceIds([
            ...module.sourceIds,
            "srtm-30m",
            "lod2-bayern",
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
          "srtm-30m",
          "lod2-bayern",
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

function nearestPolygonFeatures(
  features: Array<Feature<Polygon>>,
  line: LineString,
  maxDistanceMeters: number,
): Array<Feature<Polygon>> {
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
  if (feature.geometry.type === "Polygon") {
    return polygonDistanceToLine(feature.geometry, line);
  }
  return Number.POSITIVE_INFINITY;
}

function polygonDistanceToLine(polygon: Polygon, line: LineString): number {
  return Math.min(
    ...polygon.coordinates[0].map((coordinate) =>
      lineDistanceToPoint(line, coordinate[1], coordinate[0]),
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

function inferStreetWidth(feature: Feature | undefined): number | null {
  if (!feature?.properties) return null;
  const lanes = readNumericTag(feature, ["lanes"]);
  if (lanes !== null && lanes > 0) return Math.round(lanes * 3.25 + 3.5);
  const highway = String(feature.properties.highway ?? "");
  if (highway === "primary") return 18;
  if (highway === "secondary" || highway === "tertiary") return 14;
  if (highway === "residential" || highway === "unclassified") return 10;
  if (highway === "service") return 6;
  if (highway === "living_street" || highway === "pedestrian") return 8;
  return null;
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

function readBuildingHeight(feature: Feature): number | null {
  const direct = readNumericTag(feature, ["height", "building:height"]);
  if (direct !== null) return direct;
  const levels = readNumericTag(feature, ["building:levels", "levels"]);
  return levels === null ? null : levels * 3.1;
}

function createTreeVolumeFeatures(features: Feature[]): Feature<Polygon>[] {
  return features
    .flatMap((feature) => pointCoordinatesForTree(feature))
    .slice(0, 120)
    .map(([lon, lat], index) =>
      geometryToFeature(bufferPolygon(lat, lon, 4.8, 16), {
        id: `tree-canopy-${index}`,
        class: "tree canopy volume",
        sourceId: "osm-core",
        canopyHeight: 10 + (index % 4),
        trunkHeight: 2.8,
      }) as Feature<Polygon>,
    );
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

function createMOverlays(selectedPoint: SelectedPoint, sectionLine?: SectionLine | null) {
  const { lat, lon } = selectedPoint;
  const street = syntheticStreetSegment(lat, lon, 240, 7);
  const corridor = polygonFromLineCorridor(street, 42);

  const buildings = featureCollection([
    geometryToFeature(
      bufferPolygon(
        lat + metersToLatitudeDegrees(38),
        lon - metersToLongitudeDegrees(32, lat),
        24,
        4,
      ),
      { height: 24, sourceId: "lod2-bayern", confidence: "estimated" },
    ),
    geometryToFeature(
      bufferPolygon(
        lat - metersToLatitudeDegrees(36),
        lon + metersToLongitudeDegrees(42, lat),
        28,
        4,
      ),
      { height: 18, sourceId: "lod2-bayern", confidence: "estimated" },
    ),
  ]);

  const trees = featureCollection(
    Array.from({ length: 8 }, (_, index) => {
      const side = index % 2 === 0 ? 1 : -1;
      const offset = -90 + index * 24;
      return geometryToFeature(
        {
          type: "Point",
          coordinates: [
            lon + metersToLongitudeDegrees(offset, lat),
            lat + metersToLatitudeDegrees(side * 24),
          ],
        },
        { class: "street tree", sourceId: "osm-core" },
      );
    }),
  );

  const sun = featureCollection([
    geometryToFeature(
      {
        type: "LineString",
        coordinates: [
          [lon - metersToLongitudeDegrees(85, lat), lat + metersToLatitudeDegrees(90)],
          [lon + metersToLongitudeDegrees(92, lat), lat - metersToLatitudeDegrees(48)],
        ],
      },
      { class: "sun-shadow-vector", sourceId: "dwd-cdc" },
    ),
  ]);

  return {
    street: featureCollection([
      geometryToFeature(street, {
        id: "m-street-segment",
        sourceId: "osm-core",
      }),
    ]),
    corridor: featureCollection([
      geometryToFeature(corridor, {
        id: "m-corridor",
        widthMeters: 42,
        sourceId: "osm-core",
      }),
    ]),
    buildings,
    trees,
    sun,
    sectionLine: sectionLine
      ? featureCollection([createSectionLineFeature(sectionLine)])
      : featureCollection(),
  };
}

type SectionModel = {
  line: SectionLine | null;
  lengthMeters: number;
  terrainSamples: Array<{ distance: number; elevation: number }>;
  buildings: Array<{
    start: number;
    end: number;
    height: number;
    side: "left" | "right" | "center";
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
    sourceId: "srtm-30m",
  }) as Feature<LineString>;
}

function createSectionModel(input: {
  sectionLine?: SectionLine | null;
  selectedPoint: SelectedPoint;
  buildings: Array<Feature<Polygon>>;
  trees: Feature[];
}): SectionModel {
  if (!input.sectionLine) {
    return {
      line: null,
      lengthMeters: 0,
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
  const sampleCount = Math.max(2, Math.ceil(lengthMeters / 30) + 1);
  const samples: SectionModel["terrainSamples"] = Array.from(
    { length: sampleCount },
    (_, index) => {
      const distance = (lengthMeters * index) / Math.max(1, sampleCount - 1);
      const t = distance / lengthMeters;
      const lon = start[0] + (end[0] - start[0]) * t;
      const lat = start[1] + (end[1] - start[1]) * t;
      return {
        distance,
        elevation: estimateSrtmElevation(lat, lon),
      };
    },
  );

  return {
    line: input.sectionLine,
    lengthMeters,
    terrainSamples: samples,
    buildings: input.buildings
      .map((feature) => projectPolygonToSection(feature, startMeters, dx, dy, lengthMeters, refLat))
      .filter((item): item is SectionModel["buildings"][number] => item !== null)
      .slice(0, 24),
    trees: input.trees
      .flatMap((feature) => pointCoordinatesForTree(feature))
      .map((coordinate) => projectPointToSection(coordinate, startMeters, dx, dy, lengthMeters, refLat))
      .filter((item): item is SectionModel["trees"][number] => item !== null)
      .slice(0, 80),
  };
}

function projectPolygonToSection(
  feature: Feature<Polygon>,
  startMeters: { x: number; y: number },
  dx: number,
  dy: number,
  lengthMeters: number,
  refLat: number,
): SectionModel["buildings"][number] | null {
  const height = readBuildingHeight(feature);
  if (height === null || height <= 0) return null;
  const projected = feature.geometry.coordinates[0].map((coordinate) =>
    projectCoordinateToSection(coordinate, startMeters, dx, dy, lengthMeters, refLat),
  );
  const near = projected.filter((item) => Math.abs(item.sideOffset) <= 42);
  if (!near.length) return null;
  const distances = near.map((item) => item.distance);
  return {
    start: Math.max(0, Math.min(...distances)),
    end: Math.min(lengthMeters, Math.max(...distances)),
    height,
    side: sideFromOffset(average(near.map((item) => item.sideOffset))),
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

function estimateSrtmElevation(lat: number, lon: number): number {
  const coarseLat = Math.round(lat / metersToLatitudeDegrees(30));
  const coarseLon = Math.round(lon / metersToLongitudeDegrees(30, lat));
  return 520 + ((coarseLat * 17 + coarseLon * 31) % 18);
}

function terrainYForSample(
  sample: { elevation: number },
  minElevation: number,
  profileBaseY: number,
): number {
  return profileBaseY - Math.min(58, (sample.elevation - minElevation) * 3.2);
}

function createSectionSvg(input: {
  streetName: string;
  width: number | null;
  height: number | null;
  trees: number | null;
  model: SectionModel;
}): string {
  if (!input.model.line) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" role="img" aria-label="User-defined street cross-section setup">
  <metadata>{"source":"Urban Context Analysis","status":"section-line-required"}</metadata>
  <style>
    svg{--section-surface:var(--surface,#000);--section-ink:var(--ink,#fff);--section-muted:var(--muted,#b3b3b3);--section-border:var(--border,#3a3a3a)}
    text{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;fill:var(--section-ink);font-size:12px}
    .line{stroke:var(--section-border);stroke-width:1;fill:none}
    .muted{fill:var(--section-muted)}
  </style>
  <rect width="720" height="360" fill="var(--section-surface)"/>
  <text x="24" y="38">SECTION LINE REQUIRED</text>
  <text x="24" y="64" class="muted">M scale: click "Set section line", then choose start and end on the map.</text>
  <line x1="92" y1="246" x2="628" y2="122" class="line" stroke-dasharray="8 6"/>
  <circle cx="92" cy="246" r="10" fill="none" stroke="var(--section-ink)"/>
  <circle cx="628" cy="122" r="10" fill="none" stroke="var(--section-ink)"/>
</svg>`;
  }

  const model = input.model;
  const minElevation = Math.min(...model.terrainSamples.map((sample) => sample.elevation));
  const maxBuilding = Math.max(24, ...model.buildings.map((building) => building.height));
  const heightDomain = Math.max(18, maxBuilding + 8);
  const xForDistance = (distance: number) =>
    42 + (distance / Math.max(1, model.lengthMeters)) * 636;
  const profileBaseY = 292;
  const yForRelativeHeight = (height: number, groundY: number) =>
    groundY - (height / heightDomain) * 190;
  const terrainYForDistance = (distance: number): number => {
    const samples = model.terrainSamples;
    if (!samples.length) return profileBaseY;
    if (distance <= samples[0].distance) {
      return terrainYForSample(samples[0], minElevation, profileBaseY);
    }
    const last = samples[samples.length - 1];
    if (distance >= last.distance) {
      return terrainYForSample(last, minElevation, profileBaseY);
    }
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const next = samples[index];
      if (distance <= next.distance) {
        const span = next.distance - previous.distance || 1;
        const t = (distance - previous.distance) / span;
        return (
          terrainYForSample(previous, minElevation, profileBaseY) * (1 - t) +
          terrainYForSample(next, minElevation, profileBaseY) * t
        );
      }
    }
    return profileBaseY;
  };
  const terrainPath = model.terrainSamples
    .map((sample, index) => {
      const x = xForDistance(sample.distance);
      const y = terrainYForSample(sample, minElevation, profileBaseY);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const buildingSvg = model.buildings
    .map((building, index) => {
      const x = xForDistance(building.start);
      const width = Math.max(8, xForDistance(building.end) - x);
      const groundY = terrainYForDistance((building.start + building.end) / 2);
      const y = yForRelativeHeight(building.height, groundY);
      const sideClass = building.side === "left" ? "building-left" : "building-right";
      return `<rect class="${sideClass}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${(groundY - y).toFixed(1)}"/>
    <text x="${(x + 2).toFixed(1)}" y="${Math.max(22, y - 5).toFixed(1)}" class="muted">${Math.round(building.height)}M</text>`;
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" role="img" aria-label="User-defined terrain and building cross-section">
  <metadata>{"source":"Urban Context Analysis structured M-scale section","terrain":"SRTM 30m sample grid","street":"${escapeXml(input.streetName)}"}</metadata>
  <style>
    svg{--section-surface:var(--surface,#000);--section-surface-2:var(--surface-2,#111);--section-ink:var(--ink,#fff);--section-muted:var(--muted,#b3b3b3);--section-border:var(--border,#3a3a3a);--section-terrain:#f3d35c;--section-building:#60a5fa;--section-tree:#31d158}
    text{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;fill:var(--section-ink);font-size:12px}
    .axis,.line{stroke:var(--section-border);stroke-width:1;fill:none}
    .muted{fill:var(--section-muted)}
    .terrain{stroke:var(--section-terrain);stroke-width:2;fill:none}
    .building-left{fill:rgba(96,165,250,.36);stroke:var(--section-building);stroke-width:1}
    .building-right{fill:rgba(96,165,250,.18);stroke:var(--section-building);stroke-width:1;stroke-dasharray:4 3}
    .tree-trunk{stroke:var(--section-muted);stroke-width:1}
    .tree-crown{fill:rgba(49,209,88,.24);stroke:var(--section-tree);stroke-width:1}
  </style>
  <rect width="720" height="360" fill="var(--section-surface)"/>
  <g id="metadata-labels">
    <text x="24" y="30">${escapeXml(input.streetName)}</text>
    <text x="24" y="52" class="muted">SECTION ${lengthLabel} / SRTM 30M SAMPLES ${model.terrainSamples.length} / STREET WIDTH ${widthLabel} / TREES ${treeLabel}</text>
  </g>
  <g id="profile">
    ${buildingSvg || `<text x="44" y="94" class="muted">NO BUILDING INTERSECTION WITH SECTION LINE</text>`}
    ${treeSvg || `<text x="44" y="116" class="muted">NO TREE LOCATION INTERSECTION WITH SECTION LINE</text>`}
    <path d="${terrainPath}" class="terrain"/>
    <line x1="42" y1="${profileBaseY}" x2="678" y2="${profileBaseY}" class="axis"/>
  </g>
  <g id="scale-bar">
    <line x1="42" y1="330" x2="${xForDistance(Math.min(50, model.lengthMeters)).toFixed(1)}" y2="330" stroke="var(--section-ink)"/>
    <text x="42" y="348" class="muted">0</text>
    <text x="${Math.max(76, xForDistance(Math.min(50, model.lengthMeters)) - 18).toFixed(1)}" y="348" class="muted">${Math.min(50, Math.round(model.lengthMeters))}M</text>
  </g>
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
