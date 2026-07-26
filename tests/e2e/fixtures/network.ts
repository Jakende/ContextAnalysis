import type { Page, Route } from "playwright/test";

const EMPTY_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_SHARD_INDEX = {
  type: "FeatureShardIndex",
  sourceId: "playwright-deterministic-stub",
  sourceVersion: "e2e-fixture-v1",
  featureCount: 0,
  shardCount: 0,
  shards: [],
};

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X4JYVQAAAABJRU5ErkJggg==",
  "base64",
);

const VECTOR_LAYER_IDS = [
  "landuse",
  "park",
  "water",
  "building",
  "transportation",
  "boundary",
  "place",
];

export async function installDeterministicNetwork(
  page: Page,
  options: { failLiveApis?: boolean } = {},
): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/overpass") {
      if (options.failLiveApis) {
        await fulfillJson(route, {
          ok: false,
          endpoint: "playwright://overpass-unavailable",
          elapsedMs: 1,
          endpointStatus: [
            {
              endpoint: "playwright://overpass-unavailable",
              ok: false,
              elapsedMs: 1,
              error: "Deterministic browser test: Overpass unavailable.",
            },
          ],
          error: "Deterministic browser test: Overpass unavailable.",
        });
        return;
      }
      await fulfillJson(route, {
        ok: true,
        endpoint: "playwright://overpass-empty",
        elapsedMs: 1,
        endpointStatus: [
          {
            endpoint: "playwright://overpass-empty",
            ok: true,
            status: 200,
            elapsedMs: 1,
          },
        ],
        data: { elements: [] },
      });
      return;
    }

    if (path === "/api/openrouteservice-status") {
      await fulfillJson(route, { available: false });
      return;
    }

    if (path === "/api/ollama/tags") {
      await fulfillJson(route, { models: [] });
      return;
    }

    if (path === "/api/ollama/chat") {
      await fulfillJson(route, {
        error: "Deterministic browser test: Ollama unavailable.",
      });
      return;
    }

    if (path === "/api/source-probe") {
      await fulfillJson(route, {
        ok: false,
        status: 503,
        url: url.searchParams.get("url"),
        error: "Deterministic browser test: remote metadata probe disabled.",
      });
      return;
    }

    if (path === "/api/nominatim-search") {
      await fulfillJson(route, {
        ok: true,
        data: [
          {
            lat: "48.13710",
            lon: "11.57540",
            display_name: "Stub Street, Munich",
            address: { city: "Munich", city_district: "Altstadt-Lehel" },
          },
        ],
      });
      return;
    }

    if (path === "/api/point-cache") {
      await fulfillJson(route, {
        ok: false,
        error: "Runtime point-cache writes are disabled in browser tests.",
      });
      return;
    }

    if (path === "/data/processed/cache-manifest.json") {
      await fulfillJson(route, { type: "UcaCacheManifest", entries: [] });
      return;
    }

    if (path.startsWith("/data/") && path.endsWith("/index.json")) {
      await fulfillJson(route, EMPTY_SHARD_INDEX);
      return;
    }

    if (path.startsWith("/data/") && path.endsWith(".geojson")) {
      await fulfillJson(route, EMPTY_FEATURE_COLLECTION);
      return;
    }

    if (path.startsWith("/data/") && path.endsWith(".json")) {
      await fulfillJson(route, {});
      return;
    }

    if (
      path.startsWith("/data/") &&
      /\.(?:png|jpg|jpeg|webp)$/i.test(path)
    ) {
      await fulfillPng(route);
      return;
    }

    if (
      url.hostname === "nominatim.openstreetmap.org" &&
      path.endsWith("/reverse")
    ) {
      if (options.failLiveApis) {
        await route.fulfill({
          status: 200,
          contentType: "application/json; charset=utf-8",
          body: "{",
        });
        return;
      }
      await fulfillJson(route, {
        display_name: "Stub Street 1, Munich",
        name: "Stub Street",
        address: {
          road: "Stub Street",
          city: "Munich",
          city_district: "Altstadt-Lehel",
        },
      });
      return;
    }

    if (
      url.hostname === "www.wms.nrw.de" &&
      /getfeatureinfo/i.test(url.searchParams.get("request") ?? "")
    ) {
      if (options.failLiveApis) {
        await route.fulfill({
          status: 200,
          contentType: "text/plain; charset=utf-8",
          body: "not available",
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "@stub;100;value",
      });
      return;
    }

    if (
      url.hostname === "www.wms.nrw.de" &&
      /getcapabilities/i.test(url.searchParams.get("request") ?? "")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/xml; charset=utf-8",
        body:
          "<?xml version=\"1.0\"?><WMS_Capabilities><Capability><Layer><Name>bevoelkerung_1km</Name></Layer></Capability></WMS_Capabilities>",
      });
      return;
    }

    if (
      url.hostname === "www.wms.nrw.de" ||
      url.hostname === "tile.openstreetmap.org" ||
      url.hostname === "server.arcgisonline.com"
    ) {
      await fulfillPng(route);
      return;
    }

    if (url.hostname === "tiles.openfreemap.org" && path === "/planet") {
      const testOrigin = new URL(page.url() || "http://127.0.0.1:4177").origin;
      await fulfillJson(route, {
        tilejson: "3.0.0",
        name: "Playwright empty vector source",
        minzoom: 0,
        maxzoom: 14,
        bounds: [-180, -85, 180, 85],
        tiles: [`${testOrigin}/__e2e__/tiles/{z}/{x}/{y}.pbf`],
        vector_layers: VECTOR_LAYER_IDS.map((id) => ({
          id,
          fields: {},
          minzoom: 0,
          maxzoom: 14,
        })),
      });
      return;
    }

    if (path.startsWith("/__e2e__/tiles/") && path.endsWith(".pbf")) {
      await route.fulfill({
        status: 200,
        contentType: "application/vnd.mapbox-vector-tile",
        body: Buffer.alloc(0),
      });
      return;
    }

    if (
      url.hostname === "tiles.openfreemap.org" &&
      path.includes("/sprites/") &&
      path.endsWith(".json")
    ) {
      await fulfillJson(route, {});
      return;
    }

    if (
      url.hostname === "tiles.openfreemap.org" &&
      path.includes("/sprites/") &&
      path.endsWith(".png")
    ) {
      await fulfillPng(route);
      return;
    }

    if (
      url.hostname === "tiles.openfreemap.org" &&
      path.includes("/fonts/") &&
      path.endsWith(".pbf")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/x-protobuf",
        body: Buffer.alloc(0),
      });
      return;
    }

    if (url.origin === "http://127.0.0.1:4177") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 204,
      contentType: "text/plain",
      body: "",
    });
  });
}

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(value),
  });
}

async function fulfillPng(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "image/png",
    body: TRANSPARENT_PNG,
  });
}
