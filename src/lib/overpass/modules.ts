import type { Feature, FeatureCollection } from "geojson";
import type { OverpassModule, QueryParams } from "../types";
import { featureCollection } from "../analysis/geometry";

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{
    type: string;
    ref: number;
    role?: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
};

function around(params: QueryParams): string {
  return `(around:${Math.min(params.radiusMeters, 1000)},${params.lat},${params.lon})`;
}

function output(): string {
  return "out body geom;";
}

function buildHeader(timeoutSeconds = 12): string {
  return `[out:json][timeout:${timeoutSeconds}];`;
}

function buildQuery(parts: string[]): string {
  return `${buildHeader()}
(
${parts.map((part) => `  ${part}`).join("\n")}
);
${output()}`;
}

function parseOverpassElements(response: unknown): FeatureCollection {
  const raw = response as {
    elements?: OverpassElement[];
  };

  const features: Feature[] = [];

  for (const element of raw.elements ?? []) {
    if (
      element.type === "node" &&
      typeof element.lat === "number" &&
      typeof element.lon === "number"
    ) {
      features.push({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [element.lon, element.lat],
        },
        properties: normalizedProperties(element, element.tags),
      });
      continue;
    }

    if (element.type === "relation" && element.members) {
      for (const member of element.members) {
        if (member.type !== "way" || !member.geometry) continue;
        const coordinates = sanitizeCoordinates(member.geometry);
        if (coordinates.length > 1 && !hasLongJump(coordinates, 2_500)) {
          features.push({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates },
            properties: normalizedProperties(element, {
              ...element.tags,
              relationId: String(element.id),
              memberRef: String(member.ref),
              memberRole: member.role ?? "",
            }),
          });
        }
      }
      continue;
    }

    if (element.type !== "way" || !element.geometry) continue;

    const coordinates = sanitizeCoordinates(element.geometry);
    if (coordinates.length > 1) {
      const closed = isClosedRing(coordinates);
      if (closed && !isUsablePolygonRing(coordinates)) continue;
      features.push({
        type: "Feature" as const,
        geometry: closed
          ? { type: "Polygon" as const, coordinates: [coordinates] }
          : { type: "LineString" as const, coordinates },
        properties: normalizedProperties(element, element.tags),
      });
    }
  }

  return featureCollection(features);
}

function normalizedProperties(
  element: Pick<OverpassElement, "id" | "type">,
  tags?: Record<string, string>,
): Record<string, string | number> {
  const transportMode = classifyTransportMode(tags);
  return {
    id: element.id,
    osmType: element.type,
    ...(tags ?? {}),
    ...(transportMode ? { transportMode } : {}),
  };
}

function classifyTransportMode(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  const route = tags.route;
  const railway = tags.railway;
  const highway = tags.highway;
  if (route === "subway" || railway === "subway") return "subway";
  if (route === "tram" || railway === "tram") return "tram";
  if (route === "light_rail" || railway === "light_rail") return "light_rail";
  if (route === "train" || railway === "rail" || railway === "station" || railway === "halt") {
    return "rail";
  }
  if (route === "bus" || highway === "bus_stop" || tags.bus === "yes" || tags.busway) {
    return "bus";
  }
  return undefined;
}

function sanitizeCoordinates(
  geometry: Array<{ lat: number; lon: number }>,
): number[][] {
  const coordinates: number[][] = [];
  for (const point of geometry) {
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) continue;
    const next = [point.lon, point.lat];
    const previous = coordinates.at(-1);
    if (previous && previous[0] === next[0] && previous[1] === next[1]) continue;
    coordinates.push(next);
  }
  return coordinates;
}

