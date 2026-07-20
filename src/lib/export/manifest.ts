import { getSources } from "../data/sourceRegistry";
import type { AnalysisResult, ExportManifest } from "../types";

export function createExportManifest(
  analysis: AnalysisResult,
  files: ExportManifest["files"],
): ExportManifest {
  return {
    app: "Urban Context Analysis",
    exportVersion: "0.1.0",
    selectedPoint: {
      lat: analysis.selectedPoint.lat,
      lon: analysis.selectedPoint.lon,
    },
    ...(analysis.projectArea ? { projectArea: analysis.projectArea } : {}),
    ...(analysis.kpiScenario ? { kpiScenario: analysis.kpiScenario } : {}),
    createdAt: new Date().toISOString(),
    scales: ["XL", "L", "M"],
    sources: getSources(analysis.provenance.sourceIds),
    sourceFetches: analysis.provenance.sourceFetches,
    dataSourceRun: analysis.provenance.dataSourceRun,
    overpassQueries: analysis.provenance.overpassQueries,
    files,
    caveats: analysis.provenance.caveats,
  };
}
