import { sourceRegistry } from "../../lib/data/sourceRegistry";
import type { AnalysisResult, DataSource, Indicator, Scale } from "../../lib/types";

type EvidenceDatum = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  unit?: string;
  max: number;
  color: string;
  sourceIds: string[];
};

type SourceDatum = {
  id: string;
  label: string;
  status: string;
  value: number;
  displayValue: string;
  color: string;
};

export function AnalysisCharts({
  analysis,
  activeScale,
}: {
  analysis: AnalysisResult;
  activeScale: Scale;
}) {
  const evidence = createEvidenceData(analysis, activeScale);
  const sources = createSourceData(analysis, activeScale, evidence);

  if (!evidence.length && !sources.length) {
    return null;
  }

  return (
    <section className="analysis-charts" aria-label="Compact visual evidence">
      <div className="module-title">
        <h3>Evidence overview</h3>
        <span className="confidence">{activeScale}</span>
      </div>
      <div className="evidence-overview-grid">
        {evidence.length ? (
          <MetricEvidenceCards
            title={chartTitleForScale(activeScale)}
            description={chartDescriptionForScale(activeScale)}
            data={evidence}
          />
        ) : null}
        {sources.length ? (
          <SourceEvidenceList
            title="Datenbezug"
            description="Nur Quellen mit geladenen Features oder direktem Bezug zu den dargestellten Kennwerten."
            data={sources}
          />
        ) : null}
      </div>
    </section>
  );
}

function MetricEvidenceCards({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: EvidenceDatum[];
}) {
  return (
    <figure className="evidence-card-frame">
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <div className="metric-card-grid">
        {data.map((item) => (
          <article className="metric-card" key={item.id}>
            <span>{item.label}</span>
            <strong>{item.displayValue}</strong>
            <i style={{ backgroundColor: item.color, width: `${Math.max(6, Math.min(100, (item.value / item.max) * 100))}%` }} />
          </article>
        ))}
      </div>
    </figure>
  );
}

function SourceEvidenceList({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: SourceDatum[];
}) {
  const maxValue = Math.max(1, ...data.map((item) => item.value));
  return (
    <figure className="evidence-card-frame">
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <div className="source-evidence-list">
        {data.map((item) => (
          <article className="source-evidence-row" key={item.id}>
            <i style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
            <b>{item.displayValue}</b>
            <em style={{ width: `${Math.max(4, Math.min(100, (item.value / maxValue) * 100))}%`, backgroundColor: item.color }} />
          </article>
        ))}
      </div>
    </figure>
  );
}

function createEvidenceData(analysis: AnalysisResult, activeScale: Scale): EvidenceDatum[] {
  const indicators = analysis.indicators.filter((indicator) => indicator.scale === activeScale);
  if (activeScale === "XL") {
    return [
      evidenceFromIndicator(indicators, "xl.population-density", 15_000),
      evidenceFromIndicator(indicators, "xl.median-age", 75),
      evidenceFromIndicator(indicators, "xl.median-rent", 30),
      evidenceFromIndicator(indicators, "xl.rent-index", 160),
      evidenceFromIndicator(indicators, "xl.zensus-grid-average", 100),
      ...zensusWmsEvidence(indicators),
    ].filter((item): item is EvidenceDatum => item !== null);
  }
  if (activeScale === "L") {
    return [
      evidenceFromIndicator(indicators, "l.green-percentage", 100),
      evidenceFromIndicator(indicators, "l.land-use-mix", 1),
      evidenceFromIndicator(indicators, "l.transit-stops", 30),
      evidenceFromIndicator(indicators, "l.transit-stop-density", 80),
      evidenceFromIndicator(indicators, "l.transit-lines", 20),
      evidenceFromIndicator(indicators, "l.multimodal-reachability-score", 100),
      evidenceFromIndicator(indicators, "l.walking-reachability-score", 100),
      evidenceFromIndicator(indicators, "l.cycling-reachability-score", 100),
      evidenceFromIndicator(indicators, "l.transit-reachability-score", 100),
      evidenceFromIndicator(indicators, "l.driving-reachability-score", 100),
      evidenceFromIndicator(indicators, "l.active-poi-reachability-score", 100),
      evidenceFromIndicator(indicators, "l.mobility-score", 100),
      evidenceFromIndicator(indicators, "l.social-civic-pois", 80),
      evidenceFromIndicator(indicators, "l.mobility-infrastructure", 80),
    ].filter((item): item is EvidenceDatum => item !== null);
  }
  return [
    evidenceFromIndicator(indicators, "m.street-width", 30),
    evidenceFromIndicator(indicators, "m.tree-presence", 80),
    evidenceFromIndicator(indicators, "m.building-height", 60),
    evidenceFromIndicator(indicators, "m.section-line", 120),
  ].filter((item): item is EvidenceDatum => item !== null);
}

