import type { FeatureCollection } from "geojson";
import { fetchWithTimeout } from "../api/cache";
import type {
  DataSource,
  OverpassProvenance,
  SourceFetchReceipt,
} from "../types";
import { getCsvSourceSummary } from "./csvLoader";
import { sourceRegistry } from "./sourceRegistry";

type GeocodingReceipt = {
  enabled: boolean;
  status: "ok" | "failed" | "skipped";
  cacheKey?: string;
  sourceStatus?: "live" | "cached";
  error?: string;
};

type SourceAdapterInput = {
  district: string;
  computedAt: string;
  geocoding: GeocodingReceipt;
  overpassQueries: OverpassProvenance[];
  overpassCollections: Record<string, FeatureCollection>;
};

type SourceProbeResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  contentType?: string | null;
  elapsedMs?: number;
  error?: string;
};

const PREPROCESSED_ASSET_CHECKS: Record<string, string> = {
  "zensus-grid-2022": "/tiles/zensus-grid/metadata.json",
  "lod2-bayern": "/tiles/lod2/tileset.json",
  "srtm-30m": "/data/processed/srtm-30m/metadata.json",
  "eurostat-gisco-fua": "/data/processed/eurostat-gisco-fua.json",
  "copernicus-urban-atlas": "/data/processed/copernicus-urban-atlas.json",
  "ghsl-jrc": "/data/processed/ghsl.json",
  "bkg-geobasis": "/data/processed/bkg-boundaries.json",
  "dwd-cdc": "/data/processed/dwd-climate.json",
  "mobilithek-gtfs": "/data/processed/gtfs-stops.json",
  "natural-earth-openfreemap":
    "https://tiles.openfreemap.org/natural_earth/ne2sr/0/0/0.png",
};

const DIRECT_ADAPTER_SOURCE_IDS = new Set([
  "openfreemap-planet",
  "openfreemap-fonts",
  "osm-nominatim",
  "osm-overpass",
  "osm-core",
  "destatis-genesis",
]);

export async function runSourceAdapters(
  input: SourceAdapterInput,
): Promise<SourceFetchReceipt[]> {
  const assetReceipts = await Promise.all([
    fetchOpenFreeMapTileJson(input.computedAt),
    fetchOpenFreeMapSprite(input.computedAt),
  ]);
  const receipts: SourceFetchReceipt[] = [
    ...assetReceipts,
    geocodingToReceipt(input.geocoding, input.computedAt),
    overpassToReceipt(input.overpassQueries, input.computedAt),
    osmCoreToReceipt(input.overpassCollections, input.computedAt),
    csvToReceipt(input.district, input.computedAt),
  ];
  const registryReceipts = await Promise.all(
    Object.keys(sourceRegistry)
      .filter((sourceId) => !DIRECT_ADAPTER_SOURCE_IDS.has(sourceId))
      .map((sourceId) => registryBackedSourceReceipt(sourceId, input.computedAt)),
  );
  receipts.push(...registryReceipts);

  return receipts;
}

async function fetchOpenFreeMapTileJson(
  queriedAt: string,
): Promise<SourceFetchReceipt> {
  const source = sourceRegistry["openfreemap-planet"];
  const started = performance.now();
  try {
    const response = await fetchWithTimeout(
      source.url!,
      { cache: "no-store" },
      4_000,
    );
    const json = (await response.json()) as { vector_layers?: unknown[] };
    return receipt(source, {
      status: response.ok ? "ok" : "failed",
      queriedAt,
      elapsedMs: Math.round(performance.now() - started),
      recordCount: json.vector_layers?.length,
      method:
        "Fetched OpenFreeMap TileJSON for this analysis run to verify base-map source availability.",
      caveats: [],
      error: response.ok ? undefined : `HTTP ${response.status}`,
    });
  } catch (error) {
    return failedReceipt(source, queriedAt, started, error, [
      "Base tiles failed availability check; analysis remains usable from structured data.",
    ]);
  }
}

