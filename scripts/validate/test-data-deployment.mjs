#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CACHE_CONTROL,
  CANONICAL_SOURCE_IDS,
  MANIFEST_SCHEMA,
  REGRESSION_CITIES,
  digestAssets,
  digestRelease,
  sha256File,
} from "../release/build-data-release-manifest.mjs";
import {
  parseImmutableReleaseUrl,
  validateUiReleasePin,
} from "../release/data-deployment-contract.mjs";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "uca-data-deployment-test-"));

try {
  const dataRoot = join(temporaryRoot, "data");
  const assetPath = join(dataRoot, "processed", "fixture.json");
  const manifestPath = join(dataRoot, "data-release-manifest.json");
  const stageDirectory = join(temporaryRoot, "handoff");
  const uiDirectory = join(temporaryRoot, "ui");
  await mkdir(join(dataRoot, "processed"), { recursive: true });
  await writeFile(assetPath, '{"fixture":true}\n', "utf8");

  const assets = [
    {
      path: "processed/fixture.json",
      bytes: Buffer.byteLength('{"fixture":true}\n'),
      sha256: await sha256File(assetPath),
      sourceId: null,
    },
  ];
  const sources = CANONICAL_SOURCE_IDS.map(syntheticSource);
  const releaseDigest = digestRelease(assets, sources);
  const releaseId = `uca-data-${releaseDigest.slice(0, 16)}`;
  const manifest = {
    schema: MANIFEST_SCHEMA,
    releaseId,
    releaseDigest,
    assetDigest: digestAssets(assets),
    cacheControl: CACHE_CONTROL,
    dataRootContract:
      "VITE_GEODATA_BASE_URL points to the immutable release root containing processed/.",
    excluded: [
      "processed/cache/**",
      "processed/cache-manifest.json",
      "**/.DS_Store",
      "data-release-manifest.json",
    ],
    coverageStates: ["available", "empty", "missing"],
    regressionCities: REGRESSION_CITIES,
    sources,
    assets,
    totals: { assets: assets.length, bytes: assets[0].bytes },
  };
  await writeJson(manifestPath, manifest);
  const releaseUrl = `https://data.example.test/urban-context/${releaseId}`;
  const uiOrigin = "https://app.example.test";

  await runNode("scripts/release/prepare-data-deployment.mjs", [
    `--manifest=${manifestPath}`,
    `--data-root=${dataRoot}`,
    `--out-dir=${stageDirectory}`,
    `--release-url=${releaseUrl}`,
    `--ui-origin=${uiOrigin}`,
  ]);

  const contract = JSON.parse(
    await readFile(join(stageDirectory, "deployment-contract.json"), "utf8"),
  );
  assert(contract.releaseId === releaseId, "staged release ID");
  assert(contract.target.releaseUrl === releaseUrl, "staged release URL");
  assert(contract.publishAuthorization.authorized === false, "non-publishing handoff");
  assert(contract.publishAuthorization.credentials === null, "no staged credentials");
  assert(contract.publishAuthorization.command === null, "no staged publish command");

  await mkdir(uiDirectory, { recursive: true });
  await writeJson(join(uiDirectory, "data-release-pin.json"), {
    schema: "uca-ui-data-release-pin/1.0",
    releaseId,
    geodataBaseUrl: releaseUrl,
  });
  await runNode("scripts/release/validate-data-deployment.mjs", [
    `--stage-dir=${stageDirectory}`,
    `--manifest=${manifestPath}`,
    `--ui-dist=${uiDirectory}`,
  ]);

  assertThrows(
    () => parseImmutableReleaseUrl("https://data.example.test/urban-context/latest"),
    "mutable release URL",
  );
  await writeJson(join(uiDirectory, "data-release-pin.json"), {
    schema: "uca-ui-data-release-pin/1.0",
    releaseId,
    geodataBaseUrl: `https://other.example.test/${releaseId}`,
  });
  await assertRejects(
    () => validateUiReleasePin({ uiDirectory, manifest, releaseUrl }),
    "mismatched production UI pin",
  );

  console.log(
    JSON.stringify(
      {
        valid: true,
        releaseId,
        checks: [
          "full release validation precedes staging",
          "handoff contains no publish authorization or credentials",
          "immutable release URL is explicit and manifest-bound",
          "production UI pin is manifest-bound",
          "mutable and mismatched pins fail",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function syntheticSource(sourceId) {
  return {
    sourceId,
    indexPath: "processed/fixture.json",
    sourceVersion: "fixture-1",
    featureCount: 1,
    assets: 1,
    bytes: Buffer.byteLength('{"fixture":true}\n'),
    inventory: {
      declaredFeatureCount: 1,
      validFeatureCount: 1,
      declaredShardCount: null,
      indexedShardCount: null,
      validShardCount: null,
      referencedAssetCount: 1,
      presentReferencedAssetCount: 1,
      missingReferencedAssetCount: 0,
      missingReferencedAssets: [],
      invalidFeatureCount: 0,
      featureCountMethod: "synthetic-deployment-contract-fixture",
    },
    coverageFootprint: {
      bbox: [8, 47, 13, 51],
      geometry: {
        type: "MultiPolygon",
        coordinates: [[[[8, 47], [13, 47], [13, 51], [8, 51], [8, 47]]]],
      },
      method: "synthetic-bbox",
      unitCount: 1,
      polygonCount: 1,
      limitations: ["Synthetic deployment test footprint only."],
    },
    cityGate: Object.fromEntries(
      REGRESSION_CITIES.map((city) => [
        city.id,
        {
          point: { status: "available", reason: "synthetic fixture" },
          footprint: { containment: "inside", method: "synthetic-bbox" },
        },
      ]),
    ),
  };
}

async function runNode(script, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(projectRoot, script), ...args], {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${script} failed with exit code ${String(code)}.`));
    });
  });
}

function assert(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function assertThrows(action, label) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`Expected failure: ${label}`);
}

async function assertRejects(action, label) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`Expected rejection: ${label}`);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
