import { useMemo, useState } from "react";
import type { AnalysisResult, Scale } from "../lib/types";
import { productVariant } from "../config/productVariant";
import { SpatialMap } from "../components/verplant/SpatialMap";
import { clearLocalSpatialRequestCache } from "../lib/data/localSpatial";
import { runLocationAnalysis } from "../lib/analysis/runAnalysis";
import { parseProjectAreaGeoJson } from "../lib/projectArea/geometry";
import { downloadBlob, downloadText } from "../lib/export/download";
import { appendRun, contextPackage, object } from "../lib/verplant/engine";
import {
  changes,
  editWorkspace,
  emptyContext,
  newCase,
  scopeFromPoint,
  sensitiveHints,
  transition,
  validateContext,
  validateScope,
} from "../lib/verplant/model";
import { profiles } from "../lib/verplant/profiles";
import {
  CATEGORY_LABELS,
  UNCERTAINTY_LABELS,
  RELATION_LABELS,
  ROLES,
  type CaseFile,
  type SpatialScope,
  type State,
  type UserContext,
} from "../lib/verplant/types";
import {
  caseToHtml,
  caseToJson,
  caseToMarkdown,
  caseToZip,
} from "../lib/verplant/export";
import { refineLocally } from "../lib/verplant/localRefinement";
import "../styles/verplant.css";
const phases = [
  "Eingabe",
  "Kontextualisierung",
  "Perspektivwechsel",
  "Interaktion",
  "Weiterarbeiten",
];
const labels: Record<keyof UserContext, string> = {
  role: "Ausgangsrolle",
  description: "Freie Beschreibung der Rolle",
  knowledge: "Wissensperspektive",
  institution: "Institutionelle Position",
  projectRelation: "Projektbezug",
  affectedness: "Räumliche Betroffenheit",
  observed: "Beobachteter Zustand",
  assumedCause: "Vermutete Ursache (unbestätigt)",
  goal: "Ziel",
  intervention: "Vorgeschlagene Intervention",
  question: "Offene Leitfrage",
  conflicts: "Bekannte Konflikte",
  groups: "Betroffene oder bislang nicht beteiligte Gruppen",
  horizon: "Zeithorizont",
  approaches: "Bereits diskutierte Ansätze",
  priorities: "Eigene Prioritäten",
  mode: "Bearbeitungsmodus",
};
export function VerplantApp() {
  const [context, setContext] = useState<UserContext>({ ...emptyContext });
  const [lat, setLat] = useState(""),
    [lon, setLon] = useState(""),
    [radius, setRadius] = useState("500");
  const [project, setProject] = useState<SpatialScope["project"] | null>(null),
    [contextPolygon, setContextPolygon] = useState<
      SpatialScope["context"] | null
    >(null);
  const [chosen, setChosen] = useState([
    "landscape",
    "planning",
    "recognition",
  ]);
  const [file, setFile] = useState<CaseFile>();
  const [state, setState] = useState<State>("input"),
    [notice, setNotice] = useState(
      "Wer? Wo? Was? Wähle einen Ort und beschreibe die Frage.",
    ),
    [phase, setPhase] = useState(0),
    [scale, setScale] = useState<Scale>("L");
  const [selected, setSelected] = useState(""),
    [showHidden, setShowHidden] = useState(false),
    [extra, setExtra] = useState(""),
    [dataVersion, setDataVersion] = useState(
      import.meta.env.VITE_GEODATA_BASE_URL || "nicht konfiguriert",
    );
  const result = file?.results.at(-1),
    workspace = file?.workspaces.at(-1);
  const busy = ["preparing_context", "analyzing", "exporting"].includes(state);
  const scope = useMemo(() => {
    try {
      if (!lat.trim() || !lon.trim()) return null;
      const s = scopeFromPoint(Number(lat), Number(lon), Number(radius));
      return {
        ...s,
        project: project ?? s.project,
        context: contextPolygon ?? s.context,
      };
    } catch {
      return null;
    }
  }, [lat, lon, radius, project, contextPolygon]);
  const mapObjects = useMemo(
    () =>
      result
        ? [...result.objects, ...result.site.observations].filter(
            (o) => o.geometry,
          )
        : [],
    [result],
  );
  const hints = sensitiveHints(context);
  const update = (key: keyof UserContext, value: string) => {
    setContext((c) => ({ ...c, [key]: value }));
    if (state === "review_ready") setState(transition(state, "editing"));
  };
  function point(lat: number, lon: number) {
    if (busy) return;
    setLat(lat.toFixed(6));
    setLon(lon.toFixed(6));
    setProject(null);
    setNotice(
      "Projektpunkt geändert. Kontextgebiet bleibt getrennt; neuen Durchlauf bewusst starten.",
    );
  }
  async function upload(
    target: "project" | "context",
    uploadFile: File | undefined,
  ) {
    if (!uploadFile) return;
    try {
      if (uploadFile.size > 2_000_000)
        throw new Error("GeoJSON ist größer als 2 MB.");
      const area = parseProjectAreaGeoJson(await uploadFile.text(), {
        label: target === "project" ? "Projektgebiet" : "Kontextgebiet",
      });
      if (target === "project") {
        setProject(area.geometry);
        setLat(String(area.representativePoint[1]));
        setLon(String(area.representativePoint[0]));
      } else setContextPolygon(area.geometry);
      setNotice(
        `${target === "project" ? "Projektgebiet" : "Kontextgebiet"} geladen. Eingaben vor neuem Durchlauf prüfen.`,
      );
    } catch (error) {
      setState("invalid_geometry");
      setPhase(0);
      setNotice(
        `Ungültige Geometrie: ${error instanceof Error ? error.message : "GeoJSON prüfen."}`,
      );
    }
  }
  async function start() {
    let current = state;
    if (["invalid_geometry", "data_unavailable"].includes(current))
      current = transition(current, "input");
    if (current === "generation_failed")
      current = transition(current, "review_ready");
    try {
      validateContext(context);
    } catch (e) {
      setNotice(String((e as Error).message));
      setPhase(0);
      return;
    }
    try {
      if (!scope)
        throw new Error(
          "Bitte gültige Koordinaten und Kontextradius eingeben.",
        );
      validateScope(scope);
    } catch (e) {
      setState("invalid_geometry");
      setNotice(`Ungültige Geometrie: ${(e as Error).message}`);
      setPhase(0);
      return;
    }
    if (!chosen.length) {
      setNotice("Bitte mindestens eine Perspektive auswählen.");
      setPhase(2);
      return;
    }
    current = transition(current, "preparing_context");
    setState(current);
    setNotice("Kontext wird vorbereitet.");
    try {
      const c = {
        ...(file?.case ?? newCase(context, scope, chosen)),
        context: structuredClone(context),
        spatial: structuredClone(scope),
        perspectives: [...chosen],
        scale,
        dataVersion,
      };
      const invalidation = changes(file?.case, c);
      current = transition(current, "analyzing");
      setState(current);
      setPhase(1);
      setNotice("Deterministische XL-/L-/M-Analyse läuft.");
      let analysis: AnalysisResult;
      if (result && !invalidation.invalidated.includes("E2"))
        analysis = result.analysis;
      else {
        if (invalidation.trigger.includes("data"))
          clearLocalSpatialRequestCache();
        const area = parseProjectAreaGeoJson(
          { type: "Feature", properties: {}, geometry: scope.context },
          { label: "verplant Kontextgebiet (L)" },
        );
        analysis = (
          await runLocationAnalysis({
            ...scope.anchor,
            activeScale: scale,
            projectArea: area,
            enableGeocoding: false,
            enableOverpass: false,
            enableRemoteServices: false,
          })
        ).result;
      }
      setFile(
        appendRun(
          file,
          c,
          analysis,
          import.meta.env.VITE_BUILD_COMMIT ?? "development",
        ),
      );
      setState(transition(current, "review_ready"));
      setPhase(2);
      setNotice(
        "Reflexionsstand bereit. Datenlücken und Grenzen sind Teil des Ergebnisses.",
      );
    } catch (e) {
      setState("data_unavailable");
      setNotice(
        `Daten nicht verfügbar: ${(e as Error).message}. Vorherige Ergebnisse bleiben erhalten.`,
      );
    }
  }
  function edit(id: string, patch: Parameters<typeof editWorkspace>[2]) {
    if (!file) return;
    setFile(editWorkspace(file, id, patch));
    if (state === "review_ready") setState(transition(state, "editing"));
  }
  async function exportFile(format: string) {
    if (!file) return;
    const old = state === "editing" ? "editing" : "review_ready";
    setState(transition(old, "exporting"));
    try {
      if (format === "zip") downloadBlob(await caseToZip(file), "verplant.zip");
      else
        downloadText(
          format === "json"
            ? caseToJson(file)
            : format === "html"
              ? caseToHtml(file)
              : caseToMarkdown(file),
          `verplant.${format}`,
          format === "json"
            ? "application/json"
            : format === "html"
              ? "text/html"
              : "text/markdown",
        );
      setNotice(
        "Versionierter Stand exportiert. Speichern erfolgt nur durch diese Aktion.",
      );
    } catch (e) {
      setNotice(`Export fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setState(transition("exporting", old));
    }
  }
  async function refine() {
    if (!file || !result) return;
    setState("analyzing");
    setNotice(
      "Lokale Frageauswahl läuft; Freitext kann keine Regeln überschreiben.",
    );
    const refinement = await refineLocally(
      contextPackage(file.case, result.site),
      result.objects,
      import.meta.env.VITE_API_BASE_URL,
      import.meta.env.VITE_LOCAL_OLLAMA_MODEL ?? "llama3.1",
    );
    const next = appendRun(
      file,
      file.case,
      result.analysis,
      import.meta.env.VITE_BUILD_COMMIT ?? "development",
    );
    next.runs.at(-1)!.generation = refinement.fallback
      ? "fallback"
      : "local-llm";
    next.runs.at(-1)!.trigger = ["explicit-local-refinement"];
    if (!refinement.fallback)
      next.results
        .at(-1)!
        .objects.push(
          ...refinement.ids.map((id) =>
            object(
              `local:${id}`,
              `Zusätzlich prüfen: ${result.objects.find((o) => o.id === id)!.text}`,
              { kind: "next_step", generation: "local-llm" },
            ),
          ),
        );
    setFile(next);
    setState(refinement.fallback ? "generation_failed" : "review_ready");
    setNotice(
      refinement.fallback
        ? `Lokale Generierung fehlgeschlagen: ${refinement.error} Deterministische Ausgabe bleibt vollständig verfügbar.`
        : "Bestehende Prüffragen lokal ausgewählt; neuer Durchlauf gespeichert.",
    );
  }
  const objects = result
    ? [
        ...result.objects,
        ...result.site.gaps,
        ...result.site.conflicts,
        ...(workspace?.additions ?? []),
      ]
    : [];
  return (
    <main
      className="vp"
      style={
        {
          "--vp-accent": productVariant.tokens.accent,
          "--vp-bg": productVariant.tokens.background,
          "--vp-text": productVariant.tokens.text,
          "--vp-heading": productVariant.tokens.heading,
          "--vp-body": productVariant.tokens.body,
        } as React.CSSProperties
      }
    >
      <header className="vp-header">
        <div>
          <span className="vp-brand">verplant</span>
          <h1>ausprobieren</h1>
        </div>
        <p>Ort verstehen. Perspektive wechseln. Fragen weiterdenken.</p>
        <a href="#kontext">Zur Texteingabe</a>
      </header>
      <p className="vp-boundary">
        Reflexions- und Orientierungsinstrument. Keine Planungslösung,
        rechtliche Prüfung oder Vertretung betroffener Menschen.
      </p>
      <nav className="vp-phases" aria-label="Arbeitsphasen">
        {phases.map((p, i) => (
          <button
            key={p}
            aria-current={phase === i ? "step" : undefined}
            onClick={() => setPhase(i)}
          >
            {i + 1} {p}
          </button>
        ))}
      </nav>
      <div role="status" aria-live="polite" className="vp-status">
        {notice}{" "}
        {file &&
          `Durchlauf ${file.runs.length} · Arbeitsstand ${workspace?.version}`}
      </div>
      <div className="vp-workspace">
        <div className="vp-map-column">
          <div className="vp-scale" aria-label="Maßstab">
            {(["XL", "L", "M"] as Scale[]).map((s) => (
              <button
                key={s}
                aria-pressed={scale === s}
                onClick={() => setScale(s)}
              >
                {s}{" "}
                {s === "XL"
                  ? "Stadt / Region"
                  : s === "L"
                    ? "Quartier"
                    : "Straßenraum"}
              </button>
            ))}
          </div>
          <SpatialMap
            scope={scope}
            analysis={result?.analysis}
            scale={scale}
            objects={mapObjects}
            selected={selected}
            onPoint={point}
            onSelect={(id) => {
              setSelected(id);
              setPhase(3);
              setTimeout(
                () => document.getElementById(`obj-${id}`)?.focus(),
                0,
              );
            }}
          />
          <p className="vp-small">
            Textliche Alternative: Koordinaten, Gebiete und Quellenbefunde im
            Kontextbereich. XL: Verwaltungsraum · L: Kontextpolygon · M:
            Straßenabschnitt.
          </p>
        </div>
        <section
          id="kontext"
          className="vp-inspector"
          aria-label="Kontext und Reflexion"
        >
          <h2>{phases[phase]}</h2>
          <details open={phase === 0}>
            <summary>Wer / Wo / Was bearbeiten</summary>
            <fieldset disabled={busy}>
              <legend>Wer? Ausgangsrahmen</legend>
              <label>
                Ausgangsrolle
                <select
                  value={context.role}
                  onChange={(e) => update("role", e.target.value)}
                >
                  <option value="">Bitte wählen</option>
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <p>
                Rollen sind Startperspektiven, keine Festschreibung einer
                Person.
              </p>
              <details>
                <summary>Ausgangsrahmen differenzieren</summary>
                {(
                  [
                    "description",
                    "knowledge",
                    "institution",
                    "projectRelation",
                    "affectedness",
                  ] as const
                ).map((k) => (
                  <label key={k}>
                    {labels[k]}
                    <textarea
                      maxLength={5000}
                      value={context[k]}
                      onChange={(e) => update(k, e.target.value)}
                    />
                  </label>
                ))}
              </details>
            </fieldset>
            <fieldset id="raumeingabe" disabled={busy}>
              <legend>Wo? Zwei getrennte Bezugsräume</legend>
              <div className="vp-fields">
                <label>
                  Breitengrad
                  <input
                    inputMode="decimal"
                    value={lat}
                    onChange={(e) => {
                      setLat(e.target.value);
                      setProject(null);
                    }}
                  />
                </label>
                <label>
                  Längengrad
                  <input
                    inputMode="decimal"
                    value={lon}
                    onChange={(e) => {
                      setLon(e.target.value);
                      setProject(null);
                    }}
                  />
                </label>
              </div>
              <label>
                Kontextradius (m)
                <input
                  type="number"
                  min="100"
                  max="1700"
                  value={radius}
                  onChange={(e) => {
                    setRadius(e.target.value);
                    setContextPolygon(null);
                  }}
                />
              </label>
              <p>
                Projekt: {project ? "hochgeladenes Polygon" : "gewählter Punkt"}{" "}
                · Kontext:{" "}
                {contextPolygon
                  ? "eigenes Polygon"
                  : `${radius} m um den Bezugspunkt`}
                . Punkte und WGS84-Polygone werden unterstützt, Linien noch
                nicht. Polygon-Diagonale maximal 5 km als technische
                Browsergrenze.
              </p>
              <label>
                Projektgebiet hochladen
                <input
                  type="file"
                  accept=".json,.geojson"
                  onChange={(e) => void upload("project", e.target.files?.[0])}
                />
              </label>
              <label>
                Kontextgebiet hochladen
                <input
                  type="file"
                  accept=".json,.geojson"
                  onChange={(e) => void upload("context", e.target.files?.[0])}
                />
              </label>
              <button
                onClick={() => {
                  setProject(null);
                  setContextPolygon(null);
                }}
              >
                Auf Punkt und Radius zurücksetzen
              </button>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Was? Problem und Bearbeitungsmodus</legend>
              <label>
                Bearbeitungsmodus
                <select
                  value={context.mode}
                  onChange={(e) => update("mode", e.target.value)}
                >
                  <option value="explore">Erkunden</option>
                  <option value="project_check">Projekt prüfen</option>
                </select>
              </label>
              {(["observed", "question", "goal", "intervention"] as const).map(
                (k) => (
                  <label key={k}>
                    {labels[k]}
                    <textarea
                      maxLength={5000}
                      value={context[k]}
                      onChange={(e) => update(k, e.target.value)}
                    />
                  </label>
                ),
              )}
              <details>
                <summary>Ursachen, Konflikte und Rahmen ergänzen</summary>
                {(
                  [
                    "assumedCause",
                    "conflicts",
                    "groups",
                    "horizon",
                    "approaches",
                    "priorities",
                  ] as const
                ).map((k) => (
                  <label key={k}>
                    {labels[k]}
                    <textarea
                      maxLength={5000}
                      value={context[k]}
                      onChange={(e) => update(k, e.target.value)}
                    />
                  </label>
                ))}
              </details>
            </fieldset>
          </details>
          {phase === 0 && (
            <>
              <p>
                Der Fall bleibt im Arbeitsspeicher bis zum bewussten Export.
                Kein automatisches Speichern, keine externe KI. Koordinaten und
                Texte können vertraulich sein.
              </p>
              {hints.length > 0 && (
                <p role="alert">
                  Möglicherweise sensible Angaben: {hints.join(", ")}. Bitte vor
                  Export oder lokaler KI-Nutzung prüfen; die Erkennung ist nicht
                  vollständig.
                </p>
              )}
            </>
          )}
          <button
            className="vp-primary"
            disabled={busy}
            onClick={() => void start()}
          >
            {file ? "Neuen Durchlauf starten" : "Analyse starten"}
          </button>
          {phase === 1 && (
            <>
              <h3>Standortprofil</h3>
              <label>
                Datenstand / Quellenversion
                <input
                  value={dataVersion}
                  onChange={(e) => setDataVersion(e.target.value)}
                />
              </label>
              <p>
                Geodaten:{" "}
                {import.meta.env.VITE_GEODATA_MODE === "none"
                  ? "nicht konfiguriert. Keine ortsspezifische Vollständigkeit."
                  : "konfigurierter Datenhost; Abdeckung je Quelle prüfen."}{" "}
                Live-Dienste sind in diesem ersten Pfad ausgeschaltet.
              </p>
              {result?.site.factors.map((f) => (
                <p key={f.id}>
                  {f.label}:{" "}
                  {f.status === "available"
                    ? `${f.indicatorIds.length} Indikatorverweise`
                    : "nicht verfügbar — zusätzliche Klärung nötig"}
                </p>
              ))}
              <details>
                <summary>Pipeline und Aussagegrenzen</summary>
                {result?.site.pipeline.map((p) => (
                  <p key={p.step}>
                    {p.step}. {p.label}: {p.detail}
                  </p>
                ))}
              </details>
              <h3>{scale}-Quellenbefunde</h3>
              {result?.site.observations
                .filter(
                  (o) =>
                    result.analysis.indicators.find(
                      (i) => i.id === o.indicatorIds[0],
                    )?.scale === scale,
                )
                .map((o) => (
                  <article key={o.id}>
                    <p>
                      {CATEGORY_LABELS[o.category]}: {o.text}
                    </p>
                    <details>
                      <summary>Quellen und Caveats</summary>
                      <p>{o.sourceIds.join(", ")}</p>
                      {o.caveats.map((c, i) => (
                        <p key={i}>{c}</p>
                      ))}
                    </details>
                  </article>
                ))}
            </>
          )}
          {phase === 2 && (
            <>
              <h3>Perspektiven auswählen</h3>
              {profiles.map((p) => (
                <label key={p.id} className="vp-check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    onChange={(e) =>
                      setChosen((x) =>
                        e.target.checked
                          ? [...x, p.id]
                          : x.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>
                    {p.name}
                    <small>
                      {p.questions[0]}{" "}
                      {result?.objects.find((o) => o.id === `profile:${p.id}`)
                        ?.text ??
                        "Kuratierte Prüfperspektive; Relevanz im Fall prüfen."}
                    </small>
                  </span>
                </label>
              ))}
              <p>
                Auswahländerungen gelten erst im neuen Durchlauf. Profile sind
                redaktionelle Entwürfe; soziale Gruppen werden nicht gewichtet
                oder vertreten.
              </p>
              <details>
                <summary>Methodische Problemzerlegung</summary>
                {result?.decomposition.map((d) => (
                  <p key={d.field}>
                    {labels[d.field as keyof UserContext]}:{" "}
                    {d.text || "nicht angegeben"} — {d.classification}
                  </p>
                ))}
              </details>
              {file && (
                <button disabled={busy} onClick={() => void refine()}>
                  Lokale KI-Frageauswahl ausdrücklich starten
                </button>
              )}
              <p>
                Optional: Nur das kontrollierte Kontextpaket an einen
                konfigurierten lokalen Ollama-Proxy. Keine neuen Aussagen;
                ungültige Antworten fallen auf die deterministische Ausgabe
                zurück.
              </p>
            </>
          )}
          {(phase === 2 || phase === 3) && result && (
            <>
              <h3>Reflexionsobjekte</h3>
              <label className="vp-check">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                Ausgeblendete anzeigen
              </label>
              {objects
                .filter((o) => showHidden || !workspace?.edits[o.id]?.hidden)
                .map((o) => {
                  const e = workspace?.edits[o.id];
                  return (
                    <article
                      id={`obj-${o.id}`}
                      tabIndex={-1}
                      key={o.id}
                      className={selected === o.id ? "vp-selected" : ""}
                    >
                      <strong>{CATEGORY_LABELS[o.category]}</strong>
                      <p>{o.text}</p>
                      <small>
                        Konfidenz:{" "}
                        {o.confidence === "high"
                          ? "hoch"
                          : o.confidence === "medium"
                            ? "mittel"
                            : "niedrig"}{" "}
                        · Unsicherheit: {UNCERTAINTY_LABELS[o.uncertainty]}
                      </small>
                      {e?.needsReview && (
                        <p>
                          Übernommen aus früherem Durchlauf — erneut prüfen.
                        </p>
                      )}
                      <details>
                        <summary>Quellen und Caveats</summary>
                        <p>
                          Quellen:{" "}
                          {o.sourceIds.join(", ") ||
                            "keine; keine Tatsachenbehauptung"}
                        </p>
                        <p>
                          Indikatoren: {o.indicatorIds.join(", ") || "keine"}
                        </p>
                        {o.caveats.map((c, i) => (
                          <p key={i}>{c}</p>
                        ))}
                      </details>
                      {o.geometry && (
                        <button
                          onClick={() => {
                            setSelected(o.id);
                            document.getElementById("karte")?.focus();
                            document
                              .getElementById("karte")
                              ?.scrollIntoView({ block: "nearest" });
                          }}
                        >
                          Kartenbezug zeigen
                        </button>
                      )}
                      <div className="vp-actions">
                        <button
                          onClick={() => edit(o.id, { hidden: !e?.hidden })}
                        >
                          {e?.hidden ? "Einblenden" : "Ausblenden"}
                        </button>
                        <button
                          aria-pressed={e?.relevant ?? false}
                          onClick={() => edit(o.id, { relevant: !e?.relevant })}
                        >
                          Relevant
                        </button>
                        {e?.needsReview && (
                          <button
                            onClick={() => edit(o.id, { needsReview: false })}
                          >
                            Übernahme geprüft
                          </button>
                        )}
                      </div>
                      <label>
                        Kommentar
                        <textarea
                          maxLength={5000}
                          value={e?.comment ?? ""}
                          onChange={(event) =>
                            edit(o.id, { comment: event.target.value })
                          }
                        />
                      </label>
                    </article>
                  );
                })}
              <h3>Begründete Beziehungen</h3>
              {result.relationships.map((r) => (
                <p key={r.id}>
                  {r.from} → {r.to}: {r.reason} ({RELATION_LABELS[r.type]};{" "}
                  {r.evidence})
                </p>
              ))}
              <label>
                Eigene Perspektive / Raumhinweis ergänzen
                <textarea
                  maxLength={5000}
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                />
              </label>
              <button
                disabled={!extra.trim()}
                onClick={() => {
                  if (!file || !workspace) return;
                  const next = {
                    ...workspace,
                    version: workspace.version + 1,
                    updatedAt: new Date().toISOString(),
                    additions: [
                      ...workspace.additions,
                      object(`user:${crypto.randomUUID()}`, extra, {
                        category: "user_statement",
                        kind: "reflection",
                        generation: "user",
                      }),
                    ],
                  };
                  setFile({ ...file, workspaces: [...file.workspaces, next] });
                  setExtra("");
                }}
              >
                Ergänzung übernehmen
              </button>
            </>
          )}
          {phase === 4 && (
            <>
              <h3>Versionierten Stand sichern</h3>
              <p>
                Export enthält alle Durchläufe, Kommentare, Ausblendungen,
                Datenlücken, Quellen und Unsicherheiten. Weitergabe nur durch
                deine ausdrückliche Aktion.
              </p>
              <div className="vp-actions">
                {["json", "md", "html", "zip"].map((f) => (
                  <button
                    key={f}
                    disabled={!file || busy}
                    onClick={() => void exportFile(f)}
                  >
                    {f.toUpperCase()} exportieren
                  </button>
                ))}
              </div>
              <h3>Durchlaufhistorie</h3>
              {file?.runs.map((r) => (
                <details key={r.id}>
                  <summary>
                    Durchlauf {r.sequence} · Eingabe {r.inputVersion} ·{" "}
                    {r.status === "partial" ? "Teilergebnis" : "bereit"}
                  </summary>
                  <p>
                    Auslöser: {r.trigger.join(", ")}; neu berechnet:{" "}
                    {r.invalidated.join(", ") || "explizite Wiederholung"}
                  </p>
                  <p>
                    {r.createdAt}; Software {r.versions.software}
                  </p>
                </details>
              ))}
              <p>
                „Erfahren“, „Mitmachen“, Zusammenarbeit und Veröffentlichung
                sind noch nicht angebunden. Es werden keine Kontakte oder
                Inhalte erfunden.
              </p>
            </>
          )}
          {!result && phase !== 0 && (
            <p>
              Noch kein Durchlauf vorhanden. Eingaben bleiben über „Wer / Wo /
              Was bearbeiten“ erreichbar.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
