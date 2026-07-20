import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cp } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

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

const SERVER_OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.jp/api/interpreter",
] as const;

const SERVER_OVERPASS_TIMEOUT_MS = 25_000;
const SERVER_NOMINATIM_TIMEOUT_MS = 5_000;
const SERVER_OPENROUTESERVICE_TIMEOUT_MS = 10_000;
const SERVER_NOMINATIM_USER_AGENT =
  "SD-Stadtdaten-ContextAnalysis/0.1 local-nominatim-proxy";
const SOURCE_PROBE_ALLOWED_HOSTS = new Set([
  "api.openrouteservice.org",
  "download.gtfs.de",
  "gdz.bkg.bund.de",
  "geodaten.bayern.de",
  "ghsl.jrc.ec.europa.eu",
  "gisco-services.ec.europa.eu",
  "huggingface.co",
  "human-settlement.emergency.copernicus.eu",
  "land.copernicus.eu",
  "mobilithek.info",
  "nominatim.openstreetmap.org",
  "opendata.dwd.de",
  "overpass-api.de",
  "portal.opentopography.org",
  "s3.waw3-1.cloudferro.com",
  "server.arcgisonline.com",
  "sgx.geodatenzentrum.de",
  "stac.overturemaps.org",
  "tile.openstreetmap.org",
  "tiles.openfreemap.org",
  "tiles.versatiles.org",
  "tubvsig-so2sat-vm1.srv.mwn.de",
  "www-genesis.destatis.de",
  "www.adv-online.de",
  "www.dwd.de",
  "www.openstreetmap.org",
  "www.wms.nrw.de",
]);

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  process.env = { ...env, ...process.env };
  const includeGeodata = env.UCA_INCLUDE_GEODATA !== "false";
  const outputDirectory = env.UCA_OUT_DIR?.trim() || "dist";
  return {
    plugins: [
      react(),
      localApiPlugin(),
      curatedPublicAssetsPlugin(includeGeodata, outputDirectory),
    ],
    publicDir: command === "build" ? false : "public",
    build: {
      outDir: outputDirectory,
      chunkSizeWarningLimit: 1500,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "maplibre",
                test: /node_modules[\\/]maplibre-gl[\\/]/,
              },
              {
                name: "react",
                test: /node_modules[\\/](?:react|react-dom)[\\/]/,
              },
            ],
          },
        },
      },
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

function curatedPublicAssetsPlugin(
  includeGeodata: boolean,
  outputDirectory: string,
): Plugin {
  return {
    name: "uca-curated-public-assets",
    apply: "build",
    async closeBundle() {
      const publicRoot = resolve(process.cwd(), "public");
      const outputRoot = resolve(process.cwd(), outputDirectory);
      await cp(publicRoot, outputRoot, {
        recursive: true,
        filter(source) {
          const normalized = relative(publicRoot, source).split(sep).join("/");
          return (
            (includeGeodata ||
              (normalized !== "data/processed" &&
                !normalized.startsWith("data/processed/"))) &&
            normalized !== "data/processed/cache" &&
            !normalized.startsWith("data/processed/cache/") &&
            normalized !== "data/processed/cache-manifest.json" &&
            !normalized.endsWith("/.DS_Store") &&
            normalized !== ".DS_Store"
          );
        },
      });
    },
  };
}

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
      server.middlewares.use("/api/openrouteservice-isochrones", (req, res) => {
        void handleOpenRouteServiceIsochrones(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/openrouteservice-status", (_req, res) => {
        writeJson(res as ProbeResponse, 200, {
          available: Boolean(process.env.OPENROUTESERVICE_API_KEY),
        });
      });
      server.middlewares.use("/api/nominatim-search", (req, res) => {
        void handleNominatimSearch(req as ProbeRequest, res as ProbeResponse);
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
      server.middlewares.use("/api/openrouteservice-isochrones", (req, res) => {
        void handleOpenRouteServiceIsochrones(req as ProbeRequest, res as ProbeResponse);
      });
      server.middlewares.use("/api/openrouteservice-status", (_req, res) => {
        writeJson(res as ProbeResponse, 200, {
          available: Boolean(process.env.OPENROUTESERVICE_API_KEY),
        });
      });
      server.middlewares.use("/api/nominatim-search", (req, res) => {
        void handleNominatimSearch(req as ProbeRequest, res as ProbeResponse);
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
    if (!SOURCE_PROBE_ALLOWED_HOSTS.has(parsedTarget.hostname)) {
      writeJson(res, 403, {
        ok: false,
        error: "Source probes are limited to hosts declared by the application source registry.",
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(parsedTarget, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "SD-Stadtdaten-ContextAnalysis/0.1 local-source-probe",
        Accept: "text/html,application/json,text/plain,*/*",
      },
    });
    clearTimeout(timeout);
    await response.body?.cancel();

    const safeRedirect =
      response.status >= 300 &&
      response.status < 400 &&
      Boolean(response.headers.get("location"));
    writeJson(res, 200, {
      ok: response.ok || safeRedirect,
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

async function handleOpenRouteServiceIsochrones(
  req: ProbeRequest,
  res: ProbeResponse,
): Promise<void> {
  try {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "POST required" });
      return;
    }
    const apiKey = process.env.OPENROUTESERVICE_API_KEY;
    if (!apiKey) {
      writeJson(res, 503, { error: "OpenRouteService API key is not configured on the server." });
      return;
    }
    const requestUrl = new URL(req.url ?? "", "http://127.0.0.1");
    const profile = requestUrl.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!["foot-walking", "cycling-regular", "driving-car"].includes(profile)) {
      writeJson(res, 400, { error: "Unsupported OpenRouteService profile." });
      return;
    }
    const body = await readBody(req);
    const payload = JSON.parse(body) as {
      locations?: unknown;
      range?: unknown;
      range_type?: unknown;
      location_type?: unknown;
    };
    if (
      !Array.isArray(payload.locations) ||
      payload.locations.length !== 1 ||
      !Array.isArray(payload.locations[0]) ||
      payload.locations[0].length !== 2 ||
      !payload.locations[0].every((value) => typeof value === "number" && Number.isFinite(value)) ||
      !Array.isArray(payload.range) ||
      payload.range.length > 3 ||
      !payload.range.every(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 3_600,
      )
    ) {
      writeJson(res, 400, { error: "Invalid isochrone request payload." });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_OPENROUTESERVICE_TIMEOUT_MS);
    const response = await fetch(
      `https://api.openrouteservice.org/v2/isochrones/${profile}`,
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    const responseBody = await response.text();
    res.statusCode = response.status;
    res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
    res.end(responseBody);
  } catch (error) {
    writeJson(res, 502, {
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
