import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type ProbeRequest = {
  url?: string;
  method?: string;
  on: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

type ProbeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string | Uint8Array) => void;
};

type PointCachePayload = {
  lat?: unknown;
  lon?: unknown;
  radius?: unknown;
  sources?: unknown;
};

type FuaFeature = {
  type: "Feature";
  geometry?: {
    type: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
};

const SERVER_OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.jp/api/interpreter",
] as const;

const SERVER_OVERPASS_TIMEOUT_MS = 25_000;
const SERVER_NOMINATIM_TIMEOUT_MS = 5_000;
const SERVER_NOMINATIM_USER_AGENT =
  "SD-Stadtdaten-ContextAnalysis/0.1 local-nominatim-proxy";
const SERVER_GOOGLE_TILE_TIMEOUT_MS = 10_000;

let googleTileSession:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  process.env = { ...env, ...process.env };
  return {
    plugins: [react(), localApiPlugin()],
    build: {
      chunkSizeWarningLimit: 1500,
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
    },
  };
});

function localApiPlugin(): Plugin {
  return {
    name: "sd-local-api",
    configureServer(server) {
      server.middlewares.use("/api/source-probe", (req, res) => {
        void handleSourceProbe(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/overpass", (req, res) => {
        void handleOverpassProxy(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/nominatim-search", (req, res) => {
        void handleNominatimSearch(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/point-cache", (req, res) => {
        void handlePointCache(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/google-satellite", (req, res) => {
        void handleGoogleSatelliteTile(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/ollama/tags", (req, res) => {
        void handleOllamaTags(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/ollama/chat", (req, res) => {
        void handleOllamaChat(req as ProbeRequest, res as ProbeResponse);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/source-probe", (req, res) => {
        void handleSourceProbe(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/overpass", (req, res) => {
        void handleOverpassProxy(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/nominatim-search", (req, res) => {
        void handleNominatimSearch(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/point-cache", (req, res) => {
        void handlePointCache(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/google-satellite", (req, res) => {
        void handleGoogleSatelliteTile(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/ollama/tags", (req, res) => {
        void handleOllamaTags(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/ollama/chat", (req, res) => {
        void handleOllamaChat(req as ProbeRequest, res as ProbeResponse);
      });
    },
  };
}

async function handlePointCache(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  const started = Date.now();
  try {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "POST required", results: [] });
      return;
    }

    const payload = JSON.parse(await readBody(req)) as PointCachePayload;
    const lat = Number(payload.lat);
    const lon = Number(payload.lon);
    const radius = Number(payload.radius ?? 1_000);
    const requestedSources = Array.isArray(payload.sources)
      ? payload.sources.map((source) => String(source))
      : ["overture", "urban-atlas"];

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      writeJson(res, 400, { ok: false, error: "lat and lon are required", results: [] });
      return;
    }

    const results = requestedSources.map((source) =>
      runPointCacheSource({ source, lat, lon, radius }),
    );

    writeJson(res, 200, {
      ok: results.every((result) => result.status === "ok" || result.status === "skipped"),
      elapsedMs: Date.now() - started,
      results,
    });
  } catch (error) {
    writeJson(res, 200, {
      ok: false,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      results: [],
    });
  }
}

function runPointCacheSource(input: {
  source: string;
  lat: number;
  lon: number;
  radius: number;
}) {
  const args = [
    "scripts/preprocess/resolve-point-cache.mjs",
    "--lat",
    String(input.lat),
    "--lon",
    String(input.lon),
    "--radius",
    String(input.radius),
    "--sources",
    input.source,
  ];

  if (input.source === "urban-atlas") {
    const fuaName = findFuaNameForPoint(input.lon, input.lat);
    if (!fuaName) {
      return {
        source: input.source,
        status: "skipped",
        message: "No GISCO FUA covers this point; Urban Atlas is only available for FUA areas.",
      };
    }
    args.push("--urban-atlas-fua-name", fuaName, "--source-version", "2021");
  }

  const result = spawnSync("node", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "default",
      AWS_S3_ENDPOINT: process.env.AWS_S3_ENDPOINT ?? "eodata.dataspace.copernicus.eu",
      AWS_VIRTUAL_HOSTING: process.env.AWS_VIRTUAL_HOSTING ?? "FALSE",
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  const failedText = stderr || stdout || "Point cache failed.";
  const missingCdseCredentials =
    input.source === "urban-atlas" &&
    /CDSE S3 credentials|s3:\/\/EODATA|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/i.test(failedText);
  if (missingCdseCredentials) {
    return {
      source: input.source,
      status: "skipped",
      message: "CDSE credentials not available in local server environment.",
    };
  }
  return {
    source: input.source,
    status: result.status === 0 ? "ok" : "failed",
    message: result.status === 0 ? "Point cache updated." : compactProcessMessage(failedText),
    stdout: result.status === 0 ? stdout : undefined,
    stderr: result.status === 0 ? stderr : undefined,
  };
}

function compactProcessMessage(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("at ") && !line.startsWith("file://"))
    ?.slice(0, 180) ?? "Point cache failed.";
}

async function handleNominatimSearch(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  const started = Date.now();
  try {
    if (req.method && req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "GET required" });
      return;
    }

    const requestUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const query = requestUrl.searchParams.get("q")?.trim();
    if (!query) {
      writeJson(res, 400, { ok: false, error: "Missing q parameter", data: [] });
      return;
    }

    const params = new URLSearchParams({
      format: "jsonv2",
      q: query,
      limit: requestUrl.searchParams.get("limit") ?? "1",
      addressdetails: requestUrl.searchParams.get("addressdetails") ?? "1",
      "accept-language": requestUrl.searchParams.get("accept-language") ?? "de,en",
      email: "local-dev@stadtdaten.invalid",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_NOMINATIM_TIMEOUT_MS);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": SERVER_NOMINATIM_USER_AGENT,
          Referer: "http://127.0.0.1:5173/",
          Accept: "application/json",
        },
      },
    );
    clearTimeout(timeout);

    const data = await response.json();
    writeJson(res, 200, {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      elapsedMs: Date.now() - started,
      data: Array.isArray(data) ? data : [],
      error: response.ok ? undefined : `Nominatim returned HTTP ${response.status}`,
    });
  } catch (error) {
    writeJson(res, 200, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
      data: [],
    });
  }
}

async function handleSourceProbe(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  const started = Date.now();
  try {
    const requestUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const target = requestUrl.searchParams.get("url");
    if (!target) {
      writeJson(res, 400, { ok: false, error: "Missing url parameter" });
      return;
    }

    const parsedTarget = new URL(target);
    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      writeJson(res, 400, { ok: false, error: "Only http and https URLs are supported" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(parsedTarget, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "SD-Stadtdaten-ContextAnalysis/0.1 local-source-probe",
        Accept: "text/html,application/json,text/plain,*/*",
      },
    });
    clearTimeout(timeout);
    await response.body?.cancel();

    writeJson(res, 200, {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      contentType: response.headers.get("content-type"),
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    writeJson(res, 200, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    });
  }
}

async function handleOverpassProxy(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  const started = Date.now();
  const endpointStatus: Array<{
    endpoint: string;
    ok: boolean;
    status?: number;
    statusText?: string;
    elapsedMs: number;
    error?: string;
  }> = [];

  try {
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, error: "POST required" });
      return;
    }

    const body = await readBody(req);
    const payload = JSON.parse(body) as { query?: unknown };
    if (typeof payload.query !== "string" || payload.query.trim().length === 0) {
      writeJson(res, 400, { ok: false, error: "Missing Overpass query" });
      return;
    }
    if (payload.query.length > 50_000) {
      writeJson(res, 413, { ok: false, error: "Overpass query too large" });
      return;
    }

    for (const endpoint of SERVER_OVERPASS_ENDPOINTS) {
      const endpointStarted = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SERVER_OVERPASS_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": "SD-Stadtdaten-ContextAnalysis/0.1 local-overpass-proxy",
            Accept: "application/json,*/*",
          },
          body: new URLSearchParams({ data: payload.query }),
        });
        clearTimeout(timeout);

        const elapsedMs = Date.now() - endpointStarted;
        endpointStatus.push({
          endpoint,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          elapsedMs,
        });

        if (!response.ok) {
          await response.body?.cancel();
          continue;
        }

        const data = await response.json();
        writeJson(res, 200, {
          ok: true,
          endpoint,
          status: response.status,
          elapsedMs: Date.now() - started,
          endpointStatus,
          data,
        });
        return;
      } catch (error) {
        clearTimeout(timeout);
        endpointStatus.push({
          endpoint,
          ok: false,
          elapsedMs: Date.now() - endpointStarted,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    writeJson(res, 200, {
      ok: false,
      error: "All configured Overpass endpoints failed or timed out",
      elapsedMs: Date.now() - started,
      endpointStatus,
    });
  } catch (error) {
    writeJson(res, 200, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
      endpointStatus,
    });
  }
}

