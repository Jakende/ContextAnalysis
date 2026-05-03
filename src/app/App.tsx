import { useEffect, useRef, useState } from "react";
import { ExportPanel } from "../components/export/ExportPanel";
import { FactSheetPanel } from "../components/factsheet/FactSheetPanel";
import { MapView } from "../components/map/MapView";
import { recomputeMSectionFromAnalysis } from "../lib/analysis/m/analyzeM";
import { runLocationAnalysis } from "../lib/analysis/runAnalysis";
import type {
  AnalysisResult,
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
    setStatus("Querying fresh Nominatim, Overpass, tile metadata, local datasets, and configured source adapters for this point.");
    try {
      const { result, sectionSvg: nextSectionSvg } = await runLocationAnalysis({
        ...point,
        activeScale,
        layers,
        sectionLine,
        enableGeocoding: true,
        enableOverpass: true,
      });
      setAnalysis(result);
      setSectionSvg(nextSectionSvg);
      setStatus("Analysis ready. XL/L/M scales and exports are available.");
    } catch (error) {
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
    setStatus("Analysis closed. Search can zoom the map; click the canvas pin target for a new analysis.");
  }

  function handleSectionLineSelected(nextSectionLine: SectionLine) {
    if (!analysis) {
      setStatus("Select an analysis point before drawing an M-scale section line.");
      return;
    }

    try {
      const { result, sectionSvg: nextSectionSvg } = recomputeMSectionFromAnalysis(
        analysis,
        nextSectionLine,
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
      <section className="landing-strip" aria-label="Product overview">
        <div className="brand-block">
          <span className="label">Urban Context Analysis</span>
          <h1>Kontextanalyse</h1>
          <p>
            Punkt setzen, Live-Daten abrufen, XL/L/M-Fact-Sheet exportieren.
          </p>
        </div>
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setThemeInvert((current) => !current)}
        >
          {themeInvert ? "Dark" : "Light"} theme
        </button>
      </section>

      <section className="workspace">
        <MapView
          analysis={analysis}
          activeScale={activeScale}
          layers={layers}
          mode="direct"
          isAnalyzing={isAnalyzing}
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
              className="ghost-button"
              onClick={() => requestElementFullscreen(sideStackRef.current)}
            >
              Side fullscreen
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
            OpenFreeMap, © OpenMapTiles, OpenStreetMap contributors / ODbL,
            Destatis, GeoBasis-DE / BKG, LOD2 Bayern, Eurostat GISCO,
            Copernicus, GHSL, DWD, Mobilithek.
          </span>
        </div>
      </footer>
    </main>
  );
}

function requestElementFullscreen(element: HTMLElement | null): void {
  if (!element) return;
  if (document.fullscreenElement === element) {
    void document.exitFullscreen();
    return;
  }
  void element.requestFullscreen();
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
