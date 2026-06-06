import type { FactSheetModule, Indicator } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

type BenchmarkPeer = {
  id: string;
  label: string;
  geographyType: "district" | "city";
  peerSet: string;
  sourceIds: string[];
  scores: Record<string, number>;
};

type BenchmarkRow = {
  kpiId: string;
  label: string;
  value: number | null;
  rank: number | null;
  percentile: number | null;
  peerCount: number;
  confidence: "high" | "medium" | "low";
  caveats: string[];
};

const BENCHMARK_SOURCE_ID = "uca-benchmark-peers";

const PEERS: BenchmarkPeer[] = [
  {
    id: "munich-maxvorstadt",
    label: "Munich / Maxvorstadt",
    geographyType: "district",
    peerSet: "Munich district urban quality sample",
    sourceIds: [BENCHMARK_SOURCE_ID, "destatis-genesis"],
    scores: {
      "kpi.local-quality-score": 82,
      "kpi.mobility_access": 88,
      "kpi.green_blue_access": 42,
      "kpi.urban_mix": 86,
      "kpi.social_infrastructure": 92,
      "kpi.tree_canopy": 48,
      "kpi.station_axis": 90,
    },
  },
  {
    id: "munich-schwabing",
    label: "Munich / Schwabing",
    geographyType: "district",
    peerSet: "Munich district urban quality sample",
    sourceIds: [BENCHMARK_SOURCE_ID, "destatis-genesis"],
    scores: {
      "kpi.local-quality-score": 78,
      "kpi.mobility_access": 78,
      "kpi.green_blue_access": 64,
      "kpi.urban_mix": 72,
      "kpi.social_infrastructure": 80,
      "kpi.tree_canopy": 66,
      "kpi.station_axis": 76,
    },
  },
  {
    id: "munich-altstadt-lehel",
    label: "Munich / Altstadt-Lehel",
    geographyType: "district",
    peerSet: "Munich district urban quality sample",
    sourceIds: [BENCHMARK_SOURCE_ID, "destatis-genesis"],
    scores: {
      "kpi.local-quality-score": 84,
      "kpi.mobility_access": 92,
      "kpi.green_blue_access": 52,
      "kpi.urban_mix": 90,
      "kpi.social_infrastructure": 88,
      "kpi.tree_canopy": 54,
      "kpi.station_axis": 94,
    },
  },
  {
    id: "augsburg-inner-city",
    label: "Augsburg / inner-city reference",
    geographyType: "city",
    peerSet: "Bavarian city context sample",
    sourceIds: [BENCHMARK_SOURCE_ID],
    scores: {
      "kpi.local-quality-score": 70,
      "kpi.mobility_access": 70,
      "kpi.green_blue_access": 58,
      "kpi.urban_mix": 68,
      "kpi.social_infrastructure": 72,
      "kpi.tree_canopy": 56,
      "kpi.station_axis": 68,
    },
  },
  {
    id: "rosenheim-center",
    label: "Rosenheim / centre reference",
    geographyType: "city",
    peerSet: "Bavarian city context sample",
    sourceIds: [BENCHMARK_SOURCE_ID],
    scores: {
      "kpi.local-quality-score": 62,
      "kpi.mobility_access": 58,
      "kpi.green_blue_access": 66,
      "kpi.urban_mix": 58,
      "kpi.social_infrastructure": 64,
      "kpi.tree_canopy": 62,
      "kpi.station_axis": 54,
    },
  },
  {
    id: "rural-town-reference",
    label: "Small-town reference",
    geographyType: "city",
    peerSet: "Bavarian city context sample",
    sourceIds: [BENCHMARK_SOURCE_ID],
    scores: {
      "kpi.local-quality-score": 46,
      "kpi.mobility_access": 38,
      "kpi.green_blue_access": 72,
      "kpi.urban_mix": 42,
      "kpi.social_infrastructure": 46,
      "kpi.tree_canopy": 70,
      "kpi.station_axis": 32,
    },
  },
];

const BENCHMARK_KPIS = [
  { id: "kpi.local-quality-score", label: "Local Quality Score" },
  { id: "kpi.mobility_access", label: "Mobility Access" },
  { id: "kpi.green_blue_access", label: "Green/Blue Access" },
  { id: "kpi.urban_mix", label: "Urban Mix" },
  { id: "kpi.social_infrastructure", label: "Social Infrastructure" },
  { id: "kpi.tree_canopy", label: "Tree Canopy" },
  { id: "kpi.station_axis", label: "Station Axis" },
];

