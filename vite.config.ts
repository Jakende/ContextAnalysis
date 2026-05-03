import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

type ProbeRequest = {
  url?: string;
  method?: string;
  on: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

type ProbeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

const SERVER_OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
] as const;

const SERVER_OVERPASS_TIMEOUT_MS = 5_500;
const SERVER_NOMINATIM_TIMEOUT_MS = 5_000;
const SERVER_NOMINATIM_USER_AGENT =
  "SD-Stadtdaten-ContextAnalysis/0.1 local-nominatim-proxy";

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
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
