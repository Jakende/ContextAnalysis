# Semantic city coverage gate

Asset delivery and analytical fitness are separate release decisions.
`public/data/data-release-manifest.json` remains the immutable inventory and
point-probe contract. The semantic gate reads that manifest but independently
profiles the delivered features against official municipality and FUA
contexts.

The policy is source controlled in
`scripts/release/semantic-city-coverage.config.json`. It fixes:

- the Munich, Frankfurt am Main, and Rosenheim regression coordinates;
- the official BKG municipality AGS and GISCO FUA IDs;
- the 1,000 m analytical intersection;
- required geometry types and properties per source;
- source-version/freshness rules;
- expected class counts; and
- municipality/FUA delivery and Urban Atlas thematic coverage thresholds.

Run the deterministic contract checks:

```bash
npm run test:semantic-coverage
```

Generate the machine-readable release assessment:

```bash
npm run release:semantic-coverage
```

This writes `docs/data-quality/semantic-city-coverage.json`. The document has
no wall-clock generation timestamp. It is bound to the immutable
`releaseId`/`releaseDigest` and the policy's explicit `referenceDate`, so the
same data and policy produce the same result.

Each semantic source also verifies that its current index or GeoJSON asset has
the byte size and SHA-256 declared by that release, and that its source version
matches the manifest. Regenerate the immutable release manifest before the
semantic report whenever preprocessing changes canonical files; the gate
rejects evidence attributed to a stale release.

Enforce the current release as a promotion gate:

```bash
npm run test:semantic-coverage:release
```

The enforcement command intentionally exits non-zero while a required
city/source pair is unavailable or semantically below its declared threshold.
It does not rewrite the tracked result.

## Status model

Each city/source pair exposes three distinct fields:

- `availability`: copied from the immutable release manifest's exact point or
  1 km shard probe (`available`, `empty`, or `missing`);
- `semanticQuality.status`: derived only from geometry, attributes, version,
  class coverage, context coverage, and exact analytical intersection
  (`pass` or `fail`);
- `promotionStatus`: `pass` only when availability is `available` and semantic
  quality passes.

An `inside` footprint or a present index is never treated as semantic
completeness.

## Checks and grain

Geometry validity is structural WGS84 validation: supported geometry type,
finite/ranged coordinates, closed non-zero polygon rings, and non-degenerate
lines. It is deliberately stricter than a file-presence check but is not a
replacement for a full OGC topology validator.

Required-attribute completeness and source-version consistency are measured
over de-duplicated features that intersect the fixed 1 km regression context.
Class coverage uses a source-specific controlled property such as
`code_2021`, `transportMode`, or `label`.
Every check carries deterministic severity and confidence metadata; geometry
or release-contract failures are critical, coverage/attribute failures are
high, and freshness failures are medium.

Delivery coverage is the percentage of official BKG municipality or GISCO FUA
geometry intersected by present delivery cells. For point and line datasets
that percentage is evidence only: sparse transit features are instead gated by
non-empty exact intersection, freshness, attributes, and classes. Urban Atlas
also has a municipality thematic-coverage gate based on clipped classified
polygon area.

## Interpreting blocked results

The generated JSON is the current evidence. Do not copy its counts or release
ID into narrative documentation because both change when canonical
preprocessing advances. A blocked city/source pair is not a reason to weaken a
threshold: populate and version the source, rebuild the immutable manifest,
regenerate the semantic report, and only then rerun the enforcing promotion
gate.
