# AGENTS.md — Urban Context Analysis MVP

## 1. Product intent

Build a lightweight, web-based urban context analysis tool.

The user clicks a point on a map. The application automatically assembles a simple, modular fact sheet for that location across three nested spatial scales:

- **XL — City & Region**
  - Citywide and regional structure.
  - Districts, administrative boundaries, demographic indicators, housing indicators, settlement patterns, comparative values across the wider urban area.
  - Include **European FUA / Functional Urban Area** context where available. The original product wording may mention “European foam”; treat this as an alias that likely means **European FUA**, but do not delete the original naming from any migrated content until clarified.

- **L — Neighbourhood / Quartier**
  - Walkable-radius context around the selected point.
  - Land use, public transport access, green/blue space, social and technical infrastructure, mobility infrastructure, development potential, barriers, and urban fabric.

- **M — Streetscape**
  - Segment-level and micro-spatial context.
  - Street segment geometry, edges, active/inactive frontages, 3D building context, trees, shadow/sun hints, cross-section approximation, visibility of green/blue elements, and other spatial qualities.

This is an exploratory front end to pre-processed geodata. Do **not** build a visible heavy workflow engine. Keep the UI fast, direct, and modular.

---

## 2. MVP scope

### Required MVP functionality

Implement:

1. **One interactive web map**
   - Map click / precise point selection.
   - Selected-point marker.
   - Basic address or place context via reverse geocoding where enabled.
   - Visual overlay layers.

2. **Scale switching**
   - XL / L / M tabs or segmented control.
   - The selected location stays fixed while the analysis content changes by scale.
   - Each scale has a compact fact sheet and matching map layers.

3. **Layer toggles**
   - `3D`
   - `trees`
   - `sun`
   - `section`
   - `green`
   - Add more toggles only if they remain understandable and modular.

4. **Interaction modes**
   - **Guided mode:** stepwise exploration, user is guided through selection, scale, layers, and export.
   - **Direct mode:** precise selection and immediate fact-sheet generation.

5. **Modular fact sheet**
   - Fact sheet must be generated from structured analysis JSON, not from free-form LLM text.
   - Each module must expose:
     - title
     - scale
     - indicator value(s)
     - method
     - data source(s)
     - timestamp or data version
     - confidence flag
     - caveats

6. **Exports**
   - Visual graphics export.
   - Analysis results export.
   - Local LLM report export via Ollama.
   - Geo-data package export.
   - Adaptable SVG export.

---

## 3. Non-goals for MVP

Do not implement:

- Full planning-law assessment.
- Full real-estate feasibility model.
- Routing engine beyond simple catchment or network approximations.
- Multi-user collaboration.
- User accounts.
- Heavy server-side workflow UI.
- LLM-generated metrics. The LLM may summarize only already-computed metrics.
- Proprietary geodata dependencies unless explicitly added later.

---

## 4. Preferred technical architecture

### Front end

Use a modern client-side web GIS stack.

Preferred default:

- TypeScript
- React or a similarly simple component framework
- Vite
- MapLibre GL JS
- OpenFreeMap vector tiles / OpenMapTiles-compatible schema
- Modular components:
  - `MapView`
  - `ScaleSwitcher`
  - `LayerTogglePanel`
  - `FactSheetPanel`
  - `GuidedExplorer`
  - `DirectSelectionPanel`
  - `ExportPanel`

Keep the UI compact and analytical. Avoid dashboard clutter.

### Back end / local services

Use a small API layer only where needed.

Preferred default:

- Node.js/TypeScript or Python/FastAPI.
- Separate geodata preprocessing from runtime API.
- Runtime API should mainly:
  - proxy/call external APIs when allowed,
  - serve preprocessed local datasets,
  - compute selected-point analysis,
  - generate export packages,
  - call local Ollama for reports.

### Data processing

Use reproducible preprocessing scripts.

Preferred tools:

- GDAL / OGR for vector conversion, reprojection, clipping, GeoPackage exports.
- GeoPandas / Shapely / Pyogrio for Python geodata workflows if Python is used.
- Tippecanoe or equivalent vector-tile tooling if custom vector tiles are generated.
- MBTiles for local grid or vector-tile datasets.
- GeoJSON only for small runtime payloads.

---

## 5. Repository structure

Use this target structure unless the existing project already has a clearer convention.

