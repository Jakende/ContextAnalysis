import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Point,
  Polygon,
} from "geojson";

const EARTH_RADIUS_M = 6_371_008.8;

export function pointGeometry(lat: number, lon: number): Point {
  return { type: "Point", coordinates: [lon, lat] };
}

export function featureCollection(
  features: Feature[] = [],
): FeatureCollection {
  return { type: "FeatureCollection", features };
}

export function metersToLongitudeDegrees(meters: number, lat: number): number {
  const metersPerDegree =
    (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180);
  return meters / metersPerDegree;
}

export function metersToLatitudeDegrees(meters: number): number {
  return meters / ((Math.PI / 180) * EARTH_RADIUS_M);
}

export function bufferPolygon(
  lat: number,
  lon: number,
  radiusMeters: number,
  steps = 64,
): Polygon {
  const coordinates: number[][] = [];
  const angularDistance = radiusMeters / EARTH_RADIUS_M;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (2 * Math.PI * i) / steps;
    const pointLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat),
      );
    coordinates.push([(pointLon * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }

  return { type: "Polygon", coordinates: [coordinates] };
}

export function syntheticStreetSegment(
  lat: number,
  lon: number,
  lengthMeters = 220,
  angleDegrees = 8,
): LineString {
  const half = lengthMeters / 2;
  const angle = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(angle) * half;
  const dy = Math.sin(angle) * half;
  const lonDelta = metersToLongitudeDegrees(dx, lat);
  const latDelta = metersToLatitudeDegrees(dy);

  return {
    type: "LineString",
    coordinates: [
      [lon - lonDelta, lat - latDelta],
      [lon + lonDelta, lat + latDelta],
    ],
  };
}

export function polygonFromLineCorridor(
  line: LineString,
  widthMeters: number,
): Polygon {
  const [[lon1, lat1], [lon2, lat2]] = line.coordinates;
  const midLat = (lat1 + lat2) / 2;
  const dxMeters = (lon2 - lon1) / metersToLongitudeDegrees(1, midLat);
  const dyMeters = (lat2 - lat1) / metersToLatitudeDegrees(1);
  const length = Math.hypot(dxMeters, dyMeters) || 1;
  const nxMeters = (-dyMeters / length) * (widthMeters / 2);
  const nyMeters = (dxMeters / length) * (widthMeters / 2);
  const nx = metersToLongitudeDegrees(nxMeters, midLat);
  const ny = metersToLatitudeDegrees(nyMeters);

  return {
    type: "Polygon",
    coordinates: [
      [
        [lon1 + nx, lat1 + ny],
        [lon2 + nx, lat2 + ny],
        [lon2 - nx, lat2 - ny],
        [lon1 - nx, lat1 - ny],
        [lon1 + nx, lat1 + ny],
      ],
    ],
  };
}

export function bboxAroundPoint(
  lat: number,
  lon: number,
  radiusMeters: number,
): [number, number, number, number] {
  const lonDelta = metersToLongitudeDegrees(radiusMeters, lat);
  const latDelta = metersToLatitudeDegrees(radiusMeters);
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta];
}

export function geometryToFeature(
  geometry: Geometry,
  properties: Record<string, unknown>,
): Feature {
  return { type: "Feature", geometry, properties };
}
