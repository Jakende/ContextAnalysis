# Methods

The analysis pipeline is deterministic:

1. A map click or address search creates one selected WGS84 point.
2. Optional Nominatim reverse geocoding enriches the label; failure does not block analysis.
3. `XL` modules derive city/district, demographic, housing, rent, and FUA-ready context from local structured data.
4. `L` modules use a configurable radius buffer for green/open, land-use, transit, mobility, POI, and development-hint indicators.
5. `M` modules generate a nearest-street fallback segment, corridor, building/tree/sun overlays, and an adaptive SVG cross-section.
6. Overpass query modules are deterministic, cache-keyed, and stored in export provenance. When disabled or unavailable, local fallback indicators remain visible with caveats.
7. Exports are generated from the structured `AnalysisResult` object.

The MVP uses deterministic fallback overlays where authoritative local geometry has not yet been preprocessed. Confidence and caveat fields expose this explicitly.