```text
/
  AGENTS.md
  README.md
  package.json
  src/
    app/
    components/
      map/
      factsheet/
      export/
      guided/
    lib/
      analysis/
        xl/
        l/
        m/
        indicators/
        provenance/
      api/
      data/
        csv/
      export/
      ollama/
      osm/
      overpass/
      tiles/
    styles/
  public/
    tiles/
    sprites/
    glyphs/
  data/
    raw/
    processed/
    cache/
    exports/
  scripts/
    preprocess/
    export/
    validate/
  docs/
    data-sources.md
    methods.md
    indicators.md
```

---

## 6. Mandatory data-source registry

Create or maintain a source registry, preferably in:

```text
src/lib/data/sourceRegistry.ts
```

Every layer, metric, and export must reference this registry. Do not hard-code source names only in UI components.

Each source entry must contain:

```ts
type DataSource = {
  id: string;
  label: string;
  type: "live-api" | "tile-service" | "local-file" | "local-tile" | "external-download";
  url?: string;
  localPath?: string;
  license?: string;
  attribution: string;
  scale: Array<"XL" | "L" | "M">;
  updateMode: "live" | "preprocessed" | "manual";
  notes?: string;
};
```

---

## 7. Required external APIs and data sources

The following sources must be represented in the source registry.

### 7.1 APIs — live queries

#### OpenStreetMap Nominatim — geocoding

Use for forward and reverse geocoding where enabled.

- Forward search:
  - `https://nominatim.openstreetmap.org/search`
- Reverse search:
  - `https://nominatim.openstreetmap.org/reverse`

Implementation rules:

- Always send a valid application-specific `User-Agent` and/or `Referer`.
- Cache results.
- Do not use public Nominatim as an autocomplete backend.
- Add clear fallback handling if the public service rejects or rate-limits requests.
- Keep geocoding optional: map-click analysis must work without Nominatim.

#### Overpass API — OpenStreetMap feature queries

Use for on-demand OSM queries where preprocessed data are not sufficient.

Endpoints, in failover order unless project config overrides:

```text
https://overpass.kumi.systems/api/interpreter
https://overpass.private.coffee/api/interpreter
https://overpass.openstreetmap.jp/api/interpreter
https://overpass-api.de/api/interpreter
```

Implementation rules:

- Use a deterministic Overpass query builder.
- Cap query bounding boxes and radii.
- Set explicit timeouts.
- Add request de-duplication and local caching.
- Store the exact Overpass query text in the analysis provenance and export manifest.
- If all endpoints fail, return partial analysis with visible caveats instead of blocking the whole fact sheet.
- Do not overload public Overpass infrastructure. Prefer preprocessed OSM extracts for production.

### 7.2 Map basis — tiles, fonts, sprites

Use OpenFreeMap / OpenMapTiles-compatible assets for the base map.

- Tiles / TileJSON:
  - `https://tiles.openfreemap.org/planet`
- Glyphs:
  - `https://tiles.openfreemap.org/fonts/...`
- Sprite:
  - `https://tiles.openfreemap.org/sprites/...`
- Raster Natural Earth:
  - `https://tiles.openfreemap.org/natural_earth/...`

Implementation rules:

- Keep attribution visible.
- Use MapLibre-compatible style configuration.
- Do not couple analysis logic to visual tile availability.
- If tiles fail, the analysis panel should still be able to show already-computed results.

### 7.3 Local data in this application

#### OpenStreetMap data

- Source:
  - `https://www.openstreetmap.org`
- License:
  - ODbL
- Role:
  - Base for many land-use, street, POI, green, tree, blue-space, and infrastructure layers.

Required uses:

- L-scale neighbourhood context.
- M-scale streetscape context.
- POI and infrastructure hints.
- Street segments and approximate network/radius calculations.
- Land-use and amenity classification.

#### Static XL CSV datasets — Zensus 2022 / Destatis / GENESIS-Online

Source:

- Statistisches Bundesamt / Destatis, GENESIS-Online:
  - `https://www-genesis.destatis.de/datenbank/online/`

Local project files:

```text
src/lib/data/csv/Alter.csv
src/lib/data/csv/Erwerbsstatus.csv
src/lib/data/csv/Familiengroessen.csv
src/lib/data/csv/Familientypen.csv
src/lib/data/csv/Miete_der_Wohnung.csv
src/lib/data/csv/Mietpreise_Stadtteile.csv
src/lib/data/csv/Stadtbezirke.csv
src/lib/data/csv/Wohnungskennzahlen.csv
src/lib/data/csv/Wohnungsnutzung.csv
```

