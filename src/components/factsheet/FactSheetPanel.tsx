import type { AnalysisResult, FactSheetModule, Scale } from "../../lib/types";
import { AnalysisCharts } from "./AnalysisCharts";

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
          <p>Select a point on the map or use guided mode.</p>
          <p className="muted-copy">
            Analysis will stay fixed while XL/L/M content changes.
          </p>
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
          <AnalysisCharts analysis={analysis} activeScale={activeScale} />
          <section className="source-run-list" aria-label="Source retrieval status">
            <div className="module-title">
              <h3>Source retrieval</h3>
              <span className="confidence">
                {analysis.provenance.sourceFetches.length}
              </span>
            </div>
            {analysis.provenance.sourceFetches.map((receipt) => (
              <article className="source-run-row" key={receipt.sourceId}>
                <div>
                  <span className="label">{receipt.status}</span>
                  <strong>{receipt.label}</strong>
                </div>
                <span>
                  {receipt.featureCount !== undefined
                    ? `${receipt.featureCount} features`
                    : receipt.recordCount !== undefined
                      ? `${receipt.recordCount} records`
                      : receipt.type}
                </span>
                <small>{receipt.elapsedMs}ms</small>
              </article>
            ))}
          </section>
        </>
      )}
    </aside>
  );
}

function FactModule({ module }: { module: FactSheetModule }) {
  return (
    <section className="fact-module">
      <div className="module-title">
        <h3>{module.title}</h3>
        <span className={`confidence confidence-${module.confidence}`}>
          {module.confidence}
        </span>
      </div>
      <div className="indicator-list">
        {module.indicators.map((indicator) => (
          <article className="indicator-row" key={indicator.id}>
            <div>
              <span className="label">{indicator.label}</span>
              <strong>
                {indicator.value === null ? "not available" : String(indicator.value)}
                {indicator.unit ? <small> {indicator.unit}</small> : null}
              </strong>
            </div>
            <details>
              <summary>Method / sources</summary>
              <p>{indicator.method}</p>
              <p>Sources: {indicator.sourceIds.join(", ")}</p>
              {indicator.caveats.length ? (
                <p>Caveats: {indicator.caveats.join(" ")}</p>
              ) : null}
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
