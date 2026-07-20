import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../../src/lib/analysis/kpi/kpiSchema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const coreDefinitions = schema.definitions.filter((definition) => definition.status === "core");
const contextDefinitions = schema.definitions.filter((definition) => definition.status === "context");
const coreIds = coreDefinitions.map((definition) => definition.id);

assert.deepEqual(contextDefinitions.map((definition) => definition.id), ["xl_context"]);
assert.deepEqual(coreIds, [
  "mobility_access",
  "green_blue_access",
  "urban_mix",
  "social_infrastructure",
  "tree_canopy",
  "station_axis",
]);
assert.equal(coreIds.includes("transit"), false, "transit must not be a standalone core KPI");

for (const strategy of schema.strategies) {
  const activeWeights = Object.entries(strategy.weights).filter(([id]) => coreIds.includes(id));
  const total = activeWeights.reduce((sum, [, value]) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.000001, `${strategy.id} core weights must sum to 1`);
}

const byId = Object.fromEntries(coreDefinitions.map((definition) => [definition.id, definition]));
assert.equal(normalize(byId.green_blue_access, 17.5), 50);
assert.equal(normalize(byId.green_blue_access, 35), 100);
assert.equal(normalize(byId.green_blue_access, 70), 100);
assert.equal(normalize(byId.urban_mix, 0.62), 62);
assert.equal(normalize(byId.mobility_access, 80), 80);
assert.equal(normalize(byId.social_infrastructure, null), null);
assert.equal(normalize(byId.tree_canopy, 67), 67);
assert.equal(normalize(byId.station_axis, 91), 91);

const balanced = schema.strategies.find((strategy) => strategy.id === schema.defaultStrategyId);
assert.equal(classify(85, balanced), "Strong Urban Quality");
assert.equal(classify(65, balanced), "Solid Urban Context");
assert.equal(classify(45, balanced), "Uneven Urban Context");
assert.equal(classify(20, balanced), "Weak / Limited Evidence");
assert.equal(classify(null, balanced), "Weak / Limited Evidence");

const sampleScores = {
  mobility_access: 80,
  green_blue_access: 50,
  urban_mix: 75,
  social_infrastructure: 100,
  tree_canopy: 60,
  station_axis: 85,
};
assert.equal(scoreComposite(sampleScores, balanced), 74);
assert.equal(classifyContext(97), "Metropolitan core context");
assert.equal(classifyContext(75), "Large city context");
assert.equal(classifyContext(58), "Regional city context");
assert.equal(classifyContext(35), "Small city / town context");

await validateProductionSpatialContract();

console.log("KPI rule validation passed");