Required uses:

- XL demographic and housing indicators.
- District comparison tables.
- Citywide and district-level fact-sheet modules.

#### Grid MBTiles — Zensus 2022

Attribution:

```text
© Statistische Ämter des Bundes und der Länder, 2024
Gittergeometrien: © GeoBasis-DE / BKG (2024)
```

Reference:

- Zensus 2022 — Gitterzellen / About.

Required uses:

- Grid-based population, household, building, and housing indicators where available.
- Local comparison around selected point.
- Do not expose individual-level data; use only aggregated grid statistics.

#### Local 3D data — LOD2 Bayern

Source:

- Landesamt für Digitalisierung, Breitband und Vermessung / Bayerische Vermessungsverwaltung.
- Product page:
  - `https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2`

Role:

- 3D buildings.
- M-scale urban canyon / massing context.
- Shadow/sun approximation.
- Street cross-section context.
- Exportable 3D-derived footprints and height attributes where license permits.

Implementation rules:

- Convert and serve locally, for example under:
  - `/tiles/...`
- Keep original source metadata and conversion metadata.
- If using simplified geometries, keep a reference to the full-resolution source.

---

## 8. Additional public open-data sources to support

Add these as optional adapters. They enrich the MVP but should not block first release.

### 8.1 Eurostat GISCO — cities and Functional Urban Areas

Use for:

- XL city/regional comparison.
- European FUA context.
- Urban Audit geometry references.
- FUA membership of selected location where available.

Source:

- `https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/cities-functional-urban-areas`

Implementation:

- Preprocess FUA geometries into local GeoPackage and/or MBTiles.
- Add `fua_id`, `fua_name`, `country`, `source_year`, and `source_version`.
- If a clicked point falls inside a FUA, expose an XL module:
  - `European FUA context`
  - alias key: `europeanFoamContext` only if legacy UI text needs it.

### 8.2 Copernicus Land Monitoring Service — Urban Atlas

Use for:

- L-scale land use.
- Green/blue-space percentage.
- Urban fabric typology.
- Industrial/commercial/residential/open-space differentiation.
- Optional street-tree and building-height enrichment where available.

Sources:

- `https://land.copernicus.eu/en/products/urban-atlas`
- `https://www.eea.europa.eu/data-and-maps/data/copernicus-land-monitoring-service-urban-atlas/urban-atlas-updates`

Implementation:

- Treat as preprocessed, not live.
- Match the selected point to the relevant FUA dataset.
- Use latest available reference year configured in project settings.
- Keep class-code-to-label mapping in source-controlled config.

### 8.3 GHSL — Global Human Settlement Layer

Use for:

- Settlement density.
- Built-up surface.
- Population grid.
- Urban centre / urban extent context.
- European or global comparability when local datasets are missing.

Sources:

- `https://ghsl.jrc.ec.europa.eu/`
- `https://data.jrc.ec.europa.eu/collection/ghsl/`
- `https://human-settlement.emergency.copernicus.eu/ghs_fua.php`

Implementation:

- Preprocess GHSL rasters or vector products into clipped local tiles/statistics.
- Use only as comparative context when local German/Bavarian data are unavailable or when a pan-European comparison is explicitly shown.
- Clearly label GHSL as modelled/global data, not cadastral truth.

### 8.4 BKG / GeoBasis-DE open data

Use for:

- Administrative boundaries.
- National/regional reference geometries.
- Generalized topographic context.
- Coordinate/reference grid support.

Sources:

- `https://gdz.bkg.bund.de/`
- `https://gdz.bkg.bund.de/index.php/default/open-data.html`
- `https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/verwaltungsgebiete.html`

Implementation:

- Prefer preprocessed boundaries for XL modules.
- Preserve AGS/ARS keys where available.
- Use BKG geometries for official district/municipality joins when OSM boundaries are insufficient.

### 8.5 DWD Climate Data Center

Use for:

- Optional climate and microclimate context.
- Temperature, precipitation, solar, wind, or heat-stress proxies where available.
- Report caveats about station/grid resolution.

Sources:

- `https://www.dwd.de/DE/klimaumwelt/cdc/cdc_node.html`
- `https://www.dwd.de/EN/ourservices/cdc/cdc.html`

