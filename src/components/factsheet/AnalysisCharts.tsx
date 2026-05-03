import { useEffect, useMemo, useRef, useState } from "react";
import { sourceRegistry } from "../../lib/data/sourceRegistry";
import type { AnalysisResult, DataSource, Indicator, Scale } from "../../lib/types";

type PlotlyModule = typeof import("plotly.js-dist-min").default;

const PLOTLY_CONFIG = {
  displayModeBar: false,
  responsive: true,
  staticPlot: false,
};

export function AnalysisCharts({
  analysis,
  activeScale,
}: {
  analysis: AnalysisResult;
  activeScale: Scale;
}) {
  const numericRef = useRef<HTMLDivElement | null>(null);
  const confidenceRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const plotlyRef = useRef<PlotlyModule | null>(null);
  const renderIdRef = useRef(0);
  const observedWidthRef = useRef(0);
  const [themeKey, setThemeKey] = useState(0);
  const chartModel = useMemo(
    () => createChartModel(analysis, activeScale),
    [analysis, activeScale],
  );

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeKey((current) => current + 1));
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const width = chartWidth(numericRef.current ?? confidenceRef.current ?? sourceRef.current);
      if (Math.abs(width - observedWidthRef.current) < 2) return;
      observedWidthRef.current = width;
      setThemeKey((current) => current + 1);
    });
    for (const element of [
      numericRef.current,
      confidenceRef.current,
      sourceRef.current,
    ]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const renderId = renderIdRef.current + 1;
    renderIdRef.current = renderId;
    const plotElements = [
      numericRef.current,
      confidenceRef.current,
      sourceRef.current,
    ].filter((element): element is HTMLDivElement => element !== null);

    async function renderCharts() {
      const module = await import("plotly.js-dist-min");
      if (cancelled || renderIdRef.current !== renderId) return;
      const plotly = module.default as PlotlyModule;
      plotlyRef.current = plotly;
      const theme = readPlotTheme();
      const baseLayout = createBaseLayout(theme);

      if (numericRef.current) {
        const width = chartWidth(numericRef.current);
        await plotly.react(
          numericRef.current,
          chartModel.numeric.values.length
            ? [
                {
                  type: "bar",
                  orientation: "h",
                  x: chartModel.numeric.values,
                  y: chartModel.numeric.labels,
                  marker: { color: chartModel.numeric.colors },
                  hovertemplate: "%{y}<br>%{x}<extra></extra>",
                },
              ]
            : [],
          {
            ...baseLayout,
            width,
            height: 210,
            title: { text: "Numerische Indikatoren", font: { size: 12 } },
            xaxis: {
              gridcolor: theme.grid,
              zerolinecolor: theme.border,
              tickfont: { color: theme.muted },
            },
            yaxis: {
              automargin: true,
              tickfont: { color: theme.ink, size: 10 },
            },
            annotations: chartModel.numeric.values.length
              ? []
              : [emptyAnnotation("Keine numerischen Werte fuer diese Ebene", theme)],
          },
          PLOTLY_CONFIG,
        );
        await plotly.Plots.resize(numericRef.current);
      }

      if (confidenceRef.current) {
        const width = chartWidth(confidenceRef.current);
        await plotly.react(
          confidenceRef.current,
          [
            {
              type: "pie",
              labels: chartModel.confidence.labels,
              values: chartModel.confidence.values,
              hole: 0.58,
              marker: { colors: chartModel.confidence.colors },
              textinfo: "label+value",
              hovertemplate: "%{label}: %{value}<extra></extra>",
            },
          ],
          {
            ...baseLayout,
            width,
            height: 190,
            title: { text: "Konfidenz", font: { size: 12 } },
            showlegend: false,
          },
          PLOTLY_CONFIG,
        );
        await plotly.Plots.resize(confidenceRef.current);
      }

      if (sourceRef.current) {
        const width = chartWidth(sourceRef.current);
        await plotly.react(
          sourceRef.current,
          [
            {
              type: "bar",
              x: chartModel.source.labels,
              y: chartModel.source.values,
              marker: { color: chartModel.source.colors },
              hovertemplate: "%{x}: %{y}<extra></extra>",
            },
          ],
          {
            ...baseLayout,
            width,
            height: 190,
            title: { text: "Quellenstatus", font: { size: 12 } },
            xaxis: {
              gridcolor: theme.grid,
              tickfont: { color: theme.muted, size: 10 },
            },
            yaxis: {
              gridcolor: theme.grid,
              zerolinecolor: theme.border,
              tickfont: { color: theme.muted },
              rangemode: "tozero",
            },
          },
          PLOTLY_CONFIG,
        );
        await plotly.Plots.resize(sourceRef.current);
      }
    }

    renderCharts();

    return () => {
      cancelled = true;
      queueMicrotask(() => {
        if (renderIdRef.current !== renderId) return;
        const plotly = plotlyRef.current;
        if (!plotly) return;
        for (const element of plotElements) plotly.purge(element);
      });
    };
  }, [chartModel, themeKey]);

  return (
    <section className="analysis-charts" aria-label="Plotly analysis charts">
      <div className="module-title">
        <h3>Grafische Auswertung</h3>
        <span className="confidence">{activeScale}</span>
      </div>
      <div className="plotly-stack">
        <div className="plotly-frame">
          <div ref={numericRef} className="plotly-panel" />
          <ChartSnapshot
            title="Numerische Indikatoren"
            labels={chartModel.numeric.labels}
            values={chartModel.numeric.values}
            colors={chartModel.numeric.colors}
            orientation="horizontal"
          />
        </div>
        <div className="plotly-frame">
          <div ref={confidenceRef} className="plotly-panel" />
          <ChartSnapshot
            title="Konfidenz"
            labels={chartModel.confidence.labels}
            values={chartModel.confidence.values}
            colors={chartModel.confidence.colors}
            orientation="vertical"
          />
        </div>
        <div className="plotly-frame">
          <div ref={sourceRef} className="plotly-panel" />
          <ChartSnapshot
            title="Quellenstatus"
            labels={chartModel.source.labels}
            values={chartModel.source.values}
            colors={chartModel.source.colors}
            orientation="vertical"
          />
        </div>
      </div>
    </section>
  );
}

