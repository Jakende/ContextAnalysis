export type PointCacheSource = "overture" | "urban-atlas";

export type PointCacheResult = {
  source: PointCacheSource;
  status: "ok" | "failed" | "skipped";
  message: string;
  stdout?: string;
  stderr?: string;
};

export async function resolvePointCache(input: {
  lat: number;
  lon: number;
  radius?: number;
  sources?: PointCacheSource[];
}): Promise<{
  ok: boolean;
  elapsedMs?: number;
  results: PointCacheResult[];
  error?: string;
}> {
  try {
    const response = await fetch("/api/point-cache", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: input.lat,
        lon: input.lon,
        radius: input.radius ?? 1_000,
        sources: input.sources ?? ["overture", "urban-atlas"],
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      elapsedMs?: number;
      results?: PointCacheResult[];
      error?: string;
    };
    return {
      ok: Boolean(payload.ok),
      elapsedMs: payload.elapsedMs,
      results: payload.results ?? [],
      error: payload.error,
    };
  } catch (error) {
    return {
      ok: false,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
