import type { Feature, FeatureCollection } from "geojson";
import { kpiFormulaLines } from "../analysis/kpi/kpiMatrix";
import { getSources } from "../data/sourceRegistry";
import { projectAreaToFeature } from "../projectArea/geometry";
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

export function analysisToProvenanceJson(analysis: AnalysisResult): string {
  const manifest = createExportManifest(analysis, [
    {
      name: "provenance.json",
      mediaType: "application/json",
      role: "data-source run provenance",
    },
  ]);
  return JSON.stringify(
    {
      manifest,
      selectedPoint: analysis.selectedPoint,
      projectArea: analysis.projectArea ?? null,
      kpiScenario: analysis.kpiScenario ?? null,
      dataSourceRun: analysis.provenance.dataSourceRun,
      sourceFetches: analysis.provenance.sourceFetches,
      overpassQueries: analysis.provenance.overpassQueries,
      caveats: analysis.provenance.caveats,
    },
    null,
    2,
  );
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
    ...(analysis.projectArea ? [projectAreaToFeature(analysis.projectArea)] : []),
    ...analysis.overlays.xlContext.features,
    ...analysis.overlays.xlGrid.features,
    ...analysis.overlays.xlSources.features,
    ...analysis.overlays.urbanAtlas.features,
    ...analysis.overlays.lBuffer.features,
    ...analysis.overlays.mStreetSegment.features,
    ...analysis.overlays.green.features,
    ...analysis.overlays.blue.features,
    ...analysis.overlays.trees.features,
    ...analysis.overlays.buildings.features,
    ...analysis.overlays.pois.features,
    ...analysis.overlays.gastronomy.features,
    ...analysis.overlays.parkingAreas.features,
    ...analysis.overlays.transport.features,
    ...analysis.overlays.mobility.features,
    ...analysis.overlays.isochrones.features,
    ...analysis.overlays.barriers.features,
    ...analysis.overlays.development.features,
    ...analysis.overlays.sun.features,
    ...analysis.overlays.contours.features,
    ...analysis.overlays.osmRaw.features,
  ].map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties ?? {}),
      exportSource: "Urban Context Analysis structured analysis",
    },
  }));

  const collection: FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  return JSON.stringify(
    {
      name: "urban_context_analysis_geometries",
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
    "# Urban Context Analysis",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Location",
    `Selected point: ${analysis.selectedPoint.lat.toFixed(5)}, ${analysis.selectedPoint.lon.toFixed(5)}`,
    analysis.selectedPoint.address ? `Address: ${analysis.selectedPoint.address}` : "Address: not available",
    analysis.selectedPoint.municipality
      ? `Municipality: ${analysis.selectedPoint.municipality}`
      : "Municipality: not available",
    analysis.selectedPoint.district
      ? `District: ${analysis.selectedPoint.district}`
      : "District: not available",
    analysis.projectArea
      ? `Project boundary: ${analysis.projectArea.label} (${Math.round(analysis.projectArea.areaSqm)} m², ${analysis.projectArea.source})`
      : "Project boundary: default 500 m L-scale radius",
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
    const scaleIndicators = analysis.indicators.filter((item) => item.scale === scale);
    if (!scaleIndicators.length) {
      lines.push("- No computed indicators are available for this scale.");
    }
    for (const indicator of scaleIndicators) {
      lines.push(
        `- **${indicator.label}:** ${formatValue(indicator.value)}${indicator.unit ? ` ${indicator.unit}` : ""} (${indicator.confidence} confidence)`,
      );
      lines.push(`  Method: ${indicator.method}`);
      if (indicator.sourceIds.length) {
        lines.push(`  Sources: ${indicator.sourceIds.join(", ")}`);
      }
      if (indicator.caveats.length) {
        lines.push(`  Caveats: ${indicator.caveats.join("; ")}`);
      }
    }
  }

  lines.push("", "## Key Metrics");
  for (const id of [
    "xl.population-density",
    "l.green-percentage",
    "l.land-use-dominant",
    "l.transit-stops",
    "l.transit-stop-density",
    "l.transit-mode-mix",
    "l.transit-lines",
    "l.transit-line-details",
    "l.mobility-score",
    "l.social-infrastructure-score",
    "l.tree-canopy-score",
    "l.station-axis-score",
    "xl.context-score",
    "xl.context-class",
    "kpi.local-quality-score",
    "kpi.local-quality-class",
    "benchmark.local-quality-rank",
    "benchmark.local-quality-percentile",
    "benchmark.strongest-relative-kpi",
    "benchmark.weakest-relative-kpi",
    "m.street-width",
    "m.building-height",
  ]) {
    const indicator = analysis.indicators.find((item) => item.id === id);
    lines.push(
      `- ${indicator?.label ?? id}: ${indicator ? formatValue(indicator.value) : "not available"}${indicator?.unit ? ` ${indicator.unit}` : ""}`,
    );
  }

  appendKpiFormulaSection(lines);
  if (analysis.kpiScenario) {
    lines.push(
      "",
      "## Active KPI Scenario",
      `- Strategy: ${analysis.kpiScenario.strategyName}`,
      `- Composite: ${analysis.kpiScenario.composite ?? "not available"}`,
      `- Classification: ${analysis.kpiScenario.classification}`,
      `- Confidence: ${analysis.kpiScenario.confidence}`,
      `- Schema version: ${analysis.kpiScenario.schemaVersion}`,
      `- Weights: ${Object.entries(analysis.kpiScenario.weights)
        .map(([id, weight]) => `${id}=${weight}`)
        .join(", ")}`,
    );
  }
  appendBenchmarkSection(lines, analysis);
  appendFeatureInventory(lines, analysis);

  lines.push("", "## Data Sources");
  const sources = getSources(analysis.provenance.sourceIds);
  if (!sources.length) {
    lines.push("- not available");
  }
  for (const source of sources) {
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

  lines.push("", "## Data Source Run");
  for (const event of analysis.provenance.dataSourceRun) {
    const count =
      event.featureCount !== undefined
        ? `${event.featureCount} features`
        : event.recordCount !== undefined
          ? `${event.recordCount} records`
          : event.phase;
    lines.push(
      `- ${event.label}: ${event.status}, ${count}${event.elapsedMs !== undefined ? `, ${event.elapsedMs}ms` : ""}`,
    );
    if (event.error) lines.push(`  Error: ${event.error}`);
  }

  lines.push("", "## Caveats");
  const caveats = [
    ...analysis.provenance.caveats,
    ...analysis.indicators.flatMap((indicator) => indicator.caveats),
  ];
  const uniqueCaveats = [...new Set(caveats)];
  if (!uniqueCaveats.length) {
    lines.push("- No caveats recorded.");
  }
  for (const caveat of uniqueCaveats) {
    lines.push(`- ${caveat}`);
  }

  return lines.join("\n");
}

function appendKpiFormulaSection(lines: string[]): void {
  lines.push("", "## KPI Definitions And Formulas");
  for (const line of kpiFormulaLines()) {
    lines.push(`- ${line}`);
  }
}

function appendBenchmarkSection(lines: string[], analysis: AnalysisResult): void {
  const benchmarkIndicators = analysis.indicators.filter((indicator) =>
    indicator.id.startsWith("benchmark."),
  );
  lines.push("", "## Multi-City Benchmark");
  if (!benchmarkIndicators.length) {
    lines.push("- not available");
    return;
  }
  for (const indicator of benchmarkIndicators) {
    lines.push(
      `- **${indicator.label}:** ${formatValue(indicator.value)}${indicator.unit ? ` ${indicator.unit}` : ""} (${indicator.confidence} confidence)`,
    );
  }
}

function appendFeatureInventory(lines: string[], analysis: AnalysisResult): void {
  lines.push("", "## Downloaded Feature Attributes");
  lines.push(
    `GeoJSON and GeoPackage exports preserve raw OSM/OpenData attributes in feature properties and \`properties_json\`; selected attributes are also exposed as typed columns where the export format supports them. Raw Overpass export contains ${analysis.overlays.osmRaw.features.length} feature(s).`,
  );
  appendCategoryInventory(lines, "Raw Overpass modules", analysis.overlays.osmRaw, undefined, [
    "overpassModuleId",
  ]);
  appendTransitLineInventory(lines, analysis.overlays.transport);
  appendCategoryInventory(lines, "Public transport stops", analysis.overlays.transport, "Point", [
    "transportMode",
    "name",
    "stop_name",
    "ref",
  ]);
  appendCategoryInventory(lines, "Mobility infrastructure", analysis.overlays.mobility, undefined, [
    "mobilityMode",
    "highway",
    "cycleway",
    "amenity",
  ]);
  appendCategoryInventory(lines, "Isochrones", analysis.overlays.isochrones, undefined, [
    "isochroneMode",
    "retrievalStatus",
    "rangeSeconds",
  ]);
  appendCategoryInventory(lines, "POIs", analysis.overlays.pois, undefined, [
    "poiCategory",
    "amenity",
    "shop",
    "tourism",
    "leisure",
  ]);
  appendCategoryInventory(lines, "Gastronomy", analysis.overlays.gastronomy, undefined, [
    "amenity",
    "name",
    "cuisine",
  ]);
  appendCategoryInventory(lines, "Parking areas", analysis.overlays.parkingAreas, undefined, [
    "amenity",
    "parking",
    "access",
    "capacity",
  ]);
}

function appendTransitLineInventory(lines: string[], collection: FeatureCollection): void {
  const labels = new Set<string>();
  for (const feature of collection.features) {
    if (feature.geometry.type !== "LineString") continue;
    for (const label of readTransitLineLabels(feature)) labels.add(label);
  }
  lines.push("", "### Public Transport Lines");
  if (!labels.size) {
    lines.push("- not available");
    return;
  }
  for (const label of [...labels].sort((left, right) => left.localeCompare(right, "de")).slice(0, 40)) {
    lines.push(`- ${label}`);
  }
  if (labels.size > 40) lines.push(`- plus ${labels.size - 40} additional line labels in the geodata export`);
}

function readTransitLineLabels(feature: Feature): string[] {
  const properties = feature.properties ?? {};
  const mode = String(properties.transportMode ?? properties.route ?? "transit");
  const explicit = splitProperty(properties.lineLabel);
  if (explicit.length) return explicit.map((label) => `${mode}: ${label}`);
  const refs = splitProperty(properties.routeRefs ?? properties.ref);
  const names = splitProperty(properties.routeNames ?? properties.name);
  const networks = splitProperty(properties.routeNetworks ?? properties.network);
  const operators = splitProperty(properties.routeOperators ?? properties.operator);
  const relations = splitProperty(properties.routeRelations ?? properties.relationId);
  const froms = splitProperty(properties.routeFroms);
  const tos = splitProperty(properties.routeTos);
  const maxLength = Math.max(refs.length, names.length, networks.length, operators.length, relations.length, froms.length, tos.length, 1);
  return Array.from({ length: maxLength }, (_, index) => {
    const fromTo = froms[index] || tos[index] ? `${froms[index] ?? "?"}->${tos[index] ?? "?"}` : undefined;
    const parts = [
      refs[index] ? `ref ${refs[index]}` : undefined,
      names[index],
      fromTo,
      networks[index] ? `network ${networks[index]}` : undefined,
      operators[index] ? `operator ${operators[index]}` : undefined,
      relations[index] ? `relation ${relations[index]}` : undefined,
    ].filter(Boolean);
    return `${mode}: ${parts.length ? parts.join(" / ") : String(properties.osmId ?? properties.id ?? "unnamed")}`;
  });
}

function appendCategoryInventory(
  lines: string[],
  title: string,
  collection: FeatureCollection,
  geometryType: Feature["geometry"]["type"] | undefined,
  keys: string[],
): void {
  const counts = new Map<string, number>();
  for (const feature of collection.features) {
    if (geometryType && feature.geometry.type !== geometryType) continue;
    const label = readFirstProperty(feature, keys) ?? "other";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  lines.push("", `### ${title}`);
  if (!counts.size) {
    lines.push("- not available");
    return;
  }
  for (const [label, count] of [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 20)) {
    lines.push(`- ${label}: ${count}`);
  }
}

function readFirstProperty(feature: Feature, keys: string[]): string | null {
  for (const key of keys) {
    const value = feature.properties?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function splitProperty(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function analysisToHtml(analysis: AnalysisResult): string {
  const markdown = analysisToMarkdown(analysis);
  const body = markdownToHtml(markdown);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Urban Context Analysis Report</title>
  <style>
    body{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;background:#fff;color:#111;line-height:1.5;margin:32px}
    h1{text-transform:uppercase;letter-spacing:.04em;font-size:28px}
    h2{font-size:18px;margin-top:28px;border-top:1px solid #d9d9d9;padding-top:12px}
    h3{font-size:15px;margin-top:20px}
    ul{padding-left:24px}
    li{margin:6px 0}
    .list-detail{color:#444;margin:2px 0 2px 12px}
    code{background:#f3f3f3;padding:1px 4px}
  </style>
</head>
<body>${body}</body>
</html>`;
}

function markdownToHtml(markdown: string): string {
  const output: string[] = [];
  let listOpen = false;
  let itemOpen = false;

  const closeList = () => {
    if (itemOpen) {
      output.push("</li>");
      itemOpen = false;
    }
    if (listOpen) {
      output.push("</ul>");
      listOpen = false;
    }
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("- ")) {
      if (!listOpen) {
        output.push("<ul>");
        listOpen = true;
      }
      if (itemOpen) output.push("</li>");
      output.push(`<li>${renderInlineMarkdown(line.slice(2))}`);
      itemOpen = true;
      continue;
    }

    if (itemOpen && /^\s{2,}\S/.test(line)) {
      output.push(`<div class="list-detail">${renderInlineMarkdown(line.trim())}</div>`);
      continue;
    }

    closeList();
    if (line.startsWith("### ")) {
      output.push(`<h3>${renderInlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      output.push(`<h2>${renderInlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      output.push(`<h1>${renderInlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.trim()) {
      output.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }
  }

  closeList();
  return output.join("\n");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
