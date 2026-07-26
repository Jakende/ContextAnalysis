# Preprocessing

The app runtime intentionally reads small local GeoJSON files from
`public/data/processed/`. Heavy public services are not queried directly during
map-click analysis.

Canonical preprocessing outputs have a separate immutable deployment contract.
See [data-release.md](data-release.md) for manifest generation, coverage states,
checksums, cache headers, and UI builds that exclude bundled geodata.

## Outputs

| Runtime file | Producer | Notes |
| --- | --- | --- |
| `public/data/processed/bkg-boundaries.geojson` | `npm run preprocess:bkg` | BKG VG250 WFS, normalized to `Polygon` features. |
| `public/data/processed/eurostat-gisco-fua.geojson` | `npm run preprocess:fua` | Eurostat GISCO Urban Audit FUA, default Germany filter. |
| `public/data/processed/opentopography-dem/samples.geojson` | `npm run preprocess:dem` | Numeric DEM samples for M-section terrain from OpenTopography or local GeoTIFF. Requires GDAL. |
| `public/data/processed/opentopography-contours/contours.geojson` | `npm run preprocess:dem` | Local contour-line layer generated with `gdal_contour`; replaces SRTM WMS display. |
| `public/data/processed/overture-buildings/index.json` | `npm run preprocess:buildings -- --provider overture --bbox ...` | Local Overture extract normalized and sharded for runtime loading. |
| `public/data/processed/lod2-deutschland/index.json` | planned `preprocess:lod2-state` resolver | Germany-wide LoD2-DE / BKG / AdV CityGML-derived shards when access and license metadata are confirmed. |
| `public/data/processed/lod2-federal-states/index.json` | planned `preprocess:lod2-state` resolver | Federal-state LoD2 CityGML-derived shards, selected by clicked point before Overture fallback. |
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

## OpenTopography DEM Samples and Contours

From a local GeoTIFF:

```bash
npm run preprocess:dem -- \
  --dem data/raw/dem/local-dem.tif \
  --bbox 11.2,48.0,11.9,48.4 \
  --out public/data/processed/opentopography-dem/samples.geojson \
  --contours-out public/data/processed/opentopography-contours/contours.geojson \
  --contour-interval 5
```

From OpenTopography:

```bash
OPENTOPOGRAPHY_API_KEY=your-key npm run preprocess:dem -- \
  --bbox 11.2,48.0,11.9,48.4 \
  --demtype COP30 \
  --contour-interval 5
```

The script requires `gdal_translate` and `gdal_contour`. It emits point features
with `elevation`, `sourceId: "opentopography-dem"`, `sourceVersion`, and
`processedAt`, plus contour `LineString` features with `elevation`, `interval`,
`sourceId: "opentopography-contours"`, `sourceVersion`, and `generatedAt`.

Do not use the public SRTM WMS as a viewer terrain layer. It is intentionally
replaced by locally generated contour lines because the raster service contains
visual watermarking and is not an analysis source.

## Building Fallback

Preferred runtime order:

1. `lod2-deutschland-bkg` or state-specific LoD2 shards.
2. `lod2-bayern` where already available.
3. `overture-buildings`.
4. Live OSM building footprints and height tags.
5. GlobalBuildingAtlas only after explicit license review.

The next preprocessing implementation should normalize CityGML LoD2 into the
same sharded `FeatureShardIndex` shape used by Overture. Preserve original
height, roof, federal-state, source URL/version, conversion timestamp and
license fields.

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

### Promoting verified point caches into canonical coverage

Point caches are excluded from a data release. A cache may be promoted only
after its feature source IDs, source versions, polygon geometry, and overlap
with the intended regression window have been checked:

```bash
npm run preprocess:promote-point-cache -- \
  --source-id overture-buildings \
  --cache-index public/data/processed/cache/overture-buildings/50_1099_8_6776_1000m/index.json \
  --canonical-index public/data/processed/overture-buildings/index.json \
  --required-bbox 8.668122,50.101937,8.696138,50.119903 \
  --generated-at 2026-07-26T22:06:45.000Z \
  --dry-run true
```

Remove `--dry-run true` only after reviewing the summary. The timestamp is
explicit so a release job can be reproduced. The merge is idempotent, records
all contributing source versions, de-duplicates source features, and rewrites
only affected shards. Existing Munich shards remain in place.

The promoted cache is still a clipped regression-area extract; it must not be
described as continuous or citywide coverage.

Local source-input inventory, last verified 2026-07-26:

| City/source | Local input | Unique / intersecting features | State |
| --- | --- | ---: | --- |
| Frankfurt / Overture | `cache/overture-buildings/50_1099_8_6776_1000m/index.json` | 4,363 / 3,464 | promoted |
| Rosenheim / Overture | `cache/overture-buildings/47_8536_12_1211_1000m/index.json` | 2,979 / 2,702 | promoted |
| Rosenheim / Urban Atlas | `cache/copernicus-urban-atlas/47_8536_12_1211_1000m/index.json` | 207 / 181 | promoted |
| Frankfurt / Urban Atlas | none intersecting the fixed regression bbox | 0 / 0 | blocked |

Run the deterministic inventory and canonical checks with:

```bash
npm run test:canonical-city-inputs
npm run test:canonical-city-coverage
```

The default canonical check requires Munich for both sources, Frankfurt
Overture, and Rosenheim for both sources. `--require-all true` additionally
requires Frankfurt Urban Atlas and therefore deliberately fails until its
source input exists:

```bash
node scripts/validate/inventory-canonical-city-inputs.mjs --require-all true
node scripts/validate/test-canonical-city-coverage.mjs --require-all true
```

