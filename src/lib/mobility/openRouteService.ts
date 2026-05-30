import type { FeatureCollection, Polygon } from "geojson";
import { fetchWithTimeout, getCached, setCached } from "../api/cache";
import type { SelectedPoint, SourceFetchReceipt } from "../types";
import { bufferPolygon, featureCollection, geometryToFeature } from "../analysis/geometry";

const ORS_URL = "https://api.openrouteservice.org/v2/isochrones";
const CACHE_VERSION = "v1";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const DEFAULT_RANGES_SECONDS = [300, 600, 900];

export type IsochroneResult = {
  collection: FeatureCollection;
  receipt: SourceFetchReceipt;
};

export async function fetchOpenRouteServiceIsochrones(
  selectedPoint: SelectedPoint,
  computedAt: string,
): Promise<IsochroneResult> {
  const startedAt = performance.now();
  const apiKey = import.meta.env.VITE_OPENROUTESERVICE_API_KEY;
  const profiles = [
    { id: "foot-walking", label: "walking", rangeType: "time" },
    { id: "cycling-regular", label: "cycling", rangeType: "time" },
    { id: "driving-car", label: "driving", rangeType: "time" },
  ] as const;
  const fallbackCollection = createFallbackIsochrones(selectedPoint, computedAt);

  if (!apiKey) {
    return {
      collection: fallbackCollection,
      receipt: createReceipt({
        startedAt,
        computedAt,
        status: "missing",
        featureCount: fallbackCollection.features.length,
        method:
          "OpenRouteService API key not configured; generated deterministic geometric mobility catchment placeholders from the selected point.",
        caveats: [
          "Set VITE_OPENROUTESERVICE_API_KEY to request network isochrones from OpenRouteService.",
          "Fallback polygons are distance buffers, not routed isochrones.",
        ],
      }),
    };
  }

  try {
    const collections = await Promise.all(
      profiles.map((profile) => fetchProfileIsochrone(profile.id, profile.label, selectedPoint, apiKey)),
    );
    const collection = featureCollection(collections.flatMap((item) => item.features));
    return {
      collection,
      receipt: createReceipt({
        startedAt,
        computedAt,
        status: "ok",
        featureCount: collection.features.length,
        method:
          "Requested walking, cycling, and driving isochrone polygons from OpenRouteService with 5-, 10-, and 15-minute ranges and cached responses by coordinate/profile/range.",
        caveats: [
          "OpenRouteService isochrones depend on external API availability, quota, and network model coverage.",
        ],
      }),
    };
  } catch (error) {
    return {
      collection: fallbackCollection,
      receipt: createReceipt({
        startedAt,
        computedAt,
        status: "failed",
        featureCount: fallbackCollection.features.length,
        error: error instanceof Error ? error.message : String(error),
        method:
          "OpenRouteService request failed; generated deterministic geometric mobility catchment placeholders from the selected point.",
        caveats: [
          "OpenRouteService isochrones were unavailable for this analysis run.",
          "Fallback polygons are distance buffers, not routed isochrones.",
        ],
      }),
    };
  }
}

async function fetchProfileIsochrone(
  profile: string,
  mode: string,
  selectedPoint: SelectedPoint,
  apiKey: string,
): Promise<FeatureCollection> {
  const cacheKey = [
    "uca:ors",
    CACHE_VERSION,
    profile,
    selectedPoint.lat.toFixed(5),
    selectedPoint.lon.toFixed(5),
    DEFAULT_RANGES_SECONDS.join("-"),
  ].join(":");
  const cached = getCached<FeatureCollection>(cacheKey, CACHE_MAX_AGE_MS);
  if (cached) return tagIsochroneFeatures(cached, mode, "cached");

  const response = await fetchWithTimeout(
    `${ORS_URL}/${profile}`,
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations: [[selectedPoint.lon, selectedPoint.lat]],
        range: DEFAULT_RANGES_SECONDS,
        range_type: "time",
        location_type: "start",
      }),
    },
    12_000,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouteService ${profile} failed: ${response.status} ${body.slice(0, 180)}`);
  }
  const data = (await response.json()) as FeatureCollection;
  setCached(cacheKey, data);
  return tagIsochroneFeatures(data, mode, "live");
}

function tagIsochroneFeatures(
  collection: FeatureCollection,
  mode: string,
  status: "live" | "cached",
): FeatureCollection {
  return featureCollection(
    collection.features
      .filter((feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")
      .map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          sourceId: "openrouteservice-isochrones",
          isochroneMode: mode,
          rangeSeconds: Number(feature.properties?.value ?? DEFAULT_RANGES_SECONDS[0]),
          rangeMinutes: Math.round(Number(feature.properties?.value ?? DEFAULT_RANGES_SECONDS[0]) / 60),
          retrievalStatus: status,
        },
      })),
  );
}

function createFallbackIsochrones(
  selectedPoint: SelectedPoint,
  computedAt: string,
): FeatureCollection {
  const radii = [
    { mode: "walking", rangeSeconds: 300, radiusMeters: 350 },
    { mode: "walking", rangeSeconds: 600, radiusMeters: 700 },
    { mode: "walking", rangeSeconds: 900, radiusMeters: 1_050 },
    { mode: "cycling", rangeSeconds: 300, radiusMeters: 1_250 },
    { mode: "cycling", rangeSeconds: 600, radiusMeters: 2_500 },
    { mode: "cycling", rangeSeconds: 900, radiusMeters: 3_750 },
    { mode: "driving", rangeSeconds: 300, radiusMeters: 2_000 },
    { mode: "driving", rangeSeconds: 600, radiusMeters: 4_000 },
    { mode: "driving", rangeSeconds: 900, radiusMeters: 6_000 },
  ];
  return featureCollection(
    radii.map(({ mode, radiusMeters, rangeSeconds }) =>
      geometryToFeature(bufferPolygon(selectedPoint.lat, selectedPoint.lon, radiusMeters, 96) as Polygon, {
        sourceId: "openrouteservice-isochrones",
        isochroneMode: mode,
        radiusMeters,
        rangeSeconds,
        rangeMinutes: rangeSeconds / 60,
        computedAt,
        retrievalStatus: "fallback",
      }),
    ),
  );
}

function createReceipt(input: {
  startedAt: number;
  computedAt: string;
  status: SourceFetchReceipt["status"];
  featureCount: number;
  method: string;
  caveats: string[];
  error?: string;
}): SourceFetchReceipt {
  return {
    sourceId: "openrouteservice-isochrones",
    label: "OpenRouteService isochrones",
    type: "live-api",
    status: input.status,
    queriedAt: input.computedAt,
    elapsedMs: Math.round(performance.now() - input.startedAt),
    url: ORS_URL,
    featureCount: input.featureCount,
    method: input.method,
    caveats: input.caveats,
    error: input.error,
  };
}
