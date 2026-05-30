import type { AnalysisResult } from "../types";
import { getSources } from "../data/sourceRegistry";
import { analysisToMarkdown } from "../export/serializers";
import { kpiFormulaLines } from "../analysis/kpi/kpiMatrix";

type OllamaReport = {
  status: "ok" | "fallback" | "unavailable";
  markdown: string;
  error?: string;
};

const REQUIRED_REPORT_HEADINGS = [
  "## Location",
  "## Summary",
  "## XL City & Region",
  "## L Neighbourhood",
  "## M Streetscape",
  "## Key Metrics",
  "## KPI Definitions And Formulas",
  "## Data Sources",
  "## Caveats",
] as const;

const MIN_REPORT_CHARACTERS = 1_200;

const DEFAULT_PROMPT = `You are generating a professional urban context analysis report from structured GIS analysis results.

Hard rules:
- Use only values, methods, source names, confidence flags, caveats, and timestamps present in the provided JSON.
- Do not invent metrics, addresses, planning conclusions, legal assessments, or missing source coverage.
- If a value is missing, write "not available".
- Make the report specific to the selected point. Mention its coordinates and address or label when available.
- Preserve source names, source IDs, caveats, confidence levels, and method notes.
- The LLM is only a narrator/editor; all measurements come from the JSON.

Output:
- Return Markdown only.
- Write a substantial, readable report of at least ${MIN_REPORT_CHARACTERS} characters when the JSON contains enough analysis content.
- Use short paragraphs and bullet lists. Avoid tables unless they improve readability.
- Include these exact section headings, in this order:
${REQUIRED_REPORT_HEADINGS.join("\n")}
- In each XL/L/M section, summarize the relevant modules, then list important indicators with value, unit, confidence, method, and caveats.
- In the KPI Definitions And Formulas section, list KPI definitions, thresholds, normalization formulas, composite calculation, classification rules, and confidence notes from the JSON. Do not invent formulas.
- Add "not available" for missing sections instead of omitting them.`;

