#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  SEMANTIC_REPORT_SCHEMA,
  coveragePercent,
  evaluateFreshness,
  profileFeatures,
  validateGeometry,
} from "../release/build-semantic-city-coverage.mjs";

const square = (west, south, east, north) => ({
  type: "Polygon",
  coordinates: [[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]],
});

assert.equal(SEMANTIC_REPORT_SCHEMA, "uca-semantic-city-coverage/1.0");
assert.equal(validateGeometry(square(11, 48, 12, 49)), true);
assert.equal(
  validateGeometry({
    type: "Polygon",
    coordinates: [[[11, 48], [12, 48], [12, 49], [11, 49]]],
  }),
  false,
  "Open polygon rings must fail structural validity.",
);
assert.equal(
  validateGeometry({ type: "LineString", coordinates: [[11, 48], [11, 48]] }),
  false,
  "Degenerate lines must fail structural validity.",
);
assert.equal(
  coveragePercent([square(0, 0, 1, 2)], square(0, 0, 2, 2)),
  50,
  "Coverage must use dissolved intersection area, not source feature count.",
);
assert.equal(
  coveragePercent(
    [square(0, 0, 1.25, 2), square(0.75, 0, 2, 2)],
    square(0, 0, 2, 2),
  ),
  100,
  "Overlapping delivery cells must be dissolved before calculating coverage.",
);

const definition = {
  geometryTypes: ["Point"],
  requiredProperties: ["sourceId", "sourceVersion", "label"],
  classProperty: "class",
};
const profile = profileFeatures(
  [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [11.5, 48.1] },
      properties: {
        sourceId: "fixture",
        sourceVersion: "2026-01-01",
        label: "A",
        class: "tram",
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [11.6, 48.2] },
      properties: {
        sourceId: "fixture",
        sourceVersion: "2025-01-01",
        label: "",
        class: "bus",
      },
    },
  ],
  definition,
  "2026-01-01",
);
assert.deepEqual(profile, {
  featureCount: 2,
  validGeometryCount: 2,
  geometryValidityPercent: 100,
  requiredAttributeCompletenessPercent: 83.3333,
  sourceVersionConsistencyPercent: 50,
  distinctClasses: ["bus", "tram"],
});

const compositeVersionProfile = profileFeatures(
  [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [8.68, 50.11] },
      properties: {
        sourceId: "fixture",
        sourceVersion: "2026-05-29",
        label: "B",
        class: "building",
      },
    },
  ],
  definition,
  "2026-05-17-munich+2026-05-29",
);
assert.equal(
  compositeVersionProfile.sourceVersionConsistencyPercent,
  100,
  "A combined canonical release version may enumerate preserved per-feature source versions.",
);

assert.deepEqual(
  evaluateFreshness(
    "GISCO Urban Audit 2024",
    { mode: "minimum-reference-year", minimumYear: 2024 },
    "2026-07-26",
  ),
  {
    pass: true,
    observed: 2024,
    expected: ">= 2024",
    method: "Reference year parsed from sourceVersion.",
  },
);
assert.equal(
  evaluateFreshness(
    "2026-05-12",
    { mode: "max-age-days", maximumAgeDays: 365 },
    "2026-07-26",
  ).pass,
  true,
);
assert.equal(
  evaluateFreshness(
    "2024-05-12",
    { mode: "max-age-days", maximumAgeDays: 365 },
    "2026-07-26",
  ).pass,
  false,
);

console.log(
  JSON.stringify(
    {
      valid: true,
      schema: SEMANTIC_REPORT_SCHEMA,
      checks: 12,
    },
    null,
    2,
  ),
);
