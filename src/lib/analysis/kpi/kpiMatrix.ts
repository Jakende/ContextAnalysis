import kpiSchema from "./kpiSchema.json";
import type { Confidence, FactSheetModule, Indicator } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

export type KpiDefinition = {
  id: string;
  name: string;
  category: string;
  status: "context" | "core" | "experimental" | "deferred";
  defaultWeight: number;
  sourceIndicator: string;
  normalization: {
    type: "direct" | "target" | "index";
    target?: number;
    formula: string;
  };
  formula: string;
  thresholds: string[];
};

export type KpiStrategy = {
  id: string;
  name: string;
  description: string;
  weights: Record<string, number>;
  classifications: {
    high: string;
    medium: string;
    low: string;
    minimal: string;
  };
};

type KpiSchema = {
  version: string;
  defaultStrategyId: string;
  definitions: KpiDefinition[];
  strategies: KpiStrategy[];
};

export type KpiScoreRow = {
  definition: KpiDefinition;
  source: Indicator | undefined;
  score: number | null;
  weight: number;
};

export type KpiScoreResult = {
  rows: KpiScoreRow[];
  availableRows: KpiScoreRow[];
  composite: number | null;
  confidence: Confidence;
  classification: string;
  strategy: KpiStrategy;
};

export const kpiModel = kpiSchema as KpiSchema;
export const kpiDefinitions = kpiModel.definitions.filter(
  (definition) => definition.status === "core",
);
export const kpiContextDefinitions = kpiModel.definitions.filter(
  (definition) => definition.status === "context",
);
export const kpiStrategies = kpiModel.strategies;
export const defaultKpiStrategy =
  kpiStrategies.find((strategy) => strategy.id === kpiModel.defaultStrategyId) ??
  kpiStrategies[0];

export function createKpiMatrixModule(
  indicators: Indicator[],
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const scored = scoreKpis(indicators, defaultKpiStrategy);
  const context = calculateXlContext(indicators);
  const sourceIds = [
    ...new Set(scored.availableRows.flatMap((item) => item.source?.sourceIds ?? [])),
  ];
  const caveats = [
    "KPI matrix is a deterministic screening model and not a statutory assessment.",
    "Missing KPI inputs are excluded from the Local Quality Score denominator instead of being imputed.",
    "If fewer than three KPI families are available, classification is evidence-gated to the lowest class.",
    "Default strategy is Balanced Urban Quality; UI presets can recalculate the visible Local Quality Score without changing raw indicators.",
  ];
  const familyIndicators = scored.rows.map((row) =>
    createIndicator({
      id: `kpi.${row.definition.id}`,
      label: row.definition.name,
      scale: "L",
      value: row.score,
      unit: "0-100",
      method: `${row.definition.formula} Normalization: ${row.definition.normalization.formula}.`,
      sourceIds: row.source?.sourceIds ?? [],
      confidence: row.source ? row.source.confidence : "low",
      caveats: [
        ...row.definition.thresholds,
        ...(row.source?.caveats ?? [`Source indicator ${row.definition.sourceIndicator} was not available.`]),
      ],
      computedAt,
    }),
  );
  const kpiIndicators = [
    createIndicator({
      id: "xl.context-score",
      label: "Urban / regional context score",
      scale: "XL",
      value: context.score,
      unit: "0-100",
      method: context.method,
      sourceIds: context.sourceIds,
      confidence: context.confidence,
      caveats: context.caveats,
      computedAt,
    }),
    createIndicator({
      id: "xl.context-class",
      label: "Context class",
      scale: "XL",
      value: context.classification,
      method: "Classified from the separate XL urban/regional context score; this class is not part of the Local Quality Score.",
      sourceIds: context.sourceIds,
      confidence: context.confidence,
      caveats: context.caveats,
      computedAt,
    }),
    ...familyIndicators,
    createIndicator({
      id: "kpi.local-quality-score",
      label: "Local Quality Score",
      scale: "L",
      value: scored.composite,
      unit: "0-100",
      method:
        "Weighted average of normalized local KPI family scores from src/lib/analysis/kpi/kpiSchema.json using the Balanced Urban Quality default strategy. XL context is reported separately.",
      sourceIds,
      confidence: scored.confidence,
      caveats,
      computedAt,
    }),
    createIndicator({
      id: "kpi.local-quality-class",
      label: "Local quality classification",
      scale: "L",
      value: formatClassification(scored.classification, scored.confidence),
      method: classificationMethod(defaultKpiStrategy),
      sourceIds,
      confidence: scored.confidence,
      caveats,
      computedAt,
    }),
  ];

  return {
    indicators: kpiIndicators,
    modules: [
      {
        id: "xl.context-kpi",
        title: "Urban / regional context",
        scale: "XL",
        indicators: kpiIndicators.slice(0, 2),
        method: "Separate context score and class used to distinguish metropolitan, large-city, regional-city, and small-city contexts.",
        sourceIds: context.sourceIds,
        computedAt,
        confidence: context.confidence,
        caveats: context.caveats,
      },
      {
        id: "kpi.matrix",
        title: "Local quality KPI matrix",
        scale: "L",
        indicators: kpiIndicators.slice(2),
        method:
          "Core local KPI family normalization, default strategy weighting, and strategy-specific classification. XL context is intentionally separate.",
        sourceIds,
        computedAt,
        confidence: scored.confidence,
        caveats,
      },
    ],
  };
}

