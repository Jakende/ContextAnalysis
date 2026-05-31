# Methods

The analysis pipeline is deterministic:

1. A map click or address search creates one selected WGS84 point.
2. Optional Nominatim reverse geocoding enriches the label; failure does not block analysis.
3. `XL` modules derive city/district, demographic, housing, rent, and FUA-ready context from local structured data.
4. `L` modules use a configurable radius buffer for green/open, land-use, transit, mobility, POI, Tree Canopy proxy, Station Axis proxy, and development-hint indicators.
5. `M` modules generate a nearest-street fallback segment, corridor, building/tree/sun overlays, and an adaptive SVG cross-section.
6. Overpass query modules are deterministic, cache-keyed, and stored in export provenance. When disabled or unavailable, local fallback indicators remain visible with caveats.
7. Every source check is normalized into `analysis.provenance.dataSourceRun` with phase, status, counts, timing, caveats, and errors.
8. KPI modules normalize deterministic source indicators into the local quality score, Tree Canopy, Station Axis, and benchmark profile.
9. Exports are generated from the structured `AnalysisResult` object.

The MVP uses deterministic fallback overlays where authoritative local geometry has not yet been preprocessed. Confidence and caveat fields expose this explicitly.

## Benchmarking

The current benchmark implementation is an MVP local peer table. It compares available KPI scores against static district/city reference values and emits rank and percentile indicators. This keeps the data model and exports stable while preprocessed city or district benchmark tables are prepared.

Benchmark values are low confidence until replaced by curated peer datasets. Missing selected KPI values remain unavailable and do not invalidate other benchmark rows.

## Data-source run statuses

The UI and exports use the same normalized source-run vocabulary:

- `requested`: a source step was queued or started.
- `fetched`: a live source or local coverage source returned usable data for the selected point.
- `cache-hit`: a point cache or broad coverage cache covers the selected point.
- `empty`: the source was available but returned no usable point/radius coverage.
- `missing-credentials`: the source was requested but required local credentials were not available.
- `missing`: the required local/preprocessed artifact was not present.
- `failed`: the source request or parser failed.
- `skipped`: the source was intentionally not applicable, for example an optional FUA-only layer outside FUA coverage.