async function fetchOpenFreeMapSprite(
  queriedAt: string,
): Promise<SourceFetchReceipt> {
  const source = sourceRegistry["openfreemap-fonts"];
  const url = "https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json";
  const started = performance.now();
  try {
    const response = await fetchWithTimeout(url, { cache: "no-store" }, 4_000);
    const json = (await response.json()) as Record<string, unknown>;
    return receipt(source, {
      status: response.ok ? "ok" : "failed",
      queriedAt,
      elapsedMs: Math.round(performance.now() - started),
      url,
      recordCount: Object.keys(json).length,
      method:
        "Fetched OpenFreeMap sprite manifest for this analysis run to verify map symbol assets.",
      caveats: [],
      error: response.ok ? undefined : `HTTP ${response.status}`,
    });
  } catch (error) {
    return failedReceipt(source, queriedAt, started, error, [
      "Sprite/glyph availability check failed; analytical indicators are unaffected.",
    ]);
  }
}

function geocodingToReceipt(
  geocoding: GeocodingReceipt,
  queriedAt: string,
): SourceFetchReceipt {
  const source = sourceRegistry["osm-nominatim"];
  return receipt(source, {
    status:
      geocoding.status === "ok" && geocoding.sourceStatus === "cached"
        ? "cached"
        : geocoding.status === "ok"
          ? "ok"
          : geocoding.status,
    queriedAt,
    elapsedMs: 0,
    method:
      "Reverse geocoding executed for the selected point; cached Nominatim responses still count as source-backed retrieval.",
    caveats:
      geocoding.status === "ok"
        ? []
        : ["Map-click analysis continues without address context."],
    error: geocoding.error,
  });
}

function overpassToReceipt(
  queries: OverpassProvenance[],
  queriedAt: string,
): SourceFetchReceipt {
  const source = sourceRegistry["osm-overpass"];
  const okQueries = queries.filter(
    (query) => query.status === "ok" || query.status === "cached",
  );
  const failedQueries = queries.filter((query) => query.status === "failed");
  return receipt(source, {
    status:
      okQueries.length > 0
        ? queries.every((query) => query.status === "cached")
          ? "cached"
          : "ok"
        : failedQueries.length > 0
          ? "failed"
          : "skipped",
    queriedAt,
    elapsedMs: queries.reduce((total, query) => total + (query.elapsedMs ?? 0), 0),
    recordCount: queries.length,
    featureCount: queries.reduce(
      (total, query) => total + (query.featureCount ?? 0),
      0,
    ),
    method:
      "Ran deterministic Overpass modules for land use, green/blue, transit stops, transit lines, mobility, POIs, development hints, streets, buildings, trees, and barriers.",
    caveats: queries.flatMap((query) => query.caveats),
    error:
      failedQueries.length > 0 && okQueries.length === 0
        ? "All Overpass modules failed"
        : undefined,
  });
}

function osmCoreToReceipt(
  collections: Record<string, FeatureCollection>,
  queriedAt: string,
): SourceFetchReceipt {
  const source = sourceRegistry["osm-core"];
  const featureCount = Object.values(collections).reduce(
    (total, collection) => total + collection.features.length,
    0,
  );
  return receipt(source, {
    status: featureCount > 0 ? "ok" : "missing",
    queriedAt,
    elapsedMs: 0,
    recordCount: Object.keys(collections).length,
    featureCount,
    method:
      "Normalized OSM-derived live Overpass responses into GeoJSON collections for the selected point.",
    caveats:
      featureCount > 0
        ? ["OSM completeness varies by place and tag class."]
        : ["No live OSM features were available; fallback indicators remain low-confidence."],
  });
}

function csvToReceipt(
  district: string,
  queriedAt: string,
): SourceFetchReceipt {
  const source = sourceRegistry["destatis-genesis"];
  const summary = getCsvSourceSummary(district);
  const exactMatches = summary.matchedRows.filter(
    (match) => match.match === "exact",
  ).length;
  const fallbackMatches = summary.matchedRows.length - exactMatches;
  return receipt(source, {
    status: "ok",
    queriedAt,
    elapsedMs: 0,
    recordCount: summary.recordCount,
    sourceVersion: "Zensus 2022 sample schema",
    method:
      "Read all configured local CSV tables for the selected point's inferred district during this analysis run.",
    caveats: [
      `${exactMatches}/${summary.tableCount} CSV tables matched the inferred district directly; ${fallbackMatches} used deterministic city/sample fallback rows.`,
      "Bundled CSV files are MVP schema samples and must be replaced by authoritative Destatis/Zensus preprocessing exports.",
    ],
  });
}

