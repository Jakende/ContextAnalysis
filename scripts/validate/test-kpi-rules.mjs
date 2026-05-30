import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
};
assert.equal(scoreComposite(sampleScores, balanced), 73);
assert.equal(classifyContext(97), "Metropolitan core context");
assert.equal(classifyContext(75), "Large city context");
assert.equal(classifyContext(58), "Regional city context");
assert.equal(classifyContext(35), "Small city / town context");

console.log("KPI rule validation passed");

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
