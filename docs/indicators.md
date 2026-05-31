# Indicators

Every indicator follows the common model from `AGENTS.md`:

- `id`
- `label`
- `scale`
- `value`
- `unit`
- `geometry`
- `method`
- `sourceIds`
- `sourceVersion`
- `computedAt`
- `confidence`
- `caveats`

Acceptance-critical examples are present:

- `XL`: municipality, district, population, density, age, rent, FUA context.
- `L`: radius, green percentage, land-use mix, dominant land-use family, land-use family shares, unique public-transport stops, transit stop density, transit mode mix, public-transport lines, mobility, civic POIs, Tree Canopy KPI proxy, Station Axis KPI proxy, KPI benchmark percentiles, development hints.
- `M`: street segment, cross-section width, tree edge, building massing, sun/shadow hint, frontage condition.

KPI-specific indicators are emitted as structured indicators, not UI-only scores:

- `kpi.local-quality-score` and `kpi.local-quality-class`.
- `kpi.tree_canopy` from `l.tree-canopy-score`.
- `kpi.station_axis` from `l.station-axis-score`.
- `benchmark.*` indicators for the current MVP peer-set rank and percentile.
