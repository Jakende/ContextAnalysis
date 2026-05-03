import type { LayerId, LayerState } from "../../lib/types";

const layers: Array<{ id: LayerId; label: string; method: string }> = [
  { id: "3D", label: "3D", method: "LOD2/OSM massing" },
  { id: "trees", label: "Trees", method: "OSM tree hints" },
  { id: "sun", label: "Sun", method: "Representative sun vector" },
  { id: "section", label: "Section", method: "Adaptive SVG cross-section" },
  { id: "green", label: "Green", method: "Green/open classes" },
];

export function LayerTogglePanel({
  layers: state,
  onToggle,
  onReset,
}: {
  layers: LayerState;
  onToggle: (id: LayerId) => void;
  onReset: () => void;
}) {
  return (
    <section className="layer-panel" aria-label="Layer toggles">
      <div className="panel-heading">
        <span className="label">Layers</span>
        <button type="button" className="ghost-button" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="toggle-grid">
        {layers.map((layer) => (
          <button
            key={layer.id}
            type="button"
            aria-pressed={state[layer.id]}
            onClick={() => onToggle(layer.id)}
          >
            <span>{layer.label}</span>
            <small>{layer.method}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
