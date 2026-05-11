# Preprocessing

The app runtime intentionally reads small local GeoJSON files from
`public/data/processed/`. Heavy public services are not queried directly during
map-click analysis.

## Outputs

| Runtime file | Producer | Notes |
| --- | --- | --- |
| `public/data/processed/bkg-boundaries.geojson` | `npm run preprocess:bkg` | BKG VG250 WFS, normalized to `Polygon` features. |
| `public/data/processed/eurostat-gisco-fua.geojson` | `npm run preprocess:fua` | Eurostat GISCO Urban Audit FUA, default Germany filter. |
| `public/data/processed/srtm-30m/samples.geojson` | `npm run preprocess:srtm` | Numeric DEM samples for M-section terrain. Requires GDAL. |
| `public/data/processed/overture-buildings.geojson` | `npm run preprocess:buildings -- --provider overture --input ...` | Local Overture extract normalized to runtime schema. |
| `public/data/processed/global-building-atlas.geojson` | `npm run preprocess:buildings -- --provider global-building-atlas --input ... --license-mode reviewed` | Optional, license-reviewed fallback only. |
| `public/data/processed/gtfs-stops.geojson` | `npm run preprocess:gtfs -- --input ...` | Local GTFS stops from a feed zip, folder, or `stops.txt`. |
| `public/data/processed/copernicus-urban-atlas.geojson` | `npm run preprocess:thematic -- --provider urban-atlas --input ...` | Local Urban Atlas polygons normalized for L-scale land use. |
| `public/data/processed/ghsl.geojson` | `npm run preprocess:thematic -- --provider ghsl --input ...` | Local GHSL vectorized/clipped features. |
| `public/data/processed/dwd-climate.geojson` | `npm run preprocess:thematic -- --provider dwd --input ...` | Local DWD station/grid features with coarse-resolution caveats. |

## BKG VG250 Boundaries

```bash
npm run preprocess:bkg -- \
  --bbox 5.8,47.2,15.1,55.1 \
  --precision 4 \
  --out public/data/processed/bkg-boundaries.geojson
```

Default WFS:
`https://sgx.geodatenzentrum.de/wfs_vg250`

Default runtime layers:
`vg250:vg250_krs`, `vg250:vg250_lan`

Municipalities (`vg250:vg250_gem`) are intentionally not part of the default
browser GeoJSON because the Germany-wide geometry is too large for per-click
runtime loading. Use `--type-names vg250:vg250_gem,vg250:vg250_krs,vg250:vg250_lan`
only for a clipped AOI or a later tiled/indexed pipeline.

The script keeps original BKG properties, adds `sourceId: "bkg-geobasis"`,
`label`, `name`, `boundaryLevel`, `sourceVersion`, and `processedAt`.

## Eurostat GISCO FUA

```bash
npm run preprocess:fua -- \
  --country DE \
  --out public/data/processed/eurostat-gisco-fua.geojson
```

Default source:
`https://gisco-services.ec.europa.eu/distribution/v2/urau/geojson/URAU_RG_100K_2024_4326_FUA.geojson`

Use `--country all` for all FUA geometries or `--url` / `--fua-url` to pin a
different GISCO release.

## SRTM 30m Samples

From a local GeoTIFF:

```bash
npm run preprocess:srtm -- \
  --dem data/raw/srtm/srtm_30m.tif \
  --bbox 11.2,48.0,11.9,48.4 \
  --out public/data/processed/srtm-30m/samples.geojson
```

From OpenTopography:

```bash
OPENTOPOGRAPHY_API_KEY=your-key npm run preprocess:srtm -- \
  --bbox 11.2,48.0,11.9,48.4 \
  --demtype SRTMGL1
```

The script requires `gdal_translate`. It emits point features with `elevation`,
`sourceId: "srtm-30m"`, `sourceVersion`, and `processedAt`.

## Building Fallback

Overture example:

```bash
npm run preprocess:buildings -- \
  --provider overture \
  --input data/raw/buildings/overture-buildings.geojson \
  --out public/data/processed/overture-buildings.geojson
```

GlobalBuildingAtlas requires an explicit license decision:

```bash
npm run preprocess:buildings -- \
  --provider global-building-atlas \
  --input data/raw/buildings/global-building-atlas.geojson \
  --license-mode reviewed \
  --out public/data/processed/global-building-atlas.geojson
```

The script keeps only polygonal geometries, explodes `MultiPolygon` to
`Polygon`, normalizes `height` where present, and marks estimated heights only
when `--levels-height-m` is explicitly provided.

## GTFS / Mobilithek Stops

From a local GTFS zip:

```bash
npm run preprocess:gtfs -- \
  --input data/raw/gtfs/feed.zip \
  --provider "Feed provider name" \
  --out public/data/processed/gtfs-stops.geojson
```

From a remote feed URL:

```bash
npm run preprocess:gtfs -- \
  --url https://example.org/gtfs.zip \
  --provider "Feed provider name"
```

The runtime reads `gtfs-stops.geojson` for every selected point with
`cache: "no-store"` and merges nearby stop points into the L-scale transport
analysis. Feed licensing and update cadence must be checked before use.

## Thematic Local GeoJSON

Urban Atlas:

```bash
npm run preprocess:thematic -- \
  --provider urban-atlas \
  --input data/raw/copernicus/urban-atlas.geojson
```

GHSL:

```bash
npm run preprocess:thematic -- \
  --provider ghsl \
  --input data/raw/ghsl/ghsl-clipped.geojson
```

DWD:

```bash
npm run preprocess:thematic -- \
  --provider dwd \
  --input data/raw/dwd/dwd-climate.geojson
```

These scripts intentionally normalize local files only. Product pages or
metadata endpoints are not treated as available analytical data.
