import benchmarkPeerData from "../../data/benchmark/peers.v1.json";
import type { Confidence, FactSheetModule, Indicator } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

export type BenchmarkGeographyType = "district" | "city" | "municipality" | "fua";

export type BenchmarkComparisonContext =
  | {
      type: "radius";
      radiusMeters: number;
      areaSqm?: number;
    }
  | {
      type: "project-area";
      areaSqm: number;
    }
  | {
      type: "administrative-area";
      geographyType: BenchmarkGeographyType;
      areaSqm?: number;
    };

export type BenchmarkPeer = {
  id: string;
  label: string;
  geographyType: BenchmarkGeographyType;
  context: BenchmarkComparisonContext;
  observedAt?: string;
  sourceIds: string[];
  sourceVersions: Record<string, string>;
  confidence: Confidence;
  caveats: string[];
  scores: Record<string, number>;
};

export type BenchmarkDataset = {
  schemaVersion: "1.0.0";
  datasetId: string;
  datasetVersion: string;
  status: "illustrative" | "curated";
  label: string;
  preprocessedAt: string;
  sourceIds: string[];
  sourceVersions: Record<string, string>;
  confidence: Confidence;
  caveats: string[];
  peers: BenchmarkPeer[];
};

type BenchmarkRow = {
  kpiId: string;
  label: string;
  value: number | null;
  rank: number | null;
  percentile: number | null;
  peerCount: number;
  confidence: Confidence;
  caveats: string[];
};

type ContextAssessment = {
  comparablePeers: BenchmarkPeer[];
  comparable: boolean;
  status: string;
  caveats: string[];
};

const BENCHMARK_SOURCE_ID = "uca-benchmark-peers";
const DEFAULT_CONTEXT: BenchmarkComparisonContext = {
  type: "radius",
  radiusMeters: 500,
  areaSqm: Math.PI * 500 * 500,
};
const AREA_COMPARABILITY_TOLERANCE = 0.05;

export const benchmarkDataset = validateBenchmarkDataset(benchmarkPeerData);

const BENCHMARK_KPIS = [
  { id: "kpi.local-quality-score", label: "Local Quality Score" },
  { id: "kpi.mobility_access", label: "Mobility Access" },
  { id: "kpi.green_blue_access", label: "Green/Blue Access" },
  { id: "kpi.urban_mix", label: "Urban Mix" },
  { id: "kpi.social_infrastructure", label: "Social Infrastructure" },
  { id: "kpi.tree_canopy", label: "Tree Canopy" },
  { id: "kpi.station_axis", label: "Station Axis" },
] as const;

