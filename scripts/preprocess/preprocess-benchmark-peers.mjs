import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseArgs,
  requireArg,
  writeJson,
} from "./shared.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_SOURCE_REGISTRY = resolve(PROJECT_ROOT, "src/lib/data/sourceRegistry.ts");
const SCHEMA_VERSION = "1.0.0";
const AREA_COMPARABILITY_TOLERANCE = 0.05;

export const BENCHMARK_KPI_IDS = Object.freeze([
  "kpi.local-quality-score",
  "kpi.mobility_access",
  "kpi.green_blue_access",
  "kpi.urban_mix",
  "kpi.social_infrastructure",
  "kpi.tree_canopy",
  "kpi.station_axis",
]);

const KPI_IDS = new Set(BENCHMARK_KPI_IDS);
const GEOGRAPHY_TYPES = new Set(["district", "city", "municipality", "fua"]);
const CONTEXT_TYPES = new Set(["radius", "project-area", "administrative-area"]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };

export async function preprocessBenchmarkPeers({
  inputPath,
  outputPath,
  datasetId,
  datasetVersion,
  label,
  preprocessedAt,
  confidence,
  caveats,
  sourceRegistryPath = DEFAULT_SOURCE_REGISTRY,
}) {
  const input = await readBenchmarkInput(inputPath);
  const metadata = input.metadata ?? {};
  const peers = input.peers.map((row, index) => normalizePeer(row, index));
  if (!peers.length) throw new Error("Benchmark input must contain at least one peer row.");

  const resolvedMetadata = {
    datasetId: requiredText(datasetId ?? metadata.datasetId, "datasetId"),
    datasetVersion: requiredText(datasetVersion ?? metadata.datasetVersion, "datasetVersion"),
    label: requiredText(label ?? metadata.label, "label"),
    preprocessedAt: requiredTimestamp(
      preprocessedAt ?? metadata.preprocessedAt,
      "preprocessedAt",
    ),
    confidence: optionalText(confidence ?? metadata.confidence),
    caveats: normalizeStringArray(caveats ?? metadata.caveats, "dataset caveats"),
  };
  if (!resolvedMetadata.caveats.length) {
    throw new Error("Dataset caveats must contain at least one limitation or provenance note.");
  }
  if (metadata.status !== undefined && metadata.status !== "curated") {
    throw new Error(
      `Benchmark ingestion only emits validated curated datasets; input status ${String(metadata.status)} is not allowed.`,
    );
  }

  const knownSourceIds = await readSourceRegistryIds(sourceRegistryPath);
  validatePeers(peers, resolvedMetadata.preprocessedAt, knownSourceIds);
  validateComparableContext(peers);

  const datasetSources = mergeSourceVersions(peers);
  const derivedConfidence = peers.reduce(
    (lowest, peer) =>
      CONFIDENCE_ORDER[peer.confidence] < CONFIDENCE_ORDER[lowest]
        ? peer.confidence
        : lowest,
    "high",
  );
  const datasetConfidence = resolvedMetadata.confidence ?? derivedConfidence;
  if (!CONFIDENCE_VALUES.has(datasetConfidence)) {
    throw new Error("Dataset confidence must be one of: high, medium, low.");
  }
  if (CONFIDENCE_ORDER[datasetConfidence] > CONFIDENCE_ORDER[derivedConfidence]) {
    throw new Error(
      `Dataset confidence ${datasetConfidence} cannot exceed the lowest peer confidence ${derivedConfidence}.`,
    );
  }

  const dataset = {
    schemaVersion: SCHEMA_VERSION,
    datasetId: resolvedMetadata.datasetId,
    datasetVersion: resolvedMetadata.datasetVersion,
    status: "curated",
    label: resolvedMetadata.label,
    preprocessedAt: resolvedMetadata.preprocessedAt,
    sourceIds: Object.keys(datasetSources).sort(compareText),
    sourceVersions: sortRecord(datasetSources),
    confidence: datasetConfidence,
    caveats: uniqueSorted(resolvedMetadata.caveats),
    peers: peers.sort((left, right) => compareText(left.id, right.id)),
  };

  if (outputPath) await writeJson(outputPath, dataset);
  return dataset;
}