async function validateProductionSpatialContract() {
  const projectRoot = resolve(__dirname, "../..");
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { analyzeL } = await server.ssrLoadModule("/src/lib/analysis/l/analyzeL.ts");
    const { analyzeMobilityScales } = await server.ssrLoadModule(
      "/src/lib/analysis/mobility/mobilityScales.ts",
    );
    const { createKpiScenario, kpiStrategies } = await server.ssrLoadModule(
      "/src/lib/analysis/kpi/kpiMatrix.ts",
    );
    const selectedPoint = { lat: 48, lon: 11 };
    const computedAt = "2026-07-20T00:00:00.000Z";
    const inside = [11.001, 48];
    const outside = [11.01, 48];
    const result = analyzeL(selectedPoint, computedAt, 500, {
      transportStops: collection([
        point(inside, { name: "Inside stop", transportMode: "tram" }),
        point(outside, { name: "Outside stop", transportMode: "bus" }),
      ]),
      pois: collection([
        point(inside, { name: "Inside clinic", poiCategory: "health" }),
        point(outside, { name: "Outside school", poiCategory: "education" }),
      ]),
      mobilityInfrastructure: collection([
        point(inside, { mobilityMode: "bike" }),
        point(outside, { mobilityMode: "support" }),
      ]),
      developmentHints: collection([
        point(inside, { landuse: "brownfield" }),
        point(outside, { landuse: "construction" }),
      ]),
    });
    const indicators = Object.fromEntries(
      result.indicators.map((indicator) => [indicator.id, indicator]),
    );
    assert.equal(indicators["l.transit-stops"].value, 1, "L stop count must respect 500 m context");
    assert.equal(indicators["l.transit-stop-density"].value, 1.3, "L stop density must use the same 500 m context");
    assert.equal(indicators["l.social-civic-pois"].value, 1, "L POI count must respect 500 m context");
    assert.equal(indicators["l.mobility-infrastructure"].value, 1, "L mobility evidence must respect 500 m context");
    assert.match(
      String(indicators["l.development-potential"].value),
      /^1 live OSM potential hint/,
      "L development evidence must respect 500 m context",
    );
    const mobilityStrategy = kpiStrategies.find((strategy) => strategy.id === "mobility");
    const scenario = createKpiScenario(
      result.indicators,
      mobilityStrategy,
      mobilityStrategy.weights,
      computedAt,
    );
    assert.equal(scenario.schemaVersion, "0.4.0");
    assert.equal(scenario.strategyId, "mobility");
    assert.deepEqual(scenario.weights, mobilityStrategy.weights);
    assert.equal(scenario.computedAt, computedAt);
    assert.ok(Array.isArray(scenario.availableKpiIds));

    const projectBoundary = {
      type: "Polygon",
      coordinates: [[
        [10.999, 47.999],
        [11.009, 47.999],
        [11.009, 48.001],
        [10.999, 48.001],
        [10.999, 47.999],
      ]],
    };
    const projectResult = analyzeL(
      selectedPoint,
      computedAt,
      500,
      {
        transportStops: collection([
          point([11.008, 48], { name: "Inside project, outside radius" }),
          point([11.012, 48], { name: "Outside project" }),
        ]),
      },
      projectBoundary,
    );
    const projectIndicators = Object.fromEntries(
      projectResult.indicators.map((indicator) => [indicator.id, indicator]),
    );
    assert.equal(projectIndicators["l.transit-stops"].value, 1, "project geometry must override radius inclusion");
    assert.equal(projectIndicators["l.radius"].label, "Project analysis area");
    assert.deepEqual(projectResult.overlays.lBuffer.features[0].geometry, projectBoundary);

    const poiCollection = collection([
      point([11, 48], { name: "Central POI", poiCategory: "health" }),
    ]);
    const fallbackWalking = polygonAround(selectedPoint, {
      isochroneMode: "walking",
      rangeSeconds: 600,
      retrievalStatus: "fallback",
    });
    const fallbackResult = analyzeMobilityScales({
      selectedPoint,
      computedAt,
      evidenceRadiusMeters: 500,
      pois: poiCollection,
      isochrones: collection([fallbackWalking]),
    });
    const fallbackWalkingSummary = fallbackResult.summaries.find(
      (summary) => summary.config.mode === "walking",
    );
    assert.equal(
      fallbackWalkingSummary.isochronePoiCount,
      null,
      "geometric fallback must not count as routed POI reachability",
    );

    const activeIsochrones = collection([
      polygonAround(selectedPoint, {
        isochroneMode: "walking",
        rangeSeconds: 600,
        retrievalStatus: "live",
      }),
      polygonAround(selectedPoint, {
        isochroneMode: "cycling",
        rangeSeconds: 600,
        retrievalStatus: "cached",
      }),
    ]);
    const withoutDriving = analyzeMobilityScales({
      selectedPoint,
      computedAt,
      evidenceRadiusMeters: 500,
      pois: poiCollection,
      isochrones: activeIsochrones,
    });
    const withDriving = analyzeMobilityScales({
      selectedPoint,
      computedAt,
      evidenceRadiusMeters: 500,
      pois: poiCollection,
      isochrones: collection([
        ...activeIsochrones.features,
        polygonAround(selectedPoint, {
          isochroneMode: "driving",
          rangeSeconds: 900,
          retrievalStatus: "live",
        }),
      ]),
    });
    assert.equal(
      withDriving.combinedScore,
      withoutDriving.combinedScore,
      "driving context must not change multimodal urban-quality score",
    );
    const drivingSummary = withDriving.summaries.find(
      (summary) => summary.config.mode === "driving",
    );
    assert.equal(drivingSummary.config.aggregateWeight, 0);
    assert.notEqual(drivingSummary.score, null, "driving context indicator should remain visible");
  } finally {
    await server.close();
  }
}

function collection(features) {
  return { type: "FeatureCollection", features };
}

function point(coordinates, properties = {}) {
  return { type: "Feature", geometry: { type: "Point", coordinates }, properties };
}

function polygonAround(selectedPoint, properties) {
  const delta = 0.02;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [selectedPoint.lon - delta, selectedPoint.lat - delta],
        [selectedPoint.lon + delta, selectedPoint.lat - delta],
        [selectedPoint.lon + delta, selectedPoint.lat + delta],
        [selectedPoint.lon - delta, selectedPoint.lat + delta],
        [selectedPoint.lon - delta, selectedPoint.lat - delta],
      ]],
    },
    properties,
  };
}

function normalize(definition, value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (definition.normalization.type === "target") {
    return clamp(Math.round((numeric / definition.normalization.target) * 100));
  }
  if (definition.normalization.type === "index") {
    return clamp(Math.round(numeric * 100));
  }
  return clamp(Math.round(numeric));
}

function classify(score, strategy) {
  if (score === null) return strategy.classifications.minimal;
  if (score >= 80) return strategy.classifications.high;
  if (score >= 60) return strategy.classifications.medium;
  if (score >= 40) return strategy.classifications.low;
  return strategy.classifications.minimal;
}

function scoreComposite(scores, strategy) {
  const available = Object.entries(scores).filter(
    ([id, score]) => score !== null && strategy.weights[id] > 0,
  );
  const weightTotal = available.reduce((sum, [id]) => sum + strategy.weights[id], 0);
  return Math.round(
    available.reduce((sum, [id, score]) => sum + score * strategy.weights[id], 0) /
      weightTotal,
  );
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function classifyContext(score) {
  if (score >= 85) return "Metropolitan core context";
  if (score >= 70) return "Large city context";
  if (score >= 50) return "Regional city context";
  if (score >= 30) return "Small city / town context";
  return "Limited regional evidence";
}