export function createBenchmarkModule(
  indicators: Indicator[],
  computedAt: string,
  selectedContext: BenchmarkComparisonContext = DEFAULT_CONTEXT,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const assessment = assessBenchmarkContext(selectedContext, benchmarkDataset.peers);
  const datasetStatusLabel = benchmarkDataset.status === "curated" ? "curated" : "illustrative";
  const rows = BENCHMARK_KPIS.map((kpi) =>
    benchmarkRow(
      kpi.id,
      kpi.label,
      readIndicatorNumber(indicators, kpi.id),
      assessment,
    ),
  );
  const localQuality = rows[0];
  const availableRows = rows.filter((row) => row.value !== null);
  const strongest = bestRelativeRow(availableRows);
  const weakest = weakestRelativeRow(availableRows);
  const sourceIds = unique([
    BENCHMARK_SOURCE_ID,
    ...benchmarkDataset.sourceIds,
    ...assessment.comparablePeers.flatMap((peer) => peer.sourceIds),
  ]);
  const contextCaveats = [
    ...benchmarkDataset.caveats,
    ...assessment.caveats,
    "Ranks are descending, where rank 1 is the strongest score among comparable peers plus the selected location.",
  ];
  const sourceVersion = `${benchmarkDataset.schemaVersion}/${benchmarkDataset.datasetVersion}`;

  const peerSetIndicator = createIndicator({
    id: "benchmark.peer-set",
    label: "Benchmark peer dataset",
    scale: "XL",
    value: benchmarkDataset.label,
    method:
      "Loads a schema-versioned local peer dataset and validates its grain, context, provenance, score ranges, and unique peer IDs before use.",
    sourceIds,
    sourceVersion,
    confidence: benchmarkDataset.confidence,
    caveats: contextCaveats,
    computedAt,
  });
  const comparabilityIndicator = createIndicator({
    id: "benchmark.comparability-status",
    label: "Benchmark context comparability",
    scale: "XL",
    value: assessment.status,
    method:
      "Compares the selected observation context with every peer context. Radius, project-area, and administrative contexts are never mixed; radius and area tolerances must also pass.",
    sourceIds,
    sourceVersion,
    confidence: benchmarkDataset.confidence,
    caveats: assessment.caveats,
    computedAt,
  });
  const datasetTimestampIndicator = createIndicator({
    id: "benchmark.dataset-preprocessed-at",
    label: "Benchmark dataset timestamp",
    scale: "XL",
    value: benchmarkDataset.preprocessedAt,
    method:
      "Reports the immutable preprocessing timestamp declared by the versioned benchmark dataset, distinct from this analysis run timestamp.",
    sourceIds,
    sourceVersion,
    confidence: benchmarkDataset.confidence,
    caveats: benchmarkDataset.caveats,
    computedAt,
  });
  const rankIndicator = createIndicator({
    id: "benchmark.local-quality-rank",
    label: "Local Quality peer rank",
    scale: "XL",
    value:
      localQuality.rank === null
        ? null
        : `${localQuality.rank} of ${localQuality.peerCount + 1}`,
    method:
      "Ranks the selected Local Quality Score only against peer scores with a comparable observation context.",
    sourceIds,
    sourceVersion,
    confidence: localQuality.confidence,
    caveats: localQuality.caveats,
    computedAt,
  });
  const percentileIndicator = createIndicator({
    id: "benchmark.local-quality-percentile",
    label: "Local Quality peer percentile",
    scale: "XL",
    value: localQuality.percentile,
    unit: "%",
    method:
      "Percentile is the share of comparable peer scores lower than or equal to the selected Local Quality Score.",
    sourceIds,
    sourceVersion,
    confidence: localQuality.confidence,
    caveats: localQuality.caveats,
    computedAt,
  });
  const strongestIndicator = createIndicator({
    id: "benchmark.strongest-relative-kpi",
    label: "Strongest relative KPI",
    scale: "L",
    value: strongest ? `${strongest.label}: p${strongest.percentile}` : null,
    method:
      "Finds the available KPI family with the highest percentile among context-comparable peers only.",
    sourceIds,
    sourceVersion,
    confidence: strongest?.confidence ?? "low",
    caveats: strongest?.caveats ?? contextCaveats,
    computedAt,
  });
  const weakestIndicator = createIndicator({
    id: "benchmark.weakest-relative-kpi",
    label: "Weakest relative KPI",
    scale: "L",
    value: weakest ? `${weakest.label}: p${weakest.percentile}` : null,
    method:
      "Finds the available KPI family with the lowest percentile among context-comparable peers only.",
    sourceIds,
    sourceVersion,
    confidence: weakest?.confidence ?? "low",
    caveats: weakest?.caveats ?? contextCaveats,
    computedAt,
  });
  const profileIndicators = rows.map((row) =>
    createIndicator({
      id: `benchmark.${row.kpiId.replace(/^kpi\./, "").replaceAll("_", "-")}-percentile`,
      label: `${row.label} peer percentile`,
      scale: "L",
      value: row.percentile,
      unit: "%",
      method:
        "KPI percentile against context-comparable peers. Missing KPI evidence or a non-comparable context suppresses the result.",
      sourceIds,
      sourceVersion,
      confidence: row.confidence,
      caveats: row.caveats,
      computedAt,
    }),
  );
  const benchmarkIndicators = [
    peerSetIndicator,
    comparabilityIndicator,
    datasetTimestampIndicator,
    rankIndicator,
    percentileIndicator,
    strongestIndicator,
    weakestIndicator,
    ...profileIndicators,
  ];

  return {
    indicators: benchmarkIndicators,
    modules: [
      {
        id: "xl.benchmark-summary",
        title: `${datasetStatusLabel === "curated" ? "Curated" : "Illustrative"} peer comparison`,
        scale: "XL",
        indicators: [
          peerSetIndicator,
          comparabilityIndicator,
          datasetTimestampIndicator,
          rankIndicator,
          percentileIndicator,
        ],
        method:
          "Validates a versioned peer dataset and emits comparison results only when the selected and peer observation contexts are comparable.",
        sourceIds,
        computedAt,
        confidence: benchmarkDataset.confidence,
        caveats: contextCaveats,
      },
      {
        id: "l.benchmark-kpi-profile",
        title: "KPI benchmark profile",
        scale: "L",
        indicators: [strongestIndicator, weakestIndicator, ...profileIndicators],
        method:
          "Shows strongest and weakest KPI families plus one percentile per KPI only for context-comparable peers.",
        sourceIds,
        computedAt,
        confidence: benchmarkDataset.confidence,
        caveats: contextCaveats,
      },
    ],
  };
}

