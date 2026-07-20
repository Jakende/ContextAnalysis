import type {
  AnalysisResult,
  LayerId,
  LayerStyleState,
  LayerState,
  LayerVisualStyle,
  Scale,
} from "../../lib/types";
import { useState } from "react";

type LayerControl = {
  id: LayerId;
  label: string;
  group: string;
  source: CollectionOverlayKey | "wms";
  scale: "XL" | "L" | "M" | "ALL";
  geometry?: "Point" | "LineString" | "Polygon";
  property?: string;
  value?: string;
  includeValues?: string[];
  excludeValues?: string[];
};

type CollectionOverlayKey = Exclude<keyof AnalysisResult["overlays"], "selectedPoint">;

const layerControls: LayerControl[] = [
  { id: "xlContext", label: "Context geometry", group: "XL context", source: "xlContext", scale: "XL", geometry: "Polygon" },
  { id: "zensusWms", label: "Zensus raster", group: "XL context", source: "wms", scale: "XL" },
  { id: "xlGrid", label: "Zensus grid values", group: "XL context", source: "xlGrid", scale: "XL", geometry: "Polygon" },
  { id: "xlSources", label: "Source coverage", group: "XL context", source: "xlSources", scale: "XL", geometry: "Polygon" },
  { id: "urbanAtlas", label: "Urban Atlas", group: "Land", source: "urbanAtlas", scale: "L", geometry: "Polygon" },
  { id: "lBuffer", label: "L context boundary", group: "Land", source: "lBuffer", scale: "L", geometry: "Polygon" },
  { id: "green", label: "Green", group: "Land", source: "green", scale: "L", geometry: "Polygon" },
  { id: "blue", label: "Blue / water", group: "Land", source: "blue", scale: "L", geometry: "Polygon" },
  { id: "parkingAreas", label: "Parking areas", group: "Land", source: "parkingAreas", scale: "L", geometry: "Polygon" },
  { id: "buildingFootprints", label: "OSM buildings", group: "Land", source: "buildings", scale: "L", geometry: "Polygon" },
  { id: "barriers", label: "Barriers / edges", group: "Land", source: "barriers", scale: "L" },
  { id: "transportAll", label: "All transport lines", group: "Transit", source: "transport", scale: "L", geometry: "LineString" },
  { id: "transitLocal", label: "Local transit bundle", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", includeValues: ["bus", "tram", "subway", "transit"] },
  { id: "transitRegional", label: "Regional rail bundle", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", includeValues: ["light_rail", "rail"] },
  { id: "transitBus", label: "Bus", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "bus" },
  { id: "transitTram", label: "Tram", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "tram" },
  { id: "transitSubway", label: "Subway", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "subway" },
  { id: "transitLightRail", label: "Light rail", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "light_rail" },
  { id: "transitRail", label: "Rail", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", value: "rail" },
  { id: "transitOther", label: "Other transit", group: "Transit", source: "transport", scale: "L", geometry: "LineString", property: "transportMode", excludeValues: ["bus", "tram", "subway", "light_rail", "rail"] },
  { id: "mobility", label: "Mobility bundle", group: "Mobility", source: "mobility", scale: "L" },
  { id: "mobilityBike", label: "Bike routes", group: "Mobility", source: "mobility", scale: "L", geometry: "LineString", property: "mobilityMode", value: "bike" },
  { id: "mobilityPedestrian", label: "Pedestrian", group: "Mobility", source: "mobility", scale: "L", geometry: "LineString", property: "mobilityMode", value: "pedestrian" },
  { id: "mobilitySupport", label: "Support points", group: "Mobility", source: "mobility", scale: "L", property: "mobilityMode", value: "support" },
  { id: "isochrones", label: "All isochrones", group: "Isochrones", source: "isochrones", scale: "L" },
  { id: "isochroneWalking", label: "Walking", group: "Isochrones", source: "isochrones", scale: "L", property: "isochroneMode", value: "walking" },
  { id: "isochroneCycling", label: "Cycling", group: "Isochrones", source: "isochrones", scale: "L", property: "isochroneMode", value: "cycling" },
  { id: "isochroneDriving", label: "Driving", group: "Isochrones", source: "isochrones", scale: "L", property: "isochroneMode", value: "driving" },
  { id: "pois", label: "All POIs", group: "POI", source: "pois", scale: "L", geometry: "Point" },
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
  { id: "contours", label: "Contour lines", group: "M streetscape", source: "contours", scale: "M", geometry: "LineString" },
];

export function LayerTogglePanel({
  layers: state,
  layerStyles,
  analysis,
  activeScale,
  onToggle,
  onStyleChange,
  onReset,
}: {
  layers: LayerState;
  layerStyles: LayerStyleState;
  analysis: AnalysisResult | null;
  activeScale: Scale;
  onToggle: (id: LayerId) => void;
  onStyleChange: (id: LayerId, patch: Partial<LayerVisualStyle>) => void;
  onReset: () => void;
}) {
  const [isOpen, setIsOpen] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 721px)").matches,
  );
  if (!analysis) return null;
  const visibleControls = layerControls.filter(
    (layer) =>
      layer.scale === activeScale ||
      layer.scale === "ALL" ||
      (activeScale === "M" && layer.scale === "L"),
  );
  const groups = groupLayerControls(visibleControls);

  return (
    <section className="layer-panel" data-open={isOpen} aria-label="Layer toggles">
      <div className="panel-heading">
        <div>
          <span className="label">Layer picker</span>
          <strong>{activeScale === "M" ? "M + L context" : `${activeScale} scale`}</strong>
        </div>
        <div className="layer-panel-actions">
          <button
            type="button"
            className="ghost-button"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((current) => !current)}
          >
            {isOpen ? "Hide" : "Show"}
          </button>
          {isOpen ? (
            <button type="button" className="ghost-button" onClick={onReset}>
              Reset
            </button>
          ) : null}
        </div>
      </div>
      {isOpen ? <div className="layer-picker-list">
        {groups.map(([group, controls]) => (
          <div className="layer-picker-group" key={group}>
            <span className="layer-picker-group-title">{group}</span>
            {controls.map((layer) => {
              const count = getLayerCount(analysis, layer);
              const style = layerStyles[layer.id];
              const styleLocked = layer.source === "wms" || layer.id === "isochrones";
              const lockedReason =
                layer.source === "wms"
                  ? "defined by the WMS service"
                  : "defined by its child mode layers";
              return (
                <div className="layer-picker-row" key={layer.id}>
                  <button
                    type="button"
                    aria-pressed={state[layer.id]}
                    data-empty={count === "0"}
                    onClick={() => onToggle(layer.id)}
                  >
                    <span
                      className="layer-switch-indicator"
                      style={{ backgroundColor: state[layer.id] ? style.color : "transparent" }}
                      aria-hidden="true"
                    />
                    <span className="layer-name">{layer.label}</span>
                    <small>{layer.scale === activeScale ? layer.scale : `${layer.scale} context`}</small>
                    <strong>{count}</strong>
                  </button>
                  <label
                    className="layer-color-control"
                    title={
                      styleLocked
                        ? `${layer.label} color is ${lockedReason}`
                        : `${layer.label} color`
                    }
                    data-disabled={styleLocked}
                  >
                    <span className="sr-only">{layer.label} color</span>
                    <input
                      type="color"
                      value={style.color}
                      disabled={styleLocked}
                      onChange={(event) =>
                        onStyleChange(layer.id, { color: event.target.value })
                      }
                    />
                  </label>
                  <label
                    className="layer-width-control"
                    title={
                      styleLocked
                        ? `${layer.label} size is ${lockedReason}`
                        : `${layer.label} symbol size`
                    }
                    data-disabled={styleLocked}
                  >
                    <span className="sr-only">{layer.label} size</span>
                    <input
                      type="range"
                      min="0.8"
                      max="9"
                      step="0.2"
                      value={style.width}
                      disabled={styleLocked}
                      onChange={(event) =>
                        onStyleChange(layer.id, { width: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>
        ))}
      </div> : null}
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
        layer.includeValues &&
        !layer.includeValues.includes(String(feature.properties?.[layer.property] ?? ""))
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
