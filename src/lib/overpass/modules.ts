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

  const relationWayHints = buildRelationWayHints(raw.elements ?? []);
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

    if (element.type === "relation") {
      continue;
    }

    if (element.type !== "way" || !element.geometry) continue;

    const relationHint = relationWayHints.get(element.id);
    const effectiveTags = relationHint
      ? {
          ...relationHint,
          ...(element.tags ?? {}),
        }
      : element.tags;
    const coordinates = sanitizeCoordinates(element.geometry);
    if (coordinates.length > 1) {
      const closed = isClosedRing(coordinates);
      const polygonal = closed && shouldRenderAsPolygon(effectiveTags);
      if (polygonal && !isUsablePolygonRing(coordinates)) continue;
      features.push({
        type: "Feature" as const,
        geometry: polygonal
          ? { type: "Polygon" as const, coordinates: [coordinates] }
          : { type: "LineString" as const, coordinates },
        properties: {
          ...normalizedProperties(element, effectiveTags),
          ...(closed && !polygonal ? { geometryRole: "closed-line" } : {}),
        },
      });
    }
  }

  return featureCollection(features);
}

function buildRelationWayHints(
  elements: OverpassElement[],
): Map<number, Record<string, string>> {
  const hints = new Map<number, Record<string, string>>();
  for (const element of elements) {
    if (element.type !== "relation" || !element.members?.length || !element.tags) continue;
    const relationTags = pickRelationTransportTags(element.tags, element.id);
    if (!Object.keys(relationTags).length) continue;
    for (const member of element.members) {
      if (member.type !== "way") continue;
      const existing = hints.get(member.ref) ?? {};
      hints.set(member.ref, mergeRelationHint(existing, relationTags, member.role));
    }
  }
  return hints;
}

function mergeRelationHint(
  existing: Record<string, string>,
  relationTags: Record<string, string>,
  memberRole?: string,
): Record<string, string> {
  return compactStringRecord({
    ...relationTags,
    ...existing,
    route: existing.route ?? relationTags.route,
    route_master: existing.route_master ?? relationTags.route_master,
    ref: existing.ref ?? relationTags.ref,
    name: existing.name ?? relationTags.name,
    network: existing.network ?? relationTags.network,
    operator: existing.operator ?? relationTags.operator,
    routeRefs: joinUnique(existing.routeRefs, relationTags.ref),
    routeNames: joinUnique(existing.routeNames, relationTags.name),
    routeRelations: joinUnique(existing.routeRelations, relationTags.relationId),
    routeModes: joinUnique(existing.routeModes, relationTags.route ?? relationTags.route_master),
    routeNetworks: joinUnique(existing.routeNetworks, relationTags.network),
    routeOperators: joinUnique(existing.routeOperators, relationTags.operator),
    routeFroms: joinUnique(existing.routeFroms, relationTags.from),
    routeTos: joinUnique(existing.routeTos, relationTags.to),
    routeVias: joinUnique(existing.routeVias, relationTags.via),
    routeColours: joinUnique(existing.routeColours, relationTags.colour),
    memberRoles: joinUnique(existing.memberRoles, memberRole),
    relationId: existing.relationId ?? relationTags.relationId,
    memberRole: existing.memberRole ?? memberRole ?? "",
  });
}

function joinUnique(existing: string | undefined, value: string | undefined): string | undefined {
  const values = [
    ...(existing ? existing.split(";").map((item) => item.trim()) : []),
    ...(value ? value.split(";").map((item) => item.trim()) : []),
  ].filter(Boolean);
  const uniqueValues = [...new Set(values)];
  return uniqueValues.length ? uniqueValues.join(";") : undefined;
}

function compactStringRecord(
  input: Record<string, string | undefined>,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") output[key] = value;
  }
  return output;
}

function pickRelationTransportTags(
  tags: Record<string, string>,
  relationId: number,
): Record<string, string> {
  const picked: Record<string, string> = {
    relationId: String(relationId),
  };
  for (const key of [
    "route",
    "route_master",
    "ref",
    "name",
    "network",
    "operator",
    "from",
    "to",
    "via",
    "colour",
    "colour:text",
    "public_transport:version",
  ]) {
    const value = tags[key];
    if (value) picked[key] = value;
  }
  return picked;
}