export function assessBenchmarkContext(
  selected: BenchmarkComparisonContext,
  peers: BenchmarkPeer[],
): ContextAssessment {
  const comparablePeers = peers.filter((peer) =>
    contextsAreComparable(selected, peer.context),
  );
  if (!comparablePeers.length) {
    const peerTypes = unique(peers.map((peer) => contextLabel(peer.context))).join(", ") || "none";
    const reason = `Suppressed: selected ${contextLabel(selected)} is not comparable to available peer context(s): ${peerTypes}.`;
    return {
      comparablePeers,
      comparable: false,
      status: reason,
      caveats: [
        reason,
        "No rank, percentile, strongest KPI, or weakest KPI is emitted for a non-comparable context.",
      ],
    };
  }
  const excludedCount = peers.length - comparablePeers.length;
  const status = `Comparable: ${comparablePeers.length} peer(s) match selected ${contextLabel(selected)}${excludedCount ? `; ${excludedCount} peer(s) excluded` : ""}.`;
  return {
    comparablePeers,
    comparable: true,
    status,
    caveats: [
      status,
      "Geography labels describe peer locations; ranking grain is controlled by the explicit comparison context.",
    ],
  };
}

export function contextsAreComparable(
  selected: BenchmarkComparisonContext,
  peer: BenchmarkComparisonContext,
): boolean {
  if (selected.type !== peer.type) return false;
  if (selected.type === "radius" && peer.type === "radius") {
    return Math.abs(selected.radiusMeters - peer.radiusMeters) <= 1;
  }
  if (selected.type === "project-area" && peer.type === "project-area") {
    return areasAreComparable(selected.areaSqm, peer.areaSqm);
  }
  if (selected.type === "administrative-area" && peer.type === "administrative-area") {
    if (selected.geographyType !== peer.geographyType) return false;
    if (selected.areaSqm === undefined || peer.areaSqm === undefined) return true;
    return areasAreComparable(selected.areaSqm, peer.areaSqm);
  }
  return false;
}

export function validateBenchmarkDataset(value: unknown): BenchmarkDataset {
  const dataset = asRecord(value, "benchmark dataset");
  assertEqual(dataset.schemaVersion, "1.0.0", "schemaVersion");
  assertOneOf(dataset.status, ["illustrative", "curated"], "status");
  assertNonEmptyString(dataset.datasetId, "datasetId");
  assertNonEmptyString(dataset.datasetVersion, "datasetVersion");
  assertNonEmptyString(dataset.label, "label");
  assertIsoTimestamp(dataset.preprocessedAt, "preprocessedAt");
  assertConfidence(dataset.confidence, "confidence");
  assertStringArray(dataset.sourceIds, "sourceIds", true);
  assertStringRecord(dataset.sourceVersions, "sourceVersions");
  assertSourceVersions(dataset.sourceIds, dataset.sourceVersions, "benchmark dataset");
  assertStringArray(dataset.caveats, "caveats", true);
  if (dataset.status === "illustrative" && dataset.confidence !== "low") {
    throw new Error("Illustrative benchmark datasets must have low confidence.");
  }
  if (!Array.isArray(dataset.peers) || !dataset.peers.length) {
    throw new Error("Benchmark dataset peers must be a non-empty array.");
  }
  const peerIds = new Set<string>();
  for (const [index, rawPeer] of dataset.peers.entries()) {
    const peer = asRecord(rawPeer, `peers[${index}]`);
    assertNonEmptyString(peer.id, `peers[${index}].id`);
    if (peerIds.has(peer.id)) throw new Error(`Duplicate benchmark peer id: ${peer.id}`);
    peerIds.add(peer.id);
    assertNonEmptyString(peer.label, `peers[${index}].label`);
    assertOneOf(
      peer.geographyType,
      ["district", "city", "municipality", "fua"],
      `peers[${index}].geographyType`,
    );
    validateContext(peer.context, `peers[${index}].context`);
    if (dataset.status === "curated" || peer.observedAt !== undefined) {
      assertIsoTimestamp(peer.observedAt, `peers[${index}].observedAt`);
      if (Date.parse(peer.observedAt as string) > Date.parse(dataset.preprocessedAt as string)) {
        throw new Error(`peers[${index}].observedAt cannot be later than preprocessedAt.`);
      }
    }
    assertStringArray(peer.sourceIds, `peers[${index}].sourceIds`, true);
    assertStringRecord(peer.sourceVersions, `peers[${index}].sourceVersions`);
    assertSourceVersions(
      peer.sourceIds,
      peer.sourceVersions,
      `peers[${index}]`,
    );
    assertConfidence(peer.confidence, `peers[${index}].confidence`);
    assertStringArray(peer.caveats, `peers[${index}].caveats`, true);
    const scores = asRecord(peer.scores, `peers[${index}].scores`);
    if (!Object.keys(scores).length) throw new Error(`peers[${index}].scores is empty.`);
    for (const [id, score] of Object.entries(scores)) {
      if (!id.startsWith("kpi.") || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
        throw new Error(`Invalid benchmark score ${id}=${String(score)} for peer ${peer.id}.`);
      }
    }
  }
  return value as BenchmarkDataset;
}

