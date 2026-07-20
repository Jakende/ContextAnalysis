# Curated benchmark ingestion

The benchmark preprocessor converts reviewable CSV or JSON peer rows into the runtime `peers.v1` contract. It does not fetch, estimate, or fabricate observed KPI values. The current runtime file remains explicitly illustrative until a reviewed observed input is supplied.

## Input grain and provenance

One row represents one peer observation for one comparison context. All rows in one output must be mutually comparable:

- `radius`: one radius within 1 m; declared areas must all be present or all absent and within 5%.
- `project-area`: all areas must be within 5%.
- `administrative-area`: one administrative geography type; declared areas must all be present or all absent and within 5%.

Every peer requires a unique ID, geography type, observation timestamp, at least one KPI score, confidence, caveats, source registry IDs, and one version for every source. The preprocessing timestamp must be at or after every observation timestamp. Scores are limited to the KPI IDs in schema `1.0.0` and the inclusive range 0–100.

Unknown source IDs, duplicate IDs including case-only duplicates, mixed context grains, conflicting source versions, missing provenance, and scores outside the accepted range fail the build. `status: curated` is emitted only after all checks pass. Dataset confidence cannot exceed the least-confident peer.

## CSV

Start with [`data/templates/benchmark-peers.template.csv`](../data/templates/benchmark-peers.template.csv). List values use `|` or `;`; source versions use `source-id=version`. KPI columns use their exact `kpi.*` IDs. The header-only template intentionally contains no example scores that could be mistaken for observations.

```bash
npm run preprocess:benchmarks -- \
  --input data/incoming/benchmark-peers.csv \
  --output src/lib/data/benchmark/peers.v1.json \
  --dataset-id munich-district-radius-500m \
  --dataset-version 2026-01 \
  --label "Munich district 500 m observations" \
  --preprocessed-at 2026-07-20T00:00:00.000Z \
  --confidence medium \
  --caveat "Coverage and KPI-method limitations documented in the source release."
```

## JSON

JSON input uses `{ "metadata": { ... }, "peers": [ ... ] }`; the inspectable schema is [`data/templates/benchmark-peers.input.schema.json`](../data/templates/benchmark-peers.input.schema.json). CLI metadata overrides JSON metadata when both are provided.

The only populated example is the clearly synthetic validation fixture at `scripts/validate/fixtures/benchmark-peers.synthetic.json`. It must never be copied into a production release.

## Validation and release review

```bash
npm run test:benchmark-ingestion
npm run test:benchmark
npm run typecheck
```

Before replacing the illustrative runtime dataset, reviewers should retain the upstream extract/query, transformation code, source release identifiers, licensing notes, KPI schema version, observation date, preprocessing timestamp, and documented limitations. Passing structural validation means the rows are internally safe to compare; it does not certify that the upstream observations or KPI methodology are authoritative.
