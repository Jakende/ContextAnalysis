import { sourceRegistry } from "../../data/sourceRegistry";
import type {
  DataSource,
  FactSheetModule,
  Indicator,
  SourceFetchReceipt,
} from "../../types";
import { createIndicator, worstConfidence } from "../indicators/createIndicator";

const XL_CONTEXT_SOURCE_IDS = (Object.values(sourceRegistry) as DataSource[])
  .filter((source) => source.scale.includes("XL"))
  .map((source) => source.id);

export function createXlSourceStatusModule(
  sourceFetches: SourceFetchReceipt[],
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[] } {
  const receiptById = new Map(
    sourceFetches.map((receipt) => [receipt.sourceId, receipt]),
  );
  const indicators = XL_CONTEXT_SOURCE_IDS.map((sourceId) => {
    const source = sourceRegistry[sourceId as keyof typeof sourceRegistry];
    const receipt = receiptById.get(sourceId);
    const caveats = [
      ...(receipt?.caveats ?? [
        "No source receipt was produced during this run; this is an adapter coverage issue.",
      ]),
      "This indicator reports source-loading state only. It is not a substitute for a computed spatial metric.",
    ];

    return createIndicator({
      id: `xl.source.${sourceId}`,
      label: source.label,
      scale: "XL",
      value: sourceStatusValue(receipt),
      method:
        receipt?.method ??
        "Expected an XL source receipt from the registry-backed adapter during this analysis run.",
      sourceIds: [sourceId],
      sourceVersion: receipt?.sourceVersion ?? source.updateMode,
      confidence: sourceStatusConfidence(receipt),
      caveats,
      computedAt,
    });
  });

  return {
    indicators,
    modules: [
      {
        id: "xl.large-area-source-loading",
        title: "XL source loading",
        scale: "XL",
        indicators,
        method:
          "Every XL-scoped registry source is checked during the selected-point analysis. Local spatial assets are loaded when present; otherwise the official registry URL is queried and the limitation is shown.",
        sourceIds: XL_CONTEXT_SOURCE_IDS,
        computedAt,
        confidence: worstConfidence(
          indicators.map((indicator) => indicator.confidence),
        ),
        caveats: [
          ...new Set(indicators.flatMap((indicator) => indicator.caveats)),
        ],
      },
    ],
  };
}

function sourceStatusValue(receipt: SourceFetchReceipt | undefined): string {
  if (!receipt) return "not checked";
  if (receipt.status !== "ok") return receipt.status;
  if (
    receipt.caveats.some((caveat) =>
      caveat.toLowerCase().includes("metadata was loaded"),
    )
  ) {
    return "metadata loaded";
  }
  if (
    receipt.caveats.some((caveat) =>
      caveat.toLowerCase().includes("availability only"),
    )
  ) {
    return "availability loaded";
  }
  if (receipt.url?.startsWith("/")) return "local data loaded";
  return "live loaded";
}

function sourceStatusConfidence(
  receipt: SourceFetchReceipt | undefined,
): "high" | "medium" | "low" {
  if (!receipt) return "low";
  if (receipt.status === "failed" || receipt.status === "missing") return "low";
  if (receipt.status === "skipped") return "low";
  if (receipt.status === "cached") return "medium";
  if (
    receipt.caveats.some((caveat) =>
      caveat.toLowerCase().includes("spatial metrics require"),
    )
  ) {
    return "medium";
  }
  return "high";
}
