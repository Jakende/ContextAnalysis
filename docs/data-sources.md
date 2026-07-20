# Data Sources

All source references are centralized in `src/lib/data/sourceRegistry.ts`.

Implemented MVP source entries include OpenFreeMap, OpenStreetMap/Nominatim, Overpass, local Destatis/Zensus-style CSVs, the local MVP benchmark peer table, Zensus grid, LOD2 Bayern, Eurostat GISCO FUA, Copernicus Urban Atlas, GHSL, BKG/GeoBasis-DE, DWD, Mobilithek/GTFS, and Natural Earth via OpenFreeMap.

Local CSV files are schema-compatible MVP samples and are explicitly labelled as samples in indicator caveats. Production preprocessing should replace them with authoritative exports while preserving the same source IDs and indicator model.

## User-defined project boundary

A project boundary is user-supplied analysis context, not authoritative source data. It is stored separately from the source registry as a versioned `ProjectArea` and carried through structured analysis and exports.

Accepted inputs are WGS84 GeoJSON Features or FeatureCollections containing only `Polygon` / `MultiPolygon` geometry, plus polygons and axis-aligned rectangles drawn on the map. The canonical record includes the geometry, source (`upload`, `draw-polygon`, or `draw-rectangle`), original filename where applicable, bounding box, centroid, representative interior point, approximate area, timestamp, and validation caveats. The current maximum diagonal is 5 km.

The representative point anchors reverse geocoding, XL administrative context, and M street analysis. The full boundary replaces the default 500 m L-scale filter and area denominator. Its bounding box constrains Overpass and local retrieval; the exact boundary filters point/line evidence and selects intersecting polygon evidence.

Exact clipping and dissolving of intersecting land-use and green/blue polygons remains open. An uploaded FeatureCollection with several polygons is preserved as one multipart area; overlaps are not currently dissolved. These limits must remain visible in caveats and provenance.

## Runtime freshness rule

Every new selected point or project area must run a fresh source check. Live/API sources are requested for that context unless the source is explicitly configured as broad preprocessed coverage.

Allowed cache/preprocessing classes:

- Large nationwide or pan-European datasets such as BKG boundaries, GISCO FUA, GTFS stops, Urban Atlas extracts, Overture building shards, and similar coverage datasets may be stored as preprocessed, versioned coverage.
- Interactive analysis reads existing bounded coverage; it does not download or rewrite large point caches during a map click or project-area change.
- Production builds exclude generated `public/data/processed/cache/` payloads and cache-manifest duplicate paths. Canonical versioned/sharded coverage datasets remain available to the runtime build.
- A local or cached source is only considered usable when the selected point, default radius, or project boundary intersects real coverage for that dataset.
- Product pages, metadata pages, or catalog URLs do not make a source available by themselves.
- Missing, empty, skipped, failed, or credential-blocked sources must stay visible in provenance instead of being hidden behind fallback values.

Public Nominatim forward search is explicit submit-only search, never autocomplete, and successful requests are cached. Reverse geocoding is optional and cached; failure leaves coordinate-based and boundary-based analysis operational. Overpass queries use the project bounding box when a boundary is active and retain their exact query text in provenance.

OpenRouteService requests pass through the local server proxy and use `OPENROUTESERVICE_API_KEY`; the credential is never exposed through a `VITE_` browser variable. Missing credentials produce labelled geometric fallback buffers, which remain excluded from routed KPI evidence.

The current satellite basemap is the registered Esri raster source. Google Maps tile credentials and session creation are not part of the active runtime path.

Runtime evidence is stored in `analysis.provenance.dataSourceRun` and exported through JSON, Markdown/HTML reports, SVG metadata, GeoJSON manifests, GeoPackage `data_source_run`, ZIP `manifest.json`, and the dedicated `Provenance JSON` export. Project-area geometry and the active KPI scenario are preserved alongside source provenance; neither replaces it.

## Data-source regression checks

Use the point-specific check when debugging one location:

```bash
npm run test:data-sources -- --lat 48.13613 --lon 11.58082
```

Use the fixed regression set before data-source or preprocessing changes:

```bash
npm run test:data-sources:regression
```

The regression set currently covers Munich centre, Frankfurt centre, and Rosenheim as a small-city point. The command fails on hard source problems (`failed`, `missing`, `missing-credentials`) and reports optional empty coverage explicitly without inventing availability.
