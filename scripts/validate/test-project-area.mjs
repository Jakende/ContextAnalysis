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
  const projectArea = await server.ssrLoadModule("/src/lib/projectArea/geometry.ts");
  const { overpassModules } = await server.ssrLoadModule("/src/lib/overpass/modules.ts");

  validateGeoJsonParsing(projectArea);
  validateUploadedOverlapDissolve(projectArea);
  validateDrawingFactories(projectArea);
  validateCanonicalIds(projectArea);
  validateRejections(projectArea);
  validateAnalysisRadius(projectArea);
  validateOverpassBboxQueries(overpassModules);

  console.log("Project-area contract validation passed");
} finally {
  await server.close();
}

function validateUploadedOverlapDissolve({ parseProjectAreaGeoJson }) {
  const dissolved = parseProjectAreaGeoJson({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [rectangleRing(11, 48, 11.002, 48.002)] },
      },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [rectangleRing(11.001, 48, 11.003, 48.002)] },
      },
    ],
  });
  const expected = parseProjectAreaGeoJson({
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [rectangleRing(11, 48, 11.003, 48.002)] },
  });
  const relativeAreaError = Math.abs(dissolved.areaSqm - expected.areaSqm) / expected.areaSqm;
  assert.ok(relativeAreaError < 1e-8, `overlapping upload area was not dissolved: ${relativeAreaError}`);
  assert.match(dissolved.caveats.join(" "), /overlapping components are dissolved/i);
}

function validateGeoJsonParsing({ parseProjectAreaGeoJson }) {
  const polygon = parseProjectAreaGeoJson(
    {
      type: "Feature",
      properties: { name: "Uploaded boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [squareRing(11, 48, 0.001)],
      },
    },
    { fileName: "boundary.geojson", createdAt: "2026-07-20T00:00:00.000Z" },
  );
  assert.equal(polygon.geometry.type, "Polygon");
  assert.equal(polygon.source, "upload");
  assert.equal(polygon.label, "Uploaded boundary");
  assert.equal(polygon.fileName, "boundary.geojson");
  assert.ok(polygon.areaSqm > 1);

  const multiPolygon = parseProjectAreaGeoJson({
    type: "Feature",
    properties: { label: "Multipart boundary" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [squareRing(11, 48, 0.0005)],
        [squareRing(11.003, 48.003, 0.0005)],
      ],
    },
  });
  assert.equal(multiPolygon.geometry.type, "MultiPolygon");
  assert.equal(multiPolygon.geometry.coordinates.length, 2);
  assert.equal(multiPolygon.label, "Multipart boundary");
  assert.deepEqual(multiPolygon.bbox, [11, 48, 11.0035, 48.0035]);
}

function validateDrawingFactories({ createPolygonProjectArea, createRectangleProjectArea }) {
  const polygon = createPolygonProjectArea(
    [
      [11, 48],
      [11.001, 48],
      [11.0005, 48.001],
    ],
    { label: "Sketch", createdAt: "2026-07-20T00:00:00.000Z" },
  );
  assert.equal(polygon.source, "draw-polygon");
  assert.equal(polygon.label, "Sketch");
  assert.deepEqual(
    polygon.geometry.coordinates[0][0],
    polygon.geometry.coordinates[0].at(-1),
    "drawn polygon ring must be closed",
  );

  const rectangle = createRectangleProjectArea(
    [11.002, 48.002],
    [11, 48],
    { createdAt: "2026-07-20T00:00:00.000Z" },
  );
  assert.equal(rectangle.source, "draw-rectangle");
  assert.deepEqual(rectangle.bbox, [11, 48, 11.002, 48.002]);
  assert.equal(rectangle.geometry.coordinates[0].length, 5);
}

function validateCanonicalIds({ createPolygonProjectArea }) {
  const canonical = [
    [11, 48],
    [11.002, 48],
    [11.002, 48.001],
    [11, 48.001],
  ];
  const rotated = [canonical[2], canonical[3], canonical[0], canonical[1]];
  const reversed = [...canonical].reverse();
  const options = { createdAt: "2026-07-20T00:00:00.000Z" };
  const canonicalArea = createPolygonProjectArea(canonical, options);
  assert.equal(createPolygonProjectArea(rotated, options).id, canonicalArea.id);
  assert.equal(createPolygonProjectArea(reversed, options).id, canonicalArea.id);
}

function validateRejections({ createPolygonProjectArea, createRectangleProjectArea }) {
  assert.throws(
    () =>
      createPolygonProjectArea([
        [11, 48],
        [11.002, 48.002],
        [11, 48.002],
        [11.002, 48],
      ]),
    (error) => error?.code === "self-intersection",
    "self-crossing project polygons must be rejected",
  );
  assert.throws(
    () => createRectangleProjectArea([11, 48], [11.1, 48.1]),
    (error) => error?.code === "extent-too-large",
    "project areas beyond the browser analysis limit must be rejected",
  );
}

function validateAnalysisRadius({ createRectangleProjectArea, projectAreaRadiusMeters }) {
  const rectangle = createRectangleProjectArea(
    [11, 48],
    [11.002, 48.002],
    { createdAt: "2026-07-20T00:00:00.000Z" },
  );
  const radius = projectAreaRadiusMeters(rectangle);
  assert.ok(radius > 130 && radius < 140, `unexpected project analysis radius: ${radius}`);
}

function validateOverpassBboxQueries(overpassModules) {
  const bbox = [10.9, 47.9, 11.1, 48.1];
  const expectedOverpassBbox = "(47.9,10.9,48.1,11.1)";
  const params = { lat: 48, lon: 11, radiusMeters: 500, bbox };
  for (const module of overpassModules) {
    for (const [kind, build] of [
      ["primary", module.buildQuery],
      ["fallback", module.buildFallbackQuery],
    ]) {
      if (!build) continue;
      const query = build(params);
      assert.ok(
        query.includes(expectedOverpassBbox),
        `${module.id} ${kind} query must include the supplied bbox`,
      );
      assert.equal(
        query.includes("(around:"),
        false,
        `${module.id} ${kind} query must not fall back to an around clause when bbox is supplied`,
      );
    }
  }
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
