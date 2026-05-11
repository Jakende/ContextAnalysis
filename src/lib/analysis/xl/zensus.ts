import type { FeatureCollection } from "geojson";
import type { FactSheetModule, Indicator } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

export function createZensusGridModule(
  zensusGrid: FeatureCollection,
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const values = zensusGrid.features
    .map((feature) => feature.properties?.populationIndex)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const cellCount = zensusGrid.features.length;
  const averageValue =
    values.length > 0
      ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10
      : null;
  const caveat =
    cellCount > 0
      ? "Loaded from local preprocessed Zensus grid GeoJSON for this selected-point analysis."
      : "No local Zensus grid GeoJSON cells were found for this selected point.";

  const indicators = [
    createIndicator({
      id: "xl.zensus-grid-cells",
      label: "Zensus grid cells",
      scale: "XL",
      value: cellCount || null,
      unit: "cells",
      method:
        "Filtered local preprocessed Zensus grid cells by the selected XL context bbox.",
      sourceIds: ["zensus-grid-2022"],
      confidence: cellCount > 0 ? "high" : "low",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "xl.zensus-grid-average",
      label: "Zensus grid average",
      scale: "XL",
      value: averageValue,
      method:
        "Average of the configured numeric Zensus grid value property across loaded cells.",
      sourceIds: ["zensus-grid-2022"],
      confidence: averageValue !== null ? "high" : "low",
      caveats: [
        averageValue !== null
          ? caveat
          : "Loaded Zensus cells do not contain a recognized numeric value property.",
      ],
      computedAt,
    }),
  ];

  return {
    indicators,
    modules: [
      {
        id: "xl.zensus-grid",
        title: "Zensus grid context",
        scale: "XL",
        indicators,
        method:
          "Local Zensus grid cells are loaded per selected point and classified into low/medium/high classes from real cell values.",
        sourceIds: ["zensus-grid-2022"],
        computedAt,
        confidence: cellCount > 0 ? "high" : "low",
        caveats: [caveat],
      },
    ],
  };
}
