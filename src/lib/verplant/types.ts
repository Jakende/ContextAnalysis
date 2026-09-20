import type { Point, Polygon, MultiPolygon, Geometry } from "geojson";
import type { AnalysisResult, Confidence, Indicator, Scale } from "../types";
export const SCHEMA_VERSION = "verplant-case/1.0.0";
export const PROFILE_VERSION = "verplant-profiles/1.0.0";
export const ROLES = [
  "Landschaftsarchitektur",
  "Architektur",
  "Innenarchitektur",
  "Landschaftsplanung",
  "Stadtplanung",
  "Raumplanung",
  "Verwaltung",
  "Politik",
  "Naturschutz",
  "Tierschutz",
  "Wissenschaft",
  "Soziologie",
  "Gesundheitswissenschaft",
  "Projektentwicklung",
  "Initiative",
  "Freie Rolle",
] as const;
export type Mode =
  | "explore"
  | "project_check"
  | "compare_perspectives"
  | "prepare_participation"
  | "collaborate";
export type UserContext = {
  role: string;
  description: string;
  knowledge: string;
  institution: string;
  projectRelation: string;
  affectedness: string;
  observed: string;
  assumedCause: string;
  goal: string;
  intervention: string;
  question: string;
  conflicts: string;
  groups: string;
  horizon: string;
  approaches: string;
  priorities: string;
  mode: Mode;
};
export type SpatialScope = {
  project: Point | Polygon | MultiPolygon;
  context: Polygon | MultiPolygon;
  anchor: { lat: number; lon: number };
  contextRadius?: number;
};
export type Case = {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  inputVersion: number;
  context: UserContext;
  spatial: SpatialScope;
  scale: Scale;
  perspectives: string[];
  dataVersion: string;
  references: string[];
};
export type StatementCategory =
  | "source_fact"
  | "computed_indicator"
  | "interpretation"
  | "open_question"
  | "user_statement"
  | "participation_perspective";
export const CATEGORY_LABELS: Record<StatementCategory, string> = {
  source_fact: "Quellenbefund",
  computed_indicator: "Berechneter Indikator",
  interpretation: "Vorläufige Deutung",
  open_question: "Offene Frage",
  user_statement: "Nutzer:innen-Aussage",
  participation_perspective: "Beteiligungsbedarf",
};
export type ObjectKind =
  | "perspective"
  | "finding"
  | "hypothesis"
  | "question"
  | "relationship"
  | "spatial_hint"
  | "data_gap"
  | "next_step"
  | "reflection";
export type Uncertainty =
  | "none"
  | "coverage"
  | "method"
  | "temporal"
  | "normative"
  | "unverified"
  | "source_conflict";
export type ResultObject = {
  id: string;
  kind: ObjectKind;
  profileId: string;
  perspectiveType: "professional" | "institutional" | "participation";
  category: StatementCategory;
  text: string;
  indicatorIds: string[];
  sourceIds: string[];
  confidence: Confidence;
  caveats: string[];
  uncertainty: Uncertainty;
  generation: "deterministic" | "local-llm" | "user";
  createdAt: string;
  status: "original";
  geometry?: Geometry;
  spatialScope?: "project" | "context" | "indicator";
};
export type Relationship = {
  id: string;
  from: string;
  to: string;
  type: "tradeoff" | "synergy" | "dependency" | "followup";
  reason: string;
  evidence: "user_hypothesis" | "question" | "supported";
  indicatorIds: string[];
  sourceIds: string[];
};
export type PerspectiveProfile = {
  id: string;
  name: string;
  category: ResultObject["perspectiveType"];
  scope: string;
  questions: string[];
  terms: string[];
  indicatorPatterns: string[];
  interactions: string[];
  limits: string[];
  knowledgeRefs: string[];
  version: string;
  reviewStatus: "editorial-draft";
  dimensions: {
    expertise: string;
    institution: string;
    affectedness: string;
    decisionPower: string;
    recognition: string;
    participation: string;
  };
};
export type SiteProfile = {
  indicators: Indicator[];
  observations: ResultObject[];
  gaps: ResultObject[];
  conflicts: ResultObject[];
  factors: {
    id: string;
    label: string;
    indicatorIds: string[];
    status: "available" | "not available";
  }[];
  pipeline: {
    step: number;
    label: string;
    status: "done" | "limited";
    detail: string;
  }[];
};
export type Run = {
  id: string;
  caseId: string;
  sequence: number;
  inputVersion: number;
  input: Case;
  trigger: string[];
  invalidated: string[];
  createdAt: string;
  versions: {
    schema: string;
    profiles: string;
    software: string;
    analysis: string;
    sources: Record<string, string>;
  };
  status: "partial" | "ready";
  generation: "deterministic" | "fallback" | "local-llm";
};
export type Result = {
  runId: string;
  schemaVersion: string;
  analysis: AnalysisResult;
  site: SiteProfile;
  objects: ResultObject[];
  relationships: Relationship[];
  decomposition: { field: string; text: string; classification: string }[];
  steps: string[];
};
export type Edit = {
  comment: string;
  hidden: boolean;
  relevant: boolean;
  carriedFrom?: string;
  needsReview: boolean;
};
export type Workspace = {
  version: number;
  runId: string;
  edits: Record<string, Edit>;
  additions: ResultObject[];
  updatedAt: string;
};
export type CaseFile = {
  schemaVersion: typeof SCHEMA_VERSION;
  case: Case;
  runs: Run[];
  results: Result[];
  workspaces: Workspace[];
};
export type State =
  | "input"
  | "preparing_context"
  | "analyzing"
  | "review_ready"
  | "editing"
  | "exporting"
  | "invalid_geometry"
  | "data_unavailable"
  | "generation_failed";
export type ContextPackage = {
  case: { id: string; inputVersion: number; mode: Mode };
  spatial_scope: SpatialScope;
  site_facts: Indicator[];
  data_gaps: string[];
  perspectives: PerspectiveProfile[];
  knowledge_refs: string[];
  user_hypotheses: UserContext;
  instructions: { schema: string; rule: string };
};

export const UNCERTAINTY_LABELS: Record<Uncertainty, string> = {
  none: "keine zusätzliche Unsicherheit angegeben",
  coverage: "Datenabdeckung",
  method: "Methodik",
  temporal: "Zeitstand",
  normative: "Wertentscheidung",
  unverified: "nicht verifiziert",
  source_conflict: "Quellenkonflikt",
};
export const RELATION_LABELS: Record<Relationship["type"], string> = {
  tradeoff: "möglicher Zielkonflikt",
  synergy: "mögliche Synergie",
  dependency: "zu prüfende Abhängigkeit",
  followup: "Folgefrage",
};
