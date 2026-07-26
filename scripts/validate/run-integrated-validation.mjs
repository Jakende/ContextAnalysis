#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "uca-integrated-validation-"));
const slimBuildDirectory = join(temporaryRoot, "dist");
const dataReleaseManifest = JSON.parse(
  await readFile(resolve(projectRoot, "public/data/data-release-manifest.json"), "utf8"),
);
const validationReleaseUrl = `https://data.invalid/${dataReleaseManifest.releaseId}`;

const checks = [
  {
    label: "TypeScript typecheck",
    command: "npm",
    args: ["run", "typecheck"],
  },
  {
    label: "Benchmark runtime contract",
    command: "node",
    args: ["scripts/validate/test-benchmark-contract.mjs"],
  },
  {
    label: "Benchmark ingestion contract",
    command: "node",
    args: ["scripts/validate/test-benchmark-ingestion.mjs"],
  },
  {
    label: "KPI rules contract",
    command: "node",
    args: ["scripts/validate/test-kpi-rules.mjs"],
  },
  {
    label: "Project-area contract",
    command: "node",
    args: ["scripts/validate/test-project-area.mjs"],
  },
  {
    label: "Spatial-area contract",
    command: "node",
    args: ["scripts/validate/test-spatial-area.mjs"],
  },
  {
    label: "Scenario contract",
    command: "node",
    args: ["scripts/validate/test-scenario.mjs"],
  },
  {
    label: "Analysis timing contract",
    command: "node",
    args: ["scripts/validate/test-analysis-timing.mjs"],
  },
  {
    label: "Semantic city coverage contract",
    command: "node",
    args: ["scripts/validate/test-semantic-city-coverage.mjs"],
  },
  {
    label: "Data-access profile contract",
    command: "node",
    args: ["scripts/validate/test-data-access-profile.mjs"],
  },
  {
    label: "Polygon compaction contract",
    command: "node",
    args: ["scripts/validate/test-sharded-polygon-compaction.mjs"],
  },
  {
    label: "UI design-system validation",
    command: "python3",
    args: [
      "scripts/validate/validate_ui_css.py",
      "src/styles/design-system.css",
      "src/styles/app.css",
    ],
  },
  {
    label: "Data-release contract (hashes disabled)",
    command: "node",
    args: [
      "scripts/release/validate-data-release-manifest.mjs",
      "--verify-hashes=false",
    ],
  },
  {
    label: "Data-deployment contract",
    command: "node",
    args: ["scripts/validate/test-data-deployment.mjs"],
  },
  {
    label: "Slim production build",
    command: "npm",
    args: ["run", "build"],
    env: {
      UCA_INCLUDE_GEODATA: "false",
      UCA_OUT_DIR: slimBuildDirectory,
      VITE_GEODATA_BASE_URL: validationReleaseUrl,
    },
  },
];

const startedAt = Date.now();
const completedChecks = [];

try {
  for (const [index, check] of checks.entries()) {
    const checkStartedAt = Date.now();
    console.log(`\n[${index + 1}/${checks.length}] ${check.label}`);
    await runCommand(check);
    const durationMs = Date.now() - checkStartedAt;
    completedChecks.push({ label: check.label, durationMs });
    console.log(`PASS ${check.label} (${formatDuration(durationMs)})`);
  }

  const build = await inspectSlimBuild(slimBuildDirectory);
  const summary = {
    valid: true,
    checks: completedChecks.length,
    durationMs: Date.now() - startedAt,
    slimBuild: build,
  };
  console.log(`\n${JSON.stringify(summary, null, 2)}`);
} catch (error) {
  console.error(`\nIntegrated validation failed: ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function runCommand({ command, args, env = {} }) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${detail}.`));
    });
  });
}

async function inspectSlimBuild(buildDirectory) {
  const indexPath = join(buildDirectory, "index.html");
  await access(indexPath);
  const bundledGeodataPath = join(buildDirectory, "data", "processed");
  let bundledGeodata = false;
  try {
    await access(bundledGeodataPath);
    bundledGeodata = true;
  } catch {
    // Expected for UCA_INCLUDE_GEODATA=false.
  }
  if (bundledGeodata) {
    throw new Error(`Slim build unexpectedly contains ${bundledGeodataPath}.`);
  }
  const releasePin = JSON.parse(
    await readFile(join(buildDirectory, "data-release-pin.json"), "utf8"),
  );
  if (
    releasePin.releaseId !== dataReleaseManifest.releaseId ||
    releasePin.geodataBaseUrl !== validationReleaseUrl
  ) {
    throw new Error("Slim build data-release pin does not match the validated manifest.");
  }
  const inventory = await directoryInventory(buildDirectory);
  return {
    files: inventory.files,
    bytes: inventory.bytes,
    includesGeodata: false,
    dataReleaseId: releasePin.releaseId,
  };
}

async function directoryInventory(root) {
  let files = 0;
  let bytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(path)).size;
      }
    }
  }
  await visit(root);
  return { files, bytes };
}

function formatDuration(durationMs) {
  return `${(durationMs / 1_000).toFixed(2)}s`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
