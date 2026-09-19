import type { Confidence, Indicator, Scale } from "../../types";

export function createIndicator(input: {
  id: string;
  label: string;
  scale: Scale;
  value: Indicator["value"];
  unit?: string;
  method: string;
  sourceIds: string[];
  sourceVersion?: string;
  confidence: Confidence;
  caveats?: string[];
  computedAt: string;
  geometry?: Indicator["geometry"];
}): Indicator {
  return {
    id: input.id,
    label: input.label,
    scale: input.scale,
    value: input.value,
    unit: input.unit,
    method: input.method,
    sourceIds: input.sourceIds,
    sourceVersion: input.sourceVersion,
    computedAt: input.computedAt,
    confidence: input.confidence,
    caveats: input.caveats ?? [],
    geometry: input.geometry,
  };
}

export function worstConfidence(
  values: Confidence[],
): Confidence {
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}