async function registryBackedSourceReceipt(
  sourceId: string,
  queriedAt: string,
): Promise<SourceFetchReceipt> {
  const source: DataSource = sourceRegistry[sourceId as keyof typeof sourceRegistry];
  const localUrl = PREPROCESSED_ASSET_CHECKS[sourceId] ?? publicUrlFromLocalPath(source.localPath);

  if (localUrl) {
    const localStarted = performance.now();
    try {
      const response = await fetchWithTimeout(
        localUrl,
        { cache: "no-store" },
        3_000,
      );
      const contentType = response.headers.get("content-type") ?? "";
      const assetPresent = response.ok && !contentType.includes("text/html");
      if (assetPresent) {
        return receipt(source, {
          status: "ok",
          queriedAt,
          elapsedMs: Math.round(performance.now() - localStarted),
          url: localUrl,
          method:
            "Loaded the configured local/preprocessed asset endpoint for this registry source during the selected-point analysis run.",
          caveats: [],
          error: undefined,
        });
      }
    } catch {
      // Fall through to the registry URL probe below.
    }
  }

  if (source.url) {
    return remoteMetadataReceipt(source, queriedAt, localUrl);
  }

  return receipt(source, {
    status: "missing",
    queriedAt,
    elapsedMs: 0,
    url: localUrl,
    method:
      "Checked the source registry for a configured local asset or remote URL during the selected-point analysis run.",
    caveats: [
      "No loadable local asset or remote URL is configured; related indicators remain unavailable instead of being inferred.",
    ],
    error: "No source URL or public local asset path configured",
  });
}

async function remoteMetadataReceipt(
  source: DataSource,
  queriedAt: string,
  localUrl?: string,
): Promise<SourceFetchReceipt> {
  const started = performance.now();
  try {
    const probe = await probeRemoteSource(source.url!);
    return receipt(source, {
      status: probe.ok ? "ok" : "failed",
      queriedAt,
      elapsedMs: Math.round(performance.now() - started),
      url: probe.url ?? source.url,
      sourceVersion: probe.contentType ?? undefined,
      method:
        "Probed the official registry URL through the local API layer during the selected-point analysis run because no local preprocessed asset was available.",
      caveats: [
        localUrl
          ? `Local preprocessed asset was not available at ${localUrl}.`
          : "No local preprocessed asset endpoint is configured for this source.",
        probe.ok
          ? "Remote source metadata headers were loaded server-side; spatial metrics require a preprocessed local dataset before values are emitted."
          : "Remote source metadata could not be loaded; spatial metrics remain unavailable.",
      ],
      error: probe.ok
        ? undefined
        : probe.error ?? `HTTP ${probe.status ?? "unknown"}`,
    });
  } catch (error) {
    return failedReceipt(source, queriedAt, started, error, [
      localUrl
        ? `Local preprocessed asset was not available at ${localUrl}.`
        : "No local preprocessed asset endpoint is configured for this source.",
      "The local source-probe API was unavailable or the remote source failed; analysis exposes this as unavailable instead of inventing values.",
    ], source.url);
  }
}

async function probeRemoteSource(url: string): Promise<SourceProbeResponse> {
  const response = await fetchWithTimeout(
    `/api/source-probe?url=${encodeURIComponent(url)}`,
    { cache: "no-store" },
    12_000,
  );
  const payload = (await response.json()) as SourceProbeResponse;
  if (!response.ok && !payload.error) {
    payload.error = `Source probe HTTP ${response.status}`;
  }
  return payload;
}

function publicUrlFromLocalPath(localPath?: string): string | undefined {
  if (!localPath) return undefined;
  if (localPath.startsWith("public/")) return `/${localPath.slice("public/".length)}`;
  if (localPath.startsWith("/")) return localPath;
  return undefined;
}

function receipt(
  source: DataSource,
  input: Omit<SourceFetchReceipt, "sourceId" | "label" | "type" | "elapsedMs"> & {
    elapsedMs: number;
  },
): SourceFetchReceipt {
  return {
    sourceId: source.id,
    label: source.label,
    type: source.type,
    url: input.url ?? source.url,
    localPath: source.localPath,
    ...input,
    elapsedMs: input.elapsedMs,
  };
}

function failedReceipt(
  source: DataSource,
  queriedAt: string,
  started: number,
  error: unknown,
  caveats: string[],
  url?: string,
): SourceFetchReceipt {
  return receipt(source, {
    status: "failed",
    queriedAt,
    elapsedMs: Math.round(performance.now() - started),
    url,
    method: "Attempted source retrieval for the selected-point analysis run.",
    caveats,
    error: error instanceof Error ? error.message : String(error),
  });
}
