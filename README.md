# Urban Context Analysis

> A lightweight urban context analysis MVP for point-based XL / L / M fact sheets.
>
> Click a location on the map, inspect structured indicators, switch scale, and export the result as data or graphics.

## At a glance

| Area | What it does |
| --- | --- |
| `XL` | City and region context: districts, demographics, housing, rents, and FUA-ready references. |
| `L` | Neighbourhood context: land use, green and blue space, transit access, and development hints. |
| `M` | Streetscape context: street segment, trees, building massing, sun/shadow hints, and section SVG. |

| Stack | Details |
| --- | --- |
| Front end | TypeScript, React, Vite, MapLibre GL JS |
| Analysis | Deterministic structured indicators from local and live geodata |
| Exports | JSON, CSV, GeoJSON, GPKG, SVG, PNG, Markdown, HTML, Ollama report |
| Data strategy | Preprocessed local sources first, live Overpass/Nominatim as optional enrichment |

## What you can do

- Select a point on the map or search for a place.
- Switch between `XL`, `L`, and `M` without losing the selected location.
- Toggle analytical layers for `3D`, `trees`, `sun`, `section`, and `green`.
- Use guided mode for stepwise exploration or direct mode for immediate analysis.
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
npm run validate:ui
npm run build
```

## Configuration

The app uses a local Vite dev/preview server with built-in `/api` proxies for Nominatim search and Overpass queries.

Optional Ollama report settings:

```bash
VITE_OLLAMA_BASE_URL=http://localhost:11434
VITE_OLLAMA_MODEL=llama3.1
VITE_REPORT_LANGUAGE=en
VITE_OLLAMA_TIMEOUT_MS=120000
```

If Ollama is unavailable, deterministic Markdown export still works.

## Data and analysis

The project is designed around a mandatory source registry in `src/lib/data/sourceRegistry.ts`. Every indicator, layer, and export path references those source IDs.

Key characteristics:

- analysis is deterministic and traceable to structured inputs;
- live Overpass requests are cached and recorded in provenance;
- Nominatim geocoding is optional and never blocks click-based analysis;
- the fact sheet is built from structured JSON, not free-form generated text;
- confidence and caveat fields are always exposed.

Local CSVs in `src/lib/data/csv/` are schema-compatible MVP samples. Replace them with authoritative preprocessing outputs when you move beyond the prototype stage.

## Repository layout

- `src/app` holds the application shell.
- `src/components/map` contains map interaction, scale switching, and layer toggles.
- `src/components/factsheet` renders the structured fact sheet.
- `src/lib/analysis` computes XL / L / M indicators and overlays.
- `src/lib/export` creates JSON, CSV, GeoJSON, SVG, PNG, Markdown, HTML, and GPKG exports.
- `src/lib/ollama` wraps local report generation with a deterministic fallback.
- `docs/` contains the methods, indicators, and data source notes.

## Documentation

- [Data sources](docs/data-sources.md)
- [Methods](docs/methods.md)
- [Indicators](docs/indicators.md)

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