export async function generateOllamaReport(
  analysis: AnalysisResult,
): Promise<OllamaReport> {
  const apiBaseUrl = import.meta.env.VITE_OLLAMA_API_BASE_URL ?? "/api/ollama";
  const model = import.meta.env.VITE_OLLAMA_MODEL ?? "deepseek-v4-flash:cloud";
  const language = import.meta.env.VITE_REPORT_LANGUAGE ?? "en";

  try {
    const tags = await fetch(`${apiBaseUrl}/tags`);
    if (!tags.ok) {
      throw new Error(await ollamaHttpError(tags, "tags"));
    }
    const tagJson = (await tags.json()) as { models?: Array<{ name: string }> };
    const available = tagJson.models?.some((item) =>
      item.name.startsWith(model),
    );
    if (!available) {
      throw new Error(`Ollama model "${model}" is not available locally`);
    }

    const response = await fetch(`${apiBaseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 2_800,
        },
        messages: [
          {
            role: "system",
            content: `${DEFAULT_PROMPT}\nReport language: ${language}.`,
          },
          {
            role: "user",
            content: createReportRequest(analysis),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(await ollamaHttpError(response, "chat"));
    }

    const json = (await response.json()) as OllamaChatResponse;
    const markdown = extractOllamaMarkdown(json);
    if (!markdown) {
      return {
        status: "fallback",
        markdown: analysisToMarkdown(analysis),
        error: "Ollama returned an empty report; deterministic report exported instead.",
      };
    }
    const qualityIssue = reportQualityIssue(markdown);
    if (qualityIssue) {
      return {
        status: "fallback",
        markdown: analysisToMarkdown(analysis),
        error: `Ollama returned an incomplete report (${qualityIssue}); deterministic report exported instead.`,
      };
    }

    return {
      status: "ok",
      markdown,
    };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        status: "fallback",
        markdown: analysisToMarkdown(analysis),
        error: `${errorMessage(error)}; deterministic report exported instead.`,
      };
    }

    return {
      status: "unavailable",
      markdown: analysisToMarkdown(analysis),
      error: errorMessage(error),
    };
  }
}

type OllamaChatResponse = {
  message?: { content?: string | null };
  response?: string | null;
};

function extractOllamaMarkdown(json: OllamaChatResponse): string | null {
  const content = json.message?.content ?? json.response;
  if (typeof content !== "string") return null;

  const markdown = content.trim();
  return markdown.length > 0 ? markdown : null;
}

function reportQualityIssue(markdown: string): string | null {
  if (markdown.length < MIN_REPORT_CHARACTERS) {
    return `only ${markdown.length} characters`;
  }

  const missingHeading = REQUIRED_REPORT_HEADINGS.find(
    (heading) => !markdown.includes(heading),
  );
  return missingHeading ? `missing ${missingHeading}` : null;
}

function isAbortError(error: unknown): boolean {
  const message = errorMessage(error);
  if (/abort/i.test(message)) return true;

  if (typeof error === "object" && error !== null && "name" in error) {
    const name = String((error as { name?: unknown }).name);
    if (name === "AbortError" || name === "TimeoutError") return true;
  }

  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /abort/i.test(error.message)
    );
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error instanceof DOMException && error.message) {
    return error.message;
  }
  return String(error);
}

async function ollamaHttpError(response: Response, endpoint: string): Promise<string> {
  const fallback = `Ollama ${endpoint} endpoint returned HTTP ${response.status}`;
  const text = await response.text().catch(() => "");
  if (!text.trim()) return fallback;

  try {
    const payload = JSON.parse(text) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return `${fallback}: ${payload.error}`;
    }
  } catch {
    // Plain text responses are useful enough to surface directly.
  }

  return `${fallback}: ${text.trim().slice(0, 300)}`;
}

function createReportRequest(analysis: AnalysisResult): string {
  return [
    "Create the final report for the current selected point and the current analysis JSON below.",
    "The report must be self-contained: a reader should understand what was analyzed, what was found at XL/L/M scales, which values are approximate, and which sources/caveats apply.",
    "Do not describe implementation details or mention that you are an AI model.",
    "",
    "ANALYSIS_JSON:",
    JSON.stringify(createReportPayload(analysis), null, 2),
  ].join("\n");
}

function createReportPayload(analysis: AnalysisResult) {
  const sources = getSources(analysis.provenance.sourceIds);

  return {
    app: analysis.app,
    analysisVersion: analysis.analysisVersion,
    activeScale: analysis.activeScale,
    generatedAt: new Date().toISOString(),
    selectedPoint: {
      lat: analysis.selectedPoint.lat,
      lon: analysis.selectedPoint.lon,
      label: analysis.selectedPoint.label,
      address: analysis.selectedPoint.address,
      municipality: analysis.selectedPoint.municipality,
      district: analysis.selectedPoint.district,
    },
    mapState: {
      center: analysis.mapState.center,
      zoom: analysis.mapState.zoom,
      activeLayers: Object.entries(analysis.mapState.layers)
        .filter(([, enabled]) => enabled)
        .map(([layer]) => layer),
    },
    indicatorsByScale: {
      XL: createIndicatorPayload(analysis, "XL"),
      L: createIndicatorPayload(analysis, "L"),
      M: createIndicatorPayload(analysis, "M"),
    },
    modules: analysis.modules.map((module) => ({
      id: module.id,
      title: module.title,
      scale: module.scale,
      method: module.method,
      sourceIds: module.sourceIds,
      confidence: module.confidence,
      caveats: module.caveats,
      indicators: module.indicators.map((indicator) => indicator.id),
    })),
    kpiDefinitionsAndFormulas: kpiFormulaLines(),
    sources: sources.map((source) => ({
      id: source.id,
      label: source.label,
      type: source.type,
      attribution: source.attribution,
      updateMode: source.updateMode,
      notes: source.notes,
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

function createIndicatorPayload(
  analysis: AnalysisResult,
  scale: "XL" | "L" | "M",
) {
  return analysis.indicators
    .filter((indicator) => indicator.scale === scale)
    .map((indicator) => ({
      id: indicator.id,
      label: indicator.label,
      value: indicator.value,
      unit: indicator.unit,
      method: indicator.method,
      sourceIds: indicator.sourceIds,
      sourceVersion: indicator.sourceVersion,
      computedAt: indicator.computedAt,
      confidence: indicator.confidence,
      caveats: indicator.caveats,
    }));
}
