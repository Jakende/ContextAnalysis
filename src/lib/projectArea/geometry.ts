import type {
  Feature,
  FeatureCollection,
  Position,
} from "geojson";
import {
  PROJECT_AREA_SCHEMA_VERSION,
  type ProjectArea,
  type ProjectAreaBbox,
  type ProjectAreaCoordinate,
  type ProjectAreaCreationOptions,
  type ProjectAreaGeometry,
  type ProjectAreaSource,
} from "./types";
import {
  dissolveGeometries,
  geometryAreaSqm as calculateGeometryAreaSqm,
} from "../analysis/spatialArea";

const EARTH_RADIUS_METERS = 6_371_008.8;
const COORDINATE_EPSILON = 1e-12;
const MAX_PROJECT_AREA_POSITIONS = 20_000;
const DEFAULT_PROJECT_AREA_LABEL = "Project area";

/**
 * Safe MVP limit for browser-side data requests and deterministic analysis.
 * Larger study areas need a separately designed regional processing path.
 */
export const PROJECT_AREA_MAX_DIAGONAL_METERS = 5_000;

export type ProjectAreaGeoJsonOptions = ProjectAreaCreationOptions;

export type ProjectAreaFeatureProperties = {
  projectAreaId: string;
  label: string;
  source: ProjectAreaSource;
  areaSqm: number;
  createdAt: string;
  fileName?: string;
};

export class ProjectAreaValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectAreaValidationError";
    this.code = code;
  }
}

