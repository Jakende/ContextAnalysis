# Product Plan

Last updated: 2026-07-20.

This file is the standing product plan for the Urban Context Analysis MVP. Agents must read it at the beginning of each session after `AGENTS.md` and before proposing or implementing product changes.

## Current Product Direction

The tool should stay a lightweight, map-first urban context analysis workspace. A selected point remains the default anchor; an uploaded or drawn project boundary may replace the default L-scale radius while an interior representative point anchors XL and M. The app should not become a heavy workflow engine.

KPIs are the product spine. Raw indicators, map layers, reports, and exports should support the KPI interpretation rather than competing with it.

Completed in the 2026-05-31 implementation pass:

- Tree Canopy and Station Axis are now core KPI families.
- Multi-city benchmarking has an initial static MVP peer table and emits structured benchmark indicators.
- Guided workflows remain out of scope; the mounted product flow is direct and map-first.
- The L-scale fact sheet is KPI-first: the KPI matrix appears before raw modules and each KPI row exposes trace details.
- Markdown/HTML reports include the new KPI families and benchmark section.

Completed in the 2026-07-20 implementation pass:

- WGS84 GeoJSON `Polygon` / `MultiPolygon` upload and polygon/rectangle drawing define a canonical project area up to 5 km diagonally.
- The project boundary replaces the default 500 m L-scale spatial filter and area denominator; its bounding box limits Overpass and local retrieval.
- KPI schema `0.4.0` filters evidence to one context, excludes geometric ORS fallbacks from routed scores, and gives driving zero weight in the urban-quality composite.
- The active KPI strategy, weights, composite, classification, and evidence availability are serialized in analysis results, manifests, and reports.
- Public Nominatim search is submit-only and cached. Analysis no longer downloads or rewrites large point caches during an interactive run.
- Production builds omit generated point-cache/cache-manifest duplicates while retaining canonical sharded datasets; the satellite background uses the registered Esri raster path rather than an inactive Google tile session.
- GPKG loading is deferred; ZIP packages contain a standalone manifest plus CSV, HTML, provenance, and graphics.
- UI validation passes.

Completed in the continued 2026-07-20 hardening pass:

- Project-area polygons are now dissolved, exactly clipped, and made mutually exclusive before green/blue and land-use area aggregation.
- Copernicus Urban Atlas owns baseline land-use coverage; OSM contributes detail only outside that coverage, with deterministic family precedence inside each source.
- Benchmark peers now live in a schema-versioned dataset with explicit source versions, timestamps, confidence, caveats, and spatial-context comparability. Project-area and mismatched-radius ranks are suppressed.
- The UI can deploy independently as an approximately 5.4 MB slim artifact through `UCA_INCLUDE_GEODATA=false` and `VITE_GEODATA_BASE_URL`.
- Canonical assets have a deterministic SHA-256 release manifest and `available` / `empty` / `missing` regression coverage gate. The current schema-1.1 release is `uca-data-edde681ba2da0b93` with 9,363 assets and 2.21 GB logical data.
- A browser-verified technical coverage audit is available under `docs/data-quality/coverage-audit.html`.

### Durable KPI contract

The KPI model is a versioned interpretation layer over immutable structured indicators:

1. Evidence is filtered to one declared spatial context before normalization.
2. Source indicators keep method, source IDs, version, confidence, timestamp, and caveats.
3. Strategy weights never alter raw evidence; they produce a separate serializable `KpiScenario`.
4. The score shown in the UI must equal the score in JSON, manifest, reports, and geodata exports.
5. Missing evidence is excluded transparently and the remaining weights are normalized; low evidence must reduce confidence rather than be silently filled.
6. Visual or geometric fallbacks cannot masquerade as routed or measured evidence.
7. Formula, threshold, or classification changes require a schema-version change and fixture updates.

## Priority Roadmap

### 1. KPI-First Analysis Surface — Done / Durable Contract Updated

Make the KPI model more visible and more useful.

- [x] Promote the local quality score and KPI family scores in the fact sheet.
- [x] Keep KPI inputs deterministic and traceable to source indicators.
- [x] Show missing KPI inputs explicitly instead of hiding them.
- [x] Preserve confidence, caveats, method, and source IDs for every KPI.
- [x] Keep UI controls for KPI strategies and weights compact and analytical.
- [x] Serialize the active strategy, weights, composite, classification, and available KPI IDs.
- [x] Exclude geometric ORS fallback buffers from routed reachability.
- [x] Keep car-driving reachability visible as context with zero composite weight.
- [x] Filter KPI evidence to the same radius or project-area context.

Acceptance target:

- A user can understand the location's main strengths and weaknesses from the KPI section before reading raw modules.
- Every KPI score can be traced back to source indicators and source registry IDs.

Current status:

- The L-scale fact sheet shows the KPI matrix before raw modules.
- KPI rows expose source indicator, method, source IDs, and normalization details.
- KPI schema version `0.4.0` defines six core KPI families: Mobility Access, Green/Blue Access, Urban Mix, Social Infrastructure Access, Tree Canopy, and Station Axis.
- Walking, cycling, and transit contribute to Mobility Access; car driving is reported separately and contributes zero to the urban-quality composite.
- Only live or cached routed isochrones contribute routed reachability. Geometric fallback buffers remain visual context.

