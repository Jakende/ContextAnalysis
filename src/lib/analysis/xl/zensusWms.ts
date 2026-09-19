import type { FactSheetModule, Indicator } from "../../types";

export function createZensusWmsModule(
  indicators: Indicator[],
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const zensusIndicators = indicators.filter((indicator) =>
    indicator.id.startsWith("xl.zensus-wms."),
  );
  return {
    indicators: zensusIndicators,
    modules: [
      {
        id: "xl.zensus-wms",
        title: "Zensus-Atlas WMS",
        scale: "XL",
        indicators: zensusIndicators,
        method:
          "Official Zensus-Atlas WMS 1.3.0 is used for map rendering and GetFeatureInfo point reads on 1km grid layers.",
        sourceIds: ["zensus-grid-2022"],
        computedAt,
        confidence: zensusIndicators.some((indicator) => indicator.value !== null)
          ? "high"
          : "low",
        caveats: [
          "WMS delivers rendered grid layers and point query responses, not full local vector geometries.",
          "Use the downloadable Zensus grid data for bulk export or full-cell spatial joins.",
        ],
      },
    ],
  };
}
