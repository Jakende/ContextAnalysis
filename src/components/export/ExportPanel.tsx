import { analysisToGpkgBlob } from "../../lib/export/gpkg";
import { downloadBlob, downloadText, safeFilename } from "../../lib/export/download";
import {
  analysisToCsv,
  analysisToGeoJson,
  analysisToHtml,
  analysisToJson,
  analysisToMarkdown,
  analysisToProvenanceJson,
} from "../../lib/export/serializers";
import { analysisToSvg, svgToPngBlob } from "../../lib/export/svg";
import { generateOllamaReport } from "../../lib/ollama/client";
import type { AnalysisResult } from "../../lib/types";

export function ExportPanel({
  analysis,
  sectionSvg,
  onStatus,
  }: {
  analysis: AnalysisResult | null;
  sectionSvg: string;
  onStatus: (status: string) => void;
}) {
  if (!analysis) {
    return null;
  }

  const baseName = analysis
    ? safeFilename(
        `sd-stadtdaten-${analysis.selectedPoint.lat.toFixed(5)}-${analysis.selectedPoint.lon.toFixed(5)}`,
      )
    : "sd-stadtdaten-analysis";

  async function runExport(kind: string) {
    if (!analysis) return;
    try {
      onStatus(`Exporting ${kind}...`);
      if (kind === "json") {
        downloadText(analysisToJson(analysis), `${baseName}.json`, "application/json");
      }
      if (kind === "provenance") {
        downloadText(
          analysisToProvenanceJson(analysis),
          `${baseName}-provenance.json`,
          "application/json",
        );
      }
      if (kind === "csv") {
        downloadText(analysisToCsv(analysis), `${baseName}.csv`, "text/csv");
      }
      if (kind === "geojson") {
        downloadText(analysisToGeoJson(analysis), `${baseName}.geojson`, "application/geo+json");
      }
      if (kind === "svg") {
        downloadText(analysisToSvg(analysis, sectionSvg), `${baseName}.svg`, "image/svg+xml");
      }
      if (kind === "section-svg") {
        downloadText(sectionSvg, `${baseName}-section.svg`, "image/svg+xml");
      }
      if (kind === "png") {
        downloadBlob(await svgToPngBlob(analysisToSvg(analysis, sectionSvg)), `${baseName}.png`);
      }
      if (kind === "gpkg") {
        downloadBlob(await analysisToGpkgBlob(analysis), `${baseName}.gpkg`);
      }
      if (kind === "markdown") {
        downloadText(analysisToMarkdown(analysis), `${baseName}.md`, "text/markdown");
      }
      if (kind === "html") {
        downloadText(analysisToHtml(analysis), `${baseName}.html`, "text/html");
      }
      if (kind === "ollama") {
        const report = await generateOllamaReport(analysis);
        downloadText(report.markdown, `${baseName}-ollama-report.md`, "text/markdown");
        if (report.status === "unavailable") {
          onStatus(`Ollama unavailable; deterministic report exported. ${report.error}`);
          return;
        }
        if (report.status === "fallback") {
          onStatus(report.error ?? "Ollama report empty; deterministic report exported.");
          return;
        }
      }
      onStatus(`${kind.toUpperCase()} export ready.`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const primaryExports = [
    ["json", "JSON"],
    ["svg", "SVG map"],
    ["png", "PNG"],
    ["ollama", "Ollama report"],
  ] as const;

  const secondaryExports = [
    ["csv", "CSV"],
    ["provenance", "Provenance JSON"],
    ["geojson", "GeoJSON"],
    ["gpkg", "GPKG"],
    ["markdown", "Markdown"],
    ["html", "HTML"],
    ...(sectionSvg ? ([["section-svg", "SVG section"]] as const) : []),
  ] as const;

  return (
    <section className="export-panel panel" aria-label="Exports">
      <div className="panel-heading">
        <span className="label">Exports</span>
        <span className="export-status">Ready</span>
      </div>
      <div className="export-primary-row">
        {primaryExports.map(([kind, label]) => (
          <button type="button" key={kind} onClick={() => void runExport(kind)}>
            {label}
          </button>
        ))}
      </div>
      <details className="export-secondary">
        <summary>More exports</summary>
        <div className="export-grid">
          {secondaryExports.map(([kind, label]) => (
            <button type="button" key={kind} onClick={() => void runExport(kind)}>
              {label}
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