function benchmarkRow(
  kpiId: string,
  label: string,
  value: number | null,
  assessment: ContextAssessment,
): BenchmarkRow {
  const peerValues = assessment.comparablePeers
    .map((peer) => peer.scores[kpiId])
    .filter((score): score is number => Number.isFinite(score));
  if (!assessment.comparable) {
    return {
      kpiId,
      label,
      value,
      rank: null,
      percentile: null,
      peerCount: 0,
      confidence: "low",
      caveats: assessment.caveats,
    };
  }
  if (value === null || !peerValues.length) {
    return {
      kpiId,
      label,
      value,
      rank: null,
      percentile: null,
      peerCount: peerValues.length,
      confidence: "low",
      caveats: [
        `Selected ${label} score is unavailable or no comparable peer values exist for this KPI.`,
        ...assessment.caveats,
      ],
    };
  }
  const allValues = [...peerValues, value].sort((left, right) => right - left);
  const rank = allValues.findIndex((score) => score <= value) + 1;
  const lowerOrEqual = peerValues.filter((score) => score <= value).length;
  const percentile = Math.round((lowerOrEqual / peerValues.length) * 100);
  return {
    kpiId,
    label,
    value,
    rank,
    percentile,
    peerCount: peerValues.length,
    confidence: benchmarkDataset.confidence,
    caveats: [
      `${label} compared against ${peerValues.length} context-compatible ${benchmarkDataset.status} peer value(s).`,
      `Selected value ${value} ranks ${rank} of ${peerValues.length + 1}, including the selected location.`,
      ...assessment.caveats,
    ],
  };
}

function bestRelativeRow(rows: BenchmarkRow[]): BenchmarkRow | null {
  return rows
    .filter((row) => row.percentile !== null)
    .sort((left, right) => (right.percentile ?? -1) - (left.percentile ?? -1))[0] ?? null;
}

function weakestRelativeRow(rows: BenchmarkRow[]): BenchmarkRow | null {
  return rows
    .filter((row) => row.percentile !== null)
    .sort((left, right) => (left.percentile ?? 101) - (right.percentile ?? 101))[0] ?? null;
}

function readIndicatorNumber(indicators: Indicator[], id: string): number | null {
  const value = indicators.find((indicator) => indicator.id === id)?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function areasAreComparable(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) / Math.max(left, right) <= AREA_COMPARABILITY_TOLERANCE;
}

function contextLabel(context: BenchmarkComparisonContext): string {
  if (context.type === "radius") return `${Math.round(context.radiusMeters)} m radius`;
  if (context.type === "project-area") return `project-area context (${Math.round(context.areaSqm)} m²)`;
  return `${context.geographyType} administrative area`;
}

function validateContext(value: unknown, path: string): void {
  const context = asRecord(value, path);
  assertOneOf(context.type, ["radius", "project-area", "administrative-area"], `${path}.type`);
  if (context.type === "radius") assertPositiveNumber(context.radiusMeters, `${path}.radiusMeters`);
  if (context.type === "project-area") assertPositiveNumber(context.areaSqm, `${path}.areaSqm`);
  if (context.type === "administrative-area") {
    assertOneOf(context.geographyType, ["district", "city", "municipality", "fua"], `${path}.geographyType`);
  }
  if (context.areaSqm !== undefined) assertPositiveNumber(context.areaSqm, `${path}.areaSqm`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string.`);
}

function assertIsoTimestamp(value: unknown, path: string): void {
  assertNonEmptyString(value, path);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${path} must be an ISO timestamp.`);
}

function assertConfidence(value: unknown, path: string): void {
  assertOneOf(value, ["high", "medium", "low"], path);
}

function assertOneOf(value: unknown, allowed: readonly string[], path: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}.`);
  }
}

function assertEqual(value: unknown, expected: string, path: string): void {
  if (value !== expected) throw new Error(`${path} must equal ${expected}.`);
}

function assertStringArray(value: unknown, path: string, requireValues: boolean): void {
  if (!Array.isArray(value) || (requireValues && !value.length) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${path} must be ${requireValues ? "a non-empty " : "an "}array of strings.`);
  }
}

function assertStringRecord(value: unknown, path: string): void {
  const record = asRecord(value, path);
  if (!Object.keys(record).length || Object.values(record).some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${path} must contain string source versions.`);
  }
}

function assertSourceVersions(sourceIds: unknown, versions: unknown, path: string): void {
  if (!Array.isArray(sourceIds)) return;
  const versionRecord = asRecord(versions, `${path}.sourceVersions`);
  for (const sourceId of sourceIds) {
    if (typeof sourceId === "string" && typeof versionRecord[sourceId] !== "string") {
      throw new Error(`${path}.sourceVersions is missing ${sourceId}.`);
    }
  }
}

function assertPositiveNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive finite number.`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
