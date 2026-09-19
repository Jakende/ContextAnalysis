# Data Implementation Plan

This plan prioritizes data integrations that move the MVP toward reproducible real-data analysis for arbitrary German locations.

## Priority 1: Terrain Contours

- Replace visual SRTM WMS terrain with local contour lines derived from OpenTopography DEM clips.
- Preferred DEM product: `COP30`; fallback products may be configured through `--demtype`.
- Runtime layer: `opentopography-contours`.
- Export layer: `contour_lines`.
- Required contour attributes: `elevation`, `interval`, `sourceId`, `sourceVersion`, `generatedAt`.

Command pattern:

```bash
OPENTOPOGRAPHY_API_KEY=... npm run preprocess:dem -- \
  --bbox west,south,east,north \
  --demtype COP30 \
  --contour-interval 5
```

## Priority 2: LOD2 Buildings Germany

Building-source order:

1. `lod2-deutschland-bkg` / federal-state LoD2 CityGML shards.
2. `lod2-bayern` where already preprocessed.
3. `overture-buildings`.
4. Live OSM `building` footprints and height tags.
5. GlobalBuildingAtlas only as an explicitly enabled experimental fallback after license review.

Federal-state resolver targets:

- Deutschland / ZSHH: `https://www.lvg.bayern.de/vermessung/zshh/lod2-de.html`
- Deutschland / BKG product page: `https://gdz.bkg.bund.de/index.php/default/3d-gebaudemodelle-lod2-deutschland-lod2-de.html`
- Bayern: `https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2`
- Berlin: `https://daten.berlin.de/datensaetze/3d-gebaudemodelle-im-level-of-detail-2-lod-2-3c7c49af`
- Hessen: `https://opendata.hessen.de/en/dataset/3d-gebaudemodell-he-lod2`
- Baden-Wuerttemberg: `https://opengeodata.lgl-bw.de/`
- Niedersachsen: `https://opengeodata.lgln.niedersachsen.de`
- Nordrhein-Westfalen: `https://www.bezreg-koeln.nrw.de/geobasis-nrw/produkte-und-dienste/3d-gebaeudemodelle`
- Sachsen-Anhalt: `https://www.geodatenportal.sachsen-anhalt.de/gfds/de/gdp-download-lod2.html`
- Other states: add only after confirming current open-data endpoint, license and tiling scheme.

Every building feature must preserve source attributes, especially `height`, `building:height`, `building:levels`, roof fields, federal state, source URL/version, and confidence.

## Priority 3: Urban Atlas

- Use Urban Atlas as the main L-scale land-use source.
- Flow: selected point -> FUA match -> Urban Atlas FlatGeobuf extract -> local cache -> overlays/indicators/export.
- Do not treat product pages as data. Availability requires a local/preprocessed artifact.

## Priority 4: GTFS.DE

- Use GTFS.DE local public transit as the primary L-scale public-transport source.
- Runtime should separate `gtfs_stops`, `gtfs_routes`, and supplemental OSM transport features.
- Avoid long-distance rail in L-scale default accessibility counts.

## Priority 5: BKG and FUA

- Use BKG administrative boundaries and Eurostat GISCO FUA as official XL context geometries.
- Keep IDs and provenance: AGS/ARS for BKG, FUA ID/name/country/source year for GISCO.

## Priority 6: Tree Depiction and Export

- Render individual OSM trees with crown, trunk and shadow styling.
- Use `diameter_crown`, `crown_diameter`, `height`, `species`, `leaf_type` where present.
- Treat missing crown/height values as visual estimates only; preserve raw OSM tags in exports.

## Lower Priority Context

- GHSL: modelled comparative context only.
- DWD: coarse climate proxy only, never street-level measurement.
