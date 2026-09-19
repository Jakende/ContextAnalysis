#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENT_SCHEMA,
  IMMUTABLE_CACHE_CONTROL,
  assertReleaseMatchesUrl,
  parseArguments,
  parseUiOrigin,
} from "./data-deployment-contract.mjs";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = parseArguments(process.argv.slice(2));
const manifestPath = resolve(projectRoot, args.manifest || "public/data/data-release-manifest.json");
const dataRoot = resolve(projectRoot, args["data-root"] || "public/data");
const outputDirectory = requiredPath(args["out-dir"], "--out-dir");
const releaseUrl = requiredString(args["release-url"], "--release-url");
const uiOrigin = parseUiOrigin(requiredString(args["ui-origin"], "--ui-origin"));
const verifyHashes = args["verify-hashes"] !== "false";

assertSafeOutputDirectory(outputDirectory, dataRoot);
await assertEmptyOrMissing(outputDirectory);
await runReleaseValidation({ manifestPath, dataRoot, verifyHashes });

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const parsedRelease = assertReleaseMatchesUrl(manifest, releaseUrl);
if (manifest.cacheControl !== IMMUTABLE_CACHE_CONTROL) {
  throw new Error(
    `Manifest cache policy is ${String(
      manifest.cacheControl,
    )}; expected ${IMMUTABLE_CACHE_CONTROL}.`,
  );
}

const contract = {
  schema: DEPLOYMENT_SCHEMA,
  releaseId: manifest.releaseId,
  releaseDigest: manifest.releaseDigest,
  target: {
    releaseUrl: parsedRelease.releaseUrl,
    uiOrigin,
  },
  source: {
    dataRoot: toProjectRelative(dataRoot),
    manifest: toProjectRelative(manifestPath),
    payloadRoot: "processed/",
    assets: manifest.totals.assets,
    bytes: manifest.totals.bytes,
  },
  uiBuild: {
    UCA_INCLUDE_GEODATA: "false",
    VITE_GEODATA_BASE_URL: parsedRelease.releaseUrl,
  },
  publishAuthorization: {
    authorized: false,
    credentials: null,
    command: null,
    note: "This staged handoff is non-publishing. Choose a provider and supply its credentials and upload command explicitly.",
  },
  invariants: [
    "The release URL ends with the manifest release ID.",
    "The existing public/data/processed tree is the upload source; no payload copy is staged.",
    "An existing release prefix is never overwritten or deleted.",
    "The production UI is built with the exact pinned release URL.",
    "Rollback changes only the UI pin to a retained prior immutable release.",
  ],
};

const httpPolicy = {
  schema: "uca-data-http-policy/1.0",
  releaseId: manifest.releaseId,
  match: `${new URL(parsedRelease.releaseUrl).pathname}/**`,
  responseHeaders: {
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    "Access-Control-Allow-Origin": uiOrigin,
    Vary: "Origin",
  },
  cors: {
    allowedOrigins: [uiOrigin],
    allowedMethods: ["GET", "HEAD"],
    allowedRequestHeaders: ["Range", "If-None-Match", "If-Modified-Since"],
    exposedResponseHeaders: [
      "Accept-Ranges",
      "Content-Length",
      "Content-Range",
      "ETag",
      "Last-Modified",
    ],
    maxAgeSeconds: 86400,
  },
  requiredHostBehavior: {
    byteRangeRequests: true,
    headRequests: true,
    immutableObjectKeys: true,
    directoryListing: false,
  },
};

const rollback = {
  schema: "uca-data-rollback/1.0",
  currentReleaseId: manifest.releaseId,
  destructiveActionsAllowed: false,
  prerequisites: [
    "Retain every previously promoted immutable release prefix.",
    "Retain the UI artifact or build inputs that pin each promoted release.",
  ],
  procedure: [
    "Select a previously validated release ID.",
    "Build or restore the UI artifact whose data-release-pin.json names that release.",
    "Validate the UI pin against the retained release manifest.",
    "Promote only the UI artifact; do not mutate or delete either data release.",
  ],
};

const readme = `# Immutable geodata deployment handoff

Release: \`${manifest.releaseId}\`
Target: \`${parsedRelease.releaseUrl}\`

This directory is a control-plane handoff only. It contains no geodata payload
and cannot publish anything. Upload the existing \`${toProjectRelative(
  dataRoot,
)}/processed/\` tree plus \`${toProjectRelative(
  manifestPath,
)}\` to the release URL using an explicitly chosen provider command and
credentials. Refuse overwrite operations if the release prefix already exists.

Apply \`http-policy.json\`, then build the production UI with
\`ui-production.env\`. The build emits \`data-release-pin.json\`; validate that
artifact before promotion. Roll back by promoting a retained UI artifact pinned
to a retained prior data release. Never edit or delete an immutable release in
place.
`;

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeJson(resolve(outputDirectory, "deployment-contract.json"), contract),
  writeJson(resolve(outputDirectory, "http-policy.json"), httpPolicy),
  writeJson(resolve(outputDirectory, "rollback.json"), rollback),
  writeFile(
    resolve(outputDirectory, "ui-production.env"),
    `UCA_INCLUDE_GEODATA=false\nVITE_GEODATA_BASE_URL=${parsedRelease.releaseUrl}\n`,
    "utf8",
  ),
  writeFile(resolve(outputDirectory, "README.md"), readme, "utf8"),
]);

console.log(
  JSON.stringify(
    {
      staged: true,
      published: false,
      releaseId: manifest.releaseId,
      outputDirectory,
      payloadCopied: false,
      verifyHashes,
    },
    null,
    2,
  ),
);

function requiredString(value, flag) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${flag} is required.`);
  }
  return value.trim();
}

function requiredPath(value, flag) {
  return resolve(projectRoot, requiredString(value, flag));
}

function assertSafeOutputDirectory(output, sourceRoot) {
  const relativeToSource = relative(sourceRoot, output);
  if (
    output === sourceRoot ||
    (!relativeToSource.startsWith(`..${sep}`) && relativeToSource !== "..")
  ) {
    throw new Error("The deployment handoff directory must be outside the geodata root.");
  }
}

async function assertEmptyOrMissing(path) {
  try {
    await access(path);
    const entries = await readdir(path);
    if (entries.length) {
      throw new Error(`Deployment handoff directory is not empty: ${path}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function runReleaseValidation({ manifestPath, dataRoot, verifyHashes }) {
  const validator = resolve(projectRoot, "scripts/release/validate-data-release-manifest.mjs");
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        validator,
        `--manifest=${manifestPath}`,
        `--data-root=${dataRoot}`,
        `--verify-hashes=${String(verifyHashes)}`,
      ],
      { cwd: projectRoot, stdio: "inherit", shell: false },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Data-release validation failed with exit code ${String(code)}.`));
    });
  });
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toProjectRelative(path) {
  const relativePath = relative(projectRoot, path);
  return relativePath.split(sep).join("/");
}
