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
import { createZipBlob } from "../../lib/export/zip";
import { generateOllamaReport } from "../../lib/ollama/client";
import type { AnalysisPhase, AnalysisResult } from "../../lib/types";

export function ExportPanel({
  analysis,
  analysisPhase,
  sectionSvg,
  onStatus,
  }: {
  analysis: AnalysisResult | null;
  analysisPhase: AnalysisPhase;
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
      if (kind === "zip") {
        const svg = analysisToSvg(analysis, sectionSvg);
        downloadBlob(
          await createZipBlob([
            { name: "analysis.json", content: analysisToJson(analysis), mediaType: "application/json" },
            { name: "analysis.geojson", content: analysisToGeoJson(analysis), mediaType: "application/geo+json" },
            { name: "analysis.svg", content: svg, mediaType: "image/svg+xml" },
            { name: "analysis.png", content: await svgToPngBlob(svg), mediaType: "image/png" },
            { name: "report.md", content: analysisToMarkdown(analysis), mediaType: "text/markdown" },
            { name: "provenance.json", content: analysisToProvenanceJson(analysis), mediaType: "application/json" },
          ]),
          `${baseName}-package.zip`,
        );
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
    ["zip", "ZIP package"],
    ["gpkg", "GPKG"],
    ["markdown", "Markdown"],
    ["html", "HTML"],
    ...(sectionSvg ? ([["section-svg", "SVG section"]] as const) : []),
  ] as const;
  const exportGroups: Array<{
    title: string;
    description: string;
    items: ReadonlyArray<readonly [string, string]>;
  }> = [
    {
      title: "Core data",
      description: "Structured values and geometries for downstream analysis.",
      items: [
        ["json", "JSON"],
        ["csv", "CSV"],
        ["geojson", "GeoJSON"],
        ["provenance", "Provenance JSON"],
      ],
    },
    {
      title: "Visuals",
      description: "Editable or quick-share graphics from the current analysis.",
      items: [
        ["svg", "SVG map"],
        ["png", "PNG"],
        ...(sectionSvg ? ([["section-svg", "SVG section"]] as const) : []),
      ],
    },
    {
      title: "Package / report",
      description: "Bundled geodata, reproducible reports, and local LLM narration.",
      items: [
        ["zip", "ZIP package"],
        ["gpkg", "GPKG"],
        ["markdown", "Markdown"],
        ["html", "HTML"],
        ["ollama", "Ollama report"],
      ],
    },
  ];

  return (
    <section className="export-panel panel" aria-label="Exports">
      <div className="panel-heading">
        <div>
          <span className="label">Exports</span>
          <strong>Analysis package</strong>
        </div>
        <span className="export-status">{exportStatusLabel(analysisPhase)}</span>
      </div>
      <div className="export-group-list">
        {exportGroups.map((group) => (
          <section className="export-group" key={group.title}>
            <div>
              <strong>{group.title}</strong>
              <span>{group.description}</span>
            </div>
            <div className="export-grid">
              {group.items.map(([kind, label]) => (
                <button type="button" key={kind} onClick={() => void runExport(kind)}>
                  {label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <details className="export-secondary">
        <summary>Flat format list</summary>
        <div className="export-grid">
          {[...primaryExports, ...secondaryExports].map(([kind, label]) => (
            <button type="button" key={kind} onClick={() => void runExport(kind)}>
              {label}
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

function exportStatusLabel(phase: AnalysisPhase): string {
  if (phase === "complete") return "Complete";
  if (phase === "local-ready" || phase === "enhancing") return "Partial / enriching";
  if (phase === "failed") return "Partial";
  return "Ready";
}
