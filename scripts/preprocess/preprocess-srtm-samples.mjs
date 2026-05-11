#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  fetchBuffer,
  parseArgs,
  parseBbox,
  requireArg,
  writeJson,
} from "./shared.mjs";

const DEFAULT_OUT = "public/data/processed/srtm-30m/samples.geojson";
const OPENTOPOGRAPHY_URL = "https://portal.opentopography.org/API/globaldem";

const args = parseArgs();
const out = args.out ?? DEFAULT_OUT;
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const stride = Number(args.stride ?? "1");
const keepIntermediate = args["keep-intermediate"] === "true";
const demPath = args.dem;
const bbox = parseBbox(args.bbox ?? process.env.UCA_AOI_BBOX);

if (!Number.isInteger(stride) || stride < 1) {
  throw new Error("--stride must be a positive integer");
}

const workingDir = await mkdtemp(join(tmpdir(), "uca-srtm-"));
const tifPath = demPath ?? join(workingDir, "srtm.tif");
const xyzPath = join(workingDir, "srtm.xyz");

try {
  if (!demPath) {
    if (!bbox) {
      throw new Error("Provide --dem <local GeoTIFF> or --bbox west,south,east,north for OpenTopography download");
    }
    const apiKey = args["api-key"] ?? process.env.OPENTOPOGRAPHY_API_KEY;
    requireArg({ "api-key": apiKey }, "api-key", "OpenTopography download requires --api-key or OPENTOPOGRAPHY_API_KEY");
    const demtype = args.demtype ?? "SRTMGL1";
    const url = new URL(OPENTOPOGRAPHY_URL);
    url.searchParams.set("demtype", demtype);
    url.searchParams.set("south", String(bbox.south));
    url.searchParams.set("north", String(bbox.north));
    url.searchParams.set("west", String(bbox.west));
    url.searchParams.set("east", String(bbox.east));
    url.searchParams.set("outputFormat", "GTiff");
    url.searchParams.set("API_Key", apiKey);
    console.log(`Downloading ${demtype} GeoTIFF from OpenTopography`);
    await writeFile(tifPath, await fetchBuffer(url.toString()));
  }

  ensureCommand("gdal_translate");
  run("gdal_translate", [
    "-of",
    "XYZ",
    ...(bbox
      ? ["-projwin", String(bbox.west), String(bbox.north), String(bbox.east), String(bbox.south)]
      : []),
    tifPath,
    xyzPath,
  ]);

  const xyz = await readFile(xyzPath, "utf8");
  const features = [];
  let row = 0;
  for (const line of xyz.split(/\r?\n/)) {
    if (!line.trim()) continue;
    row += 1;
    if ((row - 1) % stride !== 0) continue;
    const [lonRaw, latRaw, elevationRaw] = line.trim().split(/\s+/);
    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    const elevation = Number(elevationRaw);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(elevation)) continue;
    if (elevation <= -32768) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        elevation,
        sourceId: "srtm-30m",
        sourceVersion,
        processedAt: new Date().toISOString(),
      },
    });
  }

  await writeJson(out, { type: "FeatureCollection", features });
  console.log(`Wrote ${features.length} SRTM sample points to ${out}`);
  if (keepIntermediate) {
    console.log(`Kept intermediate files in ${workingDir}`);
  }
} finally {
  if (!keepIntermediate) {
    await rm(workingDir, { recursive: true, force: true });
  }
}

function ensureCommand(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error) {
    throw new Error(
      `${command} is required to convert DEM rasters. Install GDAL or pass a preconverted samples GeoJSON.`,
    );
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}
