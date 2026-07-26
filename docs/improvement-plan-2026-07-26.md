# Urban Context Analysis — Improvement Goals

Date: 2026-07-26  
Status: committed execution plan  
Planning horizon: next 3 implementation cycles

## 1. Decision and product frame

The next work should turn the current feature-complete MVP into a dependable,
measurable analysis product. The product remains map-first and direct. It
should not gain a guided workflow, a heavy server-side workflow UI, or
LLM-generated metrics.

The next release decision is:

> Can a user define a point or project area, receive a fast and trustworthy
> analysis, understand the evidence behind the KPI result, and export the same
> result without hidden data or context mismatches?

The answer should be demonstrated through regression evidence rather than
assumed from feature presence.

## 2. Evidence reviewed

The plan is based on the repository state at `fc76aa5`:

- Typecheck, production build, UI validation, KPI, benchmark, project-area,
  spatial-area, scenario, and data-release validations exist and pass.
- The slim UI build is approximately 5.4 MB; the immutable geodata release is
  2.21 GB with 9,363 assets.
- `public/data/` occupies about 4 GB locally, while only three release-facing
  files are tracked. Runtime and deployment storage are therefore already
  conceptually separated, but production hosting is not finished.
- Munich has the complete canonical regression set. Frankfurt and Rosenheim
  still have empty Urban Atlas and Overture coverage.
- Benchmark ingestion is validated, but the runtime peer values remain
  illustrative rather than observed.
- Scenario geometry is separate and exportable, but scenario KPI effects are
  intentionally unavailable.
- The main maintainability hotspots are:
  - `src/components/map/MapView.tsx`: approximately 3,438 lines;
  - `src/styles/app.css`: approximately 2,732 lines;
  - `src/lib/analysis/l/analyzeL.ts`: approximately 1,842 lines;
  - `src/lib/data/localSpatial.ts`: approximately 1,243 lines.
- Browser QA was performed during the previous implementation pass, but the
  repeatable project-area and scenario flows are not yet stored as repository
  Playwright tests.

## 3. KPI operating framework

These are product-health KPIs for improving the application. They are separate
from the urban-analysis KPIs shown to end users.

Targets are provisional until the baseline harness in Goal 1 records at least
30 deterministic runs per regression context.

### Primary KPI A — Usable analysis completion rate

Definition:

```text
analysis attempts reaching a usable partial or complete result
÷ valid analysis attempts started
```

Provisional target:

- at least 98% across the regression matrix;
- 100% for local-only results when external APIs are deliberately unavailable.

Drivers:

- source-adapter success and timeout handling;
- geometry-overlay completion;
- local index coverage;
- absence of uncaught browser errors.

Guardrail:

- a “usable partial result” must expose unavailable modules and caveats; it
  cannot silently substitute invented or lower-quality evidence.

### Primary KPI B — Time to first usable analysis

Definition:

```text
time from valid point/project-area confirmation
to the first rendered structured fact sheet with local indicators
```

Provisional target on a normal laptop:

- median below 2 seconds for preprocessed local evidence;
- 95th percentile below 5 seconds;
- live Overpass, routing, geocoding, and Ollama work remains progressive and
  cannot block the first usable result.

Drivers:

- local shard lookup time;
- polygon overlay time;
- React commit/render time;
- transferred bytes and parsed feature count.

Guardrail:

- performance work must not weaken source provenance, spatial precision, or
  partial-result semantics.

### Primary KPI C — Trusted KPI evidence coverage

Definition:

```text
core KPI families with valid comparable evidence
÷ six core KPI families expected for the selected context
```

The numerator requires:

- resolved source registry IDs;
- method, timestamp, confidence, and caveats;
- matching spatial context;
- no fallback presented as measured or routed evidence.

Provisional release targets:

- Munich regression contexts: at least 5 of 6 core KPI families;
- new cities: no fixed score target until the city coverage gate is declared;
- benchmark rank only when peer context, radius/area grain, and source version
  are comparable.

Drivers:

- canonical source coverage;
- indicator calculation success;
- observed benchmark availability.

Guardrails:

- missing evidence lowers coverage and confidence instead of being imputed;
- scenario proposals never mutate observed evidence.

### Product guardrails

Every release must preserve:

- zero unresolved indicator source IDs;
- zero benchmark ranks for incompatible contexts;
- zero scenario features in observed-source collections;
- zero horizontal overflow at 390 px and 1,440 px reference widths;
- zero uncaught errors in the core point, project-area, scale, layer, scenario,
  and export browser flows;