export function createBenchmarkModule(
  indicators: Indicator[],
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const rows = BENCHMARK_KPIS.map((kpi) =>
    benchmarkRow(kpi.id, kpi.label, readIndicatorNumber(indicators, kpi.id)),
  );
  const localQuality = rows[0];
  const availableRows = rows.filter((row) => row.value !== null);
  const strongest = bestRelativeRow(availableRows);
  const weakest = weakestRelativeRow(availableRows);
  const sourceIds = [BENCHMARK_SOURCE_ID, "destatis-genesis"];
  const caveats = [
    "Peer comparison uses local static MVP reference values, not a live multi-city statistical benchmark.",
    "Peer values should be replaced by preprocessed district/city comparison tables before production use.",
    "Ranks are descending, where rank 1 is the strongest score in the configured peer set.",
  ];

  const benchmarkIndicators = [
    createIndicator({
      id: "benchmark.peer-set",
      label: "Static peer set",
      scale: "XL",
      value: "Static MVP district / city reference sample",
      method:
        "Selected KPI scores are compared against a deterministic local reference table. This is a placeholder comparison until preprocessed district or city benchmark tables are available.",
      sourceIds,
      confidence: "low",
      caveats,
      computedAt,
    }),
    createIndicator({
      id: "benchmark.local-quality-rank",
      label: "Local Quality peer rank",
      scale: "XL",
      value:
        localQuality.rank === null
          ? null
          : `${localQuality.rank} of ${localQuality.peerCount + 1}`,
      method:
        "Ranks the selected Local Quality Score against static peer-reference scores plus the selected location.",
      sourceIds,
      confidence: localQuality.confidence,
      caveats: localQuality.caveats,
      computedAt,
    }),
    createIndicator({
      id: "benchmark.local-quality-percentile",
      label: "Local Quality peer percentile",
      scale: "XL",
      value: localQuality.percentile,
      unit: "%",
      method:
        "Percentile is the share of configured static peer references with lower or equal Local Quality scores.",
      sourceIds,
      confidence: localQuality.confidence,
      caveats: localQuality.caveats,
      computedAt,
    }),
    createIndicator({
      id: "benchmark.strongest-relative-kpi",
      label: "Strongest relative KPI",
      scale: "L",
      value: strongest ? `${strongest.label}: p${strongest.percentile}` : null,
      method:
        "Finds the available KPI family with the highest benchmark percentile in the configured peer set.",
      sourceIds,
      confidence: strongest?.confidence ?? "low",
      caveats: strongest?.caveats ?? caveats,
      computedAt,
    }),
    createIndicator({
      id: "benchmark.weakest-relative-kpi",
      label: "Weakest relative KPI",
      scale: "L",
      value: weakest ? `${weakest.label}: p${weakest.percentile}` : null,
      method:
        "Finds the available KPI family with the lowest benchmark percentile in the configured peer set.",
      sourceIds,
      confidence: weakest?.confidence ?? "low",
      caveats: weakest?.caveats ?? caveats,
      computedAt,
    }),
    ...rows.map((row) =>
      createIndicator({
        id: `benchmark.${row.kpiId.replace(/^kpi\./, "").replaceAll("_", "-")}-percentile`,
        label: `${row.label} peer percentile`,
        scale: "L",
        value: row.percentile,
        unit: "%",
        method:
          "KPI percentile against the configured static peer-reference set. Missing selected KPI values stay unavailable.",
        sourceIds,
        confidence: row.confidence,
        caveats: row.caveats,
        computedAt,
      }),
    ),
  ];

  return {
    indicators: benchmarkIndicators,
    modules: [
      {
        id: "xl.benchmark-summary",
        title: "Static peer comparison",
        scale: "XL",
        indicators: benchmarkIndicators.slice(0, 3),
        method:
          "Compares the selected location against a static MVP reference table. This is a placeholder peer comparison, not a live multi-city benchmark.",
        sourceIds,
        computedAt,
        confidence: "low",
        caveats,
      },
      {
        id: "l.benchmark-kpi-profile",
        title: "KPI benchmark profile",
        scale: "L",
        indicators: benchmarkIndicators.slice(3),
        method:
          "Shows strongest and weakest KPI families by peer percentile, with one percentile indicator per KPI family.",
        sourceIds,
        computedAt,
        confidence: "low",
        caveats,
      },
    ],
  };
}

function benchmarkRow(
  kpiId: string,
  label: string,
  value: number | null,
): BenchmarkRow {
  const peerValues = PEERS.map((peer) => peer.scores[kpiId])
    .filter((score): score is number => Number.isFinite(score));
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
        `Selected ${label} score is not available or no peer values exist for this KPI.`,
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
    confidence: "low",
    caveats: [
      `${label} compared against ${peerValues.length} configured MVP peer value(s).`,
      `Selected value ${value} ranks ${rank} of ${peerValues.length + 1} including the selected location.`,
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
