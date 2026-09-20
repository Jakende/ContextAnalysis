import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractDirectRuntimeReferences,
  validateRuntimeAssets,
} from "../release/runtime-assets.mjs";

const fixtureRoot = await mkdtemp(join(tmpdir(), "verplant-runtime-assets-"));
await mkdir(join(fixtureRoot, "assets"), { recursive: true });
await writeFile(
  join(fixtureRoot, "assets", "maplibre.js"),
  'const worker = "maplibre-gl-worker.mjs"; new URL("./extra-worker.mjs", import.meta.url);',
);
await writeFile(join(fixtureRoot, "assets", "maplibre-gl-worker.mjs"), "");

assert.deepEqual(
  extractDirectRuntimeReferences(
    'new URL("./worker.mjs", import.meta.url); new URL(`./ignored-${name}.mjs`, import.meta.url);',
  ),
  ["worker.mjs"],
);
await assert.rejects(
  validateRuntimeAssets(fixtureRoot, "/ausprobieren/app/"),
  /extra-worker\.mjs/,
);
await writeFile(join(fixtureRoot, "assets", "extra-worker.mjs"), "");
const verified = await validateRuntimeAssets(
  fixtureRoot,
  "/ausprobieren/app/",
);
assert.deepEqual(verified[0], {
  id: "maplibre-module-worker",
  path: "assets/maplibre-gl-worker.mjs",
  publicUrl: "/ausprobieren/app/assets/maplibre-gl-worker.mjs",
  referencedBy: ["assets/maplibre.js"],
});

console.log("Runtime asset validation passed");
