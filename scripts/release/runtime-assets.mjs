import { cp, readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const RUNTIME_EXTENSIONS = "(?:mjs|js|wasm|css|json|png|svg|webp|woff2?)";

export const declaredRuntimeAssets = [
  {
    id: "maplibre-module-worker",
    source: "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
    output: "assets/maplibre-gl-worker.mjs",
    referencedBy: /maplibre-gl-worker\.mjs/,
  },
];

export async function installRuntimeAssets(outputRoot) {
  for (const asset of declaredRuntimeAssets) {
    await cp(resolve(asset.source), resolve(outputRoot, asset.output));
  }
}

export async function validateRuntimeAssets(outputRoot, basePath) {
  const files = await listFiles(outputRoot);
  const scriptFiles = files.filter((file) => /\.(?:js|mjs)$/.test(file));
  const missing = [];
  const verified = [];

  for (const asset of declaredRuntimeAssets) {
    const referencingFiles = [];
    for (const file of scriptFiles) {
      const relativePath = toPosix(relative(outputRoot, file));
      if (relativePath === asset.output) continue;
      const source = await readFile(file, "utf8");
      if (asset.referencedBy.test(source)) {
        referencingFiles.push(relativePath);
      }
    }
    if (referencingFiles.length === 0) {
      throw new Error(
        `Declared runtime asset ${asset.id} is no longer referenced by the production bundle. Review or remove its build declaration.`,
      );
    }
    if (!(await isFile(resolve(outputRoot, asset.output)))) {
      missing.push(`${asset.output} (${asset.id})`);
      continue;
    }
    verified.push({
      id: asset.id,
      path: asset.output,
      publicUrl: `${basePath}${asset.output}`,
      referencedBy: referencingFiles,
    });
  }

  for (const file of scriptFiles) {
    const source = await readFile(file, "utf8");
    for (const reference of extractDirectRuntimeReferences(source)) {
      const target = resolve(dirname(file), reference);
      if (!(await isFile(target))) {
        missing.push(
          `${toPosix(relative(outputRoot, target))} (referenced by ${toPosix(relative(outputRoot, file))})`,
        );
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Production bundle references missing runtime asset(s): ${[...new Set(missing)].join(", ")}`,
    );
  }
  return verified;
}

export function extractDirectRuntimeReferences(source) {
  const references = [];
  const pattern = new RegExp(
    String.raw`new\s+URL\(\s*["'\`]\.\/([^"'\`$?#]+\.${RUNTIME_EXTENSIONS})["'\`]\s*,`,
    "g",
  );
  for (const match of source.matchAll(pattern)) references.push(match[1]);
  return references;
}

async function listFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else output.push(path);
    }
  }
  await walk(root);
  return output;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function toPosix(value) {
  return value.split(sep).join("/");
}
