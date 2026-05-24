import type { AnalysisResult, LayerId, LayerState, Scale } from "../../lib/types";

type LayerControl = {
  id: LayerId;
  label: string;
  source: CollectionOverlayKey | "wms";
  scale: "XL" | "L" | "M" | "ALL";
  geometry?: "Point" | "LineString" | "Polygon";
  property?: string;
  value?: string;
  excludeValues?: string[];
};

type CollectionOverlayKey = Exclude<keyof AnalysisResult["overlays"], "selectedPoint">;

const layerControls: LayerControl[] = [
  { id: "xlContext", label: "XL context", source: "xlContext", scale: "XL", geometry: "Polygon" },
  { id: "zensusWms", label: "Zensus WMS", source: "wms", scale: "XL" },
  { id: "xlGrid", label: "Zensus grid", source: "xlGrid", scale: "XL", geometry: "Polygon" },
  { id: "xlSources", label: "XL sources", source: "xlSources", scale: "XL", geometry: "Polygon" },
  { id: "urbanAtlas", label: "Urban Atlas", source: "urbanAtlas", scale: "L", geometry: "Polygon" },
  { id: "lBuffer", label: "L radius", source: "lBuffer", scale: "L", geometry: "Polygon" },
  { id: "green", label: "Green", source: "green", scale: "L", geometry: "Polygon" },
  { id: "blue", label: "Blue / water", source: "blue", scale: "L", geometry: "Polygon" },
  { id: "transportAll", label: "All transport lines", source: "transport", scale: "L", geometry: "LineString" },
  { id: "transitBus", label: "Transit bus", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "bus" },
  { id: "transitTram", label: "Transit tram", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "tram" },
  { id: "transitSubway", label: "Transit subway", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "subway" },
  { id: "transitLightRail", label: "Transit light rail", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "light_rail" },
  { id: "transitRail", label: "Transit rail", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "rail" },
  { id: "transitOther", label: "Transit other", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", excludeValues: ["bus", "tram", "subway", "light_rail", "rail"] },
  { id: "mobilityBike", label: "Bike routes", source: "mobility", scale: "L", geometry: "LineString", property: "mobilityMode", value: "bike" },
  { id: "mobilityPedestrian", label: "Pedestrian", source: "mobility", scale: "L", geometry: "LineString", property: "mobilityMode", value: "pedestrian" },
  { id: "mobilitySupport", label: "Mobility support", source: "mobility", scale: "L", property: "mobilityMode", value: "support" },
  { id: "poiEducation", label: "POI education", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "education" },
  { id: "poiHealth", label: "POI health", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "health" },
  { id: "poiCivic", label: "POI civic", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "civic" },
  { id: "poiCommerce", label: "POI commerce", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "commerce" },
  { id: "poiFoodCulture", label: "POI food/culture", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "food_culture" },
  { id: "poiLeisureTourism", label: "POI leisure/tourism", source: "pois", scale: "L", geometry: "Point", property: "poiCategory", value: "leisure_tourism" },
  { id: "development", label: "Development", source: "development", scale: "L", geometry: "Polygon" },
  { id: "buildingFootprints", label: "OSM buildings", source: "buildings", scale: "L", geometry: "Polygon" },
  { id: "streets", label: "Street / corridor", source: "mStreetSegment", scale: "M", geometry: "LineString" },
  { id: "3D", label: "Buildings 3D", source: "buildings", scale: "M", geometry: "Polygon" },
  { id: "trees", label: "Trees", source: "trees", scale: "M", geometry: "Point" },
  { id: "sun", label: "Sun", source: "sun", scale: "M", geometry: "LineString" },
  { id: "section", label: "Section line", source: "sectionLine", scale: "M", geometry: "LineString" },
  { id: "srtm", label: "SRTM raster", source: "wms", scale: "M" },
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
    (layer) => layer.scale === activeScale || layer.scale === "ALL",
  );

  return (
    <section className="layer-panel" aria-label="Layer toggles">
      <div className="panel-heading">
        <span className="label">{activeScale} layers</span>
        <button type="button" className="ghost-button" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="diagnostic-layer-list">
        {visibleControls.map((layer) => {
          const count = getLayerCount(analysis, layer);
          return (
            <button
              key={layer.id}
              type="button"
              className="is-current-scale"
              aria-pressed={state[layer.id]}
              onClick={() => onToggle(layer.id)}
            >
              <span className="layer-switch-indicator" aria-hidden="true" />
              <span className="layer-name">{layer.label}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
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