- UI and data releases deployable independently;
- structured exports reproduce the KPI score displayed in the UI.

## 4. Prioritized implementation goals

## Goal 1 — Establish one repeatable release gate

Priority: P0  
Suggested duration: 1 implementation cycle

Deliverables:

1. Add a single `npm run validate` command that runs typecheck, contract tests,
   UI validation, release-manifest validation without unnecessary hash work,
   and a slim production build in a fresh staging directory.
2. Move the validated browser flows into repository Playwright tests:
   - point analysis;
   - GeoJSON project-area upload;
   - polygon and rectangle drawing;
   - XL/L/M switching;
   - scenario add/remove;
   - scenario and analysis export visibility;
   - 390 px and 1,440 px overflow checks;
   - Nominatim, Overpass, routing, and Ollama outage behavior.
3. Record deterministic timing marks for:
   - app ready;
   - local-data lookup;
   - first usable fact sheet;
   - live enrichment complete;
   - export generation.
4. Store bounded benchmark results as CI artifacts; do not add runtime
   telemetry or external tracking by default.

Acceptance:

- one command can reproduce the local release gate;
- the regression browser suite has no console errors;
- baseline measurements exist for Munich point, Munich project area, Frankfurt,
  Rosenheim, offline APIs, and a complex multipart boundary;
- flaky external requests are stubbed in contract tests and tested separately
  as optional integration checks.

Commit slices:

1. `test: add integrated validation command`
2. `test: add map workspace browser regression suite`
3. `perf: record bounded analysis timing baselines`

## Goal 2 — Make data coverage production-deployable

Priority: P0  
Suggested duration: 1–2 implementation cycles

Deliverables:

1. Choose the immutable data host and deploy
   `uca-data-edde681ba2da0b93`.
2. Pin the production UI to the release URL and verify CORS, cache headers,
   range requests, rollback, and attribution delivery.
3. Populate and version canonical Urban Atlas and Overture outputs for
   Frankfurt and Rosenheim.
4. Add municipality/FUA coverage percentages and semantic quality thresholds:
   valid geometry, required attributes, source age, expected class coverage,
   and non-empty analytical intersection.
5. Measure representative access patterns before choosing PMTiles, MBTiles,
   GeoPackage range access, or an indexed spatial API.

Acceptance:

- UI and data releases can roll forward and back independently;
- Munich, Frankfurt, and Rosenheim pass declared city gates;
- a project area downloads only intersecting shards;
- no cache tree or duplicate point extract enters the UI artifact;
- data availability and semantic quality are separate statuses.

Commit slices:

1. `ops: add immutable data deployment configuration`
2. `data: add Frankfurt and Rosenheim canonical coverage`
3. `data: add semantic city coverage gates`
4. `perf: select range-friendly storage from measured access results`

## Goal 3 — Replace illustrative benchmarks with observed peers

Priority: P1  
Suggested duration: 1 implementation cycle after Goal 2 source gates

Deliverables:

1. Produce observed peer tables in this order:
   - Munich districts;
   - Bavarian cities;
   - German cities;
   - European FUAs.
2. Define one supported observation grain per peer set:
   administrative boundary, fixed radius, or explicitly matched project-area
   cohort.
3. Record source version, observation date, calculation version, confidence,
   exclusions, and denominator for every peer value.
4. Add distribution checks, outlier review, duplicate detection, and minimum
   peer-count gates.
5. Keep the illustrative fixture only for UI development and tests.

Acceptance:

- every displayed rank can be rebuilt from source-controlled inputs;
- no rank is emitted below the minimum comparable peer count;
- project-area benchmarking remains unavailable until a reviewed cohort and
  tolerance rule exist;
- UI, JSON, CSV, GPKG, Markdown, and HTML expose the same peer result.

Commit slices:

1. `data: ingest observed Munich district benchmarks`
2. `data: add benchmark distribution quality gates`
3. `feat: expose versioned observed peer cohorts`

## Goal 4 — Reduce frontend and analysis maintenance risk

Priority: P1  
Suggested duration: 1–2 implementation cycles, behavior-preserving

Deliverables:

1. Split `MapView.tsx` by stable responsibility:
   - MapLibre lifecycle and source synchronization;
   - project-area drawing;
   - scenario drawing;
   - layer registration/styling;
   - search and map controls.
