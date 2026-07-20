# Methods

The analysis pipeline is deterministic:

1. A map click or submitted address search creates one selected WGS84 point. Alternatively, the user uploads a GeoJSON polygon/multipolygon or closes a drawn polygon/rectangle.
2. A project layer is normalized to canonical WGS84 `Polygon` / `MultiPolygon` geometry. Validation rejects invalid or self-intersecting rings, degenerate area, excessive coordinate counts, and extents larger than 5 km diagonally.
3. The boundary stores a stable ID, source, bounding box, centroid, representative interior point, approximate spherical area, timestamp, and caveats. Its representative point becomes the selected point for location-dependent operations.
4. Optional cached Nominatim reverse geocoding enriches the point label; failure does not block analysis. Forward public search is submit-only, not autocomplete.
5. `XL` modules derive city/district, demographic, housing, rent, and FUA-ready context from local structured data at the selected or representative point.
6. `L` modules use either the default 500 m radius or the project boundary for green/open, land-use, transit, mobility, POI, Tree Canopy proxy, Station Axis proxy, and development-hint indicators.
7. For a project area, point and line evidence is filtered to the boundary and its area replaces the circular area denominator. The boundary bounding box constrains Overpass queries and bounded local-source retrieval.
8. `M` modules use the selected or representative point to generate a nearest-street fallback segment, corridor, building/tree/sun overlays, and an adaptive SVG cross-section.
9. Overpass query modules are deterministic, cache-keyed, and stored in export provenance. When disabled or unavailable, local indicators remain visible with caveats.
10. Every source check is normalized into `analysis.provenance.dataSourceRun` with phase, status, counts, timing, caveats, and errors.
11. KPI modules normalize deterministic, context-filtered source indicators into the local quality score, Tree Canopy, Station Axis, and benchmark profile.
12. Exports are generated from the structured `AnalysisResult`, including the project boundary and active KPI scenario where present.

The MVP uses deterministic fallback overlays where authoritative local geometry has not yet been preprocessed. Confidence and caveat fields expose this explicitly.

## Project-area precision

The project boundary is the canonical L-scale context, not a decorative map overlay. Counts, nearest-distance evidence, context area, and the retrieval bounding box refer to that same geometry.

One precision limitation remains open: intersecting land-use and green/blue polygons are selected against the project context, but they are not yet clipped exactly to an irregular boundary before their areas are summed. Overlapping Urban Atlas and OSM geometry also requires an explicit precedence/dissolve step. Until that work is complete, area-share indicators must retain approximation caveats and should not receive `high` confidence solely because an authoritative source polygon was loaded.

## KPI contract (`0.4.0`)

- KPI evidence is filtered to one L context: the default radius or the project boundary.
- Walking, cycling, and transit contribute to the Mobility Access composite. Car-driving reachability remains a separately visible comparison with zero composite weight.
- Only live or cached routed ORS isochrones can contribute isochrone-based POI reachability. Deterministic geometric fallback buffers are visual context and never routed evidence.
- Raw source indicators remain unchanged when a user selects a strategy or changes weights.
- The active strategy produces a serializable `KpiScenario` containing schema version, strategy, weights, composite, classification, confidence, available KPI IDs, and timestamp.
- The same scenario is used by the fact sheet, analysis JSON, manifest, reports, and geodata exports so the visible classification remains reproducible.
- A formula, normalization, threshold, or classification change requires a schema-version increment and updated fixtures.

## Benchmarking

The current benchmark implementation is an MVP local peer table. It compares available KPI scores against static district/city reference values and emits rank and percentile indicators. This keeps the data model and exports stable while preprocessed city or district benchmark tables are prepared.

Benchmark values are low confidence until replaced by curated peer datasets. Missing selected KPI values remain unavailable and do not invalidate other benchmark rows.

## Data-source run statuses

The UI and exports use the same normalized source-run vocabulary:

- `requested`: a source step was queued or started.
- `fetched`: a live source or local coverage source returned usable data for the selected point.
- `cache-hit`: a cached query or preprocessed coverage source covers the selected context.
- `empty`: the source was available but returned no usable point/radius coverage.
- `missing-credentials`: the source was requested but required local credentials were not available.
- `missing`: the required local/preprocessed artifact was not present.
- `failed`: the source request or parser failed.
- `skipped`: the source was intentionally not applicable, for example an optional FUA-only layer outside FUA coverage.