Implementation:

- Treat as optional and preprocessed.
- Do not present coarse weather/climate grids as street-level measurements.
- Mark derived values as approximate.

### 8.6 Mobilithek / DELFI / GTFS feeds

Use for:

- Public-transport stop access.
- Service density.
- Transit-mode availability.
- Approximate walking access to bus, tram, rail, or subway stops.

Sources:

- `https://mobilithek.info/`
- `https://gtfs.de/en/`
- Optional global catalogue:
  - `https://mobilitydatabase.org/`

Implementation:

- Use GTFS or NeTEx data only where licensing and update cadence are clear.
- Preprocess stops, routes, service calendars, and frequencies.
- For MVP, a simple stop-distance and mode-availability module is enough.

### 8.7 Natural Earth

Use for:

- Very small-scale contextual raster/background layers only.
- Regional overview maps.

Source:

- Via OpenFreeMap Natural Earth raster endpoint:
  - `https://tiles.openfreemap.org/natural_earth/...`

Do not use Natural Earth for neighbourhood or street-level analysis.

---

## 9. Indicator model

Create one common indicator model for all scales.

```ts
type Indicator = {
  id: string;
  label: string;
  scale: "XL" | "L" | "M";
  value: number | string | boolean | null;
  unit?: string;
  geometry?: GeoJSON.Geometry;
  method: string;
  sourceIds: string[];
  sourceVersion?: string;
  computedAt: string;
  confidence: "high" | "medium" | "low";
  caveats: string[];
};
```

### Required indicator examples

#### XL

- Municipality / city name.
- District / Stadtbezirk.
- Population and demographic profile where available.
- Housing indicators from local CSVs.
- Rent indicators from local CSVs.
- Zensus grid values around selected point.
- European FUA membership/context where available.
- Comparison against city/district median.

#### L

- Land-use mix within configured radius.
- Green percentage within configured radius.
- Blue-space presence.
- Public transport stops within walking radius.
- Mobility infrastructure hints:
  - bicycle paths,
  - parking,
  - car sharing,
  - charging infrastructure,
  - transit stops.
- Social and civic infrastructure POIs.
- Development potential hints:
  - vacant/underused land-use classes,
  - large surface parking,
  - brownfield-like OSM tags,
  - low-density urban fabric,
  - proximity to transit.

#### M

- Street segment class.
- Approximate carriageway/sidewalk/cycleway configuration where tags allow.
- Tree presence along segment.
- Building height / LOD2 massing context.
- Shadow/sun approximation.
- Street-edge condition:
  - active frontage hints,
  - blank edges,
  - green edges,
  - barriers,
  - water edge,
  - rail/road infrastructure edge.
- Cross-section SVG.

---

## 10. Spatial rules by scale

### XL default

Use administrative or statistical boundaries:

- city / municipality,
- district / Stadtbezirk,
- FUA / regional boundary where available,
- grid cells for Zensus values.

### L default

Use a configurable walkable-radius context.

Default radius options:

- 300 m
- 500 m
- 800 m
- 1,000 m

For MVP, a geometric buffer is acceptable. If a street network is available, add a walkable network catchment as a later enhancement.

### M default

Use the selected nearest street segment.

Method:

1. Snap selected point to nearest OSM street segment within a reasonable threshold.
2. Use segment geometry plus a short corridor buffer.
3. Intersect with buildings, trees, land use, and LOD2 context.
4. Generate street-section and streetscape indicators from this corridor.

If no street segment is found, return partial M-scale analysis with caveats.

---

## 11. Layer toggle behaviour

Layer toggles must map to data and indicators.

### `3D`

Shows:

- LOD2 buildings where available.
- Extruded fallback buildings from OSM `building:levels`, `height`, or estimated default values if LOD2 is unavailable.

Never imply estimated heights are measured. Label estimated height as estimated.

### `trees`

Shows:

- OSM `natural=tree`, tree rows, green corridors.
- Copernicus Street Tree Layer if available.
- Local tree datasets may be added later.

### `sun`

Shows:

- Simple sun/shadow hints.
- Use selected date/time or a default representative date.
- Use LOD2 building heights where available.
- Use fallback approximate heights where not available.
- Mark results as approximate unless validated against a solar model.

### `section`

Shows:

- Adaptive SVG cross-section.
- Street width and lanes from OSM tags where available.
- Building setbacks from building footprints.
- Tree/green/blue edges from intersected geometries.
- Confidence based on source completeness.

