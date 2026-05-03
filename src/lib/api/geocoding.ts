import { fetchWithTimeout, getCached, setCached } from "./cache";

type NominatimResponse = {
  display_name?: string;
  name?: string;
  address?: {
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    suburb?: string;
    borough?: string;
    city_district?: string;
    municipality?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
  };
};

type NominatimSearchItem = NominatimResponse & {
  lat: string;
  lon: string;
};

type NominatimSearchProxyResponse = {
  ok?: boolean;
  data?: NominatimSearchItem[];
  error?: string;
};

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<{
  status: "ok" | "failed";
  cacheKey: string;
  label?: string;
  address?: string;
  municipality?: string;
  district?: string;
  sourceStatus?: "live" | "cached";
  error?: string;
}> {
  const cacheKey = `sd:nominatim:reverse:${lat.toFixed(5)}:${lon.toFixed(5)}`;
  const cached = getCached<NominatimResponse>(cacheKey, 1000 * 60 * 60 * 24);

  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "de,en",
    email: "local-dev@stadtdaten.invalid",
  });

  try {
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
      {
        headers: {
          Referer: window.location.origin,
        },
      },
      4_000,
    );

    if (!response.ok) {
      throw new Error(`Nominatim returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as NominatimResponse;
    setCached(cacheKey, json);
    return parseNominatim(json, cacheKey, "live");
  } catch (error) {
    if (cached) {
      return parseNominatim(cached, cacheKey, "cached");
    }
    return {
      status: "failed",
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function forwardGeocode(
  query: string,
): Promise<{
  status: "ok" | "failed";
  lat?: number;
  lon?: number;
  label?: string;
  sourceStatus?: "live" | "cached";
  error?: string;
}> {
  const results = await searchPlaces(query, 1);
  if (results.status === "ok" && results.results[0]) {
    return { ...results.results[0], sourceStatus: results.sourceStatus };
  }
  return {
    status: "failed",
    error: results.error ?? "No result",
  };
}

export async function searchPlaces(
  query: string,
  limit = 5,
): Promise<{
  status: "ok" | "failed";
  results: Array<{
    status: "ok";
    lat: number;
    lon: number;
    label?: string;
  }>;
  sourceStatus?: "live" | "cached";
  error?: string;
}> {
  const normalized = query.trim();
  if (!normalized) {
    return { status: "failed", results: [], error: "Search query is empty" };
  }

  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 8));
  const cacheKey = `sd:nominatim:search:${normalized.toLowerCase()}:${safeLimit}`;
  const cached = getCached<NominatimSearchItem[]>(cacheKey, 1000 * 60 * 60 * 24);

  const params = new URLSearchParams({
    format: "jsonv2",
    q: normalized,
    limit: String(safeLimit),
    addressdetails: "1",
    "accept-language": "de,en",
    email: "local-dev@stadtdaten.invalid",
  });

  try {
    const response = await fetchWithTimeout(
      `/api/nominatim-search?${params.toString()}`,
      { cache: "no-store" },
      6_000,
    );
    if (!response.ok) {
      throw new Error(`Search proxy returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as NominatimSearchProxyResponse;
    if (payload.ok === false) {
      throw new Error(payload.error ?? "Nominatim search failed");
    }
    const results = payload.data ?? [];
    setCached(cacheKey, results);
    if (!results[0]) throw new Error("No result");
    return {
      status: "ok",
      results: results.map((item) => parseSearch(item, "live")),
      sourceStatus: "live",
    };
  } catch (error) {
    if (cached?.[0]) {
      return {
        status: "ok",
        results: cached.map((item) => parseSearch(item, "cached")),
        sourceStatus: "cached",
      };
    }
    return {
      status: "failed",
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseNominatim(
  json: NominatimResponse,
  cacheKey: string,
  sourceStatus: "live" | "cached",
): {
  status: "ok";
  cacheKey: string;
  label?: string;
  address?: string;
  municipality?: string;
  district?: string;
  sourceStatus: "live" | "cached";
} {
  const label =
    json.address?.road ??
    json.address?.pedestrian ??
    json.name ??
    json.address?.neighbourhood ??
    json.address?.suburb;
  const municipality =
    json.address?.city ??
    json.address?.town ??
    json.address?.village ??
    json.address?.municipality ??
    json.address?.county;
  const district =
    json.address?.city_district ??
    json.address?.borough ??
    json.address?.suburb ??
    json.address?.neighbourhood;

  return {
    status: "ok",
    cacheKey,
    label,
    address: json.display_name,
    municipality,
    district,
    sourceStatus,
  };
}

function parseSearch(
  item: NominatimSearchItem,
  sourceStatus: "live" | "cached",
): {
  status: "ok";
  lat: number;
  lon: number;
  label?: string;
  sourceStatus: "live" | "cached";
} {
  return {
    status: "ok",
    lat: Number(item.lat),
    lon: Number(item.lon),
    label: item.display_name ?? item.name,
    sourceStatus,
  };
}
