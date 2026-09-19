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
  const timing = await server.ssrLoadModule("/src/lib/performance/timing.ts");
  const manifest = await server.ssrLoadModule("/src/lib/export/manifest.ts");
  validateDeterministicAnalysisTimeline(timing);
  validateMissingMarkContract(timing);
  validateBoundedExportTimeline(timing);
  validateExportSafeManifest(timing, manifest);
  console.log("Analysis timing contract validation passed");
} finally {
  await server.close();
}

function validateExportSafeManifest(
  {
    createAnalysisTimer,
  },
  { createExportManifest },
) {
  const timer = createAnalysisTimer(
    { startedAt: "2026-07-26T10:00:00.000Z", monotonicMs: 0 },
    () => 100,
  );
  timer.mark("local-data-lookup-start");
  timer.mark("local-data-lookup-complete");
  timer.mark("first-usable-structured-result");
  timer.mark("live-enrichment-complete");
  const timings = timer.snapshot();
  const manifest = createExportManifest(
    {
      selectedPoint: { lat: 48, lon: 11 },
      provenance: {
        timings,
        sourceIds: [],
        sourceFetches: [],
        dataSourceRun: [],
        overpassQueries: [],
        caveats: [],
      },
    },
    [{ name: "analysis.json", mediaType: "application/json", role: "structured analysis" }],
  );

  assert.deepEqual(manifest.performance.analysis, timings);
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest.performance, "exports"),
    false,
    "manifests must not leak prior or in-progress export activity",
  );
}

function validateDeterministicAnalysisTimeline({
  createAnalysisTimer,
  evaluateAnalysisTimingContract,
}) {
  let now = 100;
  const timer = createAnalysisTimer(
    { startedAt: "2026-07-26T10:00:00.000Z", monotonicMs: 100 },
    () => now,
  );
  now = 125;
  timer.mark("local-data-lookup-start");
  now = 475;
  timer.mark("local-data-lookup-complete");
  now = 825;
  timer.mark("first-usable-structured-result");
  now = 1_425;
  timer.mark("live-enrichment-complete");

  const summary = timer.snapshot();
  assert.deepEqual(summary.durations, {
    localDataLookupMs: 350,
    firstUsableStructuredResultMs: 725,
    liveEnrichmentCompleteMs: 1_325,
  });
  assert.deepEqual(
    summary.marks.map((mark) => mark.id),
    [
      "analysis-start",
      "local-data-lookup-start",
      "local-data-lookup-complete",
      "first-usable-structured-result",
      "live-enrichment-complete",
    ],
  );
  assert.deepEqual(evaluateAnalysisTimingContract(summary), {
    valid: true,
    missingMarks: [],
    firstUsableWithinProvisionalP95: true,
  });
}

function validateMissingMarkContract({ createAnalysisTimer, evaluateAnalysisTimingContract }) {
  const timer = createAnalysisTimer(
    { startedAt: "2026-07-26T10:00:00.000Z", monotonicMs: 0 },
    () => 5_001,
  );
  timer.mark("first-usable-structured-result");
  const evaluation = evaluateAnalysisTimingContract(timer.snapshot());
  assert.equal(evaluation.valid, false);
  assert.equal(evaluation.firstUsableWithinProvisionalP95, false);
  assert.deepEqual(evaluation.missingMarks, [
    "local-data-lookup-start",
    "local-data-lookup-complete",
    "live-enrichment-complete",
  ]);
}

function validateBoundedExportTimeline({ createExportTimingStore }) {
  let now = 0;
  let wallTick = 0;
  const store = createExportTimingStore({
    now: () => now,
    wallNow: () => `2026-07-26T10:00:${String(wallTick++).padStart(2, "0")}.000Z`,
    maxEvents: 3,
  });
  for (const kind of ["json", "csv", "geojson", "zip"]) {
    const id = store.begin(kind);
    now += 10;
    store.finish(id, "ok");
  }
  const events = store.snapshot();
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.kind), ["csv", "geojson", "zip"]);
  assert.ok(events.every((event) => event.status === "ok" && event.elapsedMs === 10));
  assert.equal(
    Object.prototype.hasOwnProperty.call(events[0], "monotonicStart"),
    false,
    "internal monotonic origins must not leak into export-safe snapshots",
  );
}