### `green`

Shows:

- Parks, forests, grass, recreation grounds, cemeteries, allotments, green urban areas, street trees, and other green/open classes.
- Compute green percentage by selected radius or streetscape corridor.
- Keep class mapping explicit.

---

## 12. Analysis computation rules

### Do

- Compute metrics deterministically from geodata.
- Return partial results when some sources fail.
- Keep every metric traceable to source IDs.
- Cache expensive Overpass and geocoding calls.
- Separate raw data, derived data, and rendered map state.
- Store source versions in export manifests.

### Do not

- Ask the LLM to invent missing values.
- Hide low-confidence results.
- Mix visual tile data with analytical source data unless explicitly documented.
- Treat OSM as complete.
- Treat global datasets as more precise than local authoritative datasets.
- Block the whole report because one layer failed.

---

## 13. Overpass query modules

Create reusable query modules.

Suggested modules:

- `landUse`
- `greenBlue`
- `transportStops`
- `mobilityInfrastructure`
- `buildings`
- `streets`
- `trees`
- `pois`
- `barriers`
- `developmentHints`

Each module must declare:

```ts
type OverpassModule = {
  id: string;
  scale: "XL" | "L" | "M";
  radiusMeters?: number;
  bboxRequired?: boolean;
  buildQuery: (params: QueryParams) => string;
  parse: (response: unknown) => GeoJSON.FeatureCollection;
};
```

All Overpass responses must be normalized to GeoJSON FeatureCollections before analysis.

---

## 14. Export requirements

### 14.1 Export types

Implement these export targets:

1. **Analysis JSON**
   - Full structured result.
   - Includes indicators, modules, data provenance, caveats, selected point, map state, and timestamps.

2. **CSV**
   - Flat table of indicators.
   - One row per indicator.

3. **GeoJSON**
   - Selected point.
   - Relevant analysis geometries.
   - Layer outputs from Overpass/OSM and other sources where license permits.

4. **GeoPackage / GPKG package**
   - Treat the user phrase “GUP package” as **GPKG / GeoPackage** unless project stakeholders define a separate `.gup` format.
   - Export as `.gpkg`.
   - Include separate layers, for example:
     - `selected_point`
     - `xl_boundaries`
     - `l_buffer`
     - `m_street_segment`
     - `osm_pois`
     - `osm_streets`
     - `green_blue`
     - `buildings`
     - `trees`
     - `analysis_indicators`
     - `source_manifest`
   - Use EPSG:4326 for interchange unless otherwise configured.
   - Include attribution and source metadata.

5. **Adaptable SVG**
   - Export selected map graphics and/or diagrams as editable SVG.
   - SVG must be useful in Illustrator, Inkscape, Figma, and browser contexts.
   - Requirements:
     - clean `viewBox`,
     - grouped layers with stable IDs,
     - semantic class names,
     - CSS variables for colors,
     - no rasterized text where avoidable,
     - embedded metadata block with source manifest,
     - optional simplified geometries,
     - scale bar and north arrow when relevant.
   - For cross-sections, output a standalone SVG in addition to map-overlay SVG.

6. **PNG**
   - Current map view or selected graphic.
   - Use for quick sharing only; SVG is the editable primary visual export.

7. **HTML / Markdown report**
   - Generated locally through Ollama using computed analysis JSON.
   - Must include source list, caveats, and method notes.
   - Must not contain metrics that are absent from the JSON.

8. **PDF report**
   - Optional MVP-plus export generated from HTML.
   - Keep layout simple and printable.

### 14.2 Export manifest

Every export package must include a machine-readable manifest.

```json
{
  "app": "Urban Context Analysis",
  "exportVersion": "0.1.0",
  "selectedPoint": {
    "lat": 0,
    "lon": 0
  },
  "createdAt": "ISO-8601 timestamp",
  "scales": ["XL", "L", "M"],
  "sources": [],
  "overpassQueries": [],
  "files": [],
  "caveats": []
}
```

---

## 15. Local LLM / Ollama report integration

### Goal

Use a local LLM via Ollama to turn computed structured results into a readable report.

The LLM is a narrator and editor, not a calculator.

### Required configuration

Use environment variables:

```text
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1
OLLAMA_TIMEOUT_MS=120000
REPORT_LANGUAGE=en
```

