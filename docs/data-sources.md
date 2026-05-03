# Data Sources

All source references are centralized in `src/lib/data/sourceRegistry.ts`.

Implemented MVP source entries include OpenFreeMap, OpenStreetMap/Nominatim, Overpass, local Destatis/Zensus-style CSVs, Zensus grid, LOD2 Bayern, Eurostat GISCO FUA, Copernicus Urban Atlas, GHSL, BKG/GeoBasis-DE, DWD, Mobilithek/GTFS, and Natural Earth via OpenFreeMap.

Local CSV files are schema-compatible MVP samples and are explicitly labelled as samples in indicator caveats. Production preprocessing should replace them with authoritative exports while preserving the same source IDs and indicator model.
