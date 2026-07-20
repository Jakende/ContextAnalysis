import type { Feature, MultiPolygon, Polygon } from "geojson";
import polygonClipping from "polygon-clipping";

type PolygonalGeometry = Polygon | MultiPolygon;
type ClippingGeometry = number[][][] | number[][][][];
type ClippingMultiPolygon = number[][][][];
const UNION_BATCH_SIZE = 24;
const SPATIAL_PARTITION_THRESHOLD = 64;
const SPATIAL_PARTITION_TARGET = 12;

const clipping = polygonClipping as unknown as {
  union: (geometry: ClippingGeometry, ...geometries: ClippingGeometry[]) => ClippingMultiPolygon;
  intersection: (geometry: ClippingGeometry, ...geometries: ClippingGeometry[]) => ClippingMultiPolygon;
  difference: (geometry: ClippingGeometry, ...geometries: ClippingGeometry[]) => ClippingMultiPolygon;
};

export type ExclusiveCategoryGeometry = {
  category: string;
  geometry: MultiPolygon;
  areaSqm: number;
};

/**
 * Clips polygonal geometries to one analysis context and dissolves their
 * overlaps. Boolean operations intentionally run in WGS84 because the browser
 * project-area limit is five kilometres; areas are calculated afterwards in a
 * local equirectangular metre projection.
 */
export function clipAndDissolveGeometries(
  geometries: PolygonalGeometry[],
  context: PolygonalGeometry,
): MultiPolygon | null {
  if (geometries.length >= SPATIAL_PARTITION_THRESHOLD) {
    return clipAndDissolvePartitioned(geometries, context);
  }
  const clipped = geometries.flatMap((geometry) => {
    const intersection = clipping.intersection(
      toClippingGeometry(geometry),
      toClippingGeometry(context),
    );
    return intersection.length ? [intersection] : [];
  });
  return dissolveClippingGeometries(clipped);
}

/**
 * Large browser overlays are split into non-overlapping cells before boolean
 * operations. The cell results can be concatenated without another union:
 * their interiors are disjoint, so summed area remains exact while the
 * clipping queue stays bounded.
 */
function clipAndDissolvePartitioned(
  geometries: PolygonalGeometry[],
  context: PolygonalGeometry,
): MultiPolygon | null {
  const [west, south, east, north] = polygonalBounds(context);
  if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) {
    return null;
  }
  const divisions = Math.min(
    12,
    Math.max(2, Math.ceil(Math.sqrt(geometries.length / SPATIAL_PARTITION_TARGET))),
  );
  const width = (east - west) / divisions;
  const height = (north - south) / divisions;
  const geometryBounds = geometries.map(polygonalBounds);
  const parts: ClippingMultiPolygon = [];

  for (let row = 0; row < divisions; row += 1) {
    for (let column = 0; column < divisions; column += 1) {
      const cellBounds: [number, number, number, number] = [
        west + column * width,
        south + row * height,
        column === divisions - 1 ? east : west + (column + 1) * width,
        row === divisions - 1 ? north : south + (row + 1) * height,
      ];
      const cell = rectangleClippingGeometry(cellBounds);
      const cellContext = clipping.intersection(toClippingGeometry(context), cell);
      if (!cellContext.length) continue;
      const clipped = geometries.flatMap((geometry, index) => {
        if (!boundsOverlap(geometryBounds[index], cellBounds)) return [];
        const intersection = clipping.intersection(toClippingGeometry(geometry), cellContext);
        return intersection.length ? [intersection] : [];
      });
      const dissolved = dissolveClippingGeometries(clipped);
      if (dissolved) parts.push(...dissolved.coordinates);
    }
  }
  return clippingResultToGeometry(parts);
}

export function differenceGeometry(
  subject: PolygonalGeometry | null,
  exclusions: Array<PolygonalGeometry | null | undefined>,
): MultiPolygon | null {
  if (!subject) return null;
  const masks = exclusions
    .filter((geometry): geometry is PolygonalGeometry => Boolean(geometry))
    .map(toClippingGeometry);
  const result = masks.length
    ? clipping.difference(toClippingGeometry(subject), ...masks)
    : toMultiPolygonCoordinates(subject);
  return clippingResultToGeometry(result);
}

export function dissolveGeometries(
  geometries: Array<PolygonalGeometry | null | undefined>,
): MultiPolygon | null {
  return dissolveClippingGeometries(
    geometries
      .filter((geometry): geometry is PolygonalGeometry => Boolean(geometry))
      .map(toClippingGeometry),
  );
}

/**
 * Produces mutually exclusive category geometries. Earlier categories have
 * precedence over later ones, and an optional exclusion geometry can reserve
 * coverage owned by a higher-priority source.
 */