async function handleGoogleSatelliteTile(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  try {
    if (req.method && req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "GET required" });
      return;
    }

    const key = process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      writeJson(res, 404, {
        ok: false,
        error: "Missing GOOGLE_MAPS_API_KEY in .env.local.",
      });
      return;
    }

    const requestUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const [z, x, y] = requestUrl.pathname.split("/").filter(Boolean);
    if (!z || !x || !y || ![z, x, y].every((value) => /^\d+$/.test(value))) {
      writeJson(res, 400, { ok: false, error: "Expected /api/google-satellite/{z}/{x}/{y}" });
      return;
    }

    const session = await getGoogleTileSession(key);
    const tileParams = new URLSearchParams({
      session,
      key,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_GOOGLE_TILE_TIMEOUT_MS);
    const response = await fetch(
      `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?${tileParams.toString()}`,
      {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "image/*,*/*",
        },
      },
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      writeJson(res, response.status, {
        ok: false,
        error: message || `Google Map Tiles returned HTTP ${response.status}`,
      });
      return;
    }

    const contentType = response.headers.get("content-type") ?? "image/png";
    const bytes = new Uint8Array(await response.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "public, max-age=3600");
    res.end(bytes);
  } catch (error) {
    writeJson(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleOllamaTags(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  try {
    if (req.method && req.method !== "GET") {
      writeJson(res, 405, { ok: false, error: "GET required" });
      return;
    }

    const response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => null);
    writeJson(res, response.ok ? 200 : response.status, payload ?? {
      models: [],
      error: `Ollama tags endpoint returned HTTP ${response.status}`,
    });
  } catch (error) {
    writeJson(res, 502, {
      models: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleOllamaChat(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "POST required" });
      return;
    }

    const body = await readBody(req);
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
    res.end(text);
  } catch (error) {
    writeJson(res, 502, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ollamaBaseUrl(): string {
  return (
    process.env.VITE_OLLAMA_BASE_URL ??
    process.env.OLLAMA_BASE_URL ??
    "http://localhost:11434"
  ).replace(/\/+$/, "");
}

async function getGoogleTileSession(key: string): Promise<string> {
  const now = Date.now();
  if (googleTileSession && googleTileSession.expiresAt > now + 60_000) {
    return googleTileSession.token;
  }

  const params = new URLSearchParams({ key });
  const response = await fetch(
    `https://tile.googleapis.com/v1/createSession?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mapType: "satellite",
        language: "de-DE",
        region: "DE",
      }),
    },
  );
  const payload = (await response.json()) as {
    session?: string;
    expiry?: string;
    error?: { message?: string };
  };
  if (!response.ok || !payload.session) {
    throw new Error(
      payload.error?.message ?? `Google Map Tiles createSession failed with HTTP ${response.status}`,
    );
  }

  googleTileSession = {
    token: payload.session,
    expiresAt: payload.expiry ? Date.parse(payload.expiry) : now + 55 * 60 * 1000,
  };
  return googleTileSession.token;
}

function findFuaNameForPoint(lon: number, lat: number): string | null {
  const path = "public/data/processed/eurostat-gisco-fua.geojson";
  if (!existsSync(path)) return null;
  try {
    const collection = JSON.parse(readFileSync(path, "utf8")) as { features?: FuaFeature[] };
    const feature = collection.features?.find((candidate) =>
      geometryContainsPoint(candidate.geometry, [lon, lat]),
    );
    const name =
      feature?.properties?.fua_name ??
      feature?.properties?.FUA_NAME ??
      feature?.properties?.URAU_NAME ??
      feature?.properties?.name ??
      feature?.properties?.label;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

function geometryContainsPoint(
  geometry: FuaFeature["geometry"] | undefined,
  point: [number, number],
): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return polygonContainsPoint(geometry.coordinates, point);
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, point));
  }
  return false;
}

function polygonContainsPoint(coordinates: unknown, point: [number, number]): boolean {
  if (!Array.isArray(coordinates)) return false;
  const rings = coordinates as number[][][];
  if (!ringContainsPoint(rings[0] ?? [], point)) return false;
  return !rings.slice(1).some((ring) => ringContainsPoint(ring, point));
}

function ringContainsPoint(ring: number[][], point: [number, number]): boolean {
  let inside = false;
  const [x, y] = point;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = ring[index]?.[0];
    const yi = ring[index]?.[1];
    const xj = ring[previous]?.[0];
    const yj = ring[previous]?.[1];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function readBody(req: ProbeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk) => {
      if (typeof chunk === "string") {
        chunks.push(new TextEncoder().encode(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      resolve(new TextDecoder().decode(concatChunks(chunks)));
    });
    req.on("error", (error) => {
      reject(error);
    });
  });
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function writeJson(
  res: ProbeResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