To close the remaining Frankfurt Urban Atlas gap, acquire the official 2021
`DE005L1` FUA input using shell-only CDSE credentials or an externally
downloaded source file, then clip it through the existing point-cache resolver:

```bash
npm run preprocess:point-cache -- \
  --lat 50.11092 \
  --lon 8.68213 \
  --radius 1000 \
  --sources urban-atlas \
  --urban-atlas-fua-code DE005L1 \
  --source-version 2021
```

After the inventory reports an intersecting input, dry-run and then promote
`public/data/processed/cache/copernicus-urban-atlas/50_1109_8_6821_1000m/index.json`
with the fixed Frankfurt bbox above. Never substitute the nearby
`50_0905_8_6850_1000m` cache: its footprint does not intersect the regression
window.

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

### Compacting large polygon shards

Before compaction, the canonical Urban Atlas tree contained 983,872,937 encoded
bytes. One 277,948,504-byte shard contained a road-class source part with
roughly 3.53 million coordinates. Repeating or delivering that complete
geometry as a shard record created avoidable parse and clipping work. The
validated 2026-07-26 compaction reduced the tree to 344,790,532 encoded bytes;
the largest output shard is 3,036,189 bytes.

`compact-sharded-polygons.mjs` reconstructs one geometry per original source
part, validates source IDs, versions, properties, counts, and polygon
structure, then runs one streamed OGR topology audit across every source part.
Invalid input is routed through GDAL `MakeValid(LINEWORK)` and OGR intersection;
ordinary valid input uses the faster polygon-clipping path. Decimal shard
bounds are normalized before intersection, and every final fragment receives
an OGR validity check. Each output record receives:

- a stable `sourcePartId`;
- a stable, shard-specific `fragmentId`, also used as the GeoJSON feature ID;
- `fragmentShardKey` and `fragmentSchema` provenance.
- clipping engine, original-validity, and geometry-repair provenance.

The validated release audited 81,717 source parts, explicitly repaired 81,
and produced 92,409 OGR-valid fragments. Repaired area, fragment area, engine
counts, and the repair count are reconciled in the staged index.

The browser loader gives `fragmentId` precedence during de-duplication, so two
adjacent fragments from one source part are retained when a query spans a shard
boundary.

Inspect encoded size and the conservative heap estimate without parsing any
shard geometry:

```bash
node scripts/preprocess/compact-sharded-polygons.mjs \
  --preflight-only true \
  --input-index public/data/processed/copernicus-urban-atlas/index.json \
  --source-id copernicus-urban-atlas
```

The 2026-07-27 preflight reported 983,872,937 encoded bytes, a 277,948,504-byte
largest shard, a conservative 3,935,491,748-byte peak estimate, and a minimum
recommended old-space value of 5,775 MB. The 8 GB example below leaves
additional headroom. The same read-only inventory found 81,735 shard records
and 81,717 unique `(identifier, partIndex)` source parts, exactly matching the
index `featureCount` of 81,717. Fragmented indexes instead declare an explicit
`sourcePartCount`; the compactor validates that field rather than treating
fragment records as source features.

Build an explicit staging tree only:

```bash
node --max-old-space-size=8192 \
  scripts/preprocess/compact-sharded-polygons.mjs \
  --input-index public/data/processed/copernicus-urban-atlas/index.json \
  --staging-dir /private/tmp/uca-urban-atlas-compact-2021 \
  --source-id copernicus-urban-atlas \
  --generated-at 2026-07-27T09:00:00.000Z
```

Use the real release-job timestamp instead of the example timestamp. The
script refuses an existing staging directory and never modifies the input in
this mode. It writes shard records compactly, reconciles original source-part
count against fragment count, checks exact area conservation, and reports the
input/output byte ratio.

The preflight assumes peak heap may reach four times encoded input while the
source-part geometry set and clipping queues coexist. It stops before parsing
when that estimate exceeds 65% of the configured Node heap and reports the
minimum `--max-old-space-size` value. Output fragments are spooled to disk with
at most 24 open files, so they do not all remain in memory.

Run the synthetic contract before reviewing a real stage:

```bash
node scripts/validate/test-sharded-polygon-compaction.mjs
```

Review `index.json`, `compaction.sourcePartCount`,
`compaction.fragmentCount`, `compaction.sourceAreaDegrees2`,
`compaction.fragmentAreaDegrees2`, `byteRatio`, and several boundary-spanning
features before replacement. A stage is not a release and must not be included
in the data manifest.

Replacement is a separate, explicit operation so the expensive stage can be
reviewed first:

```bash
node scripts/preprocess/compact-sharded-polygons.mjs \
  --apply-staged true \
  --input-index public/data/processed/copernicus-urban-atlas/index.json \
  --staging-dir /private/tmp/uca-urban-atlas-compact-2021 \
  --source-id copernicus-urban-atlas \
  --apply-to public/data/processed/copernicus-urban-atlas \
  --backup-dir /private/tmp/uca-urban-atlas-backup-2021 \
  --confirm-apply copernicus-urban-atlas
```

Apply mode revalidates every staged fragment, recomputes the complete input
asset digest to reject canonical drift after staging, requires the apply target
to exactly equal the input index directory, and refuses an existing backup.
It renames canonical to backup and staging to canonical. If the second rename
fails, it restores the original directory automatically. Keep staging, target,
and backup on the same filesystem for atomic renames.

After applying, rebuild and validate the data-release manifest and run the
canonical city/semantic checks before removing the backup. To recover after a
later validation failure:

1. move the failed compacted canonical directory to a separate diagnostic path;
2. rename the explicit backup directory back to the exact canonical path;
3. rebuild the manifest against the restored assets and rerun its validation;
4. retain the failed tree until the fragment/count discrepancy is understood.

Do not overwrite or delete the backup as part of the compaction command.

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