Allow `REPORT_LANGUAGE=de` for German report output.

### API behaviour

Support Ollama chat/generate calls through a small wrapper.

The wrapper must:

- check if Ollama is reachable,
- check if the configured model is available or return a clear setup error,
- send only the computed analysis JSON and report instructions,
- disable or avoid any remote LLM fallback by default,
- return a structured report object.

### Report rules

The report must include:

- location summary,
- XL findings,
- L findings,
- M findings,
- key metrics,
- visual-export references,
- source and attribution list,
- caveats and confidence,
- “not available” sections for missing data.

The report must not:

- invent values,
- hide missing data,
- present OSM-derived values as authoritative,
- send data to external AI services unless explicitly configured outside MVP.

### Suggested report prompt

```text
You are generating an urban context analysis report from structured GIS results.
Use only the JSON values provided.
Do not invent metrics.
If a value is missing, write "not available".
Preserve source names, caveats and confidence.
Write in {REPORT_LANGUAGE}.
Return Markdown with sections: Summary, XL City & Region, L Neighbourhood, M Streetscape, Key Metrics, Data Sources, Caveats.
```

---

## 16. Fact-sheet UI requirements

The fact sheet must be modular.

Each module should display:

- metric title,
- value,
- unit,
- compact interpretation,
- confidence badge,
- source badge(s),
- caveat tooltip or collapsed note.

Example modules:

```text
XL
- District profile
- Demographic structure
- Housing and rent indicators
- Zensus grid context
- European FUA context

L
- Land-use mix
- Green percentage
- Blue-space access
- Public transport access
- Mobility infrastructure
- Development hints

M
- Street segment profile
- Tree / green edge
- Building massing
- Sun / shadow hint
- Cross-section
```

---

## 17. Source attribution and licensing

Implement a visible attribution area in the app and exports.

Minimum visible attribution must include, where used:

- OpenStreetMap contributors / ODbL.
- OpenFreeMap and OpenMapTiles-compatible tile attribution as required by provider terms.
- Destatis / GENESIS-Online.
- Statistische Ämter des Bundes und der Länder, 2024.
- GeoBasis-DE / BKG, 2024.
- Bayerische Vermessungsverwaltung / LDBV for LOD2.
- Copernicus Land Monitoring Service where used.
- Eurostat GISCO where used.
- GHSL / European Commission JRC where used.
- DWD where used.
- Mobilithek / DELFI / GTFS feed provider where used.

Every export must include an attribution section or manifest.

---

## 18. Data quality and confidence

Each indicator must be labelled:

- `high` — authoritative or directly measured from suitable local data.
- `medium` — derived from good but incomplete public data.
- `low` — estimated, inferred, global/coarse, or based on sparse OSM tagging.

Examples:

- Zensus grid value: usually `high` for its intended scale.
- OSM POI count: `medium` or `low` depending on completeness.
- Estimated building height from `building:levels`: `low`.
- LOD2 building height: `high` if processed correctly.
- Street width inferred from tags: `low` unless confirmed by source geometry.

---

## 19. Performance rules

MVP target:

- Initial map load: fast enough for immediate interaction on a normal laptop.
- Click-to-basic-results: under a few seconds when preprocessed data are available.
- Live Overpass-enhanced results may load progressively.
- Do not block UI while Overpass or Ollama is running.
- Use progressive fact-sheet modules:
  - show local/preprocessed results first,
  - then live API results,
  - then report export availability.

Cache:

- Nominatim responses.
- Overpass responses keyed by query hash and bbox/radius.
- Preprocessed spatial joins.
- Generated exports by selected point + scale + source versions if useful.

---

## 20. Error handling

Show partial results with caveats.

Examples:

- Nominatim unavailable:
  - keep selected coordinate and continue analysis.
- Overpass unavailable:
  - show local/preprocessed results and mark live OSM modules unavailable.
- LOD2 unavailable:
  - fallback to OSM building footprints and estimated heights if available.
- Ollama unavailable:
  - allow JSON/SVG/GPKG export and show “Local report generation unavailable”.
- Export conversion fails:
  - provide the raw analysis JSON and error details.

Never fail silently.

---

## 21. Testing and acceptance criteria

### MVP acceptance tests

