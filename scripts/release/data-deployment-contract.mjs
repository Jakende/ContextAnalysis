import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export const DEPLOYMENT_SCHEMA = "uca-data-deployment/1.0";
export const UI_PIN_SCHEMA = "uca-ui-data-release-pin/1.0";
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const RELEASE_ID_PATTERN = /^uca-data-[0-9a-f]{16}$/;

export function parseImmutableReleaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("An explicit immutable release URL is required.");
  }
  const raw = value.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid immutable release URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("The immutable release URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "The immutable release URL must not contain credentials, a query, or a fragment.",
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const releaseId = pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error(
      "The immutable release URL must end with uca-data- followed by 16 lowercase hexadecimal characters.",
    );
  }
  url.pathname = pathname;
  return {
    releaseId,
    releaseUrl: url.toString().replace(/\/$/, ""),
  };
}

export function parseUiOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("An explicit production UI origin is required.");
  }
  const raw = value.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid UI origin: ${raw}`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "The production UI origin must be an HTTPS origin without credentials, a path, query, or fragment.",
    );
  }
  return url.origin;
}

export function assertReleaseMatchesUrl(manifest, releaseUrl) {
  const parsed = parseImmutableReleaseUrl(releaseUrl);
  if (manifest?.releaseId !== parsed.releaseId) {
    throw new Error(
      `Release URL pins ${parsed.releaseId}, but the manifest declares ${String(
        manifest?.releaseId,
      )}.`,
    );
  }
  return parsed;
}

export async function validateUiReleasePin({
  uiDirectory,
  manifest,
  releaseUrl,
}) {
  const parsed = assertReleaseMatchesUrl(manifest, releaseUrl);
  const pinPath = resolve(uiDirectory, "data-release-pin.json");
  const pin = JSON.parse(await readFile(pinPath, "utf8"));
  const errors = [];
  if (pin.schema !== UI_PIN_SCHEMA) {
    errors.push(`Unexpected UI pin schema: ${String(pin.schema)}`);
  }
  if (pin.releaseId !== manifest.releaseId) {
    errors.push(
      `UI pins ${String(pin.releaseId)}, but the manifest declares ${manifest.releaseId}.`,
    );
  }
  if (pin.geodataBaseUrl !== parsed.releaseUrl) {
    errors.push(
      `UI geodata base URL ${String(pin.geodataBaseUrl)} does not match ${parsed.releaseUrl}.`,
    );
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return pin;
}

export async function directoryInventory(root) {
  let files = 0;
  let bytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(path)).size;
      }
    }
  }
  await visit(resolve(root));
  return { files, bytes };
}

export function parseArguments(argv) {
  return Object.fromEntries(
    argv.map((argument) => {
      const [key, ...value] = argument.replace(/^--/, "").split("=");
      return [key, value.join("=") || true];
    }),
  );
}
