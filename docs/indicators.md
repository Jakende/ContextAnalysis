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
- `L`: radius or project-area hectares, green percentage, land-use mix, dominant land-use family, land-use family shares, unique public-transport stops, transit stop density, transit mode mix, public-transport lines, mobility, civic POIs, Tree Canopy KPI proxy, Station Axis KPI proxy, KPI benchmark percentiles, development hints.
- `M`: street segment, cross-section width, tree edge, building massing, sun/shadow hint, frontage condition.

## Spatial context

`l.radius` records the L-scale context itself:

- without a project area, its value is the configured radius in metres and its geometry is the circular buffer;
- with a project area, its value is the approximate project area in hectares and its geometry is the canonical WGS84 polygon/multipolygon.

All point/count/distance evidence used by L indicators and KPIs must be filtered to this same context. For project boundaries, the dissolved stored project area supplies density denominators. Land-use and green/blue polygons are exactly clipped and dissolved against the same context. Urban Atlas owns baseline coverage; OSM fills uncovered areas only, and deterministic family precedence makes area shares mutually exclusive.

## KPI indicators and scenario

KPI schema `0.4.0` emits structured indicators, not UI-only scores:

- `kpi.local-quality-score` and `kpi.local-quality-class`.
- `kpi.tree_canopy` from `l.tree-canopy-score`.
- `kpi.station_axis` from `l.station-axis-score`.
- `benchmark.*` indicators for the schema-versioned illustrative peer set, its timestamp, context-comparability status, and any valid rank/percentile.

The six core KPI families are Mobility Access, Green/Blue Access, Urban Mix, Social Infrastructure Access, Tree Canopy, and Station Axis. Walking, cycling, and transit contribute to Mobility Access; car driving remains a visible context indicator with zero composite contribution. Routed reachability excludes deterministic fallback polygons.

The current user-selected strategy is stored separately as `analysis.kpiScenario`. It records the schema version, strategy ID/name, weights, resulting composite, classification, confidence, available KPI IDs, and computation time. Changing strategy weights changes derived interpretation only; it never mutates raw indicators or source evidence. All exports must preserve this object so they reproduce the score shown in the UI.

Benchmark ranks are emitted only for comparable observation contexts. A project area never inherits a fixed-radius peer rank, and a mismatched radius suppresses the full rank/percentile/strongest/weakest profile rather than presenting a misleading comparison.