export function scoreKpis(
  indicators: Indicator[],
  strategy: KpiStrategy = defaultKpiStrategy,
  weightOverrides: Record<string, number> = {},
): KpiScoreResult {
  const rows = kpiDefinitions.map((definition) => {
    const source = indicators.find((indicator) => indicator.id === definition.sourceIndicator);
    return {
      definition,
      source,
      score: normalizeKpiScore(definition, source?.value ?? null),
      weight:
        weightOverrides[definition.id] ??
        strategy.weights[definition.id] ??
        definition.defaultWeight,
    };
  });
  const availableRows = rows.filter((row) => row.score !== null && row.weight > 0);
  const weightTotal = availableRows.reduce((total, item) => total + item.weight, 0);
  const composite =
    weightTotal > 0
      ? Math.round(
          availableRows.reduce(
            (total, item) => total + (item.score ?? 0) * item.weight,
            0,
          ) / weightTotal,
        )
      : null;
  const confidence = calculateKpiConfidence(availableRows);
  const evidenceGated = availableRows.length < 3;
  return {
    rows,
    availableRows,
    composite,
    confidence,
    classification: evidenceGated
      ? strategy.classifications.minimal
      : classifyStrategicLocation(composite, strategy),
    strategy,
  };
}

export function normalizeKpiScore(
  definitionOrId: KpiDefinition | string,
  value: Indicator["value"],
): number | null {
  const definition =
    typeof definitionOrId === "string"
      ? kpiModel.definitions.find((item) => item.id === definitionOrId)
      : definitionOrId;
  if (!definition || value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (definition.normalization.type === "target") {
    const target = definition.normalization.target ?? 100;
    return clampScore(Math.round((numeric / target) * 100));
  }
  if (definition.normalization.type === "index") {
    return clampScore(Math.round(numeric * 100));
  }
  return clampScore(Math.round(numeric));
}

export function classifyStrategicLocation(
  score: number | null,
  strategy: KpiStrategy = defaultKpiStrategy,
): string {
  if (score === null) return strategy.classifications.minimal;
  if (score >= 80) return strategy.classifications.high;
  if (score >= 60) return strategy.classifications.medium;
  if (score >= 40) return strategy.classifications.low;
  return strategy.classifications.minimal;
}

export function formatClassification(
  classification: string,
  confidence: Confidence,
): string {
  return confidence === "low" ? `${classification} (Low Confidence)` : classification;
}

export function classificationMethod(strategy: KpiStrategy): string {
  return [
    `Strategy: ${strategy.name}.`,
    `80-100: ${strategy.classifications.high}.`,
    `60-79: ${strategy.classifications.medium}.`,
    `40-59: ${strategy.classifications.low}.`,
    `0-39 or missing: ${strategy.classifications.minimal}.`,
    "Low confidence is appended to the label instead of reducing the score.",
  ].join(" ");
}

export function kpiFormulaLines(strategy: KpiStrategy = defaultKpiStrategy): string[] {
  const lines = [
    `Schema version: ${kpiModel.version}`,
    `Default strategy: ${strategy.name}`,
    "Local Quality Score = round(sum(normalized_family_score * strategy_weight) / sum(strategy_weight for available local family scores)).",
    "Missing KPI family scores are excluded from the denominator.",
    "Urban / Regional Context is reported separately and is not part of the Local Quality Score.",
    "If fewer than three local KPI families are available, the classification is evidence-gated to the lowest class.",
    classificationMethod(strategy),
  ];
  for (const definition of kpiDefinitions) {
    lines.push(
      `${definition.name}: source ${definition.sourceIndicator}; normalization ${definition.normalization.formula}; weight ${strategy.weights[definition.id] ?? definition.defaultWeight}. ${definition.formula}`,
    );
    for (const threshold of definition.thresholds) {
      lines.push(`  Threshold: ${threshold}`);
    }
  }
  return lines;
}

function calculateKpiConfidence(rows: KpiScoreRow[]): Confidence {
  if (rows.length >= 4 && rows.every((row) => row.source?.confidence !== "low")) {
    return "high";
  }
  if (rows.length >= 3) return "medium";
  return "low";
}

function calculateXlContext(indicators: Indicator[]): {
  score: number | null;
  classification: string;
  confidence: Confidence;
  sourceIds: string[];
  method: string;
  caveats: string[];
} {
  const municipality = readIndicatorString(indicators, "xl.municipality");
  const fua = readIndicatorString(indicators, "xl.fua-membership");
  const density = readIndicatorNumber(indicators, "xl.population-density");
  const normalizedMunicipality = municipality.toLowerCase();
  const resolver = resolveKnownMunicipalityContext(normalizedMunicipality);
  const baseScore = resolver?.score ?? scoreFromDensity(density);
  if (baseScore === null) {
    return {
      score: null,
      classification: "Limited regional evidence",
      confidence: "low",
      sourceIds: ["osm-nominatim", "bkg-geobasis", "eurostat-gisco-fua", "destatis-genesis"],
      method: "No reliable municipality, FUA, population, or density context was available for XL context classification.",
      caveats: ["Preprocessed municipality/FUA population context is required for robust city-size benchmarking."],
    };
  }
  const densityBonus = density !== null && density >= 8_000 ? 5 : density !== null && density >= 4_000 ? 3 : 0;
  const fuaBonus = fua && fua !== "nearby FUA only" ? 5 : 0;
  const score = clampScore(baseScore + densityBonus + fuaBonus);
  const caveats = [
    resolver?.caveat ??
      "Context class is derived from available density/FUA evidence because no configured municipality-size resolver matched this municipality.",
    "This XL context score is separate from local neighbourhood quality; a regional city centre can still score high locally.",
  ];
  return {
    score,
    classification: classifyXlContext(score),
    confidence: resolver ? "medium" : density !== null || fua ? "low" : "low",
    sourceIds: ["osm-nominatim", "bkg-geobasis", "eurostat-gisco-fua", "destatis-genesis"],
    method:
      "Resolved known municipality context where configured, then adjusted with available FUA membership and district-density evidence. This is a context benchmark, not a local quality score.",
    caveats,
  };
}

function resolveKnownMunicipalityContext(
  municipality: string,
): { score: number; caveat: string } | null {
  if (/münchen|muenchen|munich/.test(municipality)) {
    return {
      score: 92,
      caveat: "Municipality resolver classifies Munich as a metropolitan core context.",
    };
  }
  if (/nürnberg|nuernberg|nuremberg|augsburg/.test(municipality)) {
    return {
      score: 78,
      caveat: "Municipality resolver classifies this as a large-city context.",
    };
  }
  if (/regensburg|ingolstadt|würzburg|wuerzburg|fürth|fuerth|erlangen|rosenheim/.test(municipality)) {
    return {
      score: 58,
      caveat: "Municipality resolver classifies this as a regional-city context.",
    };
  }
  return null;
}

function scoreFromDensity(density: number | null): number | null {
  if (density === null) return null;
  if (density >= 8_000) return 78;
  if (density >= 4_000) return 62;
  if (density >= 1_500) return 45;
  return 30;
}

function classifyXlContext(score: number): string {
  if (score >= 85) return "Metropolitan core context";
  if (score >= 70) return "Large city context";
  if (score >= 50) return "Regional city context";
  if (score >= 30) return "Small city / town context";
  return "Limited regional evidence";
}

function readIndicatorString(indicators: Indicator[], id: string): string {
  const value = indicators.find((indicator) => indicator.id === id)?.value;
  return typeof value === "string" ? value : "";
}

function readIndicatorNumber(indicators: Indicator[], id: string): number | null {
  const value = indicators.find((indicator) => indicator.id === id)?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}
