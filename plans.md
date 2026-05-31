# Product Plan

Last updated: 2026-05-31.

This file is the standing product plan for the Urban Context Analysis MVP. Agents must read it at the beginning of each session after `AGENTS.md` and before proposing or implementing product changes.

## Current Product Direction

The tool should stay a lightweight, map-first urban context analysis workspace. The selected point remains the anchor. The app should not become a heavy workflow engine.

KPIs are the product spine. Raw indicators, map layers, reports, and exports should support the KPI interpretation rather than competing with it.

Completed in the 2026-05-31 implementation pass:

- Tree Canopy and Station Axis are now core KPI families.
- Multi-city benchmarking has an initial static MVP peer table and emits structured benchmark indicators.
- Guided workflows remain out of scope; the mounted product flow is direct and map-first.
- The L-scale fact sheet is KPI-first: the KPI matrix appears before raw modules and each KPI row exposes trace details.
- Markdown/HTML reports include the new KPI families and benchmark section.

## Priority Roadmap

### 1. KPI-First Analysis Surface — Done

Make the KPI model more visible and more useful.

- [x] Promote the local quality score and KPI family scores in the fact sheet.
- [x] Keep KPI inputs deterministic and traceable to source indicators.
- [x] Show missing KPI inputs explicitly instead of hiding them.
- [x] Preserve confidence, caveats, method, and source IDs for every KPI.
- [x] Keep UI controls for KPI strategies and weights compact and analytical.

Acceptance target:

- A user can understand the location's main strengths and weaknesses from the KPI section before reading raw modules.
- Every KPI score can be traced back to source indicators and source registry IDs.

Current status:

- The L-scale fact sheet shows the KPI matrix before raw modules.
- KPI rows expose source indicator, method, source IDs, and normalization details.
- KPI schema version `0.3.0` defines six core KPI families: Mobility Access, Green/Blue Access, Urban Mix, Social Infrastructure Access, Tree Canopy, and Station Axis.

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
- [ ] Replace static MVP peer values with curated preprocessed Munich district, Bavarian city, German city, and European FUA benchmark tables.

Acceptance target:

- A selected location can show its KPI rank or percentile against a configured peer set.
- Missing peer data is visible and does not invalidate the whole comparison.

Current status:

- Initial benchmark indicators are available from a static MVP peer table. Replace with preprocessed benchmark tables for production.
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

### 5. In-App Editing — Open

Keep in-app editing as a useful later expert workflow, not a core MVP blocker.

Possible scope:

- [ ] Let users sketch scenario features such as a new street, bike-sharing station, transit stop, green edge, or public-space intervention.
- [ ] Keep scenario edits separate from source data.
- [ ] Recompute affected KPIs as a scenario comparison: current state vs proposed state.
- [ ] Export scenario features separately with clear provenance.

Acceptance target:

- Edits never overwrite authoritative or live source data.
- Reports and exports distinguish existing conditions from user-created scenario geometry.

### 6. Sun / Shadow Model — Open / Deferred

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
- Before adding a new metric source, update `src/lib/data/sourceRegistry.ts`.
- Before adding a new export field, confirm JSON, CSV, GeoJSON, SVG, GPKG, Markdown, and HTML behavior still makes sense.
- Keep all benchmark, canopy, and station-axis values reproducible from structured analysis JSON.
