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
| `public/data/processed/overture-buildings/index.json` | `npm run preprocess:buildings -- --provider overture --bbox ...` | Local Overture extract normalized and sharded for runtime loading. |
| `public/data/processed/overture-building-parts/index.json` | `npm run preprocess:buildings -- --provider overture-building-parts --bbox ...` | Optional Overture building parts, kept separate from footprints. |
| `public/data/processed/global-building-atlas.geojson` | `npm run preprocess:buildings -- --provider global-building-atlas --input ... --license-mode reviewed` | Optional, license-reviewed fallback only. |
| `public/data/processed/gtfs-stops/index.json` | `npm run preprocess:gtfs -- --feed gtfs-de-local-transit` | Default GTFS.DE Nahverkehr stop layer, sharded for per-click browser loading. Local GTFS zip/folder/`stops.txt` also supported. |
| `public/data/processed/copernicus-urban-atlas/index.json` | `npm run preprocess:thematic -- --provider urban-atlas --fua-name ...` | Local Urban Atlas polygons resolved from the 2021 CSV catalog and sharded for L-scale land use. |
| `public/data/processed/cache-manifest.json` | `npm run preprocess:point-cache -- --lat ... --lon ... --sources ...` | Optional point-cache manifest. Runtime reads it before the global test indexes. |
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

Overture from an already downloaded GeoJSON:

```bash
npm run preprocess:buildings -- \
  --provider overture \
  --input data/raw/buildings/overture-buildings.geojson \
  --out public/data/processed/overture-buildings/index.json
```

Overture direct BBox extraction, if the `overturemaps` CLI is installed:

```bash
npm run preprocess:buildings -- \
  --provider overture \
  --bbox 11.40,48.06,11.72,48.25 \
  --out public/data/processed/overture-buildings/index.json
```

For normal point-based work, do not overwrite the global test index. Resolve a
point cache instead:

```bash
npm run preprocess:point-cache -- \
  --lat 48.13613 \
  --lon 11.58082 \
  --sources overture
```

This writes `public/data/processed/cache/overture-buildings/.../index.json` and
updates `public/data/processed/cache-manifest.json`. The app checks that
manifest by selected point and analysis radius before falling back to the older
global index.

Building parts are optional and remain a separate artifact:

```bash
npm run preprocess:buildings -- \
  --provider overture-building-parts \
  --bbox 11.40,48.06,11.72,48.25 \
  --out public/data/processed/overture-building-parts/index.json
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

Default GTFS.DE local public-transit feed:

```bash
npm run preprocess:gtfs -- \
  --feed gtfs-de-local-transit \
  --source-version 2026-05-12
```

Alternative GTFS.DE feeds:

```bash
npm run preprocess:gtfs -- --feed gtfs-de-full
npm run preprocess:gtfs -- --feed gtfs-de-regional-rail
npm run preprocess:gtfs -- --feed gtfs-de-long-distance-rail
```

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

The runtime reads `gtfs-stops/index.json` for every selected point with
`cache: "no-store"` and then loads only intersecting stop shards. It merges
nearby stop points into the L-scale transport analysis. Feed licensing and
update cadence must be checked before use. Pass `--single-file true` only for
debugging or external interchange because the Germany-wide feed is too large for
per-click browser loading as one GeoJSON.

## Thematic Local GeoJSON

Urban Atlas:

```bash
npm run preprocess:thematic -- \
  --provider urban-atlas \
  --fua-name München
```

The Urban Atlas resolver reads the official 2021 FlatGeobuf CSV catalog by
default. The current CDSE catalog rows expose `s3://EODATA/...` paths, so direct
catalog download requires configured CDSE S3 access. Without those credentials,
download the FlatGeobuf/GeoJSON externally and pass it through `--input`.
You can pin a specific catalog or skip catalog resolution:

```bash
npm run preprocess:thematic -- \
  --provider urban-atlas \
  --catalog-url https://s3.waw3-1.cloudferro.com/swift/v1/CatalogueCSV/land_cover_use_in_priority_areas/urban_atlas/clms_ua_land-cover-land-use_europe_V025ha_3yearly_v1/clms_ua_land-cover-land-use_europe_V025ha_3yearly_v1_flatgeobuf.csv \
  --fua-code DE003L
```

```bash
npm run preprocess:thematic -- \
  --provider urban-atlas \
  --input data/raw/copernicus/urban-atlas.geojson
```

For point-cache resolution with CDSE/GDAL `/vsis3` input, keep credentials in
the shell environment and pass the prepared source path:

```bash
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
npm run preprocess:point-cache -- \
  --lat 48.13613 \
  --lon 11.58082 \
  --sources urban-atlas \
  --urban-atlas-input /vsis3/eodata/.../CLMS_UA_LCU_...fgb \
  --source-version 2021
```

Do not commit CDSE keys or write them into repository config files.

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
