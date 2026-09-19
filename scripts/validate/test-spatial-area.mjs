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
  const spatialArea = await server.ssrLoadModule("/src/lib/analysis/spatialArea.ts");
  const { analyzeL } = await server.ssrLoadModule("/src/lib/analysis/l/analyzeL.ts");

  validateConcaveClip(spatialArea);
  validateMultipartClip(spatialArea);
  validateOverlappingMultipartDissolve(spatialArea);
  validateOverlapDissolve(spatialArea);
  validatePartitionedDissolve(spatialArea);
  validateExclusivePrecedence(spatialArea);
  validateAnalysisContract(analyzeL);

  console.log("Exact spatial-area validation passed");
} finally {
  await server.close();
}

function validateConcaveClip({ clipAndDissolveGeometries, geometryAreaSqm }) {
  const context = polygon([
    [11, 48],
    [11.004, 48],
    [11.004, 48.001],
    [11.001, 48.001],
    [11.001, 48.004],
    [11, 48.004],
    [11, 48],
  ]);
  const coveringSource = polygon(squareRing(10.999, 47.999, 0.007));
  const clipped = clipAndDissolveGeometries([coveringSource], context);
  assert.ok(clipped, "concave context must produce an intersection");
  assertRelativeArea(geometryAreaSqm(clipped), geometryAreaSqm(context), 1e-8);
}

function validateMultipartClip({ clipAndDissolveGeometries, geometryAreaSqm }) {
  const context = {
    type: "MultiPolygon",
    coordinates: [
      [squareRing(11, 48, 0.001)],
      [squareRing(11.003, 48.002, 0.0015)],
    ],
  };
  const coveringSource = polygon(squareRing(10.999, 47.999, 0.008));
  const clipped = clipAndDissolveGeometries([coveringSource], context);
  assert.ok(clipped, "multipart context must preserve both intersected components");
  assert.equal(clipped.coordinates.length, 2);
  assertRelativeArea(geometryAreaSqm(clipped), geometryAreaSqm(context), 1e-8);
}

function validateOverlapDissolve({ clipAndDissolveGeometries, geometryAreaSqm }) {
  const context = polygon(squareRing(11, 48, 0.004));
  const left = polygon(rectangleRing(11, 48, 11.003, 48.004));
  const right = polygon(rectangleRing(11.001, 48, 11.004, 48.004));
  const dissolved = clipAndDissolveGeometries([left, right], context);
  assert.ok(dissolved, "overlapping inputs must produce a dissolved geometry");
  assertRelativeArea(geometryAreaSqm(dissolved), geometryAreaSqm(context), 1e-8);
}

function validatePartitionedDissolve({ clipAndDissolveGeometries, geometryAreaSqm }) {
  const context = polygon(squareRing(11, 48, 0.01));
  const overlappingStripes = Array.from({ length: 100 }, (_, index) => {
    const west = 10.999 + index * 0.0001;
    return polygon(rectangleRing(west, 47.999, west + 0.002, 48.011));
  });
  const dissolved = clipAndDissolveGeometries(overlappingStripes, context);
  assert.ok(dissolved, "large overlays must dissolve through bounded spatial partitions");
  assertRelativeArea(geometryAreaSqm(dissolved), geometryAreaSqm(context), 1e-8);
}

function validateOverlappingMultipartDissolve({ dissolveGeometries, geometryAreaSqm }) {
  const overlappingMultipart = {
    type: "MultiPolygon",
    coordinates: [
      [rectangleRing(11, 48, 11.003, 48.004)],
      [rectangleRing(11.001, 48, 11.004, 48.004)],
    ],
  };
  const dissolved = dissolveGeometries([overlappingMultipart]);
  assert.ok(dissolved, "overlapping multipart components must dissolve automatically");
  const expected = polygon(rectangleRing(11, 48, 11.004, 48.004));
  assertRelativeArea(geometryAreaSqm(dissolved), geometryAreaSqm(expected), 1e-8);
}

function validateExclusivePrecedence({
  resolveExclusiveCategoryGeometries,
  geometryAreaSqm,
}) {
  const context = polygon(squareRing(11, 48, 0.004));
  const baselineCoverage = polygon(rectangleRing(11, 48, 11.0025, 48.004));
  const detail = feature(context, { category: "green" });
  const resolved = resolveExclusiveCategoryGeometries({
    features: [detail],
    context,
    categoryForFeature: (item) => item.properties?.category ?? null,
    categoryPriority: ["green"],
    exclusionGeometry: baselineCoverage,
  });
  assert.equal(resolved.length, 1);
  const expected = polygon(rectangleRing(11.0025, 48, 11.004, 48.004));
  assertRelativeArea(resolved[0].areaSqm, geometryAreaSqm(expected), 1e-8);
}

function validateAnalysisContract(analyzeL) {
  const context = polygon(squareRing(11, 48, 0.01));
  const urbanAtlasBuilt = feature(
    polygon(rectangleRing(11, 48, 11.006, 48.01)),
    {
      sourceId: "copernicus-urban-atlas",
      sourceFamily: "urban-atlas-2021-catalog",
      urbanAtlasClass: "11210 Continuous urban fabric",
    },
  );
  const osmGreen = feature(context, {
    sourceId: "osm-core",
    landuse: "grass",
  });
  const merged = collection([urbanAtlasBuilt, osmGreen]);
  const result = analyzeL(
    { lat: 48.005, lon: 11.005, point: { type: "Point", coordinates: [11.005, 48.005] } },
    "2026-07-20T00:00:00.000Z",
    500,
    {
      urbanAtlas: collection([urbanAtlasBuilt]),
      greenBlue: merged,
      landUse: merged,
    },
    context,
  );
  const green = result.indicators.find((indicator) => indicator.id === "l.green-percentage");
  const shares = result.indicators.find((indicator) => indicator.id === "l.land-use-family-share");
  assert.equal(green?.value, 40, "OSM green must fill only the 40% not covered by Urban Atlas");
  assert.match(String(green?.method), /exactly clipped and dissolved/i);
  assert.match(String(shares?.value), /built\/residential: 60/);
  assert.match(String(shares?.value), /green\/blue: 40/);
  assert.ok(
    shares?.caveats.some((caveat) => /deterministic family precedence/i.test(caveat)),
    "land-use share provenance must state the exclusivity rule",
  );
}

function assertRelativeArea(actual, expected, tolerance) {
  const relativeError = Math.abs(actual - expected) / Math.max(1, expected);
  assert.ok(
    relativeError <= tolerance,
    `area mismatch: ${actual} vs ${expected} (${relativeError})`,
  );
}

function feature(geometry, properties) {
  return { type: "Feature", geometry, properties };
}

function collection(features) {
  return { type: "FeatureCollection", features };
}

function polygon(ring) {
  return { type: "Polygon", coordinates: [ring] };
}

function squareRing(west, south, size) {
  return rectangleRing(west, south, west + size, south + size);
}

function rectangleRing(west, south, east, north) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}