function isClosedRing(coordinates: number[][]): boolean {
  if (coordinates.length < 4) return false;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function isUsablePolygonRing(coordinates: number[][]): boolean {
  if (coordinates.length < 4) return false;
  if (hasLongJump(coordinates, 2_500)) return false;
  if (ringAreaSquareMeters(coordinates) < 20) return false;
  if (ringSelfIntersects(coordinates)) return false;
  return true;
}

function hasLongJump(coordinates: number[][], maxMeters: number): boolean {
  for (let index = 1; index < coordinates.length; index += 1) {
    if (distanceMeters(coordinates[index - 1], coordinates[index]) > maxMeters) {
      return true;
    }
  }
  return false;
}

function distanceMeters(a: number[], b: number[]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(1, Math.cos(lat) * metersPerDegreeLat);
  const dx = (b[0] - a[0]) * metersPerDegreeLon;
  const dy = (b[1] - a[1]) * metersPerDegreeLat;
  return Math.hypot(dx, dy);
}

function ringAreaSquareMeters(coordinates: number[][]): number {
  const origin = coordinates[0];
  const lat = origin[1] * (Math.PI / 180);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(1, Math.cos(lat) * metersPerDegreeLat);
  let area = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const current = coordinates[index];
    const next = coordinates[index + 1];
    const x1 = (current[0] - origin[0]) * metersPerDegreeLon;
    const y1 = (current[1] - origin[1]) * metersPerDegreeLat;
    const x2 = (next[0] - origin[0]) * metersPerDegreeLon;
    const y2 = (next[1] - origin[1]) * metersPerDegreeLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function ringSelfIntersects(coordinates: number[][]): boolean {
  const lastSegment = coordinates.length - 2;
  for (let a = 0; a < lastSegment; a += 1) {
    for (let b = a + 1; b < lastSegment; b += 1) {
      if (Math.abs(a - b) <= 1) continue;
      if (a === 0 && b === lastSegment - 1) continue;
      if (
        segmentsIntersect(
          coordinates[a],
          coordinates[a + 1],
          coordinates[b],
          coordinates[b + 1],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function segmentsIntersect(
  a: number[],
  b: number[],
  c: number[],
  d: number[],
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function orientation(a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export const overpassModules: OverpassModule[] = [
  {
    id: "streets",
    scale: "M",
    radiusMeters: 140,
    buildQuery: (params) =>
      buildQuery([
        `way["highway"~"primary|secondary|tertiary|residential|service|living_street|pedestrian"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "buildings",
    scale: "M",
    radiusMeters: 180,
    buildQuery: (params) =>
      buildQuery([
        `way["building"]${around(params)};`,
        `relation["building"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "trees",
    scale: "M",
    radiusMeters: 180,
    buildQuery: (params) =>
      buildQuery([
        `node["natural"="tree"]${around(params)};`,
        `way["natural"="tree_row"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "landUse",
    scale: "L",
    radiusMeters: 650,
    buildQuery: (params) =>
      buildQuery([
        `way["landuse"]${around(params)};`,
        `way["leisure"]${around(params)};`,
        `way["amenity"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "greenBlue",
    scale: "L",
    radiusMeters: 500,
    buildQuery: (params) =>
      buildQuery([
        `way["leisure"~"park|garden|recreation_ground"]${around(params)};`,
        `way["landuse"~"forest|grass|meadow|allotments|recreation_ground|cemetery"]${around(params)};`,
        `way["natural"~"wood|water|wetland"]${around(params)};`,
        `way["waterway"]${around(params)};`,
        `node["natural"="tree"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "transportStops",
    scale: "L",
    radiusMeters: 800,
    buildQuery: (params) =>
      buildQuery([
        `node["public_transport"="platform"]${around(params)};`,
        `node["highway"="bus_stop"]${around(params)};`,
        `node["railway"~"station|halt|tram_stop"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "transportLines",
    scale: "L",
    radiusMeters: 1000,
    buildQuery: (params) => `${buildHeader(18)}
(
  relation["type"="route"]["route"~"bus|tram|subway|light_rail|train"]${around(params)};
  way["railway"~"tram|light_rail|subway|rail"]${around(params)};
  way["busway"]${around(params)};
  way["bus"="yes"]${around(params)};
);
out body geom;`,
    parse: parseOverpassElements,
  },
  {
    id: "mobilityInfrastructure",
    scale: "L",
    radiusMeters: 500,
    buildQuery: (params) =>
      buildQuery([
        `way["highway"~"cycleway|path|footway|pedestrian"]${around(params)};`,
        `node["amenity"~"bicycle_parking|charging_station|parking"]${around(params)};`,
        `node["car_sharing"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "pois",
    scale: "L",
    radiusMeters: 500,
    buildQuery: (params) =>
      buildQuery([
        `node["amenity"~"school|kindergarten|library|community_centre|clinic|doctors|theatre|cafe|restaurant"]${around(params)};`,
        `node["shop"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "developmentHints",
    scale: "L",
    radiusMeters: 650,
    buildQuery: (params) =>
      buildQuery([
        `way["landuse"~"brownfield|construction|garages|industrial|railway"]${around(params)};`,
        `way["amenity"="parking"]${around(params)};`,
        `node["amenity"="parking"]${around(params)};`,
        `way["disused"]${around(params)};`,
        `way["abandoned"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "barriers",
    scale: "M",
    radiusMeters: 180,
    buildQuery: (params) =>
      buildQuery([
        `way["barrier"]${around(params)};`,
        `node["barrier"]${around(params)};`,
        `way["railway"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
];
