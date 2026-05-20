import { sourceRegistry } from "./sourceRegistry";
import type {
  DataSource,
  DataSourceRunEvent,
  DataSourceRunPhase,
  DataSourceRunStatus,
  SourceFetchReceipt,
} from "../types";

type PreflightSourceResult = {
  source: string;
  status: "ok" | "failed" | "skipped";
  message?: string;
};

const POINT_CACHE_SOURCE_TO_REGISTRY: Record<string, string> = {
  overture: "overture-buildings",
  "urban-atlas": "urban-atlas-2021-catalog",
};

export function createDataSourceRunReport(input: {
  createdAt: string;
  preflightEvents?: DataSourceRunEvent[];
  sourceFetches: SourceFetchReceipt[];
}): DataSourceRunEvent[] {
  return [
    ...(input.preflightEvents ?? []),
    ...input.sourceFetches.map((receipt) =>
      sourceFetchToRunEvent(receipt, input.createdAt),
    ),
  ].sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

export function pointCacheResultsToRunEvents(input: {
  results: PreflightSourceResult[];
  requestedAt: string;
  elapsedMs?: number;
  error?: string;
}): DataSourceRunEvent[] {
  if (!input.results.length && input.error) {
    return [
      {
        id: `preflight:point-cache`,
        label: "Point cache resolver",
        phase: "preflight",
        status: "failed",
        requestedAt: input.requestedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: input.elapsedMs,
        detail: "Point cache resolver could not complete before analysis.",
        caveats: [
          "Analysis continues with live APIs and available preprocessed sources.",
        ],
        error: input.error,
      },
    ];
  }

  return input.results.map((result) => {
    const sourceId = POINT_CACHE_SOURCE_TO_REGISTRY[result.source];
    const source = sourceId
      ? (sourceRegistry[sourceId as keyof typeof sourceRegistry] as DataSource)
      : undefined;
    const status = pointCacheStatusToRunStatus(result);
    return {
      id: `preflight:${result.source}`,
      sourceId,
      label: source?.label ?? result.source,
      phase: "preflight",
      status,
      requestedAt: input.requestedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: input.elapsedMs,
      scale: source?.scale,
      url: source?.url,
      localPath: source?.localPath,
      detail: pointCacheDetail(result, status),
      caveats: pointCacheCaveats(result, status),
      error: status === "failed" ? result.message : undefined,
    };
  });
}

function sourceFetchToRunEvent(
  receipt: SourceFetchReceipt,
  createdAt: string,
): DataSourceRunEvent {
  const source = sourceRegistry[receipt.sourceId as keyof typeof sourceRegistry];
  const status = sourceFetchStatusToRunStatus(receipt);
  return {
    id: `source:${receipt.sourceId}`,
    sourceId: receipt.sourceId,
    label: receipt.label,
    phase: sourceFetchPhase(receipt, source),
    status,
    requestedAt: receipt.queriedAt || createdAt,
    finishedAt: receipt.queriedAt || createdAt,
    elapsedMs: receipt.elapsedMs,
    scale: source?.scale,
    url: receipt.url,
    localPath: receipt.localPath,
    recordCount: receipt.recordCount,
    featureCount: receipt.featureCount,
    detail: receipt.method,
    caveats: receipt.caveats,
    error: receipt.error,
  };
}

function sourceFetchStatusToRunStatus(
  receipt: SourceFetchReceipt,
): DataSourceRunStatus {
  if (hasMissingCredentialSignal(receipt.error, receipt.caveats.join(" "))) {
    return "missing-credentials";
  }
  if (receipt.status === "cached") return "cache-hit";
  if (receipt.status === "failed") return "failed";
  if (receipt.status === "skipped") return "skipped";
  if (receipt.status === "missing") {
    return isPointCoverageReceipt(receipt) ? "empty" : "missing";
  }
  if (receipt.status === "ok") {
    if (
      !isNonCoverageReceipt(receipt) &&
      isPointCoverageReceipt(receipt) &&
      (receipt.featureCount ?? receipt.recordCount ?? 0) === 0
    ) {
      return "empty";
    }
    return "fetched";
  }
  return "requested";
}

function sourceFetchPhase(
  receipt: SourceFetchReceipt,
  source?: DataSource,
): DataSourceRunPhase {
  if (receipt.sourceId === "osm-nominatim") return "geocoding";
  if (receipt.sourceId === "osm-overpass" || receipt.sourceId === "osm-core") {
    return "live-api";
  }
  if (source?.type === "tile-service") return "tile-service";
  if (source?.updateMode === "preprocessed") return "preprocessed";
  if (source?.type === "live-api") return "live-api";
  return "preprocessed";
}

function pointCacheStatusToRunStatus(
  result: PreflightSourceResult,
): DataSourceRunStatus {
  if (hasMissingCredentialSignal(result.message)) return "missing-credentials";
  if (result.status === "ok") return "fetched";
  if (result.status === "skipped") return "skipped";
  return "failed";
}

function pointCacheDetail(
  result: PreflightSourceResult,
  status: DataSourceRunStatus,
): string {
  if (status === "missing-credentials") {
    return "Required credentials were not available in the local server environment.";
  }
  if (status === "skipped") return result.message ?? "Source was not applicable.";
  if (status === "fetched") {
    return result.message ?? "Point-specific source cache was refreshed.";
  }
  return result.message ?? "Point-specific source cache failed.";
}

function pointCacheCaveats(
  result: PreflightSourceResult,
  status: DataSourceRunStatus,
): string[] {
  if (status === "missing-credentials") {
    return [
      "The source was requested for this point, but credentials are required for the resolver.",
    ];
  }
  if (status === "skipped") return [result.message ?? "Resolver skipped this source."];
  return [];
}

function isPointCoverageReceipt(receipt: SourceFetchReceipt): boolean {
  return /selected point|point cache|analysis radius|sharded local cache/i.test(
    `${receipt.method} ${receipt.caveats.join(" ")}`,
  );
}

function isNonCoverageReceipt(receipt: SourceFetchReceipt): boolean {
  return (
    receipt.sourceId === "osm-nominatim" ||
    receipt.sourceId === "openfreemap-planet" ||
    receipt.sourceId === "openfreemap-fonts" ||
    receipt.sourceId === "natural-earth-openfreemap"
  );
}

function hasMissingCredentialSignal(...values: Array<string | undefined>): boolean {
  return values.some((value) =>
    /credential|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|CDSE/i.test(value ?? ""),
  );
}
