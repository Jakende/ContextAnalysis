import type { Scale } from "../../lib/types";

const scales: Array<{ id: Scale; label: string; description: string }> = [
  { id: "XL", label: "Stadt & Region", description: "Boundaries / CSV / FUA" },
  { id: "L", label: "Quartier", description: "Radius / land use / access" },
  { id: "M", label: "Strassenraum", description: "Segment / section / 3D" },
];

export function ScaleSwitcher({
  activeScale,
  onChange,
}: {
  activeScale: Scale;
  onChange: (scale: Scale) => void;
}) {
  return (
    <div className="scale-switcher" aria-label="Scale switching">
      {scales.map((scale) => (
        <button
          key={scale.id}
          type="button"
          aria-pressed={activeScale === scale.id}
          onClick={() => onChange(scale.id)}
          title={scale.description}
        >
          <span>{scale.id}</span>
          <small>{scale.label}</small>
        </button>
      ))}
    </div>
  );
}
