import type { AnalysisResult } from "../types";
import { analysisToMarkdown } from "../export/serializers";

type OllamaReport = {
  status: "ok" | "unavailable";
  markdown: string;
  error?: string;
};

const DEFAULT_PROMPT =
  "You are generating an urban context analysis report from structured GIS results. Use only the JSON values provided. Do not invent metrics. If a value is missing, write \"not available\". Preserve source names, caveats and confidence. Return Markdown with sections: Summary, XL City & Region, L Neighbourhood, M Streetscape, Key Metrics, Data Sources, Caveats.";

export async function generateOllamaReport(
  analysis: AnalysisResult,
): Promise<OllamaReport> {
  const baseUrl =
    import.meta.env.VITE_OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = import.meta.env.VITE_OLLAMA_MODEL ?? "deepseek-v4-flash:cloud";
  const language = import.meta.env.VITE_REPORT_LANGUAGE ?? "en";
  const timeoutMs = Number(import.meta.env.VITE_OLLAMA_TIMEOUT_MS ?? 120000);

  try {
    const reachabilityController = new AbortController();
    const reachabilityTimeout = window.setTimeout(
      () => reachabilityController.abort(),
      2_500,
    );
    const tags = await fetch(`${baseUrl}/api/tags`, {
      signal: reachabilityController.signal,
    });
    window.clearTimeout(reachabilityTimeout);
    if (!tags.ok) {
      throw new Error(`Ollama tags endpoint returned HTTP ${tags.status}`);
    }
    const tagJson = (await tags.json()) as { models?: Array<{ name: string }> };
    const available = tagJson.models?.some((item) =>
      item.name.startsWith(model),
    );
    if (!available) {
      throw new Error(`Ollama model "${model}" is not available locally`);
    }

    const chatController = new AbortController();
    const chatTimeout = window.setTimeout(() => chatController.abort(), timeoutMs);
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: chatController.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 900,
        },
        messages: [
          {
            role: "system",
            content: `${DEFAULT_PROMPT}\nReport language: ${language}.`,
          },
          {
            role: "user",
            content: JSON.stringify(createReportPayload(analysis)),
          },
        ],
      }),
    });
    window.clearTimeout(chatTimeout);

    if (!response.ok) {
      throw new Error(`Ollama chat endpoint returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };
    return {
      status: "ok",
      markdown: json.message?.content ?? json.response ?? analysisToMarkdown(analysis),
    };
  } catch (error) {
    return {
      status: "unavailable",
      markdown: analysisToMarkdown(analysis),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createReportPayload(analysis: AnalysisResult) {
  return {
    app: analysis.app,
    analysisVersion: analysis.analysisVersion,
    selectedPoint: {
      lat: analysis.selectedPoint.lat,
      lon: analysis.selectedPoint.lon,
      label: analysis.selectedPoint.label,
      address: analysis.selectedPoint.address,
    },
    indicators: analysis.indicators.map((indicator) => ({
      id: indicator.id,
      label: indicator.label,
      scale: indicator.scale,
      value: indicator.value,
      unit: indicator.unit,
      method: indicator.method,
      sourceIds: indicator.sourceIds,
      confidence: indicator.confidence,
      caveats: indicator.caveats,
    })),
    modules: analysis.modules.map((module) => ({
      title: module.title,
      scale: module.scale,
      indicatorIds: module.indicators.map((indicator) => indicator.id),
      method: module.method,
      confidence: module.confidence,
      caveats: module.caveats,
    })),
    provenance: {
      sourceIds: analysis.provenance.sourceIds,
      geocoding: analysis.provenance.geocoding,
      overpassQueries: analysis.provenance.overpassQueries.map((query) => ({
        id: query.id,
        status: query.status,
        featureCount: query.featureCount,
        caveats: query.caveats,
      })),
      sourceFetches: analysis.provenance.sourceFetches.map((receipt) => ({
        sourceId: receipt.sourceId,
        status: receipt.status,
        recordCount: receipt.recordCount,
        featureCount: receipt.featureCount,
        caveats: receipt.caveats,
      })),
      caveats: analysis.provenance.caveats,
    },
  };
}
