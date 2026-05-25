import type { AnalysisResult, LayerId, LayerState, Scale } from "../../lib/types";

type LayerControl = {
  id: LayerId;
  label: string;
  group: string;
  source: CollectionOverlayKey | "wms";
  scale: "XL" | "L" | "M" | "ALL";
  geometry?: "Point" | "LineString" | "Polygon";
  property?: string;
  value?: string;
  excludeValues?: string[];
};

type CollectionOverlayKey = Exclude<keyof AnalysisResult["overlays"], "selectedPoint">;

const layerControls: LayerControl[] = [
  { id: "xlContext", label: "Context geometry", group: "XL context", source: "xlContext", scale: "XL", geometry: "Polygon" },
  { id: "zensusWms", label: "Zensus raster", group: "XL context", source: "wms", scale: "XL" },
  { id: "xlGrid", label: "Zensus grid values", group: "XL context", source: "xlGrid", scale: "XL", geometry: "Polygon" },
  { id: "xlSources", label: "Source coverage", group: "XL context", source: "xlSources", scale: "XL", geometry: "Polygon" },
  { id: "urbanAtlas", label: "Urban Atlas", group: "Land", source: "urbanAtlas", scale: "L", geometry: "Polygon" },
  { id: "lBuffer", label: "Radius", group: "Land", source: "lBuffer", scale: "L", geometry: "Polygon" },
  { id: "green", label: "Green", group: "Land", source: "green", scale: "L", geometry: "Polygon" },
  { id: "blue", label: "Blue / water", group: "Land", source: "blue", scale: "L", geometry: "Polygon" },
  { id: "parkingAreas", label: "Parking areas", group: "Land", source: "parkingAreas", scale: "L", geometry: "Polygon" },
  { id: "buildingFootprints", label: "OSM buildings", group: "Land", source: "buildings", scale: "L", geometry: "Polygon" },
  { id: "transportAll", label: "All transport lines", group: "Transit", source: "transport", scale: "L", geometry: "LineString" },
  { id: "transitBus", label: "Bus", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "bus" },
  { id: "transitTram", label: "Tram", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "tram" },
  { id: "transitSubway", label: "Subway", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "subway" },
  { id: "transitLightRail", label: "Light rail", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "light_rail" },
  { id: "transitRail", label: "Rail", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "rail" },
  { id: "transitOther", label: "Other transit", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", excludeValues: ["bus", "tram", "subway", "light_rail", "rail"] },
  { id: "mobilityBike", label: "Bike routes", group: "Mobility", source: "mobility", scale: "L", geometry: "LineString", property: "mobilityMode", value: "bike" },
  { id: "mobilityPedestrian", label: "Pedestrian", group: "Mobility", source: "mobility", scale: "L", geometry: "LineString", property: "mobilityMode", value: "pedestrian" },
  { id: "mobilitySupport", label: "Support points", group: "Mobility", source: "mobility", scale: "L", property: "mobilityMode", value: "support" },
  { id: "poiEducation", label: "Education", group: "POI", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "education" },
  { id: "poiHealth", label: "Health", group: "POI", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "health" },
  { id: "poiCivic", label: "Civic", group: "POI", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "civic" },
  { id: "poiCommerce", label: "Commerce", group: "POI", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "commerce" },
  { id: "poiFoodCulture", label: "Culture", group: "POI", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "food_culture" },
  { id: "poiLeisureTourism", label: "Leisure / tourism", group: "POI", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "leisure_tourism" },
  { id: "gastronomy", label: "Gastronomy", group: "POI", source: "gastronomy", scale: "L", geometry: "Point" },
  { id: "development", label: "Development hints", group: "Potential", source: "development", scale: "L", geometry: "Polygon" },
  { id: "streets", label: "Street / corridor", group: "M streetscape", source: "mStreetSegment", scale: "M", geometry: "LineString" },
  { id: "3D", label: "Buildings 3D", group: "M streetscape", source: "buildings", scale: "M", geometry: "Polygon" },
  { id: "trees", label: "Trees", group: "M streetscape", source: "trees", scale: "M", geometry: "Point" },
  { id: "sun", label: "Sun", group: "M streetscape", source: "sun", scale: "M", geometry: "LineString" },
  { id: "section", label: "Section line", group: "M streetscape", source: "sectionLine", scale: "M", geometry: "LineString" },
  { id: "srtm", label: "SRTM raster", group: "M streetscape", source: "wms", scale: "M" },
];

export function LayerTogglePanel({
  layers: state,
  analysis,
  activeScale,
  onToggle,
  onReset,
}: {
  layers: LayerState;
  analysis: AnalysisResult | null;
  activeScale: Scale;
  onToggle: (id: LayerId) => void;
  onReset: () => void;
}) {
  if (!analysis) return null;
  const visibleControls = layerControls.filter(
    (layer) =>
      layer.scale === activeScale ||
      layer.scale === "ALL" ||
      (activeScale === "M" && layer.scale === "L"),
  );
  const groups = groupLayerControls(visibleControls);

  return (
    <section className="layer-panel" aria-label="Layer toggles">
      <div className="panel-heading">
        <div>
          <span className="label">Layer picker</span>
          <strong>{activeScale === "M" ? "M + L context" : `${activeScale} scale`}</strong>
        </div>
        <button type="button" className="ghost-button" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="layer-picker-list">
        {groups.map(([group, controls]) => (
          <div className="layer-picker-group" key={group}>
            <span className="layer-picker-group-title">{group}</span>
            {controls.map((layer) => {
              const count = getLayerCount(analysis, layer);
              return (
                <button
                  key={layer.id}
                  type="button"
                  aria-pressed={state[layer.id]}
                  data-empty={count === "0"}
                  onClick={() => onToggle(layer.id)}
                >
                  <span className="layer-switch-indicator" aria-hidden="true" />
                  <span className="layer-name">{layer.label}</span>
                  <small>{layer.scale === activeScale ? layer.scale : `${layer.scale} context`}</small>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function groupLayerControls(controls: LayerControl[]): Array<[string, LayerControl[]]> {
  const grouped = new Map<string, LayerControl[]>();
  for (const control of controls) {
    const current = grouped.get(control.group) ?? [];
    current.push(control);
    grouped.set(control.group, current);
  }
  return Array.from(grouped.entries());
}

function getLayerCount(analysis: AnalysisResult, layer: LayerControl): string {
  if (layer.source === "wms") return "WMS";
  const features = analysis.overlays[layer.source].features;
  return String(
    features.filter((feature) => {
      if (layer.geometry && feature.geometry.type !== layer.geometry) return false;
      if (
        layer.property &&
        layer.value !== undefined &&
        feature.properties?.[layer.property] !== layer.value
      ) {
        return false;
      }
      if (
        layer.property &&
        layer.excludeValues?.includes(String(feature.properties?.[layer.property] ?? ""))
      ) {
        return false;
      }
      return true;
    }).length,
  );
}