1. User can click a point on the map.
2. XL, L, and M scale panels load.
3. Layer toggles alter the map without breaking fact-sheet state.
4. Guided mode walks through selection → scale → layer → export.
5. Direct mode allows immediate point selection and analysis.
6. At least one XL CSV indicator is shown where local data are present.
7. At least one L green/land-use indicator is shown.
8. At least one M street-segment indicator is shown.
9. Overpass queries are cached and recorded in provenance.
10. Exports are available:
    - JSON,
    - CSV,
    - GeoJSON,
    - GPKG/GeoPackage,
    - adaptable SVG,
    - Ollama-generated Markdown or HTML report.
11. Export manifest contains selected point, source list, caveats, and timestamps.
12. If Ollama is offline, non-LLM exports still work.
13. If Overpass is offline, preprocessed/local indicators still work.
14. Attribution is visible in UI and exports.

### Data-source acceptance tests

For every indicator:

- source IDs resolve to the source registry,
- method string is present,
- confidence value is present,
- caveats array exists,
- computed timestamp exists.

---

## 22. Implementation priority

### Phase 1 — Core MVP

- Map with OpenFreeMap/OpenMapTiles-compatible style.
- Point selection.
- XL/L/M scale switcher.
- Basic source registry.
- Local CSV loading.
- Basic Overpass module.
- Basic green percentage.
- Basic street segment snap.
- JSON and SVG export.
- Static Markdown report without LLM.

### Phase 2 — Data enrichment

- Zensus MBTiles integration.
- LOD2 building integration.
- Eurostat GISCO FUA adapter.
- Copernicus Urban Atlas adapter.
- Public transport GTFS/Mobilithek adapter.
- GPKG export.

### Phase 3 — Report and advanced exports

- Ollama local report generation.
- HTML/PDF report.
- Full adaptive SVG graphics.
- Source manifest in every package.
- More refined cross-section and sun/shadow methods.

---

## 23. Coding rules for future agents

When modifying this project:

1. Preserve the XL/L/M scale methodology.
2. Do not replace deterministic geodata analysis with LLM output.
3. Add every new source to the source registry.
4. Add every new indicator to the indicator model.
5. Keep source provenance and caveats.
6. Prefer preprocessed open data over repeated public API calls.
7. Keep all exports reproducible from analysis JSON.
8. Preserve the lightweight exploratory UX.
9. Do not introduce proprietary APIs or paid services without explicit instruction.
10. If terminology is ambiguous, preserve the original product term and add a technical alias rather than silently renaming it.

---

## 24. Public references for maintainers

Use these official or primary references when checking implementation details:

- OpenStreetMap:
  - `https://www.openstreetmap.org`
  - `https://osmfoundation.org/wiki/Licence/Attribution_Guidelines`
- Nominatim policy:
  - `https://operations.osmfoundation.org/policies/nominatim/`
- Overpass:
  - `https://wiki.openstreetmap.org/wiki/Overpass_API`
  - `https://dev.overpass-api.de/overpass-doc/en/preface/commons.html`
- OpenFreeMap:
  - `https://openfreemap.org/`
  - `https://tiles.openfreemap.org/planet`
- OpenMapTiles:
  - `https://openmaptiles.org/`
- MapLibre GL JS:
  - `https://maplibre.org/projects/gl-js/`
- Destatis / GENESIS-Online:
  - `https://www-genesis.destatis.de/datenbank/online/`
- Zensus 2022:
  - `https://atlas.zensus2022.de/`
  - `https://www.destatis.de/DE/Service/Statistik-Visualisiert/zensus-atlas.html`
- BKG / GeoBasis-DE:
  - `https://gdz.bkg.bund.de/`
- LOD2 Bayern:
  - `https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2`
- Eurostat GISCO:
  - `https://ec.europa.eu/eurostat/web/gisco`
  - `https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/cities-functional-urban-areas`
- Copernicus Urban Atlas:
  - `https://land.copernicus.eu/en/products/urban-atlas`
- GHSL:
  - `https://ghsl.jrc.ec.europa.eu/`
  - `https://data.jrc.ec.europa.eu/collection/ghsl/`
- DWD CDC:
  - `https://www.dwd.de/EN/ourservices/cdc/cdc.html`
- Mobilithek:
  - `https://mobilithek.info/`
- GTFS Germany:
  - `https://gtfs.de/en/`
- Ollama:
  - `https://docs.ollama.com/`
- GDAL / OGR:
  - `https://gdal.org/en/stable/programs/ogr2ogr.html`