function normalizedProperties(
  element: Pick<OverpassElement, "id" | "type">,
  tags?: Record<string, string>,
): Record<string, string | number> {
  const transportMode = classifyTransportMode(tags);
  const mobilityMode = classifyMobilityMode(tags);
  const poiCategory = classifyPoiCategory(tags);
  const heightMeters = readHeightMeters(tags);
  const buildingLevels = readNumber(tags?.["building:levels"] ?? tags?.levels);
  const osmTags = tags ?? {};
  const lineLabel = readTransportLineLabel(osmTags, transportMode);
  return {
    id: element.id,
    osmType: element.type,
    osmId: element.id,
    osmElementType: element.type,
    ...osmTags,
    osmTagsJson: JSON.stringify(osmTags),
    ...(transportMode ? { transportMode } : {}),
    ...(lineLabel ? { lineLabel } : {}),
    ...(mobilityMode ? { mobilityMode } : {}),
    ...(poiCategory ? { poiCategory } : {}),
    ...(heightMeters !== undefined ? { heightMeters } : {}),
    ...(buildingLevels !== undefined ? { buildingLevels } : {}),
  };
}

function readTransportLineLabel(
  tags: Record<string, string>,
  transportMode?: string,
): string | undefined {
  if (!transportMode) return undefined;
  const refs = tags.routeRefs ?? tags.ref;
  const names = tags.routeNames ?? tags.name;
  const networks = tags.routeNetworks ?? tags.network;
  const operators = tags.routeOperators ?? tags.operator;
  const relationIds = tags.routeRelations ?? tags.relationId;
  const fromTo =
    tags.routeFroms || tags.routeTos
      ? `${tags.routeFroms ?? "?"}->${tags.routeTos ?? "?"}`
      : undefined;
  const parts = [
    refs ? `ref ${refs}` : undefined,
    names,
    fromTo,
    networks ? `network ${networks}` : undefined,
    operators ? `operator ${operators}` : undefined,
    relationIds ? `relation ${relationIds}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : transportMode;
}

function readHeightMeters(tags?: Record<string, string>): number | undefined {
  return readNumber(tags?.height ?? tags?.["building:height"]);
}

function readNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(",", ".").match(/-?\d+(\.\d+)?/u)?.[0];
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function classifyTransportMode(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  const route = tags.route;
  const routeMaster = tags.route_master;
  const railway = tags.railway;
  const highway = tags.highway;
  const publicTransport = tags.public_transport;
  if (route === "subway" || railway === "subway") return "subway";
  if (route === "tram" || railway === "tram") return "tram";
  if (route === "light_rail" || railway === "light_rail") return "light_rail";
  if (
    route === "train" ||
    routeMaster === "train" ||
    railway === "rail" ||
    railway === "station" ||
    railway === "halt"
  ) {
    return "rail";
  }
  if (
    route === "bus" ||
    routeMaster === "bus" ||
    highway === "bus_stop" ||
    tags.bus === "yes" ||
    tags.busway ||
    tags["lanes:bus"] ||
    tags["bus:lanes"] ||
    tags["bus:lanes:forward"] ||
    tags["bus:lanes:backward"]
  ) {
    return "bus";
  }
  if (publicTransport === "platform" || publicTransport === "stop_position") return "transit";
  return undefined;
}

function classifyMobilityMode(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  const highway = tags.highway;
  if (
    highway === "cycleway" ||
    tags.cycleway ||
    tags["cycleway:left"] ||
    tags["cycleway:right"] ||
    tags["cycleway:both"] ||
    tags.bicycle === "designated"
  ) {
    return "bike";
  }
  if (
    highway === "footway" ||
    highway === "pedestrian" ||
    highway === "path" ||
    tags.foot === "designated" ||
    tags.sidewalk
  ) {
    return "pedestrian";
  }
  if (
    tags.amenity === "bicycle_parking" ||
    tags.amenity === "charging_station" ||
    tags.amenity === "parking" ||
    tags.car_sharing ||
    tags.busway ||
    tags["lanes:bus"] ||
    tags["bus:lanes"]
  ) {
    return "support";
  }
  return undefined;
}

function classifyPoiCategory(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  const amenity = tags.amenity;
  const shop = tags.shop;
  const tourism = tags.tourism;
  const leisure = tags.leisure;
  const healthcare = tags.healthcare;
  const office = tags.office;

  if (
    ["school", "kindergarten", "childcare", "college", "university", "library"].includes(
      amenity ?? "",
    )
  ) {
    return "education";
  }
  if (
    healthcare ||
    ["hospital", "clinic", "doctors", "dentist", "pharmacy", "social_facility"].includes(
      amenity ?? "",
    )
  ) {
    return "health";
  }
  if (
    ["townhall", "courthouse", "police", "fire_station", "post_office", "community_centre", "arts_centre", "place_of_worship"].includes(
      amenity ?? "",
    ) ||
    office === "government"
  ) {
    return "civic";
  }
  if (shop || ["marketplace", "bank", "atm"].includes(amenity ?? "")) {
    return "commerce";
  }
  if (
    ["restaurant", "cafe", "bar", "pub", "fast_food", "biergarten", "food_court"].includes(
      amenity ?? "",
    )
  ) {
    return "gastronomy";
  }
  if (
    ["theatre", "cinema", "arts_centre"].includes(amenity ?? "") ||
    tourism === "gallery" ||
    tourism === "museum"
  ) {
    return "food_culture";
  }
  if (
    tourism ||
    ["sports_centre", "fitness_centre", "playground", "pitch", "swimming_pool", "park", "garden", "recreation_ground"].includes(
      leisure ?? "",
    )
  ) {
    return "leisure_tourism";
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
  if (hasLongJump(coordinates, 1_200)) return false;
  if (ringBboxDiagonalMeters(coordinates) > 4_000) return false;
  if (maxSegmentToBboxRatio(coordinates) > 0.85) return false;
  if (ringAreaSquareMeters(coordinates) < 20) return false;
  if (ringSelfIntersects(coordinates)) return false;
  return true;
}

function shouldRenderAsPolygon(tags?: Record<string, string>): boolean {
  if (!tags) return false;
  if (tags.area === "no") return false;
  if (tags.type === "route" || tags.route || tags.route_master) return false;
  if (tags.railway && !["station", "platform"].includes(tags.railway)) return false;
  if (tags.highway && tags.area !== "yes") return false;
  if (tags.waterway && !tags.water) return false;
  if (tags.area === "yes") return true;
  return Boolean(
    tags.building ||
      tags["building:part"] ||
      tags.landuse ||
      tags.leisure ||
      tags.natural ||
      tags.amenity ||
      tags.tourism ||
      tags.shop ||
      tags.parking ||
      tags.water ||
      tags.man_made ||
      tags["addr:housenumber"],
  );
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

function ringBboxDiagonalMeters(coordinates: number[][]): number {
  const bbox = ringBbox(coordinates);
  return distanceMeters([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
}

function maxSegmentToBboxRatio(coordinates: number[][]): number {
  const diagonal = Math.max(1, ringBboxDiagonalMeters(coordinates));
  let maxSegment = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    maxSegment = Math.max(maxSegment, distanceMeters(coordinates[index - 1], coordinates[index]));
  }
  return maxSegment / diagonal;
}

function ringBbox(coordinates: number[][]): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of coordinates) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
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
    scale: "L",
    radiusMeters: 500,
    buildQuery: (params) =>
      buildQuery([
        `way["building"]${around(params)};`,
        `way["building:part"]${around(params)};`,
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
        `way["natural"~"wood|water|wetland|scrub|grassland|heath|bare_rock|sand"]${around(params)};`,
        `way["amenity"]${around(params)};`,
        `way["tourism"]${around(params)};`,
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
        `way["water"]${around(params)};`,
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
        `node["public_transport"="stop_position"]${around(params)};`,
        `node["highway"="bus_stop"]${around(params)};`,
        `node["railway"~"station|halt|tram_stop"]${around(params)};`,
        `way["public_transport"="platform"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "transportLines",
    scale: "L",
    radiusMeters: 1000,
    buildQuery: (params) => {
      const routeAround = around({
        ...params,
        radiusMeters: Math.min(params.radiusMeters, 450),
      });
      return `${buildHeader(20)}
relation["type"="route"]["route"~"bus|tram|subway|light_rail"]${routeAround}->.pt_routes;
(
  .pt_routes;
  way(r.pt_routes)${around(params)};
  way["railway"~"tram|light_rail|subway|rail"]${around(params)};
  way["highway"="busway"]${around(params)};
  way["busway"]${around(params)};
  way["bus"="yes"]${around(params)};
  way["lanes:bus"]${around(params)};
  way["bus:lanes"]${around(params)};
  way["bus:lanes:forward"]${around(params)};
  way["bus:lanes:backward"]${around(params)};
  way["public_transport"="platform"]${around(params)};
);
${output()}`;
    },
    buildFallbackQuery: (params) => `${buildHeader(16)}
(
  way["railway"~"tram|light_rail|subway|rail"]${around(params)};
  way["highway"="busway"]${around(params)};
  way["busway"]${around(params)};
  way["bus"="yes"]${around(params)};
  way["lanes:bus"]${around(params)};
  way["bus:lanes"]${around(params)};
  way["bus:lanes:forward"]${around(params)};
  way["bus:lanes:backward"]${around(params)};
  way["public_transport"="platform"]${around(params)};
);
${output()}`,
    parse: parseOverpassElements,
  },
  {
    id: "mobilityInfrastructure",
    scale: "L",
    radiusMeters: 500,
    buildQuery: (params) =>
      buildQuery([
        `way["highway"~"cycleway|path|footway|pedestrian|busway"]${around(params)};`,
        `way["sidewalk"]${around(params)};`,
        `way["cycleway"]${around(params)};`,
        `way["cycleway:left"]${around(params)};`,
        `way["cycleway:right"]${around(params)};`,
        `way["cycleway:both"]${around(params)};`,
        `way["bicycle"="designated"]${around(params)};`,
        `way["foot"="designated"]${around(params)};`,
        `way["busway"]${around(params)};`,
        `way["bus"="yes"]${around(params)};`,
        `way["lanes:bus"]${around(params)};`,
        `way["bus:lanes"]${around(params)};`,
        `way["bus:lanes:forward"]${around(params)};`,
        `way["bus:lanes:backward"]${around(params)};`,
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
        `nwr["amenity"~"school|kindergarten|childcare|college|university|library|hospital|clinic|doctors|dentist|pharmacy|social_facility|townhall|courthouse|police|fire_station|post_office|community_centre|arts_centre|place_of_worship|marketplace|bank|atm|theatre|cinema|restaurant|cafe|bar|pub|fast_food|biergarten|food_court"]${around(params)};`,
        `nwr["healthcare"]${around(params)};`,
        `node["shop"]${around(params)};`,
        `way["shop"]${around(params)};`,
        `nwr["tourism"~"museum|gallery|attraction|viewpoint|hotel|hostel|guest_house|information"]${around(params)};`,
        `nwr["leisure"~"sports_centre|fitness_centre|playground|pitch|swimming_pool|park|garden|recreation_ground"]${around(params)};`,
        `nwr["office"~"government|coworking"]${around(params)};`,
      ]),
    buildFallbackQuery: (params) =>
      buildQuery([
        `node["amenity"~"school|kindergarten|childcare|college|university|library|hospital|clinic|doctors|dentist|pharmacy|social_facility|townhall|courthouse|police|fire_station|post_office|community_centre|arts_centre|place_of_worship|marketplace|bank|atm|theatre|cinema|restaurant|cafe|bar|pub|fast_food|biergarten|food_court"]${around(params)};`,
        `node["healthcare"]${around(params)};`,
        `node["shop"]${around(params)};`,
        `node["tourism"~"museum|gallery|attraction|viewpoint|hotel|hostel|guest_house|information"]${around(params)};`,
        `node["leisure"~"sports_centre|fitness_centre|playground|pitch|swimming_pool|park|garden|recreation_ground"]${around(params)};`,
        `node["office"~"government|coworking"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "gastronomy",
    scale: "L",
    radiusMeters: 500,
    buildQuery: (params) =>
      buildQuery([
        `node["amenity"~"restaurant|cafe|bar|pub|fast_food|biergarten|food_court"]${around(params)};`,
        `way["amenity"~"restaurant|cafe|bar|pub|fast_food|biergarten|food_court"]${around(params)};`,
      ]),
    parse: parseOverpassElements,
  },
  {
    id: "parkingAreas",
    scale: "L",
    radiusMeters: 650,
    buildQuery: (params) =>
      buildQuery([
        `way["amenity"="parking"]${around(params)};`,
        `way["parking"]${around(params)};`,
        `way["parking:lane"]${around(params)};`,
        `way["parking:both"]${around(params)};`,
        `way["parking:left"]${around(params)};`,
        `way["parking:right"]${around(params)};`,
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
