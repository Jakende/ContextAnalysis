# SD Stadtdaten Context Analysis MVP

Lightweight web GIS prototype for structured urban context analysis across three nested scales:

- `XL` City & Region
- `L` Neighbourhood / Quartier
- `M` Streetscape

The app uses Vite, React, TypeScript, MapLibre GL JS, OpenFreeMap vector tiles, structured analysis JSON, a mandatory source registry, deterministic indicator modules, and browser-side exports including GeoPackage.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Validate

```bash
npm run typecheck
npm run validate:ui
npm run build
```

## Architecture

- `src/components/map` contains the MapLibre workspace, scale switcher, and layer toggles.
- `src/components/factsheet` renders only structured analysis modules.
- `src/lib/analysis` computes deterministic XL/L/M indicators and map overlays.
- `src/lib/data/sourceRegistry.ts` is the single registry for all metric, layer, and export sources.
- `src/lib/overpass` contains deterministic Overpass query modules and cache/provenance handling.
- `src/lib/export` creates JSON, CSV, GeoJSON, SVG, PNG, Markdown, HTML, and GPKG outputs from analysis JSON.
- `src/lib/ollama` wraps local Ollama report generation and falls back to deterministic Markdown if Ollama is unavailable.

LLM output is never used to invent metrics. Reports summarize computed JSON only.