### 2. Multi-City Benchmarking — Initial Done / Production Data Open

Add benchmarking as a first-class XL/L extension.

Goal:

- Compare the selected point, district, or city against a peer set of other cities or districts.
- Support peer sets such as Munich districts, Bavarian cities, German cities, and later European FUA contexts.
- Use the same KPI families wherever possible so comparisons are coherent.

Initial implementation shape:

- [x] Create a benchmark data model with peer ID, peer label, geography type, source IDs, indicator values, normalized KPI values, rank, percentile, confidence, and caveats.
- [x] Start with a local static MVP peer table before adding live queries.
- [x] Add compact benchmark modules under XL and L.
- [x] Export benchmark results through structured JSON/CSV/GPKG indicator exports and Markdown/HTML report sections.
- [x] Version and validate peer schema, provenance, source versions, timestamps, confidence, and context comparability.
- [x] Suppress rank/percentile output when the selected radius or project area is not comparable to available peers.
- [ ] Replace static MVP peer values with curated preprocessed Munich district, Bavarian city, German city, and European FUA benchmark tables.

Acceptance target:

- A selected location can show its KPI rank or percentile against a configured peer set.
- Missing peer data is visible and does not invalidate the whole comparison.

Current status:

- Benchmark indicators load from `src/lib/data/benchmark/peers.v1.json`. Its scores remain explicitly illustrative, low-confidence product fixtures; replace the dataset with reproducible observed peer tables before decision use.
- `uca-benchmark-peers` is registered in `src/lib/data/sourceRegistry.ts`.

### 3. Tree Canopy KPI — Done / Better Canopy Data Open

Represent tree canopy as a named KPI family, not only as a visual layer.

Initial implementation shape:

- [x] Use available tree evidence from OSM trees/tree rows and green polygons.
- [x] Compute a transparent proxy score when true canopy data are unavailable.
- [x] Distinguish tree count, tree-row presence, green edge, and true canopy coverage in caveats/evidence text.
- [x] Mark OSM-only canopy proxies as low or medium confidence depending on source completeness.
- [ ] Add true local canopy or remote-sensing canopy coverage when a suitable preprocessed source exists.

Acceptance target:

- The fact sheet exposes a `Tree Canopy` or `Tree / Shade` KPI with method, sources, confidence, and caveats.
- The map layer and KPI use the same source evidence where possible.

Current status:

- `l.tree-canopy-score` and `kpi.tree_canopy` are emitted from OSM tree/tree-row evidence plus green/open-space support.
- `l.tree-canopy-evidence` records the supporting count/density/proxy details.

### 4. Station Axis KPI — Done / Richer Corridor Data Open

Represent the station-axis idea as a visible KPI family.

Goal:

- Capture whether the selected point sits on or near a meaningful public-transport access axis rather than only counting nearby stops.

Initial implementation shape:

- [x] Combine nearest station/stop distance, transit mode hierarchy, stop density, route/line presence, and corridor proximity evidence.
- [x] Prefer GTFS/preprocessed transit where available, with Overpass as enrichment.
- [x] Treat station-axis proximity as a screening metric, not a routing-grade accessibility model.
- [x] Make station access and axis/corridor evidence visible in indicators and exports.
- [ ] Add richer preprocessed corridor centrality / rail-station hierarchy when data is available.

Acceptance target:

- The KPI section shows a `Station Axis` or `Transit Axis` score with supporting details.
- The score can explain whether it is driven by station distance, high-capacity mode presence, or corridor proximity.

Current status:

- `l.station-axis-score` and `kpi.station_axis` are emitted from nearest stop/station distance, mode hierarchy, stop density, and route/corridor evidence.
- `l.station-axis-evidence` records the supporting nearest-distance, mode, and line details.

### 5. Project Boundary Workflow — Initial Done / Geometry Precision Open

Let a user define the analysis site without turning boundary creation into a guided workflow.

- [x] Upload GeoJSON Feature or FeatureCollection data containing `Polygon` / `MultiPolygon` geometry.
- [x] Draw and close a free polygon or define an axis-aligned rectangle from two corners.
- [x] Normalize the result to canonical WGS84 geometry with stable ID, bounding box, centroid, representative interior point, approximate area, source, timestamp, and caveats.
- [x] Reject invalid, self-intersecting, degenerate, excessively detailed, or greater-than-5-km-diagonal boundaries.
- [x] Use the boundary for L-scale feature filtering and area-normalized KPI denominators.
- [x] Use its bounding box for deterministic Overpass queries and bounded local retrieval.
- [x] Preserve the full boundary and creation source in structured analysis and exports.
- [x] Clip intersecting Urban Atlas, OSM land-use, and green/blue polygons exactly to the irregular boundary before area aggregation.
- [x] Dissolve overlapping uploaded components and source polygons before calculating area.
- [x] Apply explicit source and family precedence before calculating mutually exclusive land-use shares.

