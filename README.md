# Urban Context Analysis

> A lightweight urban context analysis MVP for point- or project-boundary-based XL / L / M fact sheets.
>
> Click a location, upload a project boundary, or draw one on the map; then inspect structured indicators, switch scale, and export the result as data or graphics.

## At a glance

| Area | What it does |
| --- | --- |
| `XL` | City and region context: districts, demographics, housing, rents, and FUA-ready references. |
| `L` | Neighbourhood or project-area context: land use, green and blue space, transit access, station-axis evidence, tree canopy proxy, and development hints. |
| `M` | Streetscape context: street segment, trees, building massing, sun/shadow hints, and section SVG. |

| Stack | Details |
| --- | --- |
| Front end | TypeScript, React, Vite, MapLibre GL JS |
| Analysis | Deterministic structured indicators from local and live geodata |
| Exports | JSON, CSV, GeoJSON, GPKG, SVG, PNG, Markdown, HTML, Ollama report |
| Data strategy | Preprocessed local sources first, live Overpass/Nominatim as optional enrichment |

## Current build status

Last checked locally on **2026-07-20**.

| Check | Status | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passing | TypeScript compiles with `tsc --noEmit`. |
| `npm run build` | Passing | Production Vite build completes. Vite still warns that the main JS chunk is larger than 1500 kB. |
| `npm run validate:ui` | Passing | Current CSS satisfies the repository UI guardrails. |
| KPI contract | Passing | Schema `0.4.0` keeps one analysis context, excludes fallback buffers and driving from the composite, and serializes the active scenario. |
| GPKG / ZIP export | Passing | GeoPackage is loaded on demand; ZIP includes a standalone manifest, CSV, HTML, provenance, and editable graphics. |

Current implementation notes:

- The map fullscreen control targets the whole workspace so the inspector remains available in fullscreen.
- The workspace includes a resizable map/inspector split and an expanded fullscreen-style layout.
- GeoPackage export preserves full raw feature properties in `properties_json`; only a bounded, prioritized subset is materialized as typed SQLite columns.
- `sql.js` and its WASM payload are deferred until a user requests GPKG, so they are not part of the initial application chunk.
- Ollama report export remains local-first and falls back to deterministic Markdown when Ollama is unavailable.

## What you can do

- Select a point on the map or search for a place.
- Upload a WGS84 GeoJSON `Polygon` / `MultiPolygon`, close a drawn polygon, or draw a rectangle to define a project boundary up to 5 km diagonally.
- Switch between `XL`, `L`, and `M` without losing the selected location.
- Review KPI-first local quality, Tree Canopy, Station Axis, and benchmark indicators before raw modules, then choose a reproducible KPI strategy or adjust its weights.
- Toggle analytical layers for `3D`, `trees`, `sun`, `section`, and `green`.
- Use the map-first direct workflow for immediate analysis.
- Export the structured result, not just a screenshot.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

### Useful checks

```bash
npm run typecheck
npm run build
```

`npm run validate:ui` enforces the current design-system guardrails and is expected to pass.

## Configuration

The app uses a local Vite dev/preview server with built-in `/api` proxies for Nominatim search and Overpass queries. Public Nominatim search is submit-only rather than autocomplete, and successful results are cached locally.

Optional Ollama report settings:

```bash
VITE_OLLAMA_BASE_URL=http://localhost:11434
VITE_OLLAMA_MODEL=llama3.1
VITE_REPORT_LANGUAGE=en
VITE_OLLAMA_TIMEOUT_MS=120000
```

Optional routed walking/cycling/driving catchments use the server-side local proxy:

```bash
OPENROUTESERVICE_API_KEY=your_server_only_key
```

Do not use a `VITE_` prefix for this credential; client-visible environment variables are bundled into browser code.

If Ollama is unavailable, deterministic Markdown export still works.

For local credentials, copy `.env.example` to `.env.local`. Keep `.env.local`
out of Git; it may contain CDSE S3 keys for Urban Atlas preprocessing or other
preprocessing-only credentials. The satellite background uses the registered
Esri raster source and does not require a Google Maps tile key or session.

## Data and analysis

The project is designed around a mandatory source registry in `src/lib/data/sourceRegistry.ts`. Every indicator, layer, and export path references those source IDs.

Key characteristics:

- analysis is deterministic and traceable to structured inputs;
- when present, a canonical WGS84 project boundary replaces the default 500 m L-scale radius for feature filtering and area-normalized indicators;
- the boundary's representative interior point remains the anchor for XL administrative context and M street-segment analysis;
- live Overpass requests are cached and recorded in provenance;
- Nominatim geocoding is optional and failure never blocks coordinate-based analysis;
- analysis reads bounded preprocessed coverage and does not download or rewrite large point caches during a click;
- production builds omit generated point-cache and duplicate cache-manifest paths while retaining the canonical sharded datasets required at runtime;
- the fact sheet is built from structured JSON, not free-form generated text;
- confidence and caveat fields are always exposed;
- KPI schema version, active strategy, weights, score, classification, and evidence availability are serializable through analysis results and export manifests.

The current boundary workflow filters point/line evidence to one context and uses the project area as the denominator. Exact clipping of intersecting land-use and green polygons to irregular project boundaries remains open; until implemented, those area-based indicators retain explicit caveats.

Local CSVs in `src/lib/data/csv/` are schema-compatible MVP samples. Replace them with authoritative preprocessing outputs when you move beyond the prototype stage.

## Repository layout

- `src/app` holds the application shell.
- `src/components/map` contains map interaction, scale switching, and layer toggles.
- `src/lib/projectArea` validates and serializes uploaded or drawn project boundaries.
- `src/components/factsheet` renders the structured fact sheet.
- `src/lib/analysis` computes XL / L / M indicators and overlays.
- `src/lib/export` creates JSON, CSV, GeoJSON, SVG, PNG, Markdown, HTML, and GPKG exports.
- `src/lib/ollama` wraps local report generation with a deterministic fallback.
- `docs/` contains the methods, indicators, and data source notes.

## Documentation

- [Data sources](docs/data-sources.md)
- [Methods](docs/methods.md)
- [Indicators](docs/indicators.md)
- [Product plan](plans.md)

## Status

This repository is an exploratory MVP, not a planning-law or feasibility engine.

It is intentionally lightweight: the goal is a fast map-first workflow with structured geodata, visible provenance, and modular exports.

## License

No license file is included yet. Treat the repository as source-visible but not reusable by default until a license is added.

## Contributing

If you extend the analysis model, keep the changes deterministic and traceable:

- add new sources to `src/lib/data/sourceRegistry.ts`;
- keep provenance and caveats on every indicator;
- update the matching docs when the workflow changes;
- prefer preprocessed open data over repeated public API calls.
