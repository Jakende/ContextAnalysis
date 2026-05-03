import type { AnalysisResult, Scale } from "../../lib/types";

const steps = [
  "Select point",
  "Switch scale",
  "Review layers",
  "Export package",
] as const;

export function GuidedExplorer({
  mode,
  onModeChange,
  analysis,
  activeScale,
}: {
  mode: "guided" | "direct";
  onModeChange: (mode: "guided" | "direct") => void;
  analysis: AnalysisResult | null;
  activeScale: Scale;
}) {
  const activeStep = !analysis
    ? 0
    : activeScale === "XL"
      ? 1
      : activeScale === "L"
        ? 2
        : 3;

  return (
    <section className="guided-panel panel" aria-label="Interaction mode">
      <div className="mode-row">
        <button
          type="button"
          aria-pressed={mode === "guided"}
          onClick={() => onModeChange("guided")}
        >
          Guided
        </button>
        <button
          type="button"
          aria-pressed={mode === "direct"}
          onClick={() => onModeChange("direct")}
        >
          Direct
        </button>
      </div>
      {mode === "guided" ? (
        <ol className="guided-steps">
          {steps.map((step, index) => (
            <li
              key={step}
              className={index <= activeStep ? "is-complete" : undefined}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <p className="direct-copy">
          Direct mode: click the map or search an address to run the fact sheet
          immediately.
        </p>
      )}
    </section>
  );
}