export async function readBenchmarkInput(inputPath) {
  const path = resolve(requiredText(inputPath, "inputPath"));
  const text = await readFile(path, "utf8");
  if (extname(path).toLowerCase() === ".csv") {
    return { metadata: {}, peers: parseCsv(text) };
  }
  const value = JSON.parse(text);
  if (Array.isArray(value)) return { metadata: {}, peers: value };
  const record = asRecord(value, "benchmark input");
  if (!Array.isArray(record.peers)) {
    throw new Error("JSON benchmark input must be an array or an object with a peers array.");
  }
  return {
    metadata: asOptionalRecord(record.metadata ?? record.dataset ?? omit(record, "peers")),
    peers: record.peers,
  };
}

export function parseCsv(text) {
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      record.push(value);
      value = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      record.push(value);
      if (record.some((item) => item.trim())) records.push(record);
      record = [];
      value = "";
      continue;
    }
    value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  record.push(value);
  if (record.some((item) => item.trim())) records.push(record);
  if (!records.length) return [];

  const headers = records[0].map((header) => header.trim());
  if (!headers.length || headers.some((header) => !header)) {
    throw new Error("CSV header contains an empty column name.");
  }
  if (new Set(headers).size !== headers.length) throw new Error("CSV header contains duplicate columns.");
  return records.slice(1).map((row, rowIndex) => {
    if (row.length > headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} contains more values than the header.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
  });
}

export async function readSourceRegistryIds(sourceRegistryPath = DEFAULT_SOURCE_REGISTRY) {
  const text = await readFile(resolve(sourceRegistryPath), "utf8");
  const ids = new Set([...text.matchAll(/\bid:\s*["']([^"']+)["']/g)].map((match) => match[1]));
  if (!ids.size) throw new Error(`No source IDs found in ${sourceRegistryPath}.`);
  return ids;
}

function normalizePeer(value, index) {
  const row = asRecord(value, `peer row ${index + 1}`);
  const id = requiredText(first(row, "id", "peerId", "peer_id"), `peer row ${index + 1} id`);
  const label = requiredText(
    first(row, "label", "peerLabel", "peer_label"),
    `peer ${id} label`,
  );
  const geographyType = requiredText(
    first(row, "geographyType", "geography_type"),
    `peer ${id} geographyType`,
  ).toLowerCase();
  const observedAt = requiredTimestamp(
    first(row, "observedAt", "observed_at"),
    `peer ${id} observedAt`,
  );
  const confidence = requiredText(first(row, "confidence"), `peer ${id} confidence`).toLowerCase();
  const context = normalizeContext(row, id);
  const sourceIds = uniqueSorted(
    normalizeStringArray(first(row, "sourceIds", "source_ids"), `peer ${id} sourceIds`),
  );
  const sourceVersions = sortRecord(
    normalizeStringRecord(first(row, "sourceVersions", "source_versions"), `peer ${id} sourceVersions`),
  );
  const caveats = uniqueSorted(
    normalizeStringArray(first(row, "caveats"), `peer ${id} caveats`),
  );
  const scores = sortRecord(normalizeScores(row, id));
  return {
    id,
    label,
    geographyType,
    context,
    observedAt,
    sourceIds,
    sourceVersions,
    confidence,
    caveats,
    scores,
  };
}