function evidenceFromIndicator(
  indicators: Indicator[],
  id: string,
  max: number,
): EvidenceDatum | null {
  const indicator = indicators.find((item) => item.id === id);
  if (!indicator) return null;
  const value = numericIndicatorValue(indicator);
  if (value === null) return null;
  return {
    id: indicator.id,
    label: compactLabel(indicator.label),
    value: Math.max(0, value),
    displayValue: formatValue(value, indicator.unit),
    unit: indicator.unit,
    max,
    color: confidenceColor(indicator.confidence),
    sourceIds: indicator.sourceIds,
  };
}

function zensusWmsEvidence(indicators: Indicator[]): EvidenceDatum[] {
  return indicators
    .filter((indicator) => indicator.id.startsWith("xl.zensus-wms."))
    .map((indicator) => evidenceFromIndicator([indicator], indicator.id, 100))
    .filter((item): item is EvidenceDatum => item !== null)
    .slice(0, 3);
}

function createSourceData(
  analysis: AnalysisResult,
  activeScale: Scale,
  evidence: EvidenceDatum[],
): SourceDatum[] {
  const evidenceSourceIds = new Set(evidence.flatMap((item) => item.sourceIds));
  const scaleSourceIds = new Set(
    (Object.values(sourceRegistry) as DataSource[])
      .filter((source) => source.scale.includes(activeScale))
      .map((source) => source.id),
  );
  return analysis.provenance.sourceFetches
    .filter(
      (receipt) =>
        evidenceSourceIds.has(receipt.sourceId) ||
        (scaleSourceIds.has(receipt.sourceId) && (receipt.featureCount ?? receipt.recordCount ?? 0) > 0),
    )
    .map((receipt) => {
      const count = receipt.featureCount ?? receipt.recordCount ?? (receipt.status === "ok" ? 1 : 0);
      return {
        id: receipt.sourceId,
        label: compactLabel(receipt.label),
        status: receipt.status,
        value: Math.max(0, count),
        displayValue:
          receipt.featureCount !== undefined
            ? `${formatCompactNumber(receipt.featureCount)} feat.`
            : receipt.recordCount !== undefined
              ? `${formatCompactNumber(receipt.recordCount)} rec.`
              : receipt.status,
        color: sourceStatusColor(receipt.status),
      };
    })
    .slice(0, 6);
}

function numericIndicatorValue(indicator: Indicator): number | null {
  if (typeof indicator.value === "number" && Number.isFinite(indicator.value)) {
    return indicator.value;
  }
  if (typeof indicator.value === "string") {
    const match = indicator.value.match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0].replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatValue(value: number, unit?: string): string {
  const number = formatCompactNumber(value);
  if (!unit || unit === "0-1") return number;
  if (unit === "within radius") return number;
  if (unit === "section length") return `${number} m`;
  return `${number} ${unit}`;
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 100) / 10}k`;
  if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`;
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function compactLabel(label: string): string {
  return label.length > 24 ? `${label.slice(0, 21)}...` : label;
}

function confidenceColor(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "var(--seq-5)";
  if (confidence === "medium") return "var(--seq-6)";
  return "var(--seq-8)";
}

function sourceStatusColor(status: string): string {
  if (status === "ok") return "var(--seq-5)";
  if (status === "cached") return "var(--seq-4)";
  if (status === "failed") return "var(--seq-9)";
  if (status === "missing") return "var(--seq-6)";
  return "var(--muted)";
}

function chartTitleForScale(activeScale: Scale): string {
  if (activeScale === "XL") return "XL Strukturwerte";
  if (activeScale === "L") return "L Umfeld-Evidenz";
  return "M Strassenraum-Evidenz";
}

function chartDescriptionForScale(activeScale: Scale): string {
  if (activeScale === "XL") {
    return "Nur numerische CSV-/Zensuswerte mit realem Treffer; keine generischen Vergleichsbalken.";
  }
  if (activeScale === "L") {
    return "Flächen-, Erreichbarkeits- und POI-Werte aus Urban Atlas, GTFS und Live-OSM.";
  }
  return "Nur gemessene oder geladene Korridorwerte aus Street, Building, Tree und Section.";
}
