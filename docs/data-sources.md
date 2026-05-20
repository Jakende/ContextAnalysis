# Data Sources

All source references are centralized in `src/lib/data/sourceRegistry.ts`.

Implemented MVP source entries include OpenFreeMap, OpenStreetMap/Nominatim, Overpass, local Destatis/Zensus-style CSVs, Zensus grid, LOD2 Bayern, Eurostat GISCO FUA, Copernicus Urban Atlas, GHSL, BKG/GeoBasis-DE, DWD, Mobilithek/GTFS, and Natural Earth via OpenFreeMap.

Local CSV files are schema-compatible MVP samples and are explicitly labelled as samples in indicator caveats. Production preprocessing should replace them with authoritative exports while preserving the same source IDs and indicator model.

## Runtime freshness rule

Every new selected point must run a fresh source check. Live/API sources are requested for that point unless the source is explicitly configured as broad preprocessed coverage.

Allowed cache/preprocessing classes:

- Large nationwide or pan-European datasets such as BKG boundaries, GISCO FUA, GTFS stops, Urban Atlas extracts, Overture building shards, and similar coverage datasets may be stored locally or in point caches.
- A local or cached source is only considered usable when the selected point or selected analysis radius intersects real coverage for that dataset.
- Product pages, metadata pages, or catalog URLs do not make a source available by themselves.
- Missing, empty, skipped, failed, or credential-blocked sources must stay visible in provenance instead of being hidden behind fallback values.

Runtime evidence is stored in `analysis.provenance.dataSourceRun` and exported through JSON, Markdown/HTML reports, SVG metadata, GeoJSON manifests, GeoPackage `data_source_run`, and the dedicated `Provenance JSON` export.

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
