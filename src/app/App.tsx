import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
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
  LayerStyleState,
  LayerState,
  LayerVisualStyle,
  Scale,
  SectionLine,
} from "../lib/types";

const DEFAULT_LAYERS: LayerState = {
  "3D": true,
  trees: true,
  sun: true,
  section: true,
  green: true,
  blue: true,
  xlContext: true,
  zensusWms: true,
  xlGrid: true,
  xlSources: true,
  urbanAtlas: false,
  lBuffer: true,
  transitLocal: false,
  transitRegional: false,
  transportAll: false,
  transitBus: false,
  transitTram: false,
  transitSubway: false,
  transitLightRail: false,
  transitRail: false,
  transitOther: false,
  mobility: false,
  mobilityBike: false,
  mobilityPedestrian: false,
  mobilitySupport: false,
  isochrones: false,
  isochroneWalking: false,
  isochroneCycling: false,
  isochroneDriving: false,
  pois: false,
  poiEducation: false,
  poiHealth: false,
  poiCivic: false,
  poiCommerce: false,
  poiFoodCulture: false,
  poiLeisureTourism: false,
  gastronomy: false,
  development: false,
  parkingAreas: false,
  buildingFootprints: false,
  streets: true,
  barriers: false,
  contours: true,
};

const DEFAULT_LAYER_STYLES: LayerStyleState = {
  "3D": { color: "#6da9c8", width: 2.6 },
  trees: { color: "#5fa86b", width: 7.2 },
  sun: { color: "#d8bc52", width: 3 },
  section: { color: "#d8bc52", width: 4 },
  green: { color: "#5fa86b", width: 1.8 },
  blue: { color: "#5d9fc3", width: 1.9 },
  xlContext: { color: "#7aa0c4", width: 2.6 },
  zensusWms: { color: "#d8bc52", width: 1 },
  xlGrid: { color: "#d8bc52", width: 1.4 },
  xlSources: { color: "#c8855b", width: 1.8 },
  urbanAtlas: { color: "#9b8cc8", width: 1.4 },
  lBuffer: { color: "#e2e6e3", width: 1.8 },
  transitLocal: { color: "#d3b54d", width: 3.2 },
  transitRegional: { color: "#9b8cc8", width: 3 },
  transportAll: { color: "#c8855b", width: 3 },
  transitBus: { color: "#d3b54d", width: 3.2 },
  transitTram: { color: "#c76b62", width: 3.4 },
  transitSubway: { color: "#5db8c2", width: 3.4 },
  transitLightRail: { color: "#6ea877", width: 3 },
  transitRail: { color: "#9b8cc8", width: 2.8 },
  transitOther: { color: "#b9b8a8", width: 2.2 },
  mobility: { color: "#5db8c2", width: 2.8 },
  mobilityBike: { color: "#54a9ba", width: 3.2 },
  mobilityPedestrian: { color: "#66a796", width: 2.6 },
  mobilitySupport: { color: "#d09a51", width: 2.8 },
  isochrones: { color: "#d3b54d", width: 1.8 },
  isochroneWalking: { color: "#6ea877", width: 2 },
  isochroneCycling: { color: "#54a9ba", width: 2 },
  isochroneDriving: { color: "#d09a51", width: 2 },
  pois: { color: "#c97886", width: 5.2 },
  poiEducation: { color: "#668fc7", width: 5.2 },
  poiHealth: { color: "#c76b62", width: 5.2 },
  poiCivic: { color: "#9b8cc8", width: 5.2 },
  poiCommerce: { color: "#c8855b", width: 4.8 },
  poiFoodCulture: { color: "#c97886", width: 4.8 },
  poiLeisureTourism: { color: "#6ea877", width: 4.8 },
  gastronomy: { color: "#b875b8", width: 5.2 },
  development: { color: "#c8855b", width: 5.4 },
  parkingAreas: { color: "#88929a", width: 1.4 },
  buildingFootprints: { color: "#9aa5ad", width: 1.3 },
  streets: { color: "#f2f3ec", width: 5.8 },
  barriers: { color: "#c76b62", width: 3 },
  contours: { color: "#d8bc52", width: 1.4 },
};

const MIN_INSPECTOR_WIDTH = 320;
const MAX_INSPECTOR_WIDTH = 760;
const MIN_MAP_WIDTH = 420;