export function resolveExclusiveCategoryGeometries(input: {
  features: Feature[];
  context: PolygonalGeometry;
  categoryForFeature: (feature: Feature) => string | null;
  categoryPriority: string[];
  exclusionGeometry?: PolygonalGeometry | null;
}): ExclusiveCategoryGeometry[] {
  const geometriesByCategory = new Map<string, PolygonalGeometry[]>();
  for (const feature of input.features) {
    if (!isPolygonalGeometry(feature.geometry)) continue;
    const category = input.categoryForFeature(feature);
    if (!category) continue;
    const geometries = geometriesByCategory.get(category) ?? [];
    geometries.push(feature.geometry);
    geometriesByCategory.set(category, geometries);
  }

  const orderedCategories = [
    ...input.categoryPriority.filter((category) => geometriesByCategory.has(category)),
    ...[...geometriesByCategory.keys()]
      .filter((category) => !input.categoryPriority.includes(category))
      .sort((left, right) => left.localeCompare(right)),
  ];
  let assigned = input.exclusionGeometry
    ? clipAndDissolveGeometries([input.exclusionGeometry], input.context)
    : null;
  const results: ExclusiveCategoryGeometry[] = [];

  for (const category of orderedCategories) {
    const clipped = clipAndDissolveGeometries(
      geometriesByCategory.get(category) ?? [],
      input.context,
    );
    const exclusive = differenceGeometry(clipped, [assigned]);
    if (!exclusive) continue;
    const areaSqm = geometryAreaSqm(exclusive);
    if (areaSqm <= 0) continue;
    results.push({ category, geometry: exclusive, areaSqm });
    assigned = dissolveGeometries([assigned, exclusive]);
  }
  return results;
}

export function geometryAreaSqm(geometry: PolygonalGeometry): number {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  const [, south, , north] = polygonalBounds(geometry);
  const referenceLat = (south + north) / 2;
  return polygons.reduce((total, polygon) => {
    const outerArea = ringAreaSqm(polygon[0] ?? [], referenceLat);
    const holesArea = polygon
      .slice(1)
      .reduce((subtotal, ring) => subtotal + ringAreaSqm(ring, referenceLat), 0);
    return total + Math.max(0, outerArea - holesArea);
  }, 0);
}

export function isPolygonalGeometry(
  geometry: Feature["geometry"],
): geometry is PolygonalGeometry {
  return geometry.type === "Polygon" || geometry.type === "MultiPolygon";
}

function dissolveClippingGeometries(
  geometries: ClippingGeometry[],
): MultiPolygon | null {
  if (!geometries.length) return null;
  // A single MultiPolygon may itself contain overlapping components. Passing
  // every input through union first normalizes those components before the
  // bounded merge loop starts.
  let pending: ClippingGeometry[] = geometries
    .map((geometry) => clipping.union(geometry))
    .sort(compareClippingBounds);
  while (pending.length > 1) {
    const next: ClippingGeometry[] = [];
    for (let index = 0; index < pending.length; index += UNION_BATCH_SIZE) {
      const batch = pending.slice(index, index + UNION_BATCH_SIZE);
      const [first, ...rest] = batch;
      next.push(rest.length ? clipping.union(first, ...rest) : first);
    }
    pending = next.sort(compareClippingBounds);
  }
  return clippingResultToGeometry(toMultiPolygonCoordinatesFromClipping(pending[0]));
}

function clippingResultToGeometry(
  coordinates: ClippingMultiPolygon,
): MultiPolygon | null {
  return coordinates.length
    ? { type: "MultiPolygon", coordinates }
    : null;
}

function toClippingGeometry(geometry: PolygonalGeometry): ClippingGeometry {
  return geometry.type === "Polygon"
    ? geometry.coordinates
    : geometry.coordinates;
}

function toMultiPolygonCoordinates(
  geometry: PolygonalGeometry,
): ClippingMultiPolygon {
  return geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

function toMultiPolygonCoordinatesFromClipping(
  geometry: ClippingGeometry,
): ClippingMultiPolygon {
  const first = geometry[0]?.[0]?.[0];
  return typeof first === "number"
    ? [geometry as number[][][]]
    : geometry as ClippingMultiPolygon;
}

function compareClippingBounds(
  left: ClippingGeometry,
  right: ClippingGeometry,
): number {
  const [leftX, leftY] = clippingBounds(left);
  const [rightX, rightY] = clippingBounds(right);
  return leftX - rightX || leftY - rightY;
}

function clippingBounds(geometry: ClippingGeometry): [number, number] {
  const multiPolygon = toMultiPolygonCoordinatesFromClipping(geometry);
  let west = Infinity;
  let south = Infinity;
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        west = Math.min(west, coordinate[0]);
        south = Math.min(south, coordinate[1]);
      }
    }
  }
  return [west, south];
}

function polygonalBounds(
  geometry: PolygonalGeometry,
): [number, number, number, number] {
  const multiPolygon = toMultiPolygonCoordinates(geometry);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        west = Math.min(west, coordinate[0]);
        south = Math.min(south, coordinate[1]);
        east = Math.max(east, coordinate[0]);
        north = Math.max(north, coordinate[1]);
      }
    }
  }
  return [west, south, east, north];
}

function boundsOverlap(
  left: [number, number, number, number],
  right: [number, number, number, number],
): boolean {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function rectangleClippingGeometry(
  bounds: [number, number, number, number],
): ClippingGeometry {
  const [west, south, east, north] = bounds;
  return [[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]];
}

function ringAreaSqm(ring: number[][], referenceLat: number): number {
  if (ring.length < 4) return 0;
  const latitudeRadians = (referenceLat * Math.PI) / 180;
  const projected = ring.map((coordinate) => ({
    x: coordinate[0] * 111_320 * Math.cos(latitudeRadians),
    y: coordinate[1] * 111_320,
  }));
  let area = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    area +=
      projected[index].x * projected[index + 1].y -
      projected[index + 1].x * projected[index].y;
  }
  return Math.abs(area) / 2;
}
