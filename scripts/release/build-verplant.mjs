import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const base = process.env.VITE_PUBLIC_BASE || "/ausprobieren/app/";
if (
  !base.endsWith("/") ||
  !(base.startsWith("/") || base === "./") ||
  base.startsWith("//")
)
  throw new Error(
    "VITE_PUBLIC_BASE must be an absolute path or ./ ending in /.",
  );
const api = process.env.VITE_API_BASE_URL || "";
if (api && (!api.startsWith("/") || api.startsWith("//") || api.includes("..")))
  throw new Error(
    "Use a same-origin API proxy path; do not bake a local/remote AI host into the UI.",
  );
const env = {
  ...process.env,
  VITE_PRODUCT_VARIANT: "verplant",
  VITE_REPORT_LANGUAGE: "de",
  UCA_INCLUDE_GEODATA: "false",
  UCA_OUT_DIR: "dist-verplant",
  VITE_PUBLIC_BASE: base,
  VITE_API_BASE_URL: api,
  VITE_OLLAMA_MODEL: "llama3.1",
  VITE_GEODATA_BASE_URL: process.env.VITE_GEODATA_BASE_URL || "",
  VITE_GEODATA_MODE: process.env.VITE_GEODATA_BASE_URL ? "release" : "none",
  VITE_BUILD_COMMIT: git("rev-parse", "HEAD"),
};
for (const args of [
  ["node_modules/typescript/bin/tsc", "-b"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  const p = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (p.status !== 0) process.exit(p.status ?? 1);
}
const root = resolve("dist-verplant");
const files = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
}
walk(root);
if (existsSync(resolve(root, "data/processed")))
  throw new Error("Slim artifact includes canonical geodata");
const html = readFileSync(resolve(root, "index.html"), "utf8");
if (!html.includes(`${base}assets/`))
  throw new Error("Asset base path missing");
for (const p of files.filter((p) => /\.(js|html|json|css)$/.test(p))) {
  const text = readFileSync(p, "utf8");
  if (
    /localhost|127\.0\.0\.1|\/Users\/|\/home\/[a-z]|sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+/.test(
      text,
    )
  )
    throw new Error(
      `Sensitive data/local path in artifact: ${p.split("/").at(-1)}`,
    );
}
writeFileSync(
  resolve(root, "integration-manifest.json"),
  JSON.stringify(
    {
      schema: "verplant-integration/1.0.0",
      sourceCommit: env.VITE_BUILD_COMMIT,
      branch: git("branch", "--show-current"),
      dirty: !!git("status", "--porcelain"),
      createdAt: new Date().toISOString(),
      productVariant: "verplant",
      basePath: base,
      geodataMode: env.VITE_GEODATA_MODE,
      analysisVersion: "0.1.0",
      exportVersion: "0.1.0",
      extensionVersion: "verplant-case/1.0.0",
      checks: [
        "tsc -b",
        "vite build",
        "slim-geodata-absence",
        "subpath-index-assets",
        "secrets-and-local-path-scan",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "verplant artifact: dist-verplant/ (integration-manifest.json included)",
);