export function App() {
  const [activeScale, setActiveScale] = useState<Scale>("XL");
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [layerStyles, setLayerStyles] = useState<LayerStyleState>(DEFAULT_LAYER_STYLES);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [sectionLine, setSectionLine] = useState<SectionLine | null>(null);
  const [sectionSvg, setSectionSvg] = useState("");
  const [status, setStatus] = useState("Map initializing.");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisLoadSteps, setAnalysisLoadSteps] = useState<AnalysisLoadStep[]>([]);
  const [themeInvert, setThemeInvert] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(440);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const sideStackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.toggle("theme-invert", themeInvert);
  }, [themeInvert]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWorkspaceExpanded(false);
      setInspectorExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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
    setLayerStyles(DEFAULT_LAYER_STYLES);
    setAnalysis((current) =>
      current
        ? {
            ...current,
            mapState: { ...current.mapState, layers: DEFAULT_LAYERS },
          }
        : current,
    );
  }

  function handleLayerStyleChange(id: LayerId, patch: Partial<LayerVisualStyle>) {
    setLayerStyles((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...patch,
      },
    }));
  }

  function handleSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    setIsResizingInspector(true);

    const updateInspectorWidth = (clientX: number) => {
      const rect = workspace.getBoundingClientRect();
      const style = window.getComputedStyle(workspace);
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(style.paddingRight) || 0;
      const contentRight = rect.right - paddingRight;
      const contentWidth = rect.width - paddingLeft - paddingRight;
      const max = Math.max(
        MIN_INSPECTOR_WIDTH,
        Math.min(MAX_INSPECTOR_WIDTH, contentWidth - MIN_MAP_WIDTH),
      );
      const next = Math.max(MIN_INSPECTOR_WIDTH, Math.min(max, contentRight - clientX));
      setInspectorWidth(next);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateInspectorWidth(moveEvent.clientX);
    };
    const handlePointerUp = () => {
      setIsResizingInspector(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
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

      <section
        className={[
          "workspace",
          isResizingInspector ? "is-resizing" : "",
          workspaceExpanded ? "is-expanded" : "",
        ].filter(Boolean).join(" ")}
        ref={workspaceRef}
        style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
      >
        <MapView
          analysis={analysis}
          activeScale={activeScale}
          layers={layers}
          layerStyles={layerStyles}
          isAnalyzing={isAnalyzing}
          analysisLoadSteps={analysisLoadSteps}
          analysisLocked={Boolean(analysis)}
          onPointSelected={handlePointSelected}
          onAnalysisClear={handleAnalysisClear}
          onSectionLineSelected={handleSectionLineSelected}
          onScaleChange={handleScaleChange}
          onLayerToggle={handleLayerToggle}
          onLayerStyleChange={handleLayerStyleChange}
          onLayerReset={handleLayerReset}
          onStatus={setStatus}
          themeInvert={themeInvert}
          workspaceExpanded={workspaceExpanded}
          onWorkspaceExpandedToggle={() => {
            setInspectorExpanded(false);
            setWorkspaceExpanded((current) => !current);
          }}
        />
        <div
          className="workspace-splitter"
          role="separator"
          aria-label="Resize map and inspector"
          aria-orientation="vertical"
          aria-valuemin={MIN_INSPECTOR_WIDTH}
          aria-valuemax={MAX_INSPECTOR_WIDTH}
          aria-valuenow={Math.round(inspectorWidth)}
          tabIndex={0}
          onPointerDown={handleSplitterPointerDown}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setInspectorWidth((current) =>
                Math.min(MAX_INSPECTOR_WIDTH, current + 24),
              );
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setInspectorWidth((current) =>
                Math.max(MIN_INSPECTOR_WIDTH, current - 24),
              );
            }
          }}
        />
        <div
          className={`side-stack ${inspectorExpanded ? "is-expanded" : ""}`}
          ref={sideStackRef}
        >
          <div className="side-stack-toolbar panel">
            <div>
              <span className="label">Inspector</span>
              <strong>{activeScale} fact sheet</strong>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={inspectorExpanded ? "Collapse inspector" : "Expand inspector"}
              title={inspectorExpanded ? "Collapse inspector" : "Expand inspector"}
              onClick={() => {
                setWorkspaceExpanded(false);
                setInspectorExpanded((current) => !current);
              }}
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