function normalizeContext(row, peerId) {
  const nested = row.context === undefined ? null : asRecord(row.context, `peer ${peerId} context`);
  const type = requiredText(
    nested?.type ?? first(row, "contextType", "context_type"),
    `peer ${peerId} context type`,
  ).toLowerCase();
  if (!CONTEXT_TYPES.has(type)) {
    throw new Error(`Peer ${peerId} context type must be radius, project-area, or administrative-area.`);
  }
  const radiusMeters = optionalPositiveNumber(
    nested?.radiusMeters ?? first(row, "radiusMeters", "radius_meters"),
    `peer ${peerId} radiusMeters`,
  );
  const areaSqm = optionalPositiveNumber(
    nested?.areaSqm ?? first(row, "areaSqm", "area_sqm"),
    `peer ${peerId} areaSqm`,
  );
  const geographyType = optionalText(
    nested?.geographyType ?? first(row, "contextGeographyType", "context_geography_type"),
  )?.toLowerCase();

  if (type === "radius") {
    if (radiusMeters === undefined) throw new Error(`Peer ${peerId} radius context requires radiusMeters.`);
    return areaSqm === undefined ? { type, radiusMeters } : { type, radiusMeters, areaSqm };
  }
  if (type === "project-area") {
    if (areaSqm === undefined) throw new Error(`Peer ${peerId} project-area context requires areaSqm.`);
    return { type, areaSqm };
  }
  if (!geographyType || !GEOGRAPHY_TYPES.has(geographyType)) {
    throw new Error(`Peer ${peerId} administrative context requires a valid contextGeographyType.`);
  }
  return areaSqm === undefined ? { type, geographyType } : { type, geographyType, areaSqm };
}

function normalizeScores(row, peerId) {
  const rawScores = row.scores === undefined ? null : asRecord(row.scores, `peer ${peerId} scores`);
  const entries = rawScores
    ? Object.entries(rawScores)
    : Object.entries(row)
        .filter(([key, value]) => value !== "" && (key.startsWith("kpi.") || key.startsWith("score:kpi.")))
        .map(([key, value]) => [key.replace(/^score:/, ""), value]);
  if (!entries.length) throw new Error(`Peer ${peerId} must contain at least one KPI score.`);
  const scores = {};
  for (const [kpiId, rawScore] of entries) {
    if (!KPI_IDS.has(kpiId)) {
      throw new Error(`Peer ${peerId} contains unknown KPI ID ${kpiId}.`);
    }
    const score = Number(rawScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`Peer ${peerId} KPI ${kpiId} must be a finite score from 0 to 100.`);
    }
    scores[kpiId] = score;
  }
  return scores;
}

function validatePeers(peers, preprocessedAt, knownSourceIds) {
  const peerIds = new Map();
  const preprocessTime = Date.parse(preprocessedAt);
  for (const peer of peers) {
    const normalizedId = peer.id.trim().toLocaleLowerCase("en");
    if (peerIds.has(normalizedId)) {
      throw new Error(`Duplicate benchmark peer ID: ${peer.id} conflicts with ${peerIds.get(normalizedId)}.`);
    }
    peerIds.set(normalizedId, peer.id);
    if (!GEOGRAPHY_TYPES.has(peer.geographyType)) {
      throw new Error(`Peer ${peer.id} geographyType is invalid: ${peer.geographyType}.`);
    }
    if (!CONFIDENCE_VALUES.has(peer.confidence)) {
      throw new Error(`Peer ${peer.id} confidence must be high, medium, or low.`);
    }
    if (!peer.caveats.length) throw new Error(`Peer ${peer.id} must declare at least one caveat.`);
    if (!peer.sourceIds.length) throw new Error(`Peer ${peer.id} must declare source IDs.`);
    for (const sourceId of peer.sourceIds) {
      if (!knownSourceIds.has(sourceId)) {
        throw new Error(`Peer ${peer.id} references unknown source registry ID ${sourceId}.`);
      }
      if (!peer.sourceVersions[sourceId]) {
        throw new Error(`Peer ${peer.id} is missing source version for ${sourceId}.`);
      }
    }
    for (const sourceId of Object.keys(peer.sourceVersions)) {
      if (!peer.sourceIds.includes(sourceId)) {
        throw new Error(`Peer ${peer.id} has source version for undeclared source ${sourceId}.`);
      }
    }
    if (Date.parse(peer.observedAt) > preprocessTime) {
      throw new Error(`Peer ${peer.id} observedAt cannot be later than preprocessedAt.`);
    }
  }
}

