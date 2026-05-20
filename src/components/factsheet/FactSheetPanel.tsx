import type {
  AnalysisResult,
  DataSourceRunEvent,
  FactSheetModule,
  Scale,
} from "../../lib/types";
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
