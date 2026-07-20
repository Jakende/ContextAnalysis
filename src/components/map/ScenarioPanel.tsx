import {
  scenarioFeatureDefinition,
  type ScenarioFeatureType,
  type ScenarioLayer,
} from "../../lib/scenario";

const FEATURE_TYPES: ScenarioFeatureType[] = [
  "transit_stop",
  "bike_share_station",
  "new_street",
  "green_edge",
  "public_space",
];

export function ScenarioPanel({
  scenario,
  drawingType,
  draftVertexCount,
  disabled,
  onStartDrawing,
  onFinishDrawing,
  onCancelDrawing,
  onRemoveFeature,
  onClear,
}: {
  scenario: ScenarioLayer;
  drawingType: ScenarioFeatureType | null;
  draftVertexCount: number;
  disabled: boolean;
  onStartDrawing: (type: ScenarioFeatureType) => void;
  onFinishDrawing: () => void;
  onCancelDrawing: () => void;
  onRemoveFeature: (featureId: string) => void;
  onClear: () => void;
}) {
  const activeDefinition = drawingType
    ? scenarioFeatureDefinition(drawingType)
    : null;
  const canFinish = activeDefinition
    ? activeDefinition.geometryKind === "line"
      ? draftVertexCount >= 2
      : activeDefinition.geometryKind === "polygon"
        ? draftVertexCount >= 3
        : false
    : false;

  return (
    <details className="scenario-panel panel" open={drawingType ? true : undefined}>
      <summary>
        <span>
          <span className="label">Scenario</span>
          <strong>User proposals</strong>
        </span>
        <small>{scenario.features.features.length}</small>
      </summary>
      <div className="scenario-panel-body">
        <p>
          Proposed geometry stays separate from observed sources. KPI effects are not inferred.
        </p>
        {drawingType && activeDefinition ? (
          <div className="scenario-drawing-status" aria-live="polite">
            <strong>{activeDefinition.label}</strong>
            <span>
              {activeDefinition.geometryKind === "point"
                ? "Click the proposal location."
                : `${draftVertexCount} point(s). Click the map, then finish.`}
            </span>
            <div className="scenario-drawing-actions">
              {activeDefinition.geometryKind !== "point" ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!canFinish}
                  onClick={onFinishDrawing}
                >
                  Finish
                </button>
              ) : null}
              <button type="button" className="ghost-button" onClick={onCancelDrawing}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="scenario-type-grid">
            {FEATURE_TYPES.map((type) => {
              const definition = scenarioFeatureDefinition(type);
              return (
                <button
                  type="button"
                  className="ghost-button"
                  key={type}
                  disabled={disabled}
                  onClick={() => onStartDrawing(type)}
                >
                  <span>{definition.label}</span>
                  <small>{definition.geometryKind}</small>
                </button>
              );
            })}
          </div>
        )}
        {scenario.features.features.length ? (
          <div className="scenario-feature-list">
            {scenario.features.features.map((feature) => (
              <div key={feature.properties.id}>
                <span>{feature.properties.label}</span>
                <button
                  type="button"
                  className="ghost-button"
                  aria-label={`Remove ${feature.properties.label}`}
                  onClick={() => onRemoveFeature(feature.properties.id)}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="ghost-button scenario-clear" onClick={onClear}>
              Clear scenario
            </button>
          </div>
        ) : null}
        {disabled ? <small className="scenario-note">Run an analysis to activate scenario drawing.</small> : null}
      </div>
    </details>
  );
}