Acceptance target:

- A valid uploaded or drawn boundary immediately produces one traceable boundary-based analysis.
- XL and M remain anchored to a representative point inside the boundary.
- L-scale counts and density denominators refer to the same boundary.
- Until exact polygon clipping is implemented, area indicators expose the approximation caveat and are not promoted to high confidence.

Resolved area-scoring decisions:

- Urban Atlas owns baseline coverage; OSM fills uncovered areas only. Within a source, precedence is transport, industrial/service, underused, social/open, built/residential, green/blue, then other.
- Overlapping uploaded multipart components are dissolved automatically and the serialized project area carries the dissolved geometry and denominator.

Open questions that remain:

- Should the 5 km browser-analysis limit remain a product constraint after indexed server-side spatial queries are available?
- Which curated project-area peer cohorts and area tolerances are valid enough to enable project-area benchmarking? Until then, those ranks stay suppressed.

### 6. Data Coverage And Deployment Storage — Partial / Open

Keep the browser bundle small while treating large geodata as versioned deployment assets.

Current verified state on 2026-07-20:

- [x] Runtime reads a canonical sharded index first and never merges dozens of overlapping point-cache extracts.
- [x] Production builds omit the generated `public/data/processed/cache/` tree and duplicate cache manifest.
- [x] JavaScript is split into app, React, MapLibre, and on-demand GPKG chunks.
- [x] BKG, FUA, GTFS, canonical Overture, canonical Urban Atlas, and Zensus WMS checks pass for Munich.
- [x] Add a configurable immutable geodata base URL and a slim UI build that excludes canonical geodata.
- [x] Add checksums, source versions where available, immutable cache guidance, per-city coverage states, and a deterministic data-release manifest.
- [x] Add a browser-verified technical coverage audit with severity and release-gate recommendations.
- [ ] Canonical Urban Atlas and Overture coverage is empty at the Frankfurt and Rosenheim regression points; expand/version those preprocessing outputs before claiming national coverage.
- [ ] Deploy the generated immutable geodata release to the chosen static host/object store and pin the production UI to its release URL.
- [x] Add compact WGS84 source footprints and distinguish point-probe status from footprint containment.
- [ ] Add municipality/FUA coverage percentages and semantic quality thresholds; compact source footprints alone do not certify continuous or complete coverage.
- [ ] Convert the largest browser-delivered GeoJSON shards to range-friendly GeoPackage/PMTiles/MBTiles or an indexed spatial API after measuring query and hosting constraints.

Acceptance target:

- The UI deploy artifact and geodata release can be updated independently.
- A coverage regression distinguishes `available`, `empty`, and `missing` for every supported city before release.
- Selecting one project area transfers only intersecting shards, with no overlapping point-cache duplication.

### 7. In-App Scenario Editing — Initial Slice Done / KPI Impact Open

Keep in-app editing as a useful later expert workflow, not a core MVP blocker.

Project-boundary drawing defines the observation context and is already implemented. The items below concern proposed design interventions and must remain a separate scenario layer.

Possible scope:

- [x] Let users sketch scenario features such as a new street, bike-sharing station, transit stop, green edge, or public-space intervention.
- [x] Keep scenario edits separate from source data.
- [ ] Recompute affected KPIs as a scenario comparison: current state vs proposed state.
- [x] Export scenario features separately with clear provenance.

Acceptance target:

- Edits never overwrite authoritative or live source data.
- Reports and exports distinguish existing conditions from user-created scenario geometry.

### 8. Sun / Shadow Model — Open / Deferred

Keep the existing sun/shadow hint behavior, but defer a validated model.

Later scope:

- [ ] Add date/time selection.
- [ ] Use LOD2 or measured building heights where available.
- [ ] Use approximate heights only with clear labels.
- [ ] Validate the model before presenting quantitative shadow metrics.

Acceptance target:

- Until validation exists, sun/shadow remains a low-confidence qualitative hint and must not be framed as measured solar analysis.

## Explicit De-Scopes

- Guided workflows are out of scope for the current product direction. The main product should stay direct and map-first.
- Do not introduce a heavy visible workflow engine.
- Do not let LLM output create or alter metrics.
- Do not implement planning-law or real-estate feasibility logic as part of this plan.

## Implementation Notes For Agents

- Before changing KPI behavior, inspect `src/lib/analysis/kpi/kpiSchema.json`, `src/lib/analysis/kpi/kpiMatrix.ts`, and `src/components/factsheet/FactSheetPanel.tsx`.
- Before changing spatial context behavior, inspect `src/lib/projectArea/`, `src/lib/analysis/runAnalysis.ts`, and the L-scale spatial filters together.
- Before adding a new metric source, update `src/lib/data/sourceRegistry.ts`.
- Before adding a new export field, confirm JSON, CSV, GeoJSON, SVG, GPKG, Markdown, and HTML behavior still makes sense.
- Keep all benchmark, canopy, and station-axis values reproducible from structured analysis JSON.
