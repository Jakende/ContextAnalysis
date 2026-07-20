import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const scenario = await server.ssrLoadModule("/src/lib/scenario/scenario.ts");
  validateGeometryFactories(scenario);
  validateSeparateComparisonContract(scenario);
  validateScenarioExport(scenario);
  validateInvalidGeometry(scenario);
  console.log("Scenario-layer contract validation passed");
} finally {
  await server.close();
}

function validateGeometryFactories({ createScenarioFeature }) {
  const options = { createdAt: "2026-07-20T00:00:00.000Z" };
  const point = createScenarioFeature("transit_stop", [[11, 48]], {
    ...options,
    id: "scenario-point",
  });
  const line = createScenarioFeature("new_street", [[11, 48], [11.001, 48.001]], {
    ...options,
    id: "scenario-line",
  });
  const polygon = createScenarioFeature(
    "public_space",
    [[11, 48], [11.001, 48], [11.001, 48.001]],
    { ...options, id: "scenario-polygon" },
  );
  assert.equal(point.geometry.type, "Point");
  assert.equal(line.geometry.type, "LineString");
  assert.equal(polygon.geometry.type, "Polygon");
  assert.deepEqual(polygon.geometry.coordinates[0][0], polygon.geometry.coordinates[0].at(-1));
  for (const feature of [point, line, polygon]) {
    assert.equal(feature.properties.status, "proposed");
    assert.equal(feature.properties.authorship, "user");
    assert.equal(feature.properties.kpiImpactStatus, "not-modeled");
  }
}

function validateSeparateComparisonContract({
  createEmptyScenarioLayer,
  createScenarioFeature,
  addScenarioFeature,
}) {
  const empty = createEmptyScenarioLayer({
    id: "scenario-test",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const feature = createScenarioFeature("bike_share_station", [[11, 48]], {
    id: "bike-share-test",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const next = addScenarioFeature(empty, feature, "2026-07-20T00:01:00.000Z");
  assert.equal(next.features.features.length, 1);
  assert.equal(next.comparison.basis, "zero-intervention-baseline");
  assert.equal(next.comparison.kpiImpact, null);
  assert.deepEqual(next.comparison.metrics[0], {
    id: "scenario.bike_share_station.count",
    label: "Proposed bike-share station count",
    unit: "features",
    current: 0,
    proposed: 1,
    delta: 1,
    method: "Counts user-created proposal features against a zero-intervention baseline.",
  });
  assert.match(next.provenance.separationPolicy, /never merged into authoritative/i);
}

function validateScenarioExport({
  createEmptyScenarioLayer,
  createScenarioFeature,
  addScenarioFeature,
  createScenarioExportSummary,
  scenarioToGeoJson,
}) {
  const layer = addScenarioFeature(
    createEmptyScenarioLayer({ id: "scenario-export", createdAt: "2026-07-20T00:00:00.000Z" }),
    createScenarioFeature("green_edge", [[11, 48], [11.002, 48.001]], {
      id: "green-edge-export",
      createdAt: "2026-07-20T00:00:00.000Z",
    }),
    "2026-07-20T00:01:00.000Z",
  );
  const exported = JSON.parse(scenarioToGeoJson(layer));
  assert.equal(exported.type, "FeatureCollection");
  assert.equal(exported.scenario.provenance.authorship, "user");
  assert.equal(exported.scenario.comparison.kpiImpact, null);
  assert.equal(exported.features[0].properties.status, "proposed");
  assert.deepEqual(createScenarioExportSummary(layer), {
    schemaVersion: "0.1.0",
    id: "scenario-export",
    name: "Design proposal",
    featureCount: 1,
    authorship: "user",
    creationMethod: "map-drawing",
    kpiImpactStatus: "not-modeled",
    caveats: layer.provenance.caveats,
  });
}

function validateInvalidGeometry({ createScenarioFeature }) {
  assert.throws(
    () => createScenarioFeature("new_street", [[11, 48]]),
    /at least two/i,
  );
  assert.throws(
    () => createScenarioFeature("public_space", [[11, 48], [11.001, 48]]),
    /at least three/i,
  );
  assert.throws(
    () => createScenarioFeature("transit_stop", [[181, 48]]),
    /WGS84/i,
  );
}
