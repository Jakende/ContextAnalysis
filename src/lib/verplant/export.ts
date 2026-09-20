import { createExportManifest } from "../export/manifest";
import { createZipBlob } from "../export/zip";
import { CATEGORY_LABELS, type CaseFile } from "./types";
export function caseManifest(file: CaseFile) {
  const result = file.results.at(-1)!;
  return {
    ...createExportManifest(result.analysis, [
      {
        name: "case.json",
        mediaType: "application/json",
        role: "Versionierter Fall mit allen Durchläufen und Arbeitsständen",
      },
      {
        name: "report.md",
        mediaType: "text/markdown",
        role: "Reflexionsbericht",
      },
      {
        name: "report.html",
        mediaType: "text/html",
        role: "Reflexionsbericht",
      },
    ]),
    productVariant: "verplant",
    extensionVersion: file.schemaVersion,
    caseId: file.case.id,
    inputVersion: file.case.inputVersion,
    runs: file.runs.map((r) => ({
      id: r.id,
      versions: r.versions,
      status: r.status,
      generation: r.generation,
    })),
    workspaceVersion: file.workspaces.at(-1)?.version,
    spatialScope: file.case.spatial,
    uncertainties: result.site.gaps,
    scenario: "Keine Szenariogeometrien in dieser Variante erfasst",
  };
}
export function caseToJson(file: CaseFile): string {
  return JSON.stringify({ manifest: caseManifest(file), ...file }, null, 2);
}
const safe = (value: string) =>
  value.replace(/[<>\[\]`*_#]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
export function caseToMarkdown(file: CaseFile): string {
  const result = file.results.at(-1)!,
    workspace = file.workspaces.at(-1)!;
  return [
    "# verplant — Reflexionsstand",
    `Fall: ${file.case.id} · Eingabe ${file.case.inputVersion} · Durchlauf ${file.runs.length} · Arbeitsstand ${workspace.version}`,
    "Keine fertige Planung, fachliche oder rechtliche Prüfung und kein Ersatz für Beteiligung.",
    "## Ausgangsrahmen",
    ...Object.entries(file.case.context).map(
      ([key, value]) => `${key}: ${safe(value)}`,
    ),
    "## Raumbezug",
    `Projekt: ${file.case.spatial.project.type}; Kontext: ${file.case.spatial.context.type}. L nutzt das Kontextgebiet; XL und M eigene Bezugsräume.`,
    "## Perspektiven, Setzungen und offene Fragen",
    ...[
      ...result.objects,
      ...result.site.observations,
      ...result.site.gaps,
      ...result.site.conflicts,
      ...workspace.additions,
    ].map((o) => {
      const e = workspace.edits[o.id];
      return `### ${o.id}\n${CATEGORY_LABELS[o.category]}: ${safe(o.text)}\nKonfidenz: ${o.confidence}; Unsicherheit: ${o.uncertainty}; Quellen: ${o.sourceIds.join(", ") || "keine"}; Indikatoren: ${o.indicatorIds.join(", ") || "keine"}\nGrenzen: ${o.caveats.map(safe).join("; ")}\nBearbeitung: ${e?.hidden ? "ausgeblendet" : "sichtbar"}; ${e?.relevant ? "relevant markiert" : "keine Markierung"}; ${e?.needsReview ? "übernommen, erneut prüfen" : ""}\nKommentar: ${safe(e?.comment ?? "")}`;
    }),
    "## Beziehungen",
    ...result.relationships.map(
      (r) =>
        `${r.type}: ${r.from} → ${r.to}. ${safe(r.reason)} [${r.evidence}]`,
    ),
    "## Quellen und Attribution",
    ...caseManifest(file).sources.map(
      (s) =>
        `${s.id}: ${safe(s.attribution)}; Lizenz: ${s.license ?? "nicht angegeben"}`,
    ),
    "## Versionen und Verlauf",
    ...file.runs.map(
      (r) =>
        `${r.id}: ${JSON.stringify(r.versions)}; Status ${r.status}; Auslöser ${r.trigger.join(", ")}`,
    ),
    "Alle vorherigen Durchläufe, Geometrien, unbestätigten Hypothesen und Arbeitsstände stehen in case.json.",
  ].join("\n\n");
}
export function caseToHtml(file: CaseFile): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>verplant Reflexionsstand</title><style>body{font:16px system-ui;max-width:80ch;margin:2rem auto;padding:1rem;color:#111;background:#fdfdfc}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><body><pre>${escape(caseToMarkdown(file))}</pre></body></html>`;
}
export function caseToZip(file: CaseFile): Promise<Blob> {
  return createZipBlob([
    { name: "case.json", content: caseToJson(file) },
    {
      name: "manifest.json",
      content: JSON.stringify(caseManifest(file), null, 2),
    },
    { name: "report.md", content: caseToMarkdown(file) },
    { name: "report.html", content: caseToHtml(file) },
  ]);
}
