import type { Feature, FeatureCollection } from "geojson";
import { getSources } from "../data/sourceRegistry";
import type { AnalysisResult } from "../types";
import { createExportManifest } from "./manifest";

export function analysisToJson(analysis: AnalysisResult): string {
  const manifest = createExportManifest(analysis, [
    {
      name: "analysis.json",
      mediaType: "application/json",
      role: "structured analysis",
    },
  ]);
  return JSON.stringify({ manifest, analysis }, null, 2);
}

export function analysisToCsv(analysis: AnalysisResult): string {
  const headers = [
    "id",
    "scale",
    "label",
    "value",
    "unit",
    "confidence",
    "method",
    "sourceIds",
    "sourceVersion",
    "computedAt",
    "caveats",
  ];
  const rows = analysis.indicators.map((indicator) =>
    [
      indicator.id,
      indicator.scale,
      indicator.label,
      indicator.value ?? "",
      indicator.unit ?? "",
      indicator.confidence,
      indicator.method,
      indicator.sourceIds.join("|"),
      indicator.sourceVersion ?? "",
      indicator.computedAt,
      indicator.caveats.join("|"),
    ].map(csvEscape),
  );
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

export function analysisToGeoJson(analysis: AnalysisResult): string {
  const features: Feature[] = [
    analysis.overlays.selectedPoint,
    ...analysis.overlays.xlContext.features,
    ...analysis.overlays.xlGrid.features,
    ...analysis.overlays.xlSources.features,
    ...analysis.overlays.lBuffer.features,
    ...analysis.overlays.mStreetSegment.features,
    ...analysis.overlays.green.features,
    ...analysis.overlays.trees.features,
    ...analysis.overlays.buildings.features,
    ...analysis.overlays.pois.features,
    ...analysis.overlays.transport.features,
    ...analysis.overlays.mobility.features,
    ...analysis.overlays.barriers.features,
    ...analysis.overlays.development.features,
    ...analysis.overlays.sun.features,
  ].map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties ?? {}),
      exportSource: "SD Stadtdaten structured analysis",
    },
  }));

  const collection: FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  return JSON.stringify(
    {
      name: "sd_stadtdaten_analysis_geometries",
      manifest: createExportManifest(analysis, [
        {
          name: "analysis.geojson",
          mediaType: "application/geo+json",
          role: "analysis geometries",
        },
      ]),
      ...collection,
    },
    null,
    2,
  );
}

export function analysisToMarkdown(analysis: AnalysisResult): string {
  const lines = [
    "# SD Stadtdaten Context Analysis",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Selected point: ${analysis.selectedPoint.lat.toFixed(5)}, ${analysis.selectedPoint.lon.toFixed(5)}`,
    analysis.selectedPoint.address ? `Address: ${analysis.selectedPoint.address}` : "Address: not available",
    "",
    "## Summary",
    "This report summarizes only computed structured indicators. Missing or approximate data are stated explicitly.",
  ];

  for (const scale of ["XL", "L", "M"] as const) {
    const title =
      scale === "XL"
        ? "XL City & Region"
        : scale === "L"
          ? "L Neighbourhood"
          : "M Streetscape";
    lines.push("", `## ${title}`);
    for (const indicator of analysis.indicators.filter(
      (item) => item.scale === scale,
    )) {
      lines.push(
        `- **${indicator.label}:** ${formatValue(indicator.value)}${indicator.unit ? ` ${indicator.unit}` : ""} (${indicator.confidence} confidence)`,
      );
      lines.push(`  Method: ${indicator.method}`);
      if (indicator.caveats.length) {
        lines.push(`  Caveats: ${indicator.caveats.join("; ")}`);
      }
    }
  }

  lines.push("", "## Key Metrics");
  for (const id of [
    "xl.population-density",
    "l.green-percentage",
    "l.transit-stops",
    "l.transit-lines",
    "m.street-width",
    "m.building-height",
  ]) {
    const indicator = analysis.indicators.find((item) => item.id === id);
    lines.push(
      `- ${indicator?.label ?? id}: ${indicator ? formatValue(indicator.value) : "not available"}${indicator?.unit ? ` ${indicator.unit}` : ""}`,
    );
  }

  lines.push("", "## Data Sources");
  for (const source of getSources(analysis.provenance.sourceIds)) {
    lines.push(`- ${source.label}: ${source.attribution}`);
  }

  lines.push("", "## Source Retrieval");
  for (const receipt of analysis.provenance.sourceFetches) {
    const count =
      receipt.featureCount !== undefined
        ? `${receipt.featureCount} features`
        : receipt.recordCount !== undefined
          ? `${receipt.recordCount} records`
          : receipt.type;
    lines.push(
      `- ${receipt.label}: ${receipt.status}, ${count}, ${receipt.elapsedMs}ms`,
    );
  }

  lines.push("", "## Caveats");
  const caveats = [
    ...analysis.provenance.caveats,
    ...analysis.indicators.flatMap((indicator) => indicator.caveats),
  ];
  for (const caveat of [...new Set(caveats)]) {
    lines.push(`- ${caveat}`);
  }

  return lines.join("\n");
}

export function analysisToHtml(analysis: AnalysisResult): string {
  const markdown = analysisToMarkdown(analysis);
  const body = markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (line.trim() === "") return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SD Stadtdaten Report</title>
  <style>
    body{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;background:#fff;color:#111;line-height:1.5;margin:32px}
    h1{text-transform:uppercase;letter-spacing:.04em;font-size:28px}
    h2{font-size:18px;margin-top:28px;border-top:1px solid #d9d9d9;padding-top:12px}
    li{margin:6px 0}
  </style>
</head>
<body>${body}</body>
</html>`;
}

function csvEscape(value: unknown): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatValue(value: AnalysisResult["indicators"][number]["value"]): string {
  if (value === null || value === undefined || value === "") return "not available";
  return String(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char] ?? char;
  });
}
