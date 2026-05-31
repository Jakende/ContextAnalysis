import type {
  AnalysisResult,
  DataSourceRunEvent,
  FactSheetModule,
  Scale,
} from "../../lib/types";
import type { Feature, FeatureCollection } from "geojson";
import { AnalysisCharts } from "./AnalysisCharts";
import { useMemo, useState } from "react";
import {
  kpiDefinitions,
  kpiStrategies,
  scoreKpis,
  formatClassification,
} from "../../lib/analysis/kpi/kpiMatrix";

export function FactSheetPanel({
  analysis,
  activeScale,
}: {
  analysis: AnalysisResult | null;
  activeScale: Scale;
}) {
  const modules = analysis?.modules.filter(
    (module) => module.scale === activeScale,
  );

  return (
    <aside className="fact-sheet panel" aria-label="Structured fact sheet">
      <header className="fact-sheet-header">
        <span className="label">Fact sheet / {activeScale}</span>
        <h2>
          {activeScale === "XL"
            ? "City & Region"
            : activeScale === "L"
              ? "Neighbourhood"
              : "Streetscape"}
        </h2>
      </header>

      {!analysis ? (
        <div className="empty-state">
          <p>Select a point to load the structured modules.</p>
        </div>
      ) : (
        <>
          <div className="point-readout">
            <span className="label">Selected point</span>
            <strong>
              {analysis.selectedPoint.lat.toFixed(5)},{" "}
              {analysis.selectedPoint.lon.toFixed(5)}
            </strong>
            <span>{analysis.selectedPoint.label ?? "Address not available"}</span>
          </div>
          <div className="module-list">
            {modules?.map((module) => (
              <FactModule key={module.id} module={module} />
            ))}
          </div>
          {activeScale === "L" ? <KpiWeightMatrix analysis={analysis} /> : null}
          <FeatureEvidencePanel analysis={analysis} activeScale={activeScale} />
          <AnalysisCharts analysis={analysis} activeScale={activeScale} />
          <details className="source-run-list">
            <summary>
              Data-source run <span>{analysis.provenance.dataSourceRun.length}</span>
            </summary>
            <div className="source-run-list-body" aria-label="Source retrieval status">
              {analysis.provenance.dataSourceRun.map((event) => (
                <article
                  className={`source-run-row source-run-row-${event.status}`}
                  key={event.id}
                >
                  <div>
                    <span className="label">{event.status}</span>
                    <strong>{event.label}</strong>
                  </div>
                  <span>
                    {formatRunCount(event)}
                  </span>
                  <small>
                    {event.elapsedMs !== undefined ? `${event.elapsedMs}ms` : event.phase}
                  </small>
                </article>
              ))}
            </div>
          </details>
        </>
      )}
    </aside>
  );
}

