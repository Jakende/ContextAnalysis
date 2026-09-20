import { bufferPolygon } from "../analysis/geometry";
import {
  parseProjectAreaGeoJson,
  projectAreaContainsCoordinate,
} from "../projectArea/geometry";
import {
  SCHEMA_VERSION,
  ROLES,
  type Case,
  type CaseFile,
  type Edit,
  type State,
  type UserContext,
  type SpatialScope,
  type Workspace,
} from "./types";
export const emptyContext: UserContext = {
  role: "",
  description: "",
  knowledge: "",
  institution: "",
  projectRelation: "",
  affectedness: "",
  observed: "",
  assumedCause: "",
  goal: "",
  intervention: "",
  question: "",
  conflicts: "",
  groups: "",
  horizon: "",
  approaches: "",
  priorities: "",
  mode: "explore",
};
export const TRANSITIONS: Record<State, State[]> = {
  input: ["preparing_context", "invalid_geometry"],
  preparing_context: [
    "analyzing",
    "invalid_geometry",
    "data_unavailable",
    "input",
  ],
  analyzing: ["review_ready", "data_unavailable", "generation_failed"],
  review_ready: [
    "editing",
    "exporting",
    "preparing_context",
    "generation_failed",
  ],
  editing: [
    "preparing_context",
    "exporting",
    "invalid_geometry",
    "generation_failed",
  ],
  exporting: ["editing", "review_ready"],
  invalid_geometry: ["input"],
  data_unavailable: ["input", "review_ready", "preparing_context"],
  generation_failed: ["review_ready", "editing"],
};
export function transition(state: State, next: State): State {
  if (!TRANSITIONS[state].includes(next))
    throw new Error(`Invalid transition ${state} -> ${next}`);
  return next;
}
export const INVALIDATION = {
  geometry: ["E2", "E3", "E4", "E5", "E6"],
  data: ["E2", "E3", "E4", "E5", "E6"],
  context: ["E3", "E4", "E5", "E6"],
  perspectives: ["E3", "E4", "E5", "E6"],
  workspace: ["E7"],
} as const;
export function changes(
  previous: Case | undefined,
  next: Case,
): { trigger: string[]; invalidated: string[] } {
  if (!previous)
    return {
      trigger: ["initial"],
      invalidated: ["E2", "E3", "E4", "E5", "E6"],
    };
  const trigger: (keyof typeof INVALIDATION)[] = [];
  if (
    JSON.stringify(previous.spatial) !== JSON.stringify(next.spatial) ||
    previous.scale !== next.scale
  )
    trigger.push("geometry");
  if (previous.dataVersion !== next.dataVersion) trigger.push("data");
  if (JSON.stringify(previous.context) !== JSON.stringify(next.context))
    trigger.push("context");
  if (
    JSON.stringify(previous.perspectives) !== JSON.stringify(next.perspectives)
  )
    trigger.push("perspectives");
  return {
    trigger,
    invalidated: [...new Set(trigger.flatMap((key) => [...INVALIDATION[key]]))],
  };
}
export function validateContext(value: unknown): UserContext {
  if (!value || typeof value !== "object")
    throw new Error("Ausgangsrahmen fehlt.");
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(emptyContext))
    if (typeof v[key] !== "string" || (v[key] as string).length > 5000)
      throw new Error(`Ungültiges Kontextfeld: ${key}`);
  if (!ROLES.includes(v.role as (typeof ROLES)[number]))
    throw new Error("Bitte eine Ausgangsrolle wählen.");
  if (v.role === "Freie Rolle" && !(v.description as string).trim())
    throw new Error("Bitte die freie Rolle beschreiben.");
  if (
    (v.observed as string).trim().length < 10 ||
    (v.question as string).trim().length < 10
  )
    throw new Error(
      "Bitte Zustand und Leitfrage verständlich beschreiben (je mindestens 10 Zeichen).",
    );
  if (!["explore", "project_check"].includes(v.mode as string))
    throw new Error("Dieser Bearbeitungsmodus ist noch nicht verfügbar.");
  if (
    v.mode === "project_check" &&
    (!(v.goal as string).trim() || !(v.intervention as string).trim())
  )
    throw new Error(
      "Für die Projektprüfung bitte Ziel und vorgeschlagene Intervention ergänzen.",
    );
  return Object.fromEntries(
    Object.keys(emptyContext).map((k) => [k, v[k]]),
  ) as UserContext;
}
export function sensitiveHints(context: UserContext): string[] {
  const text = Object.values(context).join(" ");
  return [
    /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(text) ? "E-Mail-Adresse" : null,
    /(?:\+\d[\d ()-]{7,}|\b\d{10,}\b)/.test(text)
      ? "Telefon-/Identifikationsnummer"
      : null,
    /vertraulich|diagnose|patient|gesundheitsdaten|geheim|passwort|api.?key/i.test(
      text,
    )
      ? "vertrauliche oder sensible Angaben"
      : null,
  ].filter((s): s is string => Boolean(s));
}
export function scopeFromPoint(
  lat: number,
  lon: number,
  radius: number,
): SpatialScope {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 85 ||
    Math.abs(lon) > 180
  )
    throw new Error(
      "Koordinaten außerhalb WGS84 (Breite −85 bis 85, Länge −180 bis 180).",
    );
  if (!Number.isFinite(radius) || radius < 100 || radius > 1700)
    throw new Error(
      "Kontextradius muss zwischen 100 und 1700 m liegen (Browser-Geometriegrenze).",
    );
  return {
    project: { type: "Point", coordinates: [lon, lat] },
    context: bufferPolygon(lat, lon, radius),
    anchor: { lat, lon },
    contextRadius: radius,
  };
}
export function validateScope(scope: SpatialScope): void {
  scopeFromPoint(scope.anchor.lat, scope.anchor.lon, 500);
  const area = parseProjectAreaGeoJson({
    type: "Feature",
    properties: {},
    geometry: scope.context,
  });
  if (
    !projectAreaContainsCoordinate(area, [scope.anchor.lon, scope.anchor.lat])
  )
    throw new Error("Der Bezugspunkt muss im Kontextgebiet liegen.");
  if (scope.project.type === "Point") {
    if (
      scope.project.coordinates.length !== 2 ||
      scope.project.coordinates[0] !== scope.anchor.lon ||
      scope.project.coordinates[1] !== scope.anchor.lat
    )
      throw new Error("Projektpunkt und Bezugspunkt müssen übereinstimmen.");
  } else if (
    scope.project.type === "Polygon" ||
    scope.project.type === "MultiPolygon"
  ) {
    const project = parseProjectAreaGeoJson({
      type: "Feature",
      properties: {},
      geometry: scope.project,
    });
    if (
      !projectAreaContainsCoordinate(project, [
        scope.anchor.lon,
        scope.anchor.lat,
      ])
    )
      throw new Error("Der Bezugspunkt muss im Projektgebiet liegen.");
  } else throw new Error("Projektgeometrie nicht unterstützt.");
  if (JSON.stringify(scope.project) === JSON.stringify(scope.context))
    throw new Error(
      "Projekt- und Kontextgebiet müssen getrennt definiert sein.",
    );
}
export function newCase(
  context: UserContext,
  spatial: SpatialScope,
  perspectives: string[],
): Case {
  validateContext(context);
  validateScope(spatial);
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    inputVersion: 1,
    context: structuredClone(context),
    spatial: structuredClone(spatial),
    perspectives: [...perspectives],
    scale: "L",
    dataVersion: "unconfigured",
    references: [],
  };
}
export function carryWorkspace(
  previous: Workspace | undefined,
  runId: string,
): Workspace {
  return {
    version: (previous?.version ?? 0) + 1,
    runId,
    updatedAt: new Date().toISOString(),
    edits: Object.fromEntries(
      Object.entries(previous?.edits ?? {}).map(([id, edit]) => [
        id,
        { ...edit, carriedFrom: previous!.runId, needsReview: true },
      ]),
    ),
    additions: (previous?.additions ?? []).map((o) => ({
      ...o,
      caveats: [
        ...o.caveats,
        "Aus vorherigem Durchlauf übernommen; erneut prüfen.",
      ],
    })),
  };
}
export function editWorkspace(
  file: CaseFile,
  id: string,
  patch: Partial<Edit>,
): CaseFile {
  const old = file.workspaces.at(-1)!;
  const next: Workspace = {
    ...old,
    version: old.version + 1,
    updatedAt: new Date().toISOString(),
    edits: {
      ...old.edits,
      [id]: {
        ...(old.edits[id] ?? {
          comment: "",
          hidden: false,
          relevant: false,
          needsReview: false,
        }),
        ...patch,
      },
    },
  };
  return { ...file, workspaces: [...file.workspaces, next] };
}
