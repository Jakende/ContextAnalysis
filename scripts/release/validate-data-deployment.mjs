#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DEPLOYMENT_SCHEMA,
  IMMUTABLE_CACHE_CONTROL,
  assertReleaseMatchesUrl,
  directoryInventory,
  parseArguments,
  validateUiReleasePin,
} from "./data-deployment-contract.mjs";

const args = parseArguments(process.argv.slice(2));
const stageDirectory = resolve(requiredString(args["stage-dir"], "--stage-dir"));
const manifestPath = resolve(args.manifest || "public/data/data-release-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const contract = JSON.parse(
  await readFile(resolve(stageDirectory, "deployment-contract.json"), "utf8"),
);
const httpPolicy = JSON.parse(await readFile(resolve(stageDirectory, "http-policy.json"), "utf8"));
const rollback = JSON.parse(await readFile(resolve(stageDirectory, "rollback.json"), "utf8"));
const env = await readFile(resolve(stageDirectory, "ui-production.env"), "utf8");
const errors = [];

if (contract.schema !== DEPLOYMENT_SCHEMA) {
  errors.push(`Unexpected deployment schema: ${String(contract.schema)}`);
}
if (contract.releaseId !== manifest.releaseId) {
  errors.push("Deployment release ID does not match the data manifest.");
}
if (contract.releaseDigest !== manifest.releaseDigest) {
  errors.push("Deployment release digest does not match the data manifest.");
}
try {
  assertReleaseMatchesUrl(manifest, contract.target?.releaseUrl);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
if (contract.publishAuthorization?.authorized !== false) {
  errors.push("A staged handoff must not authorize publication.");
}
if (
  contract.publishAuthorization?.credentials !== null ||
  contract.publishAuthorization?.command !== null
) {
  errors.push("A staged handoff must not contain credentials or a publish command.");
}
if (httpPolicy.releaseId !== manifest.releaseId) {
  errors.push("HTTP policy release ID does not match the data manifest.");
}
if (httpPolicy.responseHeaders?.["Cache-Control"] !== IMMUTABLE_CACHE_CONTROL) {
  errors.push("HTTP policy does not require the immutable cache header.");
}
if (httpPolicy.responseHeaders?.["Access-Control-Allow-Origin"] !== contract.target?.uiOrigin) {
  errors.push("HTTP policy CORS origin does not match the deployment target.");
}
if (httpPolicy.requiredHostBehavior?.byteRangeRequests !== true) {
  errors.push("HTTP policy must require byte-range requests.");
}
if (rollback.destructiveActionsAllowed !== false) {
  errors.push("Rollback must prohibit destructive data operations.");
}
if (
  !env.includes("UCA_INCLUDE_GEODATA=false") ||
  !env.includes(`VITE_GEODATA_BASE_URL=${contract.target?.releaseUrl}`)
) {
  errors.push("UI production environment does not pin the deployment release URL.");
}

const topLevelEntries = await readdir(stageDirectory, { withFileTypes: true });
if (topLevelEntries.some((entry) => entry.isDirectory())) {
  errors.push("Deployment handoff must not contain payload directories.");
}
const inventory = await directoryInventory(stageDirectory);
if (inventory.bytes >= 1_000_000) {
  errors.push("Deployment handoff is unexpectedly large and may contain copied payload data.");
}

if (args["ui-dist"]) {
  try {
    await validateUiReleasePin({
      uiDirectory: resolve(String(args["ui-dist"])),
      manifest,
      releaseUrl: contract.target?.releaseUrl,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        valid: true,
        releaseId: manifest.releaseId,
        published: false,
        stagedFiles: inventory.files,
        stagedBytes: inventory.bytes,
        uiPinValidated: Boolean(args["ui-dist"]),
      },
      null,
      2,
    ),
  );
}

function requiredString(value, flag) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${flag} is required.`);
  return value.trim();
}
