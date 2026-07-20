# Methods

The analysis pipeline is deterministic:

1. A map click or submitted address search creates one selected WGS84 point. Alternatively, the user uploads a GeoJSON polygon/multipolygon or closes a drawn polygon/rectangle.
2. A project layer is normalized to canonical WGS84 `Polygon` / `MultiPolygon` geometry. Validation rejects invalid or self-intersecting rings, degenerate area, excessive coordinate counts, and extents larger than 5 km diagonally.
3. Uploaded components are normalized and dissolved before the boundary stores a stable ID, source, bounding box, centroid, representative interior point, approximate locally projected area, timestamp, and caveats. Its representative point becomes the selected point for location-dependent operations.
4. Optional cached Nominatim reverse geocoding enriches the point label; failure does not block analysis. Forward public search is submit-only, not autocomplete.
5. `XL` modules derive city/district, demographic, housing, rent, and FUA-ready context from local structured data at the selected or representative point.
6. `L` modules use either the default 500 m radius or the project boundary for green/open, land-use, transit, mobility, POI, Tree Canopy proxy, Station Axis proxy, and development-hint indicators.
7. For a project area, point and line evidence is filtered to the boundary and its dissolved area replaces the circular area denominator. Polygon evidence is clipped to the same geometry, dissolved, and made mutually exclusive before area aggregation. The boundary bounding box constrains Overpass queries and bounded local-source retrieval.
8. `M` modules use the selected or representative point to generate a nearest-street fallback segment, corridor, building/tree/sun overlays, and an adaptive SVG cross-section.
9. Overpass query modules are deterministic, cache-keyed, and stored in export provenance. When disabled or unavailable, local indicators remain visible with caveats.
10. Every source check is normalized into `analysis.provenance.dataSourceRun` with phase, status, counts, timing, caveats, and errors.
11. KPI modules normalize deterministic, context-filtered source indicators into the local quality score, Tree Canopy, Station Axis, and benchmark profile.
12. Exports are generated from the structured `AnalysisResult`, including the project boundary and active KPI scenario where present.

Exact polygon overlay is bounded and failure-contained in the client. If source geometry exceeds the clipping engine's safe complexity or is invalid, the affected area KPI is withheld with an explicit caveat; the remaining analysis continues. No bbox or vertex-count approximation is substituted.

The MVP uses deterministic fallback overlays where authoritative local geometry has not yet been preprocessed. Confidence and caveat fields expose this explicitly.

## Project-area precision

The project boundary is the canonical L-scale context, not a decorative map overlay. Counts, nearest-distance evidence, context area, and the retrieval bounding box refer to that same geometry.

Polygon/MultiPolygon evidence is clipped to the dissolved radius or project geometry with robust boolean operations. Overlapping Urban Atlas polygons are assigned through deterministic family precedence; Urban Atlas owns its complete baseline coverage and OSM polygons fill only uncovered space. The resulting land-use families are mutually exclusive before area shares are calculated. Values remain no higher than medium confidence when semantic completeness or source coverage is uncertain; exact geometry does not make incomplete source data authoritative.

## KPI contract (`0.4.0`)

- KPI evidence is filtered to one L context: the default radius or the project boundary.
- Walking, cycling, and transit contribute to the Mobility Access composite. Car-driving reachability remains a separately visible comparison with zero composite weight.
- Only live or cached routed ORS isochrones can contribute isochrone-based POI reachability. Deterministic geometric fallback buffers are visual context and never routed evidence.
- Raw source indicators remain unchanged when a user selects a strategy or changes weights.
- The active strategy produces a serializable `KpiScenario` containing schema version, strategy, weights, composite, classification, confidence, available KPI IDs, and timestamp.
- The same scenario is used by the fact sheet, analysis JSON, manifest, reports, and geodata exports so the visible classification remains reproducible.
- A formula, normalization, threshold, or classification change requires a schema-version increment and updated fixtures.

## Benchmarking

The current benchmark implementation loads a validated, schema-versioned illustrative peer dataset. It compares available KPI scores only against peers with the same declared observation context. Radius, project-area, and administrative contexts are never mixed; project-area and mismatched-radius ranks are suppressed.

Benchmark fixture values are explicitly low confidence and not observed city statistics. They must be replaced by curated, reproducible peer datasets before decision use. Missing selected KPI values or non-comparable contexts remain unavailable and do not invalidate raw KPI evidence.

## User proposal scenarios

User-drawn transit stops, bike-share stations, streets, green edges, and public spaces are stored in a dedicated scenario FeatureCollection. They never mutate observed source collections. The scenario GeoJSON and package/report sections label them as user-created proposals, while `kpiImpact` remains `null` until a source-controlled intervention-effect method exists.

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
