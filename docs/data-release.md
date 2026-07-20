# Geodata release contract

The UI and canonical geodata can be deployed independently. Development keeps
the existing same-origin behavior (`/data`). Production may point the browser at
an immutable release root:

```text
VITE_GEODATA_BASE_URL=https://static.example.org/uca-geodata/uca-data-<digest>
UCA_INCLUDE_GEODATA=false
```

`VITE_GEODATA_BASE_URL` must contain `processed/` directly. It is intentionally
public browser configuration, not a credential. `UCA_INCLUDE_GEODATA=false`
omits `public/data/processed/` from the Vite artifact; the default remains
`true` so local development and existing deployments are unchanged. Generated
point caches and their mutable cache manifest are excluded in both modes.

## Build and verify a release

```bash
npm run release:data-manifest
npm run test:data-release
UCA_INCLUDE_GEODATA=false npm run build
```

When `dist/` sits on a synced filesystem and cannot be emptied reliably, stage
the build in a fresh explicit directory without changing artifact contents:

```bash
UCA_INCLUDE_GEODATA=false UCA_OUT_DIR=/private/tmp/uca-ui-dist npm run build
```

Do not point `UCA_OUT_DIR` at a shared or broad directory; Vite owns the selected
build-output path.

The generator writes `public/data/data-release-manifest.json` using the
`uca-data-release-manifest/1.1` contract. The manifest is deterministic: it has
no build timestamp, lists canonical files in sorted order, and records byte size
and SHA-256 for every asset. `assetDigest` identifies that file table.
`releaseDigest` and `releaseId` additionally include the source inventory and
coverage contract. A changed coverage claim therefore creates a new immutable
release even when the bytes in the canonical asset tree did not change.

Every canonical source has two inspectable quality blocks:

- `inventory` reconciles declared, indexed, valid, present, and missing content.
  For a sharded source, `validFeatureCount` is the sum of feature records declared
  by valid shard entries whose asset exists. It is not necessarily a unique
  feature count: a line crossing multiple shards may be materialized more than
  once. For a GeoJSON source it counts valid Polygon/MultiPolygon features.
- `coverageFootprint` contains a WGS84 bbox and polygonal footprint, the method
  used to derive it, the number of footprint units, and explicit limitations.
  Sharded footprints are the valid index-cell bboxes. GeoJSON footprints are
  conservative per-feature bounding envelopes so the release manifest does not
  duplicate the full canonical geometry.

The validator checks schema and canonical-source presence, bbox/coordinate
ranges, closed footprint polygons, inventory reconciliation, city gate values,
file sizes, optional full checksums, exclusions, asset digest, and release
digest. A missing footprint fails the release gate; continuous spatial coverage
must never be inferred from the presence of an index alone.

Upload the `public/data/processed/` tree and the manifest under a directory named
with `releaseId`. Never mutate an existing release directory. Serve release
files with:

```text
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: <UI origin>
```

Publish a new release root when any canonical data file changes, then rebuild
the UI with the new `VITE_GEODATA_BASE_URL`. This lets app releases reuse
unchanged geodata and prevents the multi-gigabyte data tree from being recopied
with every UI deployment.

## City regression gate

`cityGate` deliberately separates two questions that the earlier point-only
gate conflated:

- `point.status` is the analytical probe result. For GeoJSON boundaries it is
  an exact point-in-feature test. For sharded sources it inspects the same 1 km
  query window used by the regression gate and reports intersecting populated
  shards that are present on disk.
- `footprint.containment` says whether the city coordinate is `inside` or
  `outside` the declared footprint (`unknown` only when no footprint can be
  built). It does not claim that features exist continuously throughout a shard
  cell or feature envelope.

Point status means:

- `available`: an intersecting feature or populated shard is present.
- `empty`: the canonical dataset/index exists but has no data at the point.
- `missing`: the canonical dataset/index or every referenced intersecting asset
  is absent or invalid.

`empty` is a verified data gap, not a successful analytical result. It must stay
visible until the corresponding preprocessing output is expanded and versioned.
Likewise, `inside` footprint containment is not equivalent to `available`: the
coordinate may fall in a declared cell or conservative envelope while the point
probe remains empty. Both signals must be checked before making a coverage
claim.

Current footprint limitations are part of the machine-readable manifest:

- Adjacent shard cells are merged into compact rectangles; disconnected cells
  remain separate polygons and the footprint is not a cartographic source
  boundary.
- A populated shard describes an indexed delivery unit, not continuous feature
  presence inside its bbox.
- GeoJSON feature envelopes can overstate holes and concave edges; exact point
  status is still evaluated against the original feature geometry.
- The footprint records valid declared index cells even if a referenced asset is
  missing. The inventory and point probe expose that missing delivery asset
  separately instead of silently shrinking the declared source extent.