function ChartSnapshot({
  title,
  labels,
  values,
  colors,
  orientation,
}: {
  title: string;
  labels: string[];
  values: number[];
  colors: string[];
  orientation: "horizontal" | "vertical";
}) {
  const maxValue = Math.max(1, ...values);
  return (
    <svg
      className="chart-snapshot"
      viewBox="0 0 360 200"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <text className="chart-title" x="12" y="22">
        {title}
      </text>
      {orientation === "horizontal"
        ? labels.map((label, index) => {
            const y = 44 + index * 22;
            const width = Math.max(2, (values[index] / maxValue) * 168);
            return (
              <g key={`${label}-${index}`}>
                <text className="chart-label" x="12" y={y + 12}>
                  {label}
                </text>
                <rect
                  x="178"
                  y={y}
                  width={width}
                  height="14"
                  fill={colors[index] ?? "#ffffff"}
                />
                <text className="chart-value" x={184 + width} y={y + 12}>
                  {formatChartValue(values[index])}
                </text>
              </g>
            );
          })
        : labels.map((label, index) => {
            const slot = 320 / Math.max(1, labels.length);
            const barWidth = Math.min(44, slot * 0.5);
            const x = 24 + index * slot + (slot - barWidth) / 2;
            const height = Math.max(2, (values[index] / maxValue) * 104);
            return (
              <g key={`${label}-${index}`}>
                <rect
                  x={x}
                  y={152 - height}
                  width={barWidth}
                  height={height}
                  fill={colors[index] ?? "#ffffff"}
                />
                <text className="chart-value" x={x + barWidth / 2} y={140 - height}>
                  {formatChartValue(values[index])}
                </text>
                <text className="chart-label" x={x + barWidth / 2} y="176">
                  {label}
                </text>
              </g>
            );
          })}
    </svg>
  );
}

