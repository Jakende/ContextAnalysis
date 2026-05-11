import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function requireArg(args, key, message) {
  const value = args[key];
  if (!value) {
    throw new Error(message ?? `Missing required --${key}`);
  }
  return value;
}

export function parseBbox(value) {
  if (!value) return null;
  const parts = String(value).split(",").map((item) => Number(item.trim()));
  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) {
    throw new Error("Expected --bbox west,south,east,north");
  }
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) {
    throw new Error("Invalid bbox: west/south must be smaller than east/north");
  }
  return { west, south, east, north };
}

export async function ensureParent(filePath) {
  await mkdir(dirname(resolve(filePath)), { recursive: true });
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await ensureParent(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "UrbanContextAnalysis/0.1 preprocessing",
      Accept: "application/json, application/geo+json;q=0.9, */*;q=0.5",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

export async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "UrbanContextAnalysis/0.1 preprocessing",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}${text ? `: ${text.slice(0, 300)}` : ""}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

export function assertFeatureCollection(value, label) {
  if (!value || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error(`${label} did not return a GeoJSON FeatureCollection`);
  }
  return value;
}

export function firstString(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function firstNumber(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function normalizeFeatureCollection(collection, mapFeature) {
  return {
    type: "FeatureCollection",
    features: collection.features
      .filter((feature) => feature && feature.type === "Feature" && feature.geometry)
      .map(mapFeature),
  };
}

export function explodePolygonalFeatures(collection, mapProperties, options = {}) {
  const decimals = options.decimals ?? 6;
  const features = [];
  for (const feature of collection.features) {
    if (!feature?.geometry) continue;
    const properties = mapProperties(feature.properties ?? {}, feature);
    if (feature.geometry.type === "Polygon") {
      features.push({
        type: "Feature",
        geometry: roundGeometry(feature.geometry, decimals),
        properties,
      });
    }
    if (feature.geometry.type === "MultiPolygon") {
      feature.geometry.coordinates.forEach((coordinates, partIndex) => {
        features.push({
          type: "Feature",
          geometry: roundGeometry({ type: "Polygon", coordinates }, decimals),
          properties: {
            ...properties,
            partIndex,
            multipart: true,
          },
        });
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function roundGeometry(geometry, decimals = 6) {
  const factor = 10 ** decimals;
  const round = (value) => Math.round(value * factor) / factor;
  const roundCoordinates = (coordinates) =>
    Array.isArray(coordinates[0])
      ? coordinates.map(roundCoordinates)
      : coordinates.map((value) => (typeof value === "number" ? round(value) : value));
  return {
    ...geometry,
    coordinates: roundCoordinates(geometry.coordinates),
  };
}