2. Split `analyzeL.ts` into indicator families while preserving one public
   orchestration contract.
3. Split `app.css` into shell, map, fact-sheet, export, project-area, scenario,
   and responsive modules without changing design tokens.
4. Profile before adding memoization. Apply React optimization only where
   measurements show unnecessary work:
   - lazy-load heavy export paths;
   - keep independent requests parallel;
   - isolate frequent MapLibre/transient state in refs;
   - memoize expensive derived geometry/components rather than simple values.
5. Keep direct imports for heavy modules and avoid broad barrel imports that
   increase the initial bundle.

Acceptance:

- browser snapshots and interaction tests remain unchanged;
- no new render loop or duplicated map listener;
- first-usable-analysis timing does not regress by more than 10%;
- initial JS transfer does not increase;
- extracted modules each have a focused contract test.

Commit slices:

1. `refactor: extract map drawing and synchronization hooks`
2. `refactor: split L-scale indicator families`
3. `refactor: split workspace styles by surface`
4. `perf: defer measured heavy frontend paths`

## Goal 5 — Add a defensible scenario comparison model

Priority: P2  
Dependency: Goals 1 and 3

Deliverables:

1. Create a versioned scenario-effect registry. Each supported proposal type
   declares:
   - affected indicator IDs;
   - deterministic calculation;
   - spatial influence rule;
   - source assumptions;
   - confidence downgrade;
   - explicit non-effects.
2. Start with direct, observable deltas only:
   - proposed stop count and access-distance screening;
   - bike-share point availability;
   - proposed green/public-space area;
   - proposed line length.
3. Do not infer timetable frequency, ridership, canopy maturity, mode shift,
   building delivery, or legal feasibility.
4. Present current and proposed values side by side. Never overwrite observed
   indicators or benchmark the proposal against observed peers without a
   reviewed method.
5. Export scenario formulas, proposal geometry, before/after values, and
   caveats.

Acceptance:

- observed analysis JSON remains byte-equivalent when a scenario is added;
- every proposed delta is traceable to one scenario feature and one method
  version;
- unsupported impacts remain “not available”;
- removing the scenario restores the comparison without recomputing or
  mutating source evidence.

Commit slices:

1. `feat: add versioned scenario effect registry`
2. `feat: compute bounded proposal deltas`
3. `feat: add current versus proposed comparison and exports`

## Goal 6 — Improve advanced evidence only after core reliability

Priority: P3

Candidate sequence:

1. true canopy or remote-sensing canopy coverage;
2. richer transit corridor centrality and station hierarchy;
3. measured LOD2 height coverage and cross-section calibration;
4. date/time-controlled sun and shadow model;
5. optional network catchments replacing geometric L buffers.

Acceptance:

- each new source enters the source registry and city coverage gate;
- new quantitative methods have validation fixtures and documented error
  bounds;
- approximations remain labelled and cannot be promoted to high confidence;
- sun/shadow remains qualitative until validated against a reference model.

## 5. Sequence and release boundaries

Recommended sequence:

```text
Goal 1 release gate
  -> Goal 2 production data
    -> Goal 3 observed benchmarks
      -> Goal 4 modularity/performance
        -> Goal 5 scenario effects
          -> Goal 6 advanced evidence
```

Goal 4 may begin after the Goal 1 browser suite is stable. Goal 5 must not
start by inventing effect sizes while observed benchmark and baseline evidence
remain incomplete.

## 6. Open decisions

These require an explicit product or infrastructure choice:

1. Which static/object host will serve immutable geodata releases?
2. Is the 5 km project-boundary limit a permanent product constraint or only a
   browser-runtime limit?
3. Which observed peer cohort should ship first after Munich districts?
4. What minimum peer count permits a rank or percentile?
5. Should scenario comparison remain an expert-only panel until effect methods
   are reviewed?
6. Which reference datasets can validate canopy and sun/shadow accuracy?

## 7. Definition of the next durable release

The next durable release is ready when:

- Goal 1 is complete;
- the three primary product-health KPIs have recorded baselines;
- one immutable geodata deployment can be rolled back independently;
- the city coverage report distinguishes availability from semantic quality;
- the known point, project-area, scenario, offline, responsive, and export
  flows pass from one command;
- no new KPI or scenario effect appears without a versioned method and
  reproducible evidence.