/** Parse a GeoJSON Feature or FeatureCollection containing only polygon geometry. */
export function parseProjectAreaGeoJson(
  input: string | unknown,
  options: ProjectAreaGeoJsonOptions = {},
): ProjectArea {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      throw new ProjectAreaValidationError(
        "invalid-json",
        `The project layer is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const root = requireRecord(parsed, "The project layer must be a GeoJSON object.");
  const rawPolygons: unknown[] = [];
  let importedFeatureCount = 0;

  if (root.type === "Feature") {
    importedFeatureCount = 1;
    rawPolygons.push(...geometryToRawPolygons(root.geometry, "feature.geometry"));
  } else if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features) || root.features.length === 0) {
      throw new ProjectAreaValidationError(
        "empty-feature-collection",
        "The uploaded FeatureCollection does not contain any project boundary features.",
      );
    }
    importedFeatureCount = root.features.length;
    root.features.forEach((feature, index) => {
      const record = requireRecord(
        feature,
        `Feature ${index + 1} is not a valid GeoJSON Feature.`,
      );
      if (record.type !== "Feature") {
        throw new ProjectAreaValidationError(
          "invalid-feature",
          `Item ${index + 1} in the FeatureCollection is not a GeoJSON Feature.`,
        );
      }
      rawPolygons.push(
        ...geometryToRawPolygons(record.geometry, `features[${index}].geometry`),
      );
    });
  } else {
    throw new ProjectAreaValidationError(
      "unsupported-root-type",
      "Upload a GeoJSON Feature or FeatureCollection containing Polygon or MultiPolygon geometry.",
    );
  }

  const polygons = rawPolygons.map((coordinates, index) =>
    normalizePolygonCoordinates(coordinates, `polygon ${index + 1}`),
  );
  const geometry: ProjectAreaGeometry =
    polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };

  const label = options.label?.trim() || inferGeoJsonLabel(root) || DEFAULT_PROJECT_AREA_LABEL;
  const caveats =
    importedFeatureCount > 1
      ? [
          `${importedFeatureCount} uploaded polygon features are combined as one project area and overlapping components are dissolved.`,
        ]
      : [];

  return buildProjectArea(geometry, "upload", {
    ...options,
    label,
  }, caveats);
}

/** Create a project area from three or more map-drawn longitude/latitude points. */
export function createPolygonProjectArea(
  points: ReadonlyArray<ProjectAreaCoordinate>,
  options: ProjectAreaCreationOptions = {},
): ProjectArea {
  const coordinates = normalizePolygonCoordinates([points], "drawn polygon");
  return buildProjectArea(
    { type: "Polygon", coordinates },
    "draw-polygon",
    { ...options, label: options.label?.trim() || "Drawn project area" },
  );
}

/** Create an axis-aligned rectangle from two opposite WGS84 map corners. */
export function createRectangleProjectArea(
  firstCorner: ProjectAreaCoordinate,
  oppositeCorner: ProjectAreaCoordinate,
  options: ProjectAreaCreationOptions = {},
): ProjectArea {
  const first = normalizePosition(firstCorner, "first rectangle corner");
  const opposite = normalizePosition(oppositeCorner, "opposite rectangle corner");
  const west = Math.min(first[0], opposite[0]);
  const east = Math.max(first[0], opposite[0]);
  const south = Math.min(first[1], opposite[1]);
  const north = Math.max(first[1], opposite[1]);
  const coordinates = normalizePolygonCoordinates(
    [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
    "drawn rectangle",
  );
  return buildProjectArea(
    { type: "Polygon", coordinates },
    "draw-rectangle",
    { ...options, label: options.label?.trim() || "Project rectangle" },
  );
}

/** Normalize and validate an existing Polygon or MultiPolygon. */
export function normalizeProjectAreaGeometry(
  geometry: ProjectAreaGeometry,
): ProjectAreaGeometry {
  const polygons = geometryToRawPolygons(geometry, "geometry").map((coordinates, index) =>
    normalizePolygonCoordinates(coordinates, `polygon ${index + 1}`),
  );
  const positionCount = polygons.reduce(
    (total, polygon) =>
      total + polygon.reduce((polygonTotal, ring) => polygonTotal + ring.length, 0),
    0,
  );
  if (positionCount > MAX_PROJECT_AREA_POSITIONS) {
    throw new ProjectAreaValidationError(
      "too-many-positions",
      `The project area contains ${positionCount.toLocaleString()} positions. Simplify it to ${MAX_PROJECT_AREA_POSITIONS.toLocaleString()} positions or fewer for browser analysis.`,
    );
  }
  polygons.sort(compareCoordinateArrays);
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

/** Maximum distance from the interior analysis point to a project-area vertex. */
export function projectAreaRadiusMeters(
  area: ProjectArea,
  origin: ProjectAreaCoordinate = area.representativePoint,
): number {
  let radius = 0;
  forEachCoordinate(area.geometry, (coordinate) => {
    radius = Math.max(radius, haversineMeters(origin, coordinate));
  });
  return radius;
}

export function projectAreaContainsCoordinate(
  area: ProjectArea,
  coordinate: ProjectAreaCoordinate,
): boolean {
  return pointInGeometry(coordinate, area.geometry);
}

export function projectAreaDiagonalMeters(area: Pick<ProjectArea, "bbox">): number {
  const [west, south, east, north] = area.bbox;
  return haversineMeters([west, south], [east, north]);
}

export function projectAreaToFeature(
  area: ProjectArea,
): Feature<ProjectAreaGeometry, ProjectAreaFeatureProperties> {
  return {
    type: "Feature",
    id: area.id,
    bbox: area.bbox,
    geometry: area.geometry,
    properties: {
      projectAreaId: area.id,
      label: area.label,
      source: area.source,
      areaSqm: area.areaSqm,
      createdAt: area.createdAt,
      ...(area.fileName ? { fileName: area.fileName } : {}),
    },
  };
}

export function projectAreaToFeatureCollection(
  area: ProjectArea,
): FeatureCollection<ProjectAreaGeometry, ProjectAreaFeatureProperties> {
  return { type: "FeatureCollection", features: [projectAreaToFeature(area)] };
}

function buildProjectArea(
  rawGeometry: ProjectAreaGeometry,
  source: ProjectAreaSource,
  options: ProjectAreaCreationOptions,
  caveats: string[] = [],
): ProjectArea {
  const normalizedGeometry = normalizeProjectAreaGeometry(rawGeometry);
  const dissolvedGeometry = dissolveGeometries([normalizedGeometry]);
  const geometry = dissolvedGeometry
    ? normalizeProjectAreaGeometry(dissolvedGeometry)
    : normalizedGeometry;
  const bbox = geometryBbox(geometry);
  const diagonalMeters = projectAreaDiagonalMeters({ bbox });
  if (diagonalMeters > PROJECT_AREA_MAX_DIAGONAL_METERS) {
    throw new ProjectAreaValidationError(
      "extent-too-large",
      `The project area spans ${formatDistance(diagonalMeters)} diagonally. The current map analysis supports project areas up to ${formatDistance(PROJECT_AREA_MAX_DIAGONAL_METERS)}; simplify or split the boundary.`,
    );
  }

  const areaSqm = calculateGeometryAreaSqm(geometry);
  if (!Number.isFinite(areaSqm) || areaSqm < 1) {
    throw new ProjectAreaValidationError(
      "area-too-small",
      "The project boundary has no usable area. Draw or upload a polygon larger than one square metre.",
    );
  }

  const centroid = geometryCentroid(geometry, bbox);
  const representativePoint = geometryRepresentativePoint(geometry, centroid, bbox);
  const createdAt = normalizeCreatedAt(options.createdAt);
  const label = options.label?.trim() || DEFAULT_PROJECT_AREA_LABEL;
  const id = `project-area-${stableHash(JSON.stringify(geometry))}`;

  return {
    schemaVersion: PROJECT_AREA_SCHEMA_VERSION,
    id,
    label,
    source,
    ...(options.fileName?.trim() ? { fileName: options.fileName.trim() } : {}),
    geometry,
    bbox,
    centroid,
    representativePoint,
    areaSqm,
    createdAt,
    caveats: [
      "Area is approximate and calculated after dissolving overlaps in a local metre projection from WGS84 coordinates.",
      ...caveats,
    ],
  };
}

function geometryToRawPolygons(geometry: unknown, path: string): unknown[] {
  const record = requireRecord(
    geometry,
    `${path} is missing. Every project boundary feature must have geometry.`,
  );
  if (record.type === "Polygon") return [record.coordinates];
  if (record.type === "MultiPolygon") {
    if (!Array.isArray(record.coordinates) || record.coordinates.length === 0) {
      throw new ProjectAreaValidationError(
        "empty-geometry",
        `${path} is an empty MultiPolygon.`,
      );
    }
    return record.coordinates;
  }
  throw new ProjectAreaValidationError(
    "unsupported-geometry",
    `${path} uses ${String(record.type ?? "an unknown geometry type")}. Only Polygon and MultiPolygon project boundaries are supported.`,
  );
}

function normalizePolygonCoordinates(raw: unknown, path: string): ProjectAreaCoordinate[][] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProjectAreaValidationError(
      "empty-polygon",
      `${path} does not contain an exterior ring.`,
    );
  }
  const rings = raw.map((ring, ringIndex) =>
    normalizeRing(ring, `${path}, ring ${ringIndex + 1}`, ringIndex > 0),
  );
  const positionCount = rings.reduce((sum, ring) => sum + ring.length, 0);
  if (positionCount > MAX_PROJECT_AREA_POSITIONS) {
    throw new ProjectAreaValidationError(
      "too-many-positions",
      `${path} contains ${positionCount.toLocaleString()} positions. Simplify it to ${MAX_PROJECT_AREA_POSITIONS.toLocaleString()} positions or fewer for browser analysis.`,
    );
  }

  const exterior = rings[0];
  for (let holeIndex = 1; holeIndex < rings.length; holeIndex += 1) {
    const hole = rings[holeIndex];
    if (!pointInRing(hole[0], exterior, true)) {
      throw new ProjectAreaValidationError(
        "hole-outside-polygon",
        `${path}, ring ${holeIndex + 1} is not contained by the exterior boundary.`,
      );
    }
    if (ringsIntersect(exterior, hole)) {
      throw new ProjectAreaValidationError(
        "intersecting-rings",
        `${path}, ring ${holeIndex + 1} crosses the exterior boundary.`,
      );
    }
    for (let previous = 1; previous < holeIndex; previous += 1) {
      if (
        ringsIntersect(rings[previous], hole) ||
        pointInRing(hole[0], rings[previous], false) ||
        pointInRing(rings[previous][0], hole, false)
      ) {
        throw new ProjectAreaValidationError(
          "overlapping-holes",
          `${path} contains overlapping or nested interior rings.`,
        );
      }
    }
  }
  return [rings[0], ...rings.slice(1).sort(compareCoordinateArrays)];
}

function normalizeRing(
  raw: unknown,
  path: string,
  isHole: boolean,
): ProjectAreaCoordinate[] {
  if (!Array.isArray(raw)) {
    throw new ProjectAreaValidationError("invalid-ring", `${path} is not a coordinate array.`);
  }
  const normalized: ProjectAreaCoordinate[] = [];
  raw.forEach((position, index) => {
    const coordinate = normalizePosition(position, `${path}, position ${index + 1}`);
    const previous = normalized.at(-1);
    if (!previous || !coordinatesEqual(previous, coordinate)) normalized.push(coordinate);
  });
  if (normalized.length > 1 && coordinatesEqual(normalized[0], normalized.at(-1)!)) {
    normalized.pop();
  }
  if (normalized.length < 3) {
    throw new ProjectAreaValidationError(
      "too-few-positions",
      `${path} needs at least three distinct positions.`,
    );
  }
  normalized.push([...normalized[0]]);
  const signedArea = ringSignedArea(normalized);
  if (ringHasSelfIntersection(normalized)) {
    throw new ProjectAreaValidationError(
      "self-intersection",
      `${path} crosses itself. Adjust the boundary so edges do not intersect.`,
    );
  }
  if (Math.abs(signedArea) <= COORDINATE_EPSILON) {
    throw new ProjectAreaValidationError(
      "zero-area-ring",
      `${path} is collinear or otherwise has no usable area.`,
    );
  }
  const shouldBeCounterClockwise = !isHole;
  const isCounterClockwise = signedArea > 0;
  const oriented = shouldBeCounterClockwise === isCounterClockwise
    ? normalized
    : [...normalized].reverse();
  return rotateRingToStableStart(oriented);
}

function normalizePosition(value: unknown, path: string): ProjectAreaCoordinate {
  if (!Array.isArray(value) || value.length < 2) {
    throw new ProjectAreaValidationError(
      "invalid-position",
      `${path} must contain longitude and latitude.`,
    );
  }
  const lon = value[0];
  const lat = value[1];
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new ProjectAreaValidationError(
      "invalid-coordinate",
      `${path} must contain finite numeric longitude and latitude values.`,
    );
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new ProjectAreaValidationError(
      "coordinate-out-of-range",
      `${path} is outside WGS84 longitude/latitude ranges. Reproject the layer to EPSG:4326 before uploading it.`,
    );
  }
  return [lon, lat];
}

function geometryBbox(geometry: ProjectAreaGeometry): ProjectAreaBbox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  forEachCoordinate(geometry, ([lon, lat]) => {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  });
  if (east - west > 180) {
    throw new ProjectAreaValidationError(
      "antimeridian-not-supported",
      "Project boundaries crossing the antimeridian are not supported by the current map analysis.",
    );
  }
  return [west, south, east, north];
}

function geometryCentroid(
  geometry: ProjectAreaGeometry,
  bbox: ProjectAreaBbox,
): ProjectAreaCoordinate {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let weightedLon = 0;
  let weightedLat = 0;
  let totalWeight = 0;
  for (const polygon of polygons) {
    polygon.forEach((ring, ringIndex) => {
      const { centroid, area } = ringCentroid(ring);
      const weight = Math.abs(area) * (ringIndex === 0 ? 1 : -1);
      weightedLon += centroid[0] * weight;
      weightedLat += centroid[1] * weight;
      totalWeight += weight;
    });
  }
  if (Math.abs(totalWeight) <= COORDINATE_EPSILON) {
    return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  }
  return [weightedLon / totalWeight, weightedLat / totalWeight];
}

function ringCentroid(ring: ReadonlyArray<Position>): {
  centroid: ProjectAreaCoordinate;
  area: number;
} {
  let twiceArea = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    xSum += (x1 + x2) * cross;
    ySum += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) <= COORDINATE_EPSILON) {
    return { centroid: [ring[0][0], ring[0][1]], area: 0 };
  }
  return {
    centroid: [xSum / (3 * twiceArea), ySum / (3 * twiceArea)],
    area: twiceArea / 2,
  };
}

function geometryRepresentativePoint(
  geometry: ProjectAreaGeometry,
  centroid: ProjectAreaCoordinate,
  bbox: ProjectAreaBbox,
): ProjectAreaCoordinate {
  if (pointInGeometry(centroid, geometry)) return centroid;
  const bboxCenter: ProjectAreaCoordinate = [
    (bbox[0] + bbox[2]) / 2,
    (bbox[1] + bbox[3]) / 2,
  ];
  if (pointInGeometry(bboxCenter, geometry)) return bboxCenter;

  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let bestPoint: ProjectAreaCoordinate | null = null;
  let bestWidth = -Infinity;
  for (const polygon of polygons) {
    const outer = polygon[0];
    const ys = [
      ringCentroid(outer).centroid[1],
      ...outer.slice(0, -1).map((position) => position[1]),
    ];
    for (let index = 0; index < ys.length; index += Math.max(1, Math.floor(ys.length / 24))) {
      const y = ys[index];
      const intersections: number[] = [];
      for (let edge = 0; edge < outer.length - 1; edge += 1) {
        const [x1, y1] = outer[edge];
        const [x2, y2] = outer[edge + 1];
        if ((y1 > y) !== (y2 > y)) {
          intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
        const candidate: ProjectAreaCoordinate = [
          (intersections[pair] + intersections[pair + 1]) / 2,
          y,
        ];
        const width = intersections[pair + 1] - intersections[pair];
        if (width > bestWidth && pointInPolygon(candidate, polygon)) {
          bestPoint = candidate;
          bestWidth = width;
        }
      }
    }
  }
  return bestPoint ?? [polygons[0][0][0][0], polygons[0][0][0][1]];
}

function pointInGeometry(point: ProjectAreaCoordinate, geometry: ProjectAreaGeometry): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function pointInPolygon(
  point: ProjectAreaCoordinate,
  polygon: ReadonlyArray<ReadonlyArray<Position>>,
): boolean {
  if (!pointInRing(point, polygon[0], true)) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole, true));
}

function pointInRing(
  point: ProjectAreaCoordinate,
  ring: ReadonlyArray<Position>,
  includeBoundary: boolean,
): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint: ProjectAreaCoordinate = [ring[index][0], ring[index][1]];
    const previousPoint: ProjectAreaCoordinate = [ring[previous][0], ring[previous][1]];
    if (pointOnSegment(point, previousPoint, currentPoint)) return includeBoundary;
    const crosses =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function ringHasSelfIntersection(ring: ReadonlyArray<ProjectAreaCoordinate>): boolean {
  const segmentCount = ring.length - 1;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const start = ring[index];
    const end = ring[index + 1];
    return {
      index,
      start,
      end,
      minX: Math.min(start[0], end[0]),
      maxX: Math.max(start[0], end[0]),
      minY: Math.min(start[1], end[1]),
      maxY: Math.max(start[1], end[1]),
    };
  }).sort((first, second) => first.minX - second.minX);

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (second.minX > first.maxX) break;
      const adjacent =
        Math.abs(first.index - second.index) === 1 ||
        (Math.min(first.index, second.index) === 0 &&
          Math.max(first.index, second.index) === segmentCount - 1);
      if (adjacent || second.minY > first.maxY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.start, first.end, second.start, second.end)) return true;
    }
  }
  return false;
}

function ringsIntersect(
  first: ReadonlyArray<ProjectAreaCoordinate>,
  second: ReadonlyArray<ProjectAreaCoordinate>,
): boolean {
  for (let firstIndex = 0; firstIndex < first.length - 1; firstIndex += 1) {
    const a = first[firstIndex];
    const b = first[firstIndex + 1];
    for (let secondIndex = 0; secondIndex < second.length - 1; secondIndex += 1) {
      const c = second[secondIndex];
      const d = second[secondIndex + 1];
      if (segmentBboxesOverlap(a, b, c, d) && segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function segmentsIntersect(
  a: ProjectAreaCoordinate,
  b: ProjectAreaCoordinate,
  c: ProjectAreaCoordinate,
  d: ProjectAreaCoordinate,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  return o4 === 0 && pointOnSegment(b, c, d);
}

function orientation(
  a: ProjectAreaCoordinate,
  b: ProjectAreaCoordinate,
  c: ProjectAreaCoordinate,
): -1 | 0 | 1 {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(cross) <= COORDINATE_EPSILON) return 0;
  return cross > 0 ? 1 : -1;
}

function pointOnSegment(
  point: ProjectAreaCoordinate,
  start: ProjectAreaCoordinate,
  end: ProjectAreaCoordinate,
): boolean {
  return (
    orientation(start, end, point) === 0 &&
    point[0] >= Math.min(start[0], end[0]) - COORDINATE_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + COORDINATE_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - COORDINATE_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + COORDINATE_EPSILON
  );
}

function segmentBboxesOverlap(
  a: ProjectAreaCoordinate,
  b: ProjectAreaCoordinate,
  c: ProjectAreaCoordinate,
  d: ProjectAreaCoordinate,
): boolean {
  return !(
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  );
}

function ringSignedArea(ring: ReadonlyArray<ProjectAreaCoordinate>): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    twiceArea +=
      ring[index][0] * ring[index + 1][1] -
      ring[index + 1][0] * ring[index][1];
  }
  return twiceArea / 2;
}

function forEachCoordinate(
  geometry: ProjectAreaGeometry,
  callback: (coordinate: ProjectAreaCoordinate) => void,
): void {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  polygons.forEach((polygon) =>
    polygon.forEach((ring) =>
      ring.forEach((position) => callback([position[0], position[1]])),
    ),
  );
}

function haversineMeters(
  first: ProjectAreaCoordinate,
  second: ProjectAreaCoordinate,
): number {
  const lat1 = degreesToRadians(first[1]);
  const lat2 = degreesToRadians(second[1]);
  const latDelta = lat2 - lat1;
  const lonDelta = degreesToRadians(second[0] - first[0]);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatesEqual(
  first: ProjectAreaCoordinate,
  second: ProjectAreaCoordinate,
): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

function rotateRingToStableStart(
  ring: ReadonlyArray<ProjectAreaCoordinate>,
): ProjectAreaCoordinate[] {
  const openRing = ring.slice(0, -1);
  let firstIndex = 0;
  for (let index = 1; index < openRing.length; index += 1) {
    const [lon, lat] = openRing[index];
    const [firstLon, firstLat] = openRing[firstIndex];
    if (lon < firstLon || (lon === firstLon && lat < firstLat)) firstIndex = index;
  }
  const rotated = [...openRing.slice(firstIndex), ...openRing.slice(0, firstIndex)];
  return [...rotated, [...rotated[0]]];
}

function compareCoordinateArrays(first: unknown, second: unknown): number {
  return JSON.stringify(first).localeCompare(JSON.stringify(second));
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalizeCreatedAt(value?: string): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ProjectAreaValidationError(
      "invalid-created-at",
      "Project area createdAt must be a valid date or ISO-8601 timestamp.",
    );
  }
  return date.toISOString();
}

function inferGeoJsonLabel(root: Record<string, unknown>): string | undefined {
  if (root.type !== "Feature") return undefined;
  const properties = root.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
  const record = properties as Record<string, unknown>;
  for (const key of ["name", "label", "title", "project_name"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectAreaValidationError("invalid-object", message);
  }
  return value as Record<string, unknown>;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function formatDistance(meters: number): string {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}