function KpiWeightMatrix({ analysis }: { analysis: AnalysisResult }) {
  const [strategyId, setStrategyId] = useState("balanced");
  const strategy =
    kpiStrategies.find((item) => item.id === strategyId) ?? kpiStrategies[0];
  const [weights, setWeights] = useState(() =>
    Object.fromEntries(kpiDefinitions.map((definition) => [definition.id, definition.defaultWeight])),
  );
  const scored = useMemo(
    () => scoreKpis(analysis.indicators, strategy, weights),
    [analysis, strategy, weights],
  );

  return (
    <section className="kpi-matrix">
      <div className="module-title">
        <div>
          <h3>Local quality score</h3>
          <span className="label">
            {formatClassification(scored.classification, scored.confidence)}
          </span>
        </div>
        <span className="confidence">{scored.composite ?? "n/a"}</span>
      </div>
      <div className="kpi-strategy-tabs" aria-label="KPI strategy presets">
        {kpiStrategies.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={item.id === strategy.id}
            onClick={() => {
              setStrategyId(item.id);
              setWeights(item.weights);
            }}
            title={item.description}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="kpi-row-list">
        {scored.rows.map((row) => (
          <div className="kpi-row" key={row.definition.id}>
            <span>
              <strong>{row.definition.name}</strong>
              <small>{row.definition.category}</small>
            </span>
            <b>{row.score ?? "n/a"}</b>
            <small>{Math.round(row.weight * 100)}%</small>
          </div>
        ))}
      </div>
      <details className="kpi-advanced">
        <summary>Advanced weights</summary>
        <div className="kpi-row-list">
          {scored.rows.map((row) => (
            <label className="kpi-row kpi-row-editable" key={row.definition.id}>
              <span>
                <strong>{row.definition.name}</strong>
                <small>{row.definition.category}</small>
              </span>
              <b>{Math.round(row.weight * 100)}%</b>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={row.weight}
              onChange={(event) =>
                setWeights((current) => ({
                  ...current,
                  [row.definition.id]: Number(event.target.value),
                }))
              }
              aria-label={`${row.definition.name} weight`}
            />
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}

type FeatureGroup = {
  id: string;
  title: string;
  description: string;
  collection: FeatureCollection;
  geometry?: Feature["geometry"]["type"];
  filter?: (feature: Feature) => boolean;
  labelKeys: string[];
  summaryKeys: string[];
};

function FeatureEvidencePanel({
  analysis,
  activeScale,
}: {
  analysis: AnalysisResult;
  activeScale: Scale;
}) {
  const groups = featureGroupsForScale(analysis, activeScale)
    .map((group) => ({
      ...group,
      features: filteredFeatures(group),
    }))
    .filter((group) => group.features.length > 0);

  if (!groups.length) return null;

  return (
    <section className="feature-evidence">
      <div className="module-title">
        <div>
          <h3>Feature evidence</h3>
          <span className="label">Inspect loaded attributes</span>
        </div>
        <span className="confidence">{groups.length}</span>
      </div>
      <div className="feature-evidence-grid">
        {groups.map((group) => (
          <FeatureGroupCard key={group.id} group={group} />
        ))}
      </div>
    </section>
  );
}

function featureGroupsForScale(
  analysis: AnalysisResult,
  activeScale: Scale,
): FeatureGroup[] {
  if (activeScale === "XL") {
    return [
      {
        id: "xl-grid",
        title: "Zensus grid",
        description: "Grid cells and measured WMS/MBTiles properties.",
        collection: analysis.overlays.xlGrid,
        labelKeys: ["label", "name", "cellId", "id"],
        summaryKeys: ["populationIndex", "valueStatus", "sourceId", "layer"],
      },
      {
        id: "xl-context",
        title: "Boundaries",
        description: "Administrative and regional context geometries.",
        collection: analysis.overlays.xlContext,
        labelKeys: ["name", "GEN", "fua_name", "id"],
        summaryKeys: ["AGS", "ARS", "NUTS", "sourceId", "fua_id"],
      },
      {
        id: "urban-atlas",
        title: "Urban Atlas",
        description: "Loaded Copernicus land-use polygons.",
        collection: analysis.overlays.urbanAtlas,
        labelKeys: ["label", "urbanAtlasClass", "code_2021", "code"],
        summaryKeys: ["code_2021", "code", "urbanAtlasClass", "sourceId"],
      },
    ];
  }
  if (activeScale === "L") {
    return [
      {
        id: "mobility-radii",
        title: "Mobility radii",
        description: "Mode-specific calculation radii used for walking, cycling, transit and car reachability KPIs.",
        collection: analysis.overlays.lBuffer,
        geometry: "Polygon",
        labelKeys: ["label", "mobilityMode", "id"],
        summaryKeys: ["mobilityMode", "radiusBandLabel", "radiusMeters", "timeMinutes", "sourceScale", "primaryKpiRadius"],
      },
      {
        id: "osm-transport-lines",
        title: "OSM public transport lines",
        description: "Live Overpass route/way line features with OSM refs, names, operators, relation IDs and raw tags.",
        collection: analysis.overlays.osmRaw,
        geometry: "LineString",
        filter: (feature) => feature.properties?.overpassModuleId === "transportLines",
        labelKeys: ["lineLabel", "routeRefs", "ref", "routeNames", "name", "routeRelations", "osmId"],
        summaryKeys: [
          "transportMode",
          "routeRefs",
          "routeNames",
          "routeFroms",
          "routeTos",
          "routeNetworks",
          "routeOperators",
          "routeRelations",
          "railway",
          "highway",
        ],
      },
      {
        id: "transport-overlay-lines",
        title: "Rendered transport lines",
        description: "Line geometries currently passed to the map overlay; kept separate from raw OSM evidence for debugging.",
        collection: analysis.overlays.transport,
        geometry: "LineString",
        labelKeys: ["lineLabel", "routeRefs", "ref", "routeNames", "name", "routeRelations", "osmId"],
        summaryKeys: ["transportMode", "routeRefs", "routeNames", "routeNetworks", "routeOperators", "routeRelations"],
      },
      {
        id: "transport-stops",
        title: "Public transport stops",
        description: "GTFS and OSM stop/platform/station attributes.",
        collection: analysis.overlays.transport,
        geometry: "Point",
        labelKeys: ["stop_name", "name", "ref", "id"],
        summaryKeys: ["transportMode", "sourceId", "operator", "network"],
      },
      {
        id: "mobility",
        title: "Mobility infrastructure",
        description: "Cycle, pedestrian, parking, charging and support features.",
        collection: analysis.overlays.mobility,
        labelKeys: ["name", "highway", "amenity", "mobilityMode", "id"],
        summaryKeys: ["mobilityMode", "highway", "cycleway", "amenity", "parking"],
      },
      {
        id: "pois",
        title: "POIs",
        description: "Social, civic, commercial, leisure and service POIs.",
        collection: analysis.overlays.pois,
        labelKeys: ["name", "amenity", "shop", "tourism", "leisure", "id"],
        summaryKeys: ["poiCategory", "amenity", "shop", "tourism", "leisure"],
      },
      {
        id: "gastronomy",
        title: "Gastronomy",
        description: "Food and beverage POIs with cuisine/name tags where available.",
        collection: analysis.overlays.gastronomy,
        labelKeys: ["name", "amenity", "cuisine", "id"],
        summaryKeys: ["amenity", "cuisine", "opening_hours", "operator"],
      },
      {
        id: "parking",
        title: "Parking areas",
        description: "Parking polygons and related access/capacity tags.",
        collection: analysis.overlays.parkingAreas,
        labelKeys: ["name", "parking", "amenity", "id"],
        summaryKeys: ["parking", "access", "capacity", "surface", "fee"],
      },
      {
        id: "green-blue",
        title: "Green / blue",
        description: "Open-space and water features used for L-scale indicators.",
        collection: mergeFeatureCollections(analysis.overlays.green, analysis.overlays.blue),
        labelKeys: ["name", "leisure", "landuse", "natural", "water", "id"],
        summaryKeys: ["leisure", "landuse", "natural", "water", "waterway", "sourceId"],
      },
      {
        id: "raw-overpass",
        title: "Raw Overpass",
        description: "All normalized live OSM features, grouped by query module.",
        collection: analysis.overlays.osmRaw,
        labelKeys: ["name", "lineLabel", "overpassModuleId", "id"],
        summaryKeys: ["overpassModuleId", "osmElementType", "sourceId", "transportMode", "poiCategory"],
      },
    ];
  }
  return [
    {
      id: "buildings",
      title: "Buildings",
      description: "LOD2 / Overture / OSM building attributes and height fields.",
      collection: analysis.overlays.buildings,
      labelKeys: ["name", "id", "building", "building:part"],
      summaryKeys: [
        "sourceId",
        "height",
        "estimatedHeight",
        "sectionHeightMeters",
        "sectionHeightSource",
        "building:height",
        "heightMeters",
        "building:levels",
        "roof:shape",
      ],
    },
    {
      id: "trees",
      title: "Trees",
      description: "Tree points, crown/height/species tags and source metadata.",
      collection: analysis.overlays.trees,
      labelKeys: ["species", "genus", "name", "id"],
      summaryKeys: ["natural", "species", "leaf_type", "diameter_crown", "height", "sourceId"],
    },
    {
      id: "streets-section",
      title: "Street / section",
      description: "Street segment, section line, terrain and contour evidence.",
      collection: mergeFeatureCollections(
        analysis.overlays.mStreetSegment,
        analysis.overlays.sectionLine,
        analysis.overlays.contours,
      ),
      labelKeys: ["name", "label", "highway", "id", "elevation"],
      summaryKeys: [
        "highway",
        "width",
        "lanes",
        "surface",
        "elevation",
        "contourStatus",
        "interval",
        "sourceId",
        "caveat",
      ],
    },
    {
      id: "m-raw-overpass",
      title: "Raw M Overpass",
      description: "Street, tree, building and edge features fetched live from OSM.",
      collection: analysis.overlays.osmRaw,
      labelKeys: ["name", "overpassModuleId", "id"],
      summaryKeys: ["overpassModuleId", "osmElementType", "highway", "building", "natural", "barrier"],
    },
  ];
}

function FeatureGroupCard({
  group,
}: {
  group: FeatureGroup & { features: Feature[] };
}) {
  const topAttributes = summarizeTopAttributes(group.features, group.summaryKeys);
  return (
    <details className="feature-group-card">
      <summary>
        <span>
          <strong>{group.title}</strong>
          <small>{group.description}</small>
        </span>
        <b>{group.features.length}</b>
      </summary>
      {topAttributes.length ? (
        <div className="feature-attribute-strip">
          {topAttributes.map((item) => (
            <span key={`${item.key}:${item.value}`}>
              <i>{item.key}</i>
              {item.value} <small>{item.count}</small>
            </span>
          ))}
        </div>
      ) : null}
      <div className="feature-record-list">
        {group.features.slice(0, 50).map((feature, index) => (
          <FeatureRecord
            feature={feature}
            labelKeys={group.labelKeys}
            summaryKeys={group.summaryKeys}
            index={index}
            key={`${String(feature.properties?.osmElementType ?? feature.geometry.type)}:${String(feature.properties?.id ?? feature.properties?.osmId ?? index)}`}
          />
        ))}
      </div>
      {group.features.length > 50 ? (
        <p className="feature-overflow-note">
          Showing 50 of {group.features.length} records. Full attribute table is available in GeoJSON/GPKG exports.
        </p>
      ) : null}
    </details>
  );
}

function FeatureRecord({
  feature,
  labelKeys,
  summaryKeys,
  index,
}: {
  feature: Feature;
  labelKeys: string[];
  summaryKeys: string[];
  index: number;
}) {
  const label = readFirstProperty(feature, labelKeys) ?? `${feature.geometry.type} ${index + 1}`;
  const summary = summaryKeys
    .map((key) => [key, feature.properties?.[key]] as const)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .slice(0, 5);
  const properties = Object.entries(feature.properties ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <details className="feature-record">
      <summary>
        <span>{label}</span>
        <small>{feature.geometry.type}</small>
      </summary>
      {summary.length ? (
        <div className="feature-record-summary">
          {summary.map(([key, value]) => (
            <span key={key}>
              <i>{key}</i>
              {formatPropertyValue(value)}
            </span>
          ))}
        </div>
      ) : null}
      <dl className="feature-property-grid">
        {properties.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{formatPropertyValue(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function filteredFeatures(group: FeatureGroup): Feature[] {
  return group.collection.features.filter((feature) =>
    (group.geometry ? feature.geometry.type === group.geometry : true) &&
    (group.filter ? group.filter(feature) : true),
  );
}

function summarizeTopAttributes(
  features: Feature[],
  keys: string[],
): Array<{ key: string; value: string; count: number }> {
  const counts = new Map<string, { key: string; value: string; count: number }>();
  for (const feature of features) {
    for (const key of keys) {
      const value = feature.properties?.[key];
      if (value === undefined || value === null || !String(value).trim()) continue;
      for (const part of String(value).split(";").map((item) => item.trim()).filter(Boolean)) {
        const mapKey = `${key}:${part}`;
        const current = counts.get(mapKey) ?? { key, value: part, count: 0 };
        current.count += 1;
        counts.set(mapKey, current);
      }
    }
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
    .slice(0, 10);
}

function readFirstProperty(feature: Feature, keys: string[]): string | null {
  for (const key of keys) {
    const value = feature.properties?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function formatPropertyValue(value: unknown): string {
  if (value === undefined || value === null) return "not available";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function mergeFeatureCollections(...collections: FeatureCollection[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) => collection.features),
  };
}

function formatRunCount(event: DataSourceRunEvent): string {
  if (event.featureCount !== undefined) return `${event.featureCount} features`;
  if (event.recordCount !== undefined) return `${event.recordCount} records`;
  return event.phase;
}

function FactModule({ module }: { module: FactSheetModule }) {
  return (
    <section className="fact-module">
      <div className="module-title">
        <div>
          <h3>{module.title}</h3>
          <span className="label">Scale {module.scale}</span>
        </div>
        <span className={`confidence confidence-${module.confidence}`}>
          {module.confidence}
        </span>
      </div>
      <div className="module-meta">
        <span>{module.indicators.length} indicators</span>
        <span>{new Date(module.computedAt).toLocaleString()}</span>
      </div>
      <div className="indicator-list">
        {module.indicators.map((indicator) => (
          <details className="indicator-row" key={indicator.id}>
            <summary>
              <span className="indicator-summary-label">{indicator.label}</span>
              <strong>
                {indicator.value === null ? "not available" : String(indicator.value)}
                {indicator.unit ? <small> {indicator.unit}</small> : null}
              </strong>
            </summary>
            <div className="indicator-body">
              <p>
                <span className="label">Method</span>
                {indicator.method}
              </p>
              <p>
                <span className="label">Sources</span>
                {indicator.sourceIds.join(", ")}
              </p>
              <p>
                <span className="label">Updated</span>
                {new Date(indicator.computedAt).toLocaleString()}
              </p>
              {indicator.caveats.length ? (
                <p>
                  <span className="label">Caveats</span>
                  {indicator.caveats.join(" ")}
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>
      <details className="module-details">
        <summary>Module provenance</summary>
        <p>{module.method}</p>
        <p>Sources: {module.sourceIds.join(", ")}</p>
        <p>Updated: {new Date(module.computedAt).toLocaleString()}</p>
        {module.caveats.length ? <p>Caveats: {module.caveats.join(" ")}</p> : null}
      </details>
    </section>
  );
}
