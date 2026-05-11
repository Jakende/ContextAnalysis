import { fetchWithTimeout } from "../api/cache";
import { bboxAroundPoint } from "../analysis/geometry";
import type { Indicator, SelectedPoint } from "../types";
import { createIndicator } from "../analysis/indicators/createIndicator";

export const ZENSUS_WMS_BASE_URL = "https://www.wms.nrw.de/wms/zensusatlas";
export const ZENSUS_WMS_CAPABILITIES_URL =
  `${ZENSUS_WMS_BASE_URL}?service=WMS&request=GetCapabilities&version=1.3.0`;
export const ZENSUS_WMS_DISPLAY_LAYER = "bevoelkerung_1km";

export type ZensusWmsMetric = {
  id: string;
  label: string;
  layer: string;
  unit?: string;
  classes: Array<{ color: string; label: string }>;
};

export const ZENSUS_WMS_METRICS: ZensusWmsMetric[] = [
  {
    id: "population",
    label: "Bevölkerung",
    layer: "bevoelkerung_1km",
    unit: "residents",
    classes: [
      { color: "#ccebc5", label: "niedrig" },
      { color: "#a8ddb5", label: "niedrig bis mittel" },
      { color: "#7bccc4", label: "mittel" },
      { color: "#4eb3d3", label: "mittel bis hoch" },
      { color: "#2b8cbe", label: "hoch" },
      { color: "#08589e", label: "sehr hoch" },
    ],
  },
  {
    id: "average-age",
    label: "Durchschnittsalter",
    layer: "durchschnittsalter_1km",
    unit: "years",
    classes: [
      { color: "#ffffe5", label: "bis 40" },
      { color: "#edf8b2", label: "> 40 bis 42" },
      { color: "#bce395", label: "> 42 bis 44" },
      { color: "#78c679", label: "> 44 bis 48" },
      { color: "#379e54", label: "> 48 bis 52" },
      { color: "#0c713b", label: "> 52 bis 60" },
      { color: "#004529", label: "> 60" },
    ],
  },
  {
    id: "net-cold-rent",
    label: "Durchschnittsmiete",
    layer: "durchschnittMiete_1km",
    unit: "EUR/m2",
    classes: [
      { color: "#ffffcc", label: "sehr niedrig" },
      { color: "#ffefa5", label: "niedrig" },
      { color: "#fedd7f", label: "niedrig bis mittel" },
      { color: "#febf5a", label: "mittel" },
      { color: "#fd9d43", label: "mittel bis hoch" },
      { color: "#fd7134", label: "hoch" },
      { color: "#f43d25", label: "sehr hoch" },
      { color: "#db141e", label: "sehr hoch+" },
      { color: "#b60026", label: "extrem hoch" },
      { color: "#800026", label: "Maximum" },
    ],
  },
  {
    id: "vacancy-rate",
    label: "Leerstandsquote",
    layer: "leerstandsquote_1km",
    unit: "%",
    classes: [
      { color: "#ffffe5", label: "bis 2 %" },
      { color: "#fff0ae", label: "> 2 bis 4" },
      { color: "#fece65", label: "> 4 bis 6" },
      { color: "#fe9929", label: "> 6 bis 8" },
      { color: "#e1640e", label: "> 8 bis 10" },
      { color: "#aa3c03", label: "> 10 bis 15" },
      { color: "#662506", label: "> 15" },
    ],
  },
];

export async function fetchZensusWmsIndicators(
  selectedPoint: SelectedPoint,
  computedAt: string,
): Promise<Indicator[]> {
  const responses = await Promise.all(
    ZENSUS_WMS_METRICS.map(async (metric) => ({
      metric,
      value: await fetchZensusMetricValue(selectedPoint, metric.layer),
    })),
  );

  return responses.map(({ metric, value }) =>
    createIndicator({
      id: `xl.zensus-wms.${metric.id}`,
      label: metric.label,
      scale: "XL",
      value: value?.value ?? null,
      unit: value?.value === null ? undefined : metric.unit,
      method:
        "Queried the official Zensus-Atlas WMS GetFeatureInfo endpoint at the selected point using the 1km grid layer.",
      sourceIds: ["zensus-grid-2022"],
      sourceVersion: "Zensus 2022 WMS 1.3.0",
      confidence: value?.value !== null ? "high" : "low",
      caveats: [
        value?.error ??
          "Zensus WMS value read from the official queryable map service.",
        "Grid values follow the Zensus 2022 publication and disclosure-control rules; do not recompute confidential microdata.",
      ],
      computedAt,
    }),
  );
}

export function zensusWmsTileUrl(layer = ZENSUS_WMS_DISPLAY_LAYER): string {
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: layer,
    styles: "",
    format: "image/png",
    transparent: "true",
    crs: "EPSG:3857",
    width: "256",
    height: "256",
  });
  return `${ZENSUS_WMS_BASE_URL}?${params.toString()}&bbox={bbox-epsg-3857}`;
}

async function fetchZensusMetricValue(
  selectedPoint: SelectedPoint,
  layer: string,
): Promise<{ value: number | null; raw: string; error?: string }> {
  const url = zensusFeatureInfoUrl(selectedPoint, layer);
  try {
    const response = await fetchWithTimeout(url, { cache: "no-store" }, 8_000);
    const raw = await response.text();
    if (!response.ok) {
      return { value: null, raw, error: `Zensus WMS GetFeatureInfo failed: HTTP ${response.status}` };
    }
    return { value: parseZensusPlainTextValue(raw), raw };
  } catch (error) {
    return {
      value: null,
      raw: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function zensusFeatureInfoUrl(selectedPoint: SelectedPoint, layer: string): string {
  const bbox = bboxAroundPoint(selectedPoint.lat, selectedPoint.lon, 2_000);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetFeatureInfo",
    layers: layer,
    query_layers: layer,
    styles: "",
    format: "image/png",
    info_format: "text/plain",
    feature_count: "5",
    crs: "CRS:84",
    bbox: bbox.join(","),
    width: "101",
    height: "101",
    i: "50",
    j: "50",
  });
  return `${ZENSUS_WMS_BASE_URL}?${params.toString()}`;
}

function parseZensusPlainTextValue(raw: string): number | null {
  const tokens = raw
    .replace(/^@/, "")
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 3) return null;
  const numericTokens = tokens
    .map((token) => Number(token.replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  if (!numericTokens.length) return null;
  return numericTokens[0];
}
