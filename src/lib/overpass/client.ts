import type { FeatureCollection } from "geojson";
import { fetchWithTimeout, getCached, setCached } from "../api/cache";
import type { OverpassModule, OverpassProvenance, QueryParams } from "../types";
import { overpassModules } from "./modules";

const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.jp/api/interpreter",
];
const OVERPASS_CONCURRENCY = 2;
const OVERPASS_PROXY_TIMEOUT_MS = 110_000;
const OVERPASS_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const OVERPASS_CACHE_VERSION = "v12-poi-timeout-cache-fallback";

type OverpassProxyResponse = {
  ok: boolean;
  endpoint?: string;
  status?: number;
  elapsedMs?: number;
  endpointStatus?: OverpassProvenance["endpointStatus"];
  data?: unknown;
  error?: string;
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function runOverpassModules(input: {
  lat: number;
  lon: number;
  bbox?: QueryParams["bbox"];
  enabled: boolean;
  allowCache?: boolean;
}): Promise<{
  collections: Record<string, FeatureCollection>;
  provenance: OverpassProvenance[];
}> {
  const collections: Record<string, FeatureCollection> = {};
  const results = await runLimited(
    overpassModules,
    OVERPASS_CONCURRENCY,
    (module) => runOneModule(module, input),
  );

  const provenance = results.map((result) => result.provenance);
  for (const result of results) {
    if (result.collection) collections[result.id] = result.collection;
  }

  return { collections, provenance };
}

async function runOneModule(
  module: OverpassModule,
  input: {
    lat: number;
    lon: number;
    bbox?: QueryParams["bbox"];
    enabled: boolean;
    allowCache?: boolean;
  },
): Promise<{
  id: string;
  collection: FeatureCollection | null;
  provenance: OverpassProvenance;
}> {
  const radiusMeters = Math.min(module.radiusMeters ?? 500, 1000);
  const params: QueryParams = {
    lat: input.lat,
    lon: input.lon,
    radiusMeters,
    ...(input.bbox ? { bbox: input.bbox } : {}),
  };
  const query = module.buildQuery(params);
  const hash = await sha256(query);
  const cacheKey = `sd:overpass:${OVERPASS_CACHE_VERSION}:${module.id}:${hash}`;

  if (!input.enabled) {
    return {
      id: module.id,
      collection: null,
      provenance: {
        id: module.id,
        query,
        cacheKey,
        status: "skipped",
        endpointStatus: [],
        caveats: ["Live Overpass enrichment disabled for this run."],
      },
    };
  }

  const cached = input.allowCache
    ? getCached<FeatureCollection>(cacheKey, OVERPASS_CACHE_MAX_AGE_MS)
    : null;

  const endpointStatus: OverpassProvenance["endpointStatus"] = [];
  let featureCollection: FeatureCollection | null = null;
  let selectedEndpoint: string | undefined;
  let usedFallbackQuery = false;

  const primary = await fetchOverpassQuery(query, endpointStatus);
  if (primary.ok && primary.proxy?.data) {
    featureCollection = module.parse(primary.proxy.data);
    selectedEndpoint = primary.proxy.endpoint;
    if (input.allowCache) setCached(cacheKey, featureCollection);
  } else if (module.buildFallbackQuery) {
    const fallbackQuery = module.buildFallbackQuery(params);
    const fallback = await fetchOverpassQuery(fallbackQuery, endpointStatus);
    if (fallback.ok && fallback.proxy?.data) {
      featureCollection = module.parse(fallback.proxy.data);
      selectedEndpoint = fallback.proxy.endpoint;
      usedFallbackQuery = true;
      if (input.allowCache) setCached(cacheKey, featureCollection);
    }
  }

  if (featureCollection) {
    return {
      id: module.id,
      collection: featureCollection,
      provenance: {
        id: module.id,
        query,
        cacheKey,
        endpoint: selectedEndpoint,
        status: "ok",
        elapsedMs: endpointStatus.reduce(
          (total, status) => total + status.elapsedMs,
          0,
        ),
        featureCount: featureCollection.features.length,
        endpointStatus,
        caveats: usedFallbackQuery
          ? [fallbackCaveat(module.id)]
          : [],
      },
    };
  }

  if (cached) {
    return {
      id: module.id,
      collection: cached,
      provenance: {
        id: module.id,
        query,
        cacheKey,
        status: "cached",
        elapsedMs: endpointStatus.reduce(
          (total, status) => total + status.elapsedMs,
          0,
        ),
        featureCount: cached.features.length,
        endpointStatus,
      caveats: [
          "Live Overpass refresh failed; cached data for this exact query were used because cache fallback was explicitly enabled.",
      ],
      },
    };
  }

  return {
    id: module.id,
    collection: null,
    provenance: {
      id: module.id,
      query,
      cacheKey,
      status: "failed",
      elapsedMs: endpointStatus.reduce(
        (total, status) => total + status.elapsedMs,
        0,
      ),
      endpointStatus,
      caveats: [
        "All configured Overpass endpoints failed or timed out. Affected live OSM indicators remain unavailable.",
      ],
    },
  };
}

function fallbackCaveat(moduleId: string): string {
  if (moduleId === "transportLines") {
    return "Primary Overpass route-relation query timed out or failed; fallback physical OSM public-transport corridor geometry was used for line display.";
  }
  if (moduleId === "pois") {
    return "Primary Overpass POI query timed out or failed; fallback node-only POI query was used to preserve essential service and amenity evidence.";
  }
  return "Primary Overpass query timed out or failed; fallback query was used for this module.";
}

async function fetchOverpassQuery(
  query: string,
  endpointStatus: OverpassProvenance["endpointStatus"],
): Promise<{ ok: boolean; proxy?: OverpassProxyResponse }> {
  const started = performance.now();
  try {
    const response = await fetchWithTimeout(
      "/api/overpass",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, endpoints: OVERPASS_ENDPOINTS }),
      },
      OVERPASS_PROXY_TIMEOUT_MS,
    );
    const proxy = (await response.json()) as OverpassProxyResponse;
    endpointStatus.push(...normalizeEndpointStatus(proxy, performance.now() - started));
    return { ok: response.ok && proxy.ok && Boolean(proxy.data), proxy };
  } catch (error) {
    endpointStatus.push({
      endpoint: "/api/overpass",
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}

function normalizeEndpointStatus(
  proxy: OverpassProxyResponse,
  fallbackElapsedMs: number,
): OverpassProvenance["endpointStatus"] {
  if (proxy.endpointStatus?.length) return proxy.endpointStatus;
  return [
    {
      endpoint: proxy.endpoint ?? "/api/overpass",
      ok: proxy.ok,
      elapsedMs: Math.round(proxy.elapsedMs ?? fallbackElapsedMs),
      error: proxy.error,
    },
  ];
}

async function runLimited<T, R>(
  items: T[],
  concurrency: number,
  runner: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await runner(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}
