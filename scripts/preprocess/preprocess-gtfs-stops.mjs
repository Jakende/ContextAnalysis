#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  fetchBuffer,
  firstString,
  parseArgs,
  requireArg,
  writeJson,
} from "./shared.mjs";

const DEFAULT_OUT = "public/data/processed/gtfs-stops.geojson";

const args = parseArgs();
const out = args.out ?? DEFAULT_OUT;
const sourceVersion = args["source-version"] ?? new Date().toISOString().slice(0, 10);
const provider = args.provider ?? "GTFS feed provider";
const input = args.input;
const url = args.url;

if (!input && !url) {
  throw new Error("Provide --input <gtfs.zip|directory|stops.txt> or --url <gtfs.zip|stops.txt>");
}

const workingDir = await mkdtemp(join(tmpdir(), "uca-gtfs-"));

try {
  let sourcePath = input;
  if (url) {
    sourcePath = join(workingDir, basename(new URL(url).pathname) || "gtfs.zip");
    console.log(`Downloading GTFS input from ${url}`);
    await writeFile(sourcePath, await fetchBuffer(url));
  }

  const stopsPath = await resolveStopsPath(sourcePath, workingDir);
  const rows = parseCsv(await readFile(stopsPath, "utf8"));
  const features = rows
    .map((row) => {
      const lat = Number(row.stop_lat);
      const lon = Number(row.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          sourceId: "mobilithek-gtfs",
          sourceVersion,
          provider,
          stop_id: row.stop_id,
          stop_name: row.stop_name,
          label: firstString(row, ["stop_name", "stop_id"]) ?? "GTFS stop",
          transportMode: row.location_type === "1" ? "station" : "transit",
          processedAt: new Date().toISOString(),
        },
      };
    })
    .filter(Boolean);

  await writeJson(out, { type: "FeatureCollection", features });
  console.log(`Wrote ${features.length} GTFS stop features to ${out}`);
} finally {
  await rm(workingDir, { recursive: true, force: true });
}

async function resolveStopsPath(sourcePath, workingDir) {
  if (!sourcePath) throw new Error("Missing GTFS source path");
  if (sourcePath.endsWith(".txt")) return sourcePath;
  if (!sourcePath.endsWith(".zip")) return join(sourcePath, "stops.txt");
  ensureCommand("unzip");
  const result = spawnSync("unzip", ["-o", sourcePath, "stops.txt", "-d", workingDir], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`unzip failed: ${result.stderr || result.stdout}`);
  }
  return join(workingDir, "stops.txt");
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function ensureCommand(command) {
  const result = spawnSync(command, ["-v"], { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command} is required to read zipped GTFS feeds`);
  }
}
