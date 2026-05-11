# Real Data Wiring

The runtime now reads the following preprocessed GeoJSON files directly from
`public/data/processed/`. Missing files do not trigger synthetic fallback values.

## Required files

| Source | Runtime path | Geometry | Required / useful properties |
| --- | --- | --- | --- |
| SRTM / DEM samples | `public/data/processed/srtm-30m/samples.geojson` | `Point` | `elevation` or `elev` or `height` or `z` |
| LOD2 buildings | `public/data/processed/lod2-buildings.geojson` | `Polygon` / `MultiPolygon` | `height` or `building:height` or `measuredHeight` or `Hoehe` or `H_DACH` |
| Overture buildings | `public/data/processed/overture-buildings.geojson` | `Polygon` / `MultiPolygon` | `height` where available |
| GlobalBuildingAtlas buildings | `public/data/processed/global-building-atlas.geojson` | `Polygon` / `MultiPolygon` | `height` where available; verify license class |
| BKG boundaries | `public/data/processed/bkg-boundaries.geojson` | `Polygon` / `MultiPolygon` | `name` or `GEN`, plus AGS/ARS if available |
| Eurostat GISCO FUA | `public/data/processed/eurostat-gisco-fua.geojson` | `Polygon` / `MultiPolygon` | `fua_name` or `FUA_NAME`, plus `fua_id`, `country`, `source_year` if available |

## Runtime behaviour

- Every selected point re-requests these files with `cache: "no-store"`.
- LOD2 Bayern is used only where a local Bavaria preprocessing extract exists; it is not treated as a Germany-wide source.
- Overture buildings are the preferred global fallback after local preprocessing.
- GlobalBuildingAtlas is optional/offline only because its public WFS is fragile and its license classes are mixed.
- Overture and GlobalBuildingAtlas are never live-probed during a point analysis. If their local files are missing, the app reports them as unavailable instead of slowing down the analysis.
- BKG boundaries are used for `xlContext`.
- FUA geometries are used for `xlSources`.
- SRTM/DEM point samples are sampled along the drawn M-scale section line.
- SRTM WMS is visual-only terrain context; it is not used for section elevations.
- If a file or property is missing, the corresponding value remains unavailable and is shown as such.

## Filtered public-service choices

| Topic | Use in this app | Reason |
| --- | --- | --- |
| SRTM 30m WMS | Visual terrain context only | WMS is useful for display but not for section elevation sampling. |
| SRTM local samples | M-section calculation | The section needs numeric elevation values, not rendered WMS pixels. |
| BKG VG250 WFS | Preprocessed XL boundaries | Vector boundaries are suitable for joins and exports. |
| BKG VG250 WMS | Optional visual reference | WMS is display-only and should not drive indicators. |
| Eurostat GISCO FUA distribution | Preprocessed XL FUA geometry | GISCO is the primary source for FUA context. |
| ESPON FUA WMS | Optional visual/reference check | Useful for inspection, not primary analysis. |
| Overture buildings | Preferred broad fallback after preprocessing | Better suited than live WFS for Germany/global footprint coverage. |
| GlobalBuildingAtlas | Optional offline fallback after license review | Public WFS is not reliable enough for runtime point analysis and license classes must remain explicit. |