function validateComparableContext(peers) {
  const types = uniqueSorted(peers.map((peer) => peer.context.type));
  if (types.length !== 1) {
    throw new Error(`Mixed benchmark context types are not comparable: ${types.join(", ")}.`);
  }
  const type = types[0];
  if (type === "radius") {
    const radii = peers.map((peer) => peer.context.radiusMeters);
    if (Math.max(...radii) - Math.min(...radii) > 1) {
      throw new Error("Radius benchmark rows must use the same radius within 1 metre.");
    }
    const areas = peers.map((peer) => peer.context.areaSqm);
    validateOptionalComparableAreas(areas, "radius");
    return;
  }
  if (type === "project-area") {
    validateComparableAreas(peers.map((peer) => peer.context.areaSqm), "project-area");
    return;
  }
  const geographyTypes = uniqueSorted(peers.map((peer) => peer.context.geographyType));
  if (geographyTypes.length !== 1) {
    throw new Error(
      `Administrative benchmark rows must use one context geography type, found: ${geographyTypes.join(", ")}.`,
    );
  }
  validateOptionalComparableAreas(
    peers.map((peer) => peer.context.areaSqm),
    "administrative-area",
  );
}

function validateOptionalComparableAreas(areas, label) {
  const present = areas.filter((area) => area !== undefined);
  if (present.length > 0 && present.length !== areas.length) {
    throw new Error(`${label} benchmark rows cannot mix declared and undeclared areas.`);
  }
  if (present.length) validateComparableAreas(present, label);
}

function validateComparableAreas(areas, label) {
  const minimum = Math.min(...areas);
  const maximum = Math.max(...areas);
  if ((maximum - minimum) / maximum > AREA_COMPARABILITY_TOLERANCE) {
    throw new Error(`${label} benchmark areas exceed the 5% comparability tolerance.`);
  }
}

function mergeSourceVersions(peers) {
  const versions = {};
  for (const peer of peers) {
    for (const sourceId of peer.sourceIds) {
      const version = peer.sourceVersions[sourceId];
      if (versions[sourceId] && versions[sourceId] !== version) {
        throw new Error(
          `Source ${sourceId} has conflicting versions ${versions[sourceId]} and ${version}; split releases before ingestion.`,
        );
      }
      versions[sourceId] = version;
    }
  }
  return versions;
}

function normalizeStringArray(value, path) {
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item !== "string")) throw new Error(`${path} must contain strings.`);
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    return normalizeStringArray(parsed, path);
  }
  return text.split(/[|;]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeStringRecord(value, path) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string" || !item.trim()) throw new Error(`${path}.${key} must be a version string.`);
      record[key.trim()] = item.trim();
    }
    return record;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  const text = value.trim();
  if (text.startsWith("{")) return normalizeStringRecord(JSON.parse(text), path);
  const record = {};
  for (const pair of text.split(/[|;]/)) {
    const index = pair.indexOf("=");
    if (index < 1) throw new Error(`${path} entries must use source-id=version.`);
    record[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return record;
}

function optionalPositiveNumber(value, path) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${path} must be a positive number.`);
  return number;
}

function requiredTimestamp(value, path) {
  const timestamp = requiredText(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${path} must be an ISO-8601 timestamp with timezone.`);
  }
  return timestamp;
}

function requiredText(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string.`);
  return value.trim();
}

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function asOptionalRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function first(record, ...keys) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function omit(record, key) {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareText(left, right)));
}

function compareText(left, right) {
  return left.localeCompare(right, "en");
}

async function runCli() {
  const args = parseArgs();
  const dataset = await preprocessBenchmarkPeers({
    inputPath: requireArg(args, "input"),
    outputPath: requireArg(args, "output"),
    datasetId: args["dataset-id"],
    datasetVersion: args["dataset-version"],
    label: args.label,
    preprocessedAt: args["preprocessed-at"],
    confidence: args.confidence,
    caveats: args.caveat ? [args.caveat] : undefined,
    sourceRegistryPath: args["source-registry"],
  });
  console.log(
    `Wrote ${dataset.peers.length} curated benchmark peer(s) to ${resolve(args.output)} (${dataset.datasetId}@${dataset.datasetVersion}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