function formatChartValue(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`;
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

function createChartModel(analysis: AnalysisResult, activeScale: Scale) {
  const indicators = analysis.indicators.filter(
    (indicator) => indicator.scale === activeScale,
  );
  const numericIndicators = indicators
    .filter((indicator): indicator is Indicator & { value: number } =>
      typeof indicator.value === "number" && Number.isFinite(indicator.value),
    )
    .slice(0, 8)
    .reverse();
  const sourceIdsForScale = new Set(
    (Object.values(sourceRegistry) as DataSource[])
      .filter((source) => source.scale.includes(activeScale))
      .map((source) => source.id),
  );
  const receiptsForScale = analysis.provenance.sourceFetches.filter((receipt) =>
    sourceIdsForScale.has(receipt.sourceId),
  );

  return {
    numeric: {
      labels: numericIndicators.map((indicator) => shortLabel(indicator.label)),
      values: numericIndicators.map((indicator) => indicator.value),
      colors: numericIndicators.map((indicator) =>
        confidenceColor(indicator.confidence),
      ),
    },
    confidence: countValues(indicators.map((indicator) => indicator.confidence), [
      "high",
      "medium",
      "low",
    ]).withColorMap({
      high: confidenceColor("high"),
      medium: confidenceColor("medium"),
      low: confidenceColor("low"),
    }),
    source: countValues(receiptsForScale.map((receipt) => receipt.status), [
      "ok",
      "cached",
      "missing",
      "failed",
      "skipped",
    ]).withColorMap({
      ok: "#31d158",
      cached: "#93c5fd",
      missing: "#facc15",
      failed: "#ef4444",
      skipped: "#b3b3b3",
    }),
  };
}

function countValues(values: string[], order: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const labels = order.filter((value) => counts.has(value));
  const finalLabels = labels.length ? labels : ["none"];
  const finalValues = labels.length ? labels.map((value) => counts.get(value) ?? 0) : [0];

  return {
    labels: finalLabels,
    values: finalValues,
    withColorMap(colors: Record<string, string>) {
      return {
        labels: finalLabels,
        values: finalValues,
        colors: labels.length
          ? finalLabels.map((label) => colors[label] ?? "#3a3a3a")
          : ["#3a3a3a"],
      };
    },
  };
}

function readPlotTheme() {
  const style = getComputedStyle(document.body);
  return {
    surface: style.getPropertyValue("--surface-2").trim() || "#0f0f0f",
    paper: style.getPropertyValue("--surface").trim() || "#000000",
    ink: style.getPropertyValue("--ink").trim() || "#ffffff",
    muted: style.getPropertyValue("--muted").trim() || "#b3b3b3",
    border: style.getPropertyValue("--border").trim() || "#3a3a3a",
    grid: style.getPropertyValue("--border").trim() || "#3a3a3a",
    font: style.getPropertyValue("--font-mono").trim() || "monospace",
  };
}

function createBaseLayout(theme: ReturnType<typeof readPlotTheme>) {
  return {
    autosize: true,
    paper_bgcolor: theme.paper,
    plot_bgcolor: theme.surface,
    margin: { l: 12, r: 12, t: 34, b: 28 },
    font: { family: theme.font, color: theme.ink, size: 11 },
    title: { font: { color: theme.ink, size: 12 } },
    hoverlabel: {
      bgcolor: theme.paper,
      bordercolor: theme.border,
      font: { family: theme.font, color: theme.ink, size: 11 },
    },
  };
}

function chartWidth(element: HTMLElement | null): number {
  return Math.max(280, Math.floor(element?.clientWidth || 320));
}

function emptyAnnotation(text: string, theme: ReturnType<typeof readPlotTheme>) {
  return {
    text,
    showarrow: false,
    xref: "paper",
    yref: "paper",
    x: 0.5,
    y: 0.5,
    font: { color: theme.muted, size: 11 },
  };
}

function confidenceColor(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "#31d158";
  if (confidence === "medium") return "#facc15";
  return "#ef4444";
}

function shortLabel(label: string): string {
  return label.length > 26 ? `${label.slice(0, 23)}...` : label;
}
