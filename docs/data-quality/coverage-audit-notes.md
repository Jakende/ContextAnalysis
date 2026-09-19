# Coverage audit source notes

- Audience: technical maintainers and product owners deciding whether a data release is safe to promote.
- Decision: the release machinery is production-shaped; coverage claims must remain limited to verified source/city pairs.
- Grain: six canonical sources x three fixed regression points, inspected at a 1,000 m envelope.
- Denominator: six release-managed canonical sources. Zensus WMS is validated separately and excluded from this denominator because it is a live external service.
- Comparison baseline: `available`, `empty`, and `missing` states in `public/data/data-release-manifest.json` generated on 2026-07-20.
- Visual contract: one full-width categorical bar compares available-source counts (Munich 6, Frankfurt 4, Rosenheim 4) against the declared six-source denominator; the adjacent audit table preserves exact source version, intersecting feature count, status, and severity. No trend or distribution is implied.
- Robustness: release hashes, byte sizes, exclusions, deterministic digest, and source/city status domain are covered by `npm run test:data-release`; official Zensus WMS availability was rechecked with network access using `npm run test:data-sources:regression`.
- Limitation: three points and compact index-derived footprints do not establish continuous spatial or semantic coverage. Municipality/FUA coverage percentages and semantic/attribute quality checks remain open.
- Report structure mapping: title; technical summary; key findings with metric cards and the audit table; definitions; method; limitations; next steps; further questions.
