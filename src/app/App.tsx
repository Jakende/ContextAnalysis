import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ExportPanel } from "../components/export/ExportPanel";
import { FactSheetPanel } from "../components/factsheet/FactSheetPanel";
import { MapView } from "../components/map/MapView";
import { recomputeMSectionFromAnalysis } from "../lib/analysis/m/analyzeM";
import { runLocationAnalysis } from "../lib/analysis/runAnalysis";
import { resolvePointCache } from "../lib/api/pointCache";
import { loadTerrainSamplesForSection } from "../lib/data/localSpatial";
import { pointCacheResultsToRunEvents } from "../lib/data/sourceRun";
import type {
  AnalysisResult,
  AnalysisLoadStep,
  LayerId,
  LayerState,
  Scale,
  SectionLine,
} from "../lib/types";

const DEFAULT_LAYERS: LayerState = {
  "3D": true,
  trees: true,
  sun: false,
  section: true,
  green: true,
};

export function App() {
  const [activeScale, setActiveScale] = useState<Scale>("XL");
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [sectionLine, setSectionLine] = useState<SectionLine | null>(null);
  const [sectionSvg, setSectionSvg] = useState("");
  const [status, setStatus] = useState("Map initializing.");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisLoadSteps, setAnalysisLoadSteps] = useState<AnalysisLoadStep[]>([]);
  const [themeInvert, setThemeInvert] = useState(false);
  const sideStackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.toggle("theme-invert", themeInvert);
  }, [themeInvert]);

  async function handlePointSelected(point: { lat: number; lon: number }) {
    if (analysis || isAnalyzing) {
      setStatus("Analysis is locked. Close the current analysis before selecting a new point.");
      return;
    }
    setIsAnalyzing(true);
    setAnalysisLoadSteps(createInitialLoadSteps());
    setStatus("Analysis running.");
    try {
      const requestedAt = new Date().toISOString();
      setLoadStep(setAnalysisLoadSteps, "point-cache", "running", "Checking point cache coverage and resolving missing large datasets.");
      const cacheResult = await resolvePointCache({
        ...point,
        radius: 1_000,
        sources: ["overture", "urban-atlas"],
      });
      const failedCacheSources = cacheResult.results.filter((result) => result.status === "failed");
      const skippedCacheSources = cacheResult.results.filter((result) => result.status === "skipped");
      setLoadStep(
        setAnalysisLoadSteps,
        "point-cache",
        failedCacheSources.length ? "failed" : "ok",
        summarizePointCache(cacheResult.results, cacheResult.error),
      );
      if (skippedCacheSources.length || failedCacheSources.length) {
        setStatus(compactPointCacheStatus(cacheResult.results, cacheResult.error));
      }
      const preflightSourceRun = pointCacheResultsToRunEvents({
        requestedAt,
        elapsedMs: cacheResult.elapsedMs,
        results: cacheResult.results,
        error: cacheResult.error,
      });

      const { result, sectionSvg: nextSectionSvg } = await runLocationAnalysis({
        ...point,
        activeScale,
        layers,
        sectionLine,
        preflightSourceRun,
        onProgress: (step) =>
          setLoadStep(setAnalysisLoadSteps, step.id, step.status, step.detail),
        enableGeocoding: true,
        enableOverpass: true,
      });
      setAnalysis(result);
      setSectionSvg(nextSectionSvg);
      setAnalysisLoadSteps((current) =>
        current.map((step) =>
          step.status === "running" || step.status === "queued"
            ? { ...step, status: "ok" }
            : step,
        ),
      );
      setStatus("Analysis ready. XL/L/M scales and exports are available.");
    } catch (error) {
      setAnalysisLoadSteps((current) =>
        current.map((step) =>
          step.status === "running"
            ? {
                ...step,
                status: "failed",
                detail: error instanceof Error ? error.message : String(error),
              }
            : step,
        ),
      );
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleAnalysisClear() {
    setAnalysis(null);
    setSectionLine(null);
    setSectionSvg("");
    setIsAnalyzing(false);
    setAnalysisLoadSteps([]);
    setStatus("Analysis closed. Search can zoom the map; click the canvas pin target for a new analysis.");
  }

  async function handleSectionLineSelected(nextSectionLine: SectionLine) {
    if (!analysis) {
      setStatus("Select an analysis point before drawing an M-scale section line.");
      return;
    }

    try {
      const terrainSamples = await loadTerrainSamplesForSection(nextSectionLine);
      const { result, sectionSvg: nextSectionSvg } = recomputeMSectionFromAnalysis(
        analysis,
        nextSectionLine,
        terrainSamples,
      );
      setSectionLine(nextSectionLine);
      setAnalysis(result);
      setSectionSvg(nextSectionSvg);
      setStatus("Section updated from the drawn line. Current analysis remains locked until closed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function handleScaleChange(scale: Scale) {
    setActiveScale(scale);
    setAnalysis((current) =>
      current
        ? {
            ...current,
            activeScale: scale,
            mapState: { ...current.mapState, layers },
          }
        : current,
    );
  }

  function handleLayerToggle(id: LayerId) {
    setLayers((current) => {
      const next = { ...current, [id]: !current[id] };
      setAnalysis((analysisResult) =>
        analysisResult
          ? {
              ...analysisResult,
              mapState: { ...analysisResult.mapState, layers: next },
            }
          : analysisResult,
      );
      return next;
    });
  }

  function handleLayerReset() {
    setLayers(DEFAULT_LAYERS);
    setAnalysis((current) =>
      current
        ? {
            ...current,
            mapState: { ...current.mapState, layers: DEFAULT_LAYERS },
          }
        : current,
    );
  }

  return (
    <main className="app-shell">
      <header className="top-rail" aria-label="Product overview">
        <div className="brand-block">
          <span className="label">Urban Context Analysis</span>
          <strong>Map-first urban context workspace</strong>
        </div>
        <button
          type="button"
          className="theme-toggle ghost-button"
          onClick={() => setThemeInvert((current) => !current)}
        >
          {themeInvert ? "Dark" : "Light"} theme
        </button>
      </header>

      <section className="workspace">
        <MapView
          analysis={analysis}
          activeScale={activeScale}
          layers={layers}
          isAnalyzing={isAnalyzing}
          analysisLoadSteps={analysisLoadSteps}
          analysisLocked={Boolean(analysis)}
          onPointSelected={handlePointSelected}
          onAnalysisClear={handleAnalysisClear}
          onSectionLineSelected={handleSectionLineSelected}
          onScaleChange={handleScaleChange}
          onLayerToggle={handleLayerToggle}
          onLayerReset={handleLayerReset}
          onStatus={setStatus}
          themeInvert={themeInvert}
        />
        <div className="side-stack" ref={sideStackRef}>
          <div className="side-stack-toolbar panel">
            <div>
              <span className="label">Inspector</span>
              <strong>{activeScale} fact sheet</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Fullscreen inspector"
              title="Fullscreen inspector"
              onClick={() => requestElementFullscreen(sideStackRef.current)}
            >
              <FullscreenIcon />
            </button>
          </div>
          {activeScale === "M" && layers.section && sectionSvg ? (
            <section
              key={sectionLineKey(sectionLine, sectionSvg)}
              className={`section-preview panel ${
                hasCalculatedSection(analysis) ? "section-preview-active" : ""
              }`}
              aria-label="Adaptive cross-section"
            >
              <div className="section-preview-header">
                <span className="label">M Section</span>
                <strong>
                  {hasCalculatedSection(analysis)
                    ? "Calculated from drawn line"
                    : "Waiting for section line"}
                </strong>
              </div>
              <div dangerouslySetInnerHTML={{ __html: sectionSvg }} />
            </section>
          ) : null}
          <FactSheetPanel analysis={analysis} activeScale={activeScale} />
          <ExportPanel
            analysis={analysis}
            sectionSvg={sectionSvg}
            onStatus={setStatus}
          />
        </div>
      </section>

      <footer className="app-footer">
        <div>
          <span className="label">Status</span>
          <strong>{status}</strong>
        </div>
        <div>
          <span className="label">Attribution</span>
          <span>
            OpenFreeMap, © OpenMapTiles, OpenStreetMap contributors / ODbL, Destatis, GeoBasis-DE / BKG, LOD2 Bayern, Eurostat GISCO, Copernicus, GHSL, DWD, Mobilithek.
          </span>
        </div>
      </footer>
    </main>
  );
}

function createInitialLoadSteps(): AnalysisLoadStep[] {
  return [
    {
      id: "point-cache",
      label: "Area cache resolver",
      detail: "Checking Overture buildings and Urban Atlas cache coverage.",
      status: "queued",
    },
    {
      id: "geocoding",
      label: "Nominatim reverse lookup",
      detail: "Waiting for point-cache resolver.",
      status: "queued",
    },
    {
      id: "overpass",
      label: "Overpass OSM modules",
      detail: "Waiting for live feature query.",
      status: "queued",
    },
    {
      id: "local-data",
      label: "Local and WMS datasets",
      detail: "Waiting for sharded source reads.",
      status: "queued",
    },
    {
      id: "indicators",
      label: "XL/L/M indicators",
      detail: "Waiting for deterministic analysis.",
      status: "queued",
    },
  ];
}

function setLoadStep(
  setSteps: Dispatch<SetStateAction<AnalysisLoadStep[]>>,
  id: string,
  status: AnalysisLoadStep["status"],
  detail: string,
): void {
  setSteps((current) =>
    current.map((step) => (step.id === id ? { ...step, status, detail } : step)),
  );
}

function summarizePointCache(
  results: Array<{ source: string; status: string; message?: string }>,
  error?: string,
): string {
  if (error && results.length === 0) return "Point cache resolver unavailable.";
  if (!results.length) return "Point cache resolver returned no source results.";
  return results
    .map((result) => `${result.source}: ${result.status}${result.message ? ` (${compactMessage(result.message)})` : ""}`)
    .join(" / ");
}

function compactPointCacheStatus(
  results: Array<{ source: string; status: string; message?: string }>,
  error?: string,
): string {
  if (error && results.length === 0) return "Point cache unavailable. Continuing with live/local sources.";
  const failed = results.filter((result) => result.status === "failed");
  const skipped = results.filter((result) => result.status === "skipped");
  if (!failed.length && !skipped.length) return "Point cache ready.";
  return [...failed, ...skipped]
    .map((result) => `${result.source}: ${result.status}`)
    .join(" / ");
}

function compactMessage(message: string): string {
  if (/CDSE credentials/i.test(message)) return "CDSE credentials missing";
  if (/Point cache updated/i.test(message)) return "updated";
  return message.split(/\r?\n/)[0].slice(0, 90);
}

function requestElementFullscreen(element: HTMLElement | null): void {
  if (!element) return;
  if (document.fullscreenElement === element) {
    void document.exitFullscreen();
    return;
  }
  void element.requestFullscreen();
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

function hasCalculatedSection(analysis: AnalysisResult | null): boolean {
  return Boolean(analysis?.overlays.sectionLine.features.length);
}

function sectionLineKey(sectionLine: SectionLine | null, sectionSvg: string): string {
  if (!sectionLine) return `pending:${sectionSvg.length}`;
  return [
    sectionLine.start.lat.toFixed(6),
    sectionLine.start.lon.toFixed(6),
    sectionLine.end.lat.toFixed(6),
    sectionLine.end.lon.toFixed(6),
    sectionSvg.length,
  ].join(":");
}
