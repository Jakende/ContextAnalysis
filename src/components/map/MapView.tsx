import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "../../lib/api/geocoding";
import { googleSatelliteTileUrl } from "../../lib/data/publicGeoServices";
import { openFreeMapStyle } from "../../lib/tiles/openFreeMapStyle";
import {
  ZENSUS_WMS_DISPLAY_LAYER,
  ZENSUS_WMS_METRICS,
  zensusWmsTileUrl,
} from "../../lib/data/zensusWms";
import type {
  AnalysisLoadStep,
  AnalysisResult,
  LayerId,
  LayerState,
  SectionLine,
} from "../../lib/types";
import { LayerTogglePanel } from "./LayerTogglePanel";
import { ScaleSwitcher } from "./ScaleSwitcher";
import type { Scale } from "../../lib/types";

const DEFAULT_CENTER: [number, number] = [11.5755, 48.1397];
const DEFAULT_ZOOM = 12;
type BackgroundMode = "osmRaster" | "vector" | "googleSatellite";

const MAP_LAYER_COLORS = {
  xl: "#93c5fd",
  zensus: "#f3d35c",
  zensusLow: "#15321d",
  zensusMedium: "#f3d35c",
  zensusHigh: "#d45a33",
  zensusMissing: "#8a8f8a",
  xlSource: "#f97316",
  urbanAtlas: "#8b5cf6",
  buffer: "#e5e7eb",
  selected: "#ffffff",
  green: "#31d158",
  blue: "#0ea5e9",
  tree: "#16a34a",
  building: "#60a5fa",
  street: "#f8fafc",
  contour: "#f3d35c",
  transport: "#facc15",
  transportBus: "#facc15",
  transportTram: "#ef4444",
  transportSubway: "#22d3ee",
  transportRail: "#a78bfa",
  transportLightRail: "#31d158",
  mobility: "#22d3ee",
  mobilityBike: "#06b6d4",
  mobilityPedestrian: "#14b8a6",
  mobilitySupport: "#f59e0b",
  poi: "#fb7185",
  poiEducation: "#2563eb",
  poiHealth: "#dc2626",
  poiCivic: "#7c3aed",
  poiCommerce: "#f97316",
  poiFoodCulture: "#e11d48",
  poiLeisureTourism: "#16a34a",
  gastronomy: "#d946ef",
  parking: "#64748b",
  barrier: "#ef4444",
  development: "#f97316",
  sun: "#fde047",
} as const;

const LOCAL_TRANSIT_MODES = ["bus", "tram", "subway", "transit"];
const RAIL_TRANSIT_MODES = ["light_rail", "rail"];

export function MapView({
  analysis,
  activeScale,
  layers,
  isAnalyzing,
  analysisLoadSteps,
  analysisLocked,
  onPointSelected,
  onAnalysisClear,
  onSectionLineSelected,
  onScaleChange,
  onLayerToggle,
  onLayerReset,
  onStatus,
  themeInvert,
}: {
  analysis: AnalysisResult | null;
  activeScale: Scale;
  layers: LayerState;
  isAnalyzing: boolean;
  analysisLoadSteps: AnalysisLoadStep[];
  analysisLocked: boolean;
  onPointSelected: (point: { lat: number; lon: number }) => void;
  onAnalysisClear: () => void;
  onSectionLineSelected: (sectionLine: SectionLine) => void;
  onScaleChange: (scale: Scale) => void;
  onLayerToggle: (id: LayerId) => void;
  onLayerReset: () => void;
  onStatus: (status: string) => void;
  themeInvert: boolean;
}) {
  const shellRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const zensusLayerRef = useRef(ZENSUS_WMS_DISPLAY_LAYER);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onPointSelectedRef = useRef(onPointSelected);
  const onSectionLineSelectedRef = useRef(onSectionLineSelected);
  const onStatusRef = useRef(onStatus);
  const analysisRef = useRef(analysis);
  const activeScaleRef = useRef(activeScale);
  const layersRef = useRef(layers);
  const themeInvertRef = useRef(themeInvert);
  const isAnalyzingRef = useRef(isAnalyzing);
  const sectionDrawModeRef = useRef(false);
  const sectionDraftStartRef = useRef<SectionLine["start"] | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ lat: number; lon: number; label?: string }>
  >([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sectionDrawMode, setSectionDrawMode] = useState(false);
  const [sectionDraftStart, setSectionDraftStart] = useState<SectionLine["start"] | null>(null);
  const [zensusLayer, setZensusLayer] = useState(ZENSUS_WMS_DISPLAY_LAYER);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("osmRaster");

  useEffect(() => {
    zensusLayerRef.current = zensusLayer;
  }, [zensusLayer]);

  useEffect(() => {
    onPointSelectedRef.current = onPointSelected;
    onSectionLineSelectedRef.current = onSectionLineSelected;
    onStatusRef.current = onStatus;
    analysisRef.current = analysis;
    activeScaleRef.current = activeScale;
    layersRef.current = layers;
    themeInvertRef.current = themeInvert;
    isAnalyzingRef.current = isAnalyzing;
  }, [
    onPointSelected,
    onSectionLineSelected,
    onStatus,
    analysis,
    activeScale,
    layers,
    themeInvert,
    isAnalyzing,
  ]);

  useEffect(() => {
    sectionDrawModeRef.current = sectionDrawMode;
    sectionDraftStartRef.current = sectionDraftStart;
  }, [sectionDrawMode, sectionDraftStart]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: openFreeMapStyle,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.ScaleControl({ unit: "metric" }),
      "bottom-left",
    );

    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      if (/tile|source|openfreemap|openstreetmap|googleapis/i.test(message)) {
        onStatusRef.current(`Map background issue: ${message}`);
      }
    });

    map.on("click", (event) => {
      if (showXlFeatureInfo(map, event)) return;
      if (sectionDrawModeRef.current) {
        const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
        if (!sectionDraftStartRef.current) {
          sectionDraftStartRef.current = point;
          setSectionDraftStart(point);
          onStatusRef.current("Section start set. Click the section end point.");
          return;
        }
        const nextSectionLine = {
          start: sectionDraftStartRef.current,
          end: point,
        };
        sectionDraftStartRef.current = null;
        setSectionDraftStart(null);
        setSectionDrawMode(false);
        onSectionLineSelectedRef.current(nextSectionLine);
        return;
      }
      if (analysisRef.current || isAnalyzingRef.current) {
        onStatusRef.current(
          "Analysis is locked. Close the current analysis before selecting a new point.",
        );
        return;
      }
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      onPointSelectedRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    map.on("load", () => {
      map.resize();
      addAnalysisSourcesAndLayers(map);
      updateZensusWmsLayer(map, zensusLayerRef.current);
      applyBaseMapTheme(map, themeInvertRef.current);
      applyBackgroundMode(map, "osmRaster");
      syncAnalysisToMap(
        map,
        analysisRef.current,
        activeScaleRef.current,
        layersRef.current,
        markerRef,
      );
      onStatusRef.current("Map ready. Select a point to run analysis.");
    });

    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
      syncAnalysisToMap(
        map,
        analysisRef.current,
        activeScaleRef.current,
        layersRef.current,
        markerRef,
      );
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setMapCursor(map, (analysisLocked || isAnalyzing) && !sectionDrawMode, sectionDrawMode);
  }, [analysisLocked, isAnalyzing, sectionDrawMode]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 3) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    let isActive = true;
    const timeout = window.setTimeout(() => {
      void searchPlaces(normalized, 5).then((result) => {
        if (!isActive) return;
        if (result.status === "ok") {
          setSearchResults(result.results);
          setSearchOpen(result.results.length > 0);
        } else {
          setSearchResults([]);
          setSearchOpen(false);
        }
      });
    }, 260);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getSource("selected-point")) {
      map.once("load", () =>
        syncAnalysisToMap(map, analysis, activeScale, layers, markerRef),
      );
      return;
    }
    syncAnalysisToMap(map, analysis, activeScale, layers, markerRef);
  }, [analysis, activeScale, layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("background")) return;
    applyBaseMapTheme(map, themeInvert);
    applyBackgroundMode(map, backgroundMode);
  }, [themeInvert, backgroundMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("background")) return;
    applyBackgroundMode(map, backgroundMode);
  }, [backgroundMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("selected-point")) return;
    if (!analysis) {
      hideAnalysisLayers(map);
      return;
    }
    applyLayerVisibility(map, layers, activeScale);
  }, [analysis, layers, activeScale]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    updateZensusWmsLayer(map, zensusLayer);
    if (!analysis) {
      hideAnalysisLayers(map);
      return;
    }
    applyLayerVisibility(map, layers, activeScale);
  }, [analysis, zensusLayer, layers, activeScale]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      window.setTimeout(() => mapRef.current?.resize(), 0);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstResult = searchResults[0];
    if (firstResult) {
      zoomToSearchResult(firstResult);
      return;
    }

    const result = await searchPlaces(query, 5);
    if (result.status === "ok" && result.results[0]) {
      setSearchResults(result.results);
      zoomToSearchResult(result.results[0]);
    } else {
      onStatus(`Search unavailable: ${result.error ?? "no result"}`);
    }
  }

  function zoomToSearchResult(result: { lat: number; lon: number; label?: string }) {
    const map = mapRef.current;
    if (!map) return;
    setSearchOpen(false);
    setQuery(result.label ?? query);
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = new maplibregl.Marker({ color: "#facc15" })
      .setLngLat([result.lon, result.lat])
      .addTo(map);
    map.easeTo({
      center: [result.lon, result.lat],
      zoom: Math.max(map.getZoom(), 16),
      pitch: 0,
      bearing: 0,
      duration: 650,
    });
    onStatus("Search result centered. Click the map pin position to start analysis.");
  }

  function handleAnalysisClearClick() {
    setSectionDrawMode(false);
    setSectionDraftStart(null);
    sectionDraftStartRef.current = null;
    searchMarkerRef.current?.remove();
    searchMarkerRef.current = null;
    onAnalysisClear();
  }

  return (
    <section ref={shellRef} className="map-shell" aria-label="Interactive map workspace">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-topbar">
        <ScaleSwitcher activeScale={activeScale} onChange={onScaleChange} />
        <div className="map-topbar-right">
          <form className="search-form" onSubmit={handleSearch}>
            <input
              type="search"
              placeholder="Adresse suchen..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchOpen(searchResults.length > 0)}
              aria-label="Address search"
            />
            <button type="submit">Go</button>
            {searchOpen ? (
              <div className="search-suggestions" role="listbox" aria-label="Place suggestions">
                {searchResults.map((result) => (
                  <button
                    type="button"
                    role="option"
                    key={`${result.lat}:${result.lon}:${result.label}`}
                    onClick={() => zoomToSearchResult(result)}
                  >
                    <span>{result.label ?? "Unnamed place"}</span>
                    <small>
                      {result.lat.toFixed(5)}, {result.lon.toFixed(5)}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
          </form>
          <button
            type="button"
            className="icon-button"
            aria-label="Fullscreen map"
            title="Fullscreen map"
            onClick={() => requestElementFullscreen(shellRef.current)}
          >
            <FullscreenIcon />
          </button>
        </div>
      </div>
      <div className="map-left">
        <LayerTogglePanel
          layers={layers}
          analysis={analysis}
          activeScale={activeScale}
          onToggle={onLayerToggle}
          onReset={onLayerReset}
        />
        <div className="map-control-status panel">
          <strong>{isAnalyzing ? "Analysis running" : analysis ? "Analysis loaded" : "Awaiting point"}</strong>
          <span>
            {analysis
              ? "Point fixed. Switch scale, toggle layers, or export."
              : "Search only zooms. Click the canvas pin target to run analysis."}
          </span>
          {analysis ? (
            <button type="button" className="ghost-button" onClick={handleAnalysisClearClick}>
              Close analysis / new point
            </button>
          ) : null}
          {analysis && activeScale === "M" && layers.section ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setSectionDrawMode((current) => {
                  const next = !current;
                  if (!next) {
                    setSectionDraftStart(null);
                    sectionDraftStartRef.current = null;
                  }
                  onStatus(
                    next
                      ? "Section draw mode active. Click start and end point on the map."
                      : "Section draw mode cancelled.",
                  );
                  return next;
                });
              }}
            >
              {sectionDrawMode ? "Cancel section line" : "Set section line"}
            </button>
          ) : null}
          {sectionDrawMode ? (
            <span className="map-mode-note">
              {sectionDraftStart ? "Click section end" : "Click section start"}
            </span>
          ) : null}
        </div>
      </div>
      {analysis ? (
        <MapLegend
          activeScale={activeScale}
          layers={layers}
          analysis={analysis}
          zensusLayer={zensusLayer}
          onZensusLayerChange={setZensusLayer}
        />
      ) : null}
      <details className="map-attribution panel">
        <summary aria-label="Toggle attribution and data sources">
          <span className="map-attribution-icon">i</span>
        </summary>
        <div className="map-attribution-body">
          <span className="label">Attribution</span>
          <p>
            OpenFreeMap, © OpenMapTiles, OpenStreetMap contributors / ODbL, Destatis,
            GeoBasis-DE / BKG, LOD2 Bayern, Eurostat GISCO, Copernicus, GHSL, DWD,
            Mobilithek.
          </p>
        </div>
      </details>
      <BackgroundSwitcher value={backgroundMode} onChange={setBackgroundMode} />
      {isAnalyzing ? <AnalysisLoadingOverlay steps={analysisLoadSteps} /> : null}
    </section>
  );
}

function BackgroundSwitcher({
  value,
  onChange,
}: {
  value: BackgroundMode;
  onChange: (value: BackgroundMode) => void;
}) {
  return (
    <div className="background-switcher panel" aria-label="Background map">
      <span className="label">Base</span>
      <button
        type="button"
        aria-pressed={value === "osmRaster"}
        onClick={() => onChange("osmRaster")}
      >
        OSM
      </button>
      <button
        type="button"
        aria-pressed={value === "vector"}
        onClick={() => onChange("vector")}
      >
        Vec
      </button>
      <button
        type="button"
        aria-pressed={value === "googleSatellite"}
        onClick={() => onChange("googleSatellite")}
      >
        Sat
      </button>
    </div>
  );
}

function AnalysisLoadingOverlay({ steps }: { steps: AnalysisLoadStep[] }) {
  const activeStep = steps.find((step) => step.status === "running") ?? steps[0];
  const visibleSteps = steps.filter((step) => step.status !== "queued");
  const completed = steps.filter((step) => step.status === "ok" || step.status === "skipped").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  return (
    <div className="analysis-loading-overlay" aria-live="polite" aria-label="Analysis loading progress">
      <div className="analysis-loader-vector" aria-hidden="true">
        <svg viewBox="0 0 160 160" role="img">
          <circle className="loader-ring loader-ring-outer" cx="80" cy="80" r="58" />
          <circle className="loader-ring loader-ring-inner" cx="80" cy="80" r="34" />
          <path className="loader-scan" d="M24 80H136" />
          <path className="loader-scan loader-scan-vertical" d="M80 24V136" />
          <path className="loader-route" d="M43 106L72 67L96 88L119 51" />
          <circle className="loader-node loader-node-a" cx="43" cy="106" r="5" />
          <circle className="loader-node loader-node-b" cx="72" cy="67" r="5" />
          <circle className="loader-node loader-node-c" cx="96" cy="88" r="5" />
          <circle className="loader-node loader-node-d" cx="119" cy="51" r="5" />
        </svg>
      </div>
      <div className="analysis-loading-copy">
        <span className="label">Live analysis</span>
        <strong>{activeStep?.label ?? "Preparing data"}</strong>
        <span>{compactLoadDetail(activeStep?.detail ?? "Fetching live and cached datasets.")}</span>
        <small>
          {completed}/{steps.length} ready{failed ? ` / ${failed} warning` : ""}
        </small>
      </div>
      {visibleSteps.length ? (
        <ol className="analysis-loading-steps">
          {visibleSteps.slice(-3).map((step) => (
            <li className={`analysis-step analysis-step-${step.status}`} key={step.id}>
              <span>{step.status}</span>
              <strong>{step.label}</strong>
              <small>{compactLoadDetail(step.detail)}</small>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function compactLoadDetail(detail: string): string {
  if (/CDSE credentials/i.test(detail)) return "Urban Atlas skipped: CDSE credentials missing.";
  if (/Point cache updated/i.test(detail)) return "Cache updated; continuing analysis.";
  return detail.split(/\r?\n/)[0].slice(0, 96);
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

function requestElementFullscreen(element: HTMLElement | null): void {
  if (!element) return;
  if (document.fullscreenElement === element) {
    void document.exitFullscreen();
    return;
  }
  void element.requestFullscreen();
}

function MapLegend({
  activeScale,
  layers,
  analysis,
  zensusLayer,
  onZensusLayerChange,
}: {
  activeScale: Scale;
  layers: LayerState;
  analysis: AnalysisResult;
  zensusLayer: string;
  onZensusLayerChange: (layer: string) => void;
}) {
  const activeZensusMetric =
    ZENSUS_WMS_METRICS.find((metric) => metric.layer === zensusLayer) ??
    ZENSUS_WMS_METRICS[0];
  const items = getLegendItems(activeScale, layers, analysis);
  return (
    <div className="map-legend panel" aria-label="Map layer colors">
      <span className="label">Map layers</span>
      {activeScale === "XL" ? (
        <div className="zensus-legend-control">
          <label htmlFor="zensus-layer-select">Zensus WMS</label>
          <select
            id="zensus-layer-select"
            value={zensusLayer}
            onChange={(event) => onZensusLayerChange(event.target.value)}
          >
            {ZENSUS_WMS_METRICS.map((metric) => (
              <option key={metric.layer} value={metric.layer}>
                {metric.label}
              </option>
            ))}
          </select>
          <div className="zensus-class-legend" aria-label={`Legende ${activeZensusMetric.label}`}>
            {activeZensusMetric.classes.map((item) => (
              <span className="zensus-class-row" key={`${activeZensusMetric.layer}:${item.label}`}>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {items.map((item) => (
        <span className="legend-row" key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
          {typeof item.count === "number" ? <small>{item.count}</small> : null}
        </span>
      ))}
    </div>
  );
}

function getLegendItems(
  activeScale: Scale,
  layers: LayerState,
  analysis: AnalysisResult,
) {
  const items: Array<{ label: string; color: string; count?: number }> = [
    { label: "Selected point", color: MAP_LAYER_COLORS.selected },
  ];
  if (activeScale === "XL") {
    if (analysis.overlays.xlContext.features.length) {
      items.push({ label: "Official XL context geometry", color: MAP_LAYER_COLORS.xl });
    }
    if (analysis.overlays.xlGrid.features.length) {
      if (hasMeasuredZensusGrid(analysis)) {
        items.push({ label: "Zensus low", color: MAP_LAYER_COLORS.zensusLow });
        items.push({ label: "Zensus medium", color: MAP_LAYER_COLORS.zensusMedium });
        items.push({ label: "Zensus high", color: MAP_LAYER_COLORS.zensusHigh });
      } else {
        items.push({ label: "Zensus grid values missing", color: MAP_LAYER_COLORS.zensusMissing });
      }
    }
    if (analysis.overlays.xlSources.features.length) {
      items.push({ label: "Official XL source geometry", color: MAP_LAYER_COLORS.xlSource });
    }
  }
  if (activeScale === "L") {
    if (layers.urbanAtlas) items.push({ label: "Urban Atlas", color: MAP_LAYER_COLORS.urbanAtlas });
    if (layers.green) items.push({ label: "Green", color: MAP_LAYER_COLORS.green });
    if (layers.blue) items.push({ label: "Blue / water", color: MAP_LAYER_COLORS.blue });
    if (layers.buildingFootprints) items.push({ label: "OSM buildings", color: MAP_LAYER_COLORS.building });
    if (layers.transportAll) items.push({ label: "All transport lines", color: "#ff7a00" });
    if (layers.transitBus) items.push({ label: "Bus lines", color: MAP_LAYER_COLORS.transportBus });
    if (layers.transitTram) items.push({ label: "Tram lines", color: MAP_LAYER_COLORS.transportTram });
    if (layers.transitSubway) items.push({ label: "Subway lines", color: MAP_LAYER_COLORS.transportSubway });
    if (layers.transitLightRail) items.push({ label: "Light rail", color: MAP_LAYER_COLORS.transportLightRail });
    if (layers.transitRail) items.push({ label: "Rail lines", color: MAP_LAYER_COLORS.transportRail });
    if (layers.mobilityBike) items.push({ label: "Bike routes", color: MAP_LAYER_COLORS.mobilityBike });
    if (layers.mobilityPedestrian) items.push({ label: "Pedestrian routes", color: MAP_LAYER_COLORS.mobilityPedestrian });
    if (layers.mobilitySupport) items.push({ label: "Mobility support", color: MAP_LAYER_COLORS.mobilitySupport });
    if (layers.poiEducation) items.push({ label: "POI education", color: MAP_LAYER_COLORS.poiEducation });
    if (layers.poiHealth) items.push({ label: "POI health", color: MAP_LAYER_COLORS.poiHealth });
    if (layers.poiCivic) items.push({ label: "POI civic", color: MAP_LAYER_COLORS.poiCivic });
    if (layers.poiCommerce) items.push({ label: "POI commerce", color: MAP_LAYER_COLORS.poiCommerce });
    if (layers.poiFoodCulture) items.push({ label: "POI food/culture", color: MAP_LAYER_COLORS.poiFoodCulture });
    if (layers.poiLeisureTourism) items.push({ label: "POI leisure/tourism", color: MAP_LAYER_COLORS.poiLeisureTourism });
    if (layers.gastronomy) items.push({ label: "Gastronomy", color: MAP_LAYER_COLORS.gastronomy });
    if (layers.parkingAreas) items.push({ label: "Parking areas", color: MAP_LAYER_COLORS.parking });
    if (layers.development) items.push({ label: "Development hints", color: MAP_LAYER_COLORS.development });
  }
  if (activeScale === "M") {
    items.push({ label: "Street segment", color: MAP_LAYER_COLORS.street });
    if (layers.green) items.push({ label: "L green", color: MAP_LAYER_COLORS.green });
    if (layers.blue) items.push({ label: "L blue / water", color: MAP_LAYER_COLORS.blue });
    if (layers.gastronomy) items.push({ label: "L gastronomy", color: MAP_LAYER_COLORS.gastronomy });
    if (layers.parkingAreas) items.push({ label: "L parking areas", color: MAP_LAYER_COLORS.parking });
    if (layers.buildingFootprints) items.push({ label: "L OSM buildings", color: MAP_LAYER_COLORS.building });
    if (layers["3D"]) items.push({ label: "3D buildings", color: MAP_LAYER_COLORS.building });
    if (layers.trees) items.push({ label: "Trees", color: MAP_LAYER_COLORS.tree });
    if (layers.contours) items.push({ label: "OpenTopography contours", color: MAP_LAYER_COLORS.contour });
    if (layers.sun) items.push({ label: "Sun hints", color: MAP_LAYER_COLORS.sun });
  }
  return items;
}

function hasMeasuredZensusGrid(analysis: AnalysisResult): boolean {
  return analysis.overlays.xlGrid.features.some(
    (feature) =>
      feature.properties?.valueStatus === "measured" &&
      typeof feature.properties?.populationIndex === "number",
  );
}

function showXlFeatureInfo(
  map: MapLibreMap,
  event: maplibregl.MapMouseEvent,
): boolean {
  const features = map.queryRenderedFeatures(event.point, {
    layers: ["xl-grid-fill", "xl-context-line", "xl-source-line"],
  });
  const feature = features[0];
  if (!feature?.properties) return false;

  const props = feature.properties as Record<string, unknown>;
  const sourceId = String(props.sourceId ?? "");
  const label = String(props.label ?? "XL layer");
  const valueStatus = String(props.valueStatus ?? "");
  const populationIndex = props.populationIndex;
  const radiusMeters = props.radiusMeters;
  const caveat = String(props.caveat ?? "");
  const valueLine =
    sourceId === "zensus-grid-2022"
      ? valueStatus === "measured" && typeof populationIndex === "number"
        ? `Zensus value index: ${populationIndex}`
        : "Zensus value: not loaded for this cell"
      : typeof radiusMeters === "number"
        ? `Radius: ${(radiusMeters / 1000).toFixed(1)} km`
        : "";

  new maplibregl.Popup({ closeButton: true, closeOnClick: true })
    .setLngLat(event.lngLat)
    .setHTML(
      `<strong>${escapeHtml(label)}</strong><br/>${escapeHtml(valueLine)}${
        caveat ? `<br/><small>${escapeHtml(caveat)}</small>` : ""
      }`,
    )
    .addTo(map);
  return true;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function getTransportBreakdown(
  analysis: AnalysisResult,
  activeModes: string[],
): Array<{
  label: string;
  color: string;
  count: number;
}> {
  const modes = [
    { mode: "bus", label: "Bus lines", color: MAP_LAYER_COLORS.transportBus },
    { mode: "tram", label: "Tram lines", color: MAP_LAYER_COLORS.transportTram },
    { mode: "subway", label: "Subway lines", color: MAP_LAYER_COLORS.transportSubway },
    { mode: "light_rail", label: "Light rail", color: MAP_LAYER_COLORS.transportLightRail },
    { mode: "rail", label: "Rail lines", color: MAP_LAYER_COLORS.transportRail },
  ];
  return modes
    .map((mode) => ({
      label: mode.label,
      color: mode.color,
      count: analysis.overlays.transport.features.filter(
        (feature) =>
          activeModes.includes(String(feature.properties?.transportMode ?? "")) &&
          feature.geometry.type === "LineString" &&
          feature.properties?.transportMode === mode.mode,
      ).length,
    }))
    .filter((item) => item.count > 0);
}

function transportModeFilter(modes: string[]) {
  return ["match", ["get", "transportMode"], modes, true, false] as any;
}

function addAnalysisSourcesAndLayers(map: MapLibreMap): void {
  ensureOsmRasterLayer(map);
  ensureVersaTilesVectorLayer(map);
  ensureSatelliteRasterLayer(map);
  ensureGoogleSatelliteLayer(map);
  ensureZensusWmsLayer(map, ZENSUS_WMS_DISPLAY_LAYER);

  for (const id of [
    "selected-point",
    "xl-context",
    "xl-grid",
    "xl-sources",
    "urban-atlas-overlay",
    "l-buffer",
    "m-street-segment",
    "green-overlay",
    "blue-overlay",
    "tree-overlay",
    "building-overlay",
    "poi-overlay",
    "gastronomy-overlay",
    "parking-overlay",
    "transport-overlay",
    "mobility-overlay",
    "barrier-overlay",
    "development-overlay",
    "sun-overlay",
    "contour-overlay",
    "section-line-overlay",
  ]) {
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
  }

  addLayerIfMissing(map, {
    id: "xl-context-fill",
    type: "fill",
    source: "xl-context",
    paint: {
      "fill-color": MAP_LAYER_COLORS.xl,
      "fill-opacity": 0.08,
    },
  });
  addLayerIfMissing(map, {
    id: "xl-context-line",
    type: "line",
    source: "xl-context",
    paint: {
      "line-color": MAP_LAYER_COLORS.xl,
      "line-width": 2,
      "line-dasharray": [4, 2],
      "line-opacity": 0.95,
    },
  });
  addLayerIfMissing(map, {
    id: "xl-source-fill",
    type: "fill",
    source: "xl-sources",
    paint: {
      "fill-color": [
        "match",
        ["get", "sourceId"],
        "bkg-geobasis",
        "#93c5fd",
        "eurostat-gisco-fua",
        "#f97316",
        "ghsl-jrc",
        "#fb7185",
        "dwd-cdc",
        "#22d3ee",
        "natural-earth-openfreemap",
        "#b3b3b3",
        MAP_LAYER_COLORS.xlSource,
      ],
      "fill-opacity": 0.035,
    },
  });
  addLayerIfMissing(map, {
    id: "xl-source-line",
    type: "line",
    source: "xl-sources",
    paint: {
      "line-color": [
        "match",
        ["get", "sourceId"],
        "bkg-geobasis",
        "#93c5fd",
        "eurostat-gisco-fua",
        "#f97316",
        "ghsl-jrc",
        "#fb7185",
        "dwd-cdc",
        "#22d3ee",
        "natural-earth-openfreemap",
        "#b3b3b3",
        MAP_LAYER_COLORS.xlSource,
      ],
      "line-width": 1.4,
      "line-dasharray": [2, 2],
      "line-opacity": 0.92,
    },
  });
  addLayerIfMissing(map, {
    id: "xl-grid-fill",
    type: "fill",
    source: "xl-grid",
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "valueStatus"], "measured"],
        [
          "interpolate",
          ["linear"],
          ["to-number", ["get", "populationIndex"], 0],
          0,
          "#15321d",
          35,
          "#275aa5",
          55,
          "#f3d35c",
          75,
          "#f0a23b",
          95,
          "#b5292e",
        ],
        MAP_LAYER_COLORS.zensusMissing,
      ],
      "fill-opacity": [
        "case",
        ["==", ["get", "valueStatus"], "measured"],
        0.44,
        0.12,
      ],
    },
  });
  addLayerIfMissing(map, {
    id: "xl-grid-line",
    type: "line",
    source: "xl-grid",
    paint: {
      "line-color": MAP_LAYER_COLORS.zensus,
      "line-width": 1,
      "line-opacity": [
        "case",
        ["==", ["get", "valueStatus"], "measured"],
        0.85,
        0.38,
      ],
    },
  });
  addLayerIfMissing(map, {
    id: "urban-atlas-fill",
    type: "fill",
    source: "urban-atlas-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": MAP_LAYER_COLORS.urbanAtlas,
      "fill-opacity": 0.16,
    },
  });
  addLayerIfMissing(map, {
    id: "urban-atlas-line",
    type: "line",
    source: "urban-atlas-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": MAP_LAYER_COLORS.urbanAtlas,
      "line-width": 0.8,
      "line-opacity": 0.85,
    },
  });
  addLayerIfMissing(map, {
    id: "l-buffer-line",
    type: "line",
    source: "l-buffer",
    paint: {
      "line-color": MAP_LAYER_COLORS.buffer,
      "line-width": 1,
      "line-dasharray": [3, 3],
      "line-opacity": 0.8,
    },
  });
  addLayerIfMissing(map, {
    id: "development-fill",
    type: "fill",
    source: "development-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": MAP_LAYER_COLORS.development,
      "fill-opacity": 0.2,
    },
  });
  addLayerIfMissing(map, {
    id: "green-fill",
    type: "fill",
    source: "green-overlay",
    paint: {
      "fill-color": MAP_LAYER_COLORS.green,
      "fill-opacity": 0.24,
    },
  });
  addLayerIfMissing(map, {
    id: "blue-fill",
    type: "fill",
    source: "blue-overlay",
    paint: {
      "fill-color": MAP_LAYER_COLORS.blue,
      "fill-opacity": 0.3,
    },
  });
  addLayerIfMissing(map, {
    id: "blue-outline",
    type: "line",
    source: "blue-overlay",
    paint: {
      "line-color": MAP_LAYER_COLORS.blue,
      "line-width": 1.1,
      "line-opacity": 0.95,
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-lines",
    type: "line",
    source: "mobility-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": MAP_LAYER_COLORS.mobility,
      "line-width": 2.5,
      "line-dasharray": [2, 2],
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-lines-bike",
    type: "line",
    source: "mobility-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "mobilityMode"], "bike"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.mobilityBike,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 15, 2.8, 17, 4.8],
      "line-opacity": 0.9,
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-lines-pedestrian",
    type: "line",
    source: "mobility-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "mobilityMode"], "pedestrian"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.mobilityPedestrian,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 15, 2.1, 17, 3.4],
      "line-opacity": 0.74,
      "line-dasharray": [2, 1.5],
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-lines-support",
    type: "line",
    source: "mobility-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "mobilityMode"], "support"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.mobilitySupport,
      "line-width": 1.8,
      "line-opacity": 0.75,
      "line-dasharray": [1, 2],
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-areas",
    type: "fill",
    source: "mobility-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": MAP_LAYER_COLORS.mobility,
      "fill-opacity": 0.14,
    },
  }, "mobility-lines");
  addLayerIfMissing(map, {
    id: "barrier-lines",
    type: "line",
    source: "barrier-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": MAP_LAYER_COLORS.barrier,
      "line-width": 2,
      "line-dasharray": [1, 2],
    },
  });
  addLayerIfMissing(map, {
    id: "green-outline",
    type: "line",
    source: "green-overlay",
    paint: {
      "line-color": MAP_LAYER_COLORS.green,
      "line-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "building-footprints-fill",
    type: "fill",
    source: "building-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": "#9ca3af",
      "fill-opacity": 0.26,
    },
  });
  addLayerIfMissing(map, {
    id: "building-footprints-outline",
    type: "line",
    source: "building-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": "#374151",
      "line-width": 0.8,
      "line-opacity": 0.86,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 3,
      "circle-color": MAP_LAYER_COLORS.poi,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-education-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "poiCategory"], "education"]],
    paint: {
      "circle-radius": 4.5,
      "circle-color": MAP_LAYER_COLORS.poiEducation,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-health-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "poiCategory"], "health"]],
    paint: {
      "circle-radius": 4.5,
      "circle-color": MAP_LAYER_COLORS.poiHealth,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-civic-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "poiCategory"], "civic"]],
    paint: {
      "circle-radius": 4.5,
      "circle-color": MAP_LAYER_COLORS.poiCivic,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-commerce-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "poiCategory"], "commerce"]],
    paint: {
      "circle-radius": 3.8,
      "circle-color": MAP_LAYER_COLORS.poiCommerce,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 0.8,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-food-culture-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "poiCategory"], "food_culture"]],
    paint: {
      "circle-radius": 3.8,
      "circle-color": MAP_LAYER_COLORS.poiFoodCulture,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 0.8,
    },
  });
  addLayerIfMissing(map, {
    id: "poi-leisure-tourism-points",
    type: "circle",
    source: "poi-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "poiCategory"], "leisure_tourism"]],
    paint: {
      "circle-radius": 4,
      "circle-color": MAP_LAYER_COLORS.poiLeisureTourism,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 0.8,
    },
  });
  addLayerIfMissing(map, {
    id: "gastronomy-points",
    type: "circle",
    source: "gastronomy-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 4.4,
      "circle-color": MAP_LAYER_COLORS.gastronomy,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "parking-area-fill",
    type: "fill",
    source: "parking-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": MAP_LAYER_COLORS.parking,
      "fill-opacity": 0.28,
    },
  });
  addLayerIfMissing(map, {
    id: "parking-area-outline",
    type: "line",
    source: "parking-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": "#1f2937",
      "line-width": 0.9,
      "line-opacity": 0.82,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-debug",
    type: "line",
    source: "transport-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": "#ff7a00",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        12,
        1,
        15,
        2.2,
        17,
        3.4,
      ],
      "line-opacity": 0.78,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-bus",
    type: "line",
    source: "transport-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "transportMode"], "bus"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.transportBus,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.1, 15, 2.6, 17, 4.5],
      "line-opacity": 0.92,
      "line-offset": -1.5,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-tram",
    type: "line",
    source: "transport-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "transportMode"], "tram"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.transportTram,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 15, 2.8, 17, 5],
      "line-opacity": 0.92,
      "line-offset": 0,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-subway",
    type: "line",
    source: "transport-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "transportMode"], "subway"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.transportSubway,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 15, 2.8, 17, 5],
      "line-opacity": 0.92,
      "line-offset": 1.5,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-light-rail",
    type: "line",
    source: "transport-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "transportMode"], "light_rail"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.transportLightRail,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 15, 2.3, 17, 4],
      "line-opacity": 0.86,
      "line-dasharray": [4, 1.5],
      "line-offset": 2.4,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-rail-only",
    type: "line",
    source: "transport-overlay",
    filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "transportMode"], "rail"]],
    paint: {
      "line-color": MAP_LAYER_COLORS.transportRail,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 15, 2, 17, 3.4],
      "line-opacity": 0.78,
      "line-dasharray": [3, 1.5],
      "line-offset": 3.2,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-other",
    type: "line",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "LineString"],
      ["!", transportModeFilter(["bus", "tram", "subway", "light_rail", "rail"])],
    ],
    paint: {
      "line-color": MAP_LAYER_COLORS.transport,
      "line-width": 1.4,
      "line-opacity": 0.6,
      "line-dasharray": [1, 2],
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines",
    type: "line",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "LineString"],
      transportModeFilter(LOCAL_TRANSIT_MODES),
    ],
    paint: {
      "line-color": [
        "match",
        ["get", "transportMode"],
        "bus",
        MAP_LAYER_COLORS.transportBus,
        "tram",
        MAP_LAYER_COLORS.transportTram,
        "subway",
        MAP_LAYER_COLORS.transportSubway,
        "light_rail",
        MAP_LAYER_COLORS.transportLightRail,
        "rail",
        MAP_LAYER_COLORS.transportRail,
        MAP_LAYER_COLORS.transport,
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        12,
        1.2,
        15,
        2.8,
        17,
        5,
      ],
      "line-opacity": 0.92,
      "line-offset": [
        "match",
        ["get", "transportMode"],
        "bus",
        -1.2,
        "tram",
        0,
        "subway",
        1.2,
        "light_rail",
        2.2,
        "rail",
        3.2,
        0,
      ],
    },
  });
  addLayerIfMissing(map, {
    id: "transport-lines-rail",
    type: "line",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "LineString"],
      transportModeFilter(RAIL_TRANSIT_MODES),
    ],
    paint: {
      "line-color": [
        "match",
        ["get", "transportMode"],
        "light_rail",
        MAP_LAYER_COLORS.transportLightRail,
        "rail",
        MAP_LAYER_COLORS.transportRail,
        MAP_LAYER_COLORS.transportRail,
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        12,
        1,
        15,
        2.2,
        17,
        4,
      ],
      "line-opacity": 0.78,
      "line-dasharray": [3, 1.5],
    },
  });
  addLayerIfMissing(map, {
    id: "transport-areas",
    type: "fill",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      transportModeFilter(LOCAL_TRANSIT_MODES),
    ],
    paint: {
      "fill-color": [
        "match",
        ["get", "transportMode"],
        "bus",
        MAP_LAYER_COLORS.transportBus,
        "tram",
        MAP_LAYER_COLORS.transportTram,
        "subway",
        MAP_LAYER_COLORS.transportSubway,
        "light_rail",
        MAP_LAYER_COLORS.transportLightRail,
        "rail",
        MAP_LAYER_COLORS.transportRail,
        MAP_LAYER_COLORS.transport,
      ],
      "fill-opacity": 0.16,
    },
  }, "transport-lines");
  addLayerIfMissing(map, {
    id: "transport-areas-rail",
    type: "fill",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      transportModeFilter(RAIL_TRANSIT_MODES),
    ],
    paint: {
      "fill-color": [
        "match",
        ["get", "transportMode"],
        "light_rail",
        MAP_LAYER_COLORS.transportLightRail,
        MAP_LAYER_COLORS.transportRail,
      ],
      "fill-opacity": 0.1,
    },
  }, "transport-lines-rail");
  addLayerIfMissing(map, {
    id: "transport-points",
    type: "circle",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      transportModeFilter([...LOCAL_TRANSIT_MODES, "station"]),
    ],
    paint: {
      "circle-radius": 5,
      "circle-color": [
        "match",
        ["get", "transportMode"],
        "bus",
        MAP_LAYER_COLORS.transportBus,
        "tram",
        MAP_LAYER_COLORS.transportTram,
        "subway",
        MAP_LAYER_COLORS.transportSubway,
        "light_rail",
        MAP_LAYER_COLORS.transportLightRail,
        "rail",
        MAP_LAYER_COLORS.transportRail,
        MAP_LAYER_COLORS.transport,
      ],
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 2,
    },
  });
  addLayerIfMissing(map, {
    id: "transport-points-rail",
    type: "circle",
    source: "transport-overlay",
    filter: [
      "all",
      ["==", ["geometry-type"], "Point"],
      transportModeFilter([...RAIL_TRANSIT_MODES, "station"]),
    ],
    paint: {
      "circle-radius": 5.5,
      "circle-color": MAP_LAYER_COLORS.transportRail,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 2,
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-points",
    type: "circle",
    source: "mobility-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 4,
      "circle-color": MAP_LAYER_COLORS.mobility,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "mobility-support-points",
    type: "circle",
    source: "mobility-overlay",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "mobilityMode"], "support"]],
    paint: {
      "circle-radius": 4.5,
      "circle-color": MAP_LAYER_COLORS.mobilitySupport,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "barrier-points",
    type: "circle",
    source: "barrier-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 4,
      "circle-color": MAP_LAYER_COLORS.barrier,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 2,
    },
  });
  addLayerIfMissing(map, {
    id: "development-points",
    type: "circle",
    source: "development-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 6,
      "circle-color": MAP_LAYER_COLORS.development,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "m-corridor-fill",
    type: "fill",
    source: "m-street-segment",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": MAP_LAYER_COLORS.street,
      "fill-opacity": 0.1,
    },
  });
  addLayerIfMissing(map, {
    id: "m-street-line",
    type: "line",
    source: "m-street-segment",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": MAP_LAYER_COLORS.street,
      "line-width": 4,
    },
  });
  addLayerIfMissing(map, {
    id: "ofm-building-extrusion",
    type: "fill-extrusion",
    source: "openfreemap",
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": "#3f6f9f",
      "fill-extrusion-opacity": 0.58,
      "fill-extrusion-height": [
        "to-number",
        ["get", "render_height"],
        ["get", "height"],
        ["get", "building:height"],
        0,
      ],
      "fill-extrusion-base": [
        "to-number",
        ["get", "render_min_height"],
        ["get", "min_height"],
        0,
      ],
      "fill-extrusion-vertical-gradient": true,
    },
  });
  addLayerIfMissing(map, {
    id: "building-extrusion",
    type: "fill-extrusion",
    source: "building-overlay",
    paint: {
      "fill-extrusion-color": [
        "interpolate",
        ["linear"],
        [
          "to-number",
          ["get", "height"],
          ["get", "building:height"],
          0,
        ],
        6,
        "#93c5fd",
        18,
        "#60a5fa",
        35,
        "#275aa5",
      ],
      "fill-extrusion-opacity": 0.76,
      "fill-extrusion-height": [
        "to-number",
        ["get", "height"],
        ["get", "building:height"],
        0,
      ],
      "fill-extrusion-base": 0,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  addLayerIfMissing(map, {
    id: "tree-canopy-extrusion",
    type: "fill-extrusion",
    source: "tree-overlay",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-extrusion-color": MAP_LAYER_COLORS.tree,
      "fill-extrusion-opacity": 0.68,
      "fill-extrusion-height": ["to-number", ["get", "canopyHeight"], 0],
      "fill-extrusion-base": ["to-number", ["get", "trunkHeight"], 0],
      "fill-extrusion-vertical-gradient": true,
    },
  });
  addLayerIfMissing(map, {
    id: "tree-shadow-circles",
    type: "circle",
    source: "tree-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        [
          "*",
          0.65,
          ["to-number", ["get", "diameter_crown"], ["get", "crown_diameter"], 8],
        ],
        17,
        [
          "*",
          1.35,
          ["to-number", ["get", "diameter_crown"], ["get", "crown_diameter"], 8],
        ],
        19,
        [
          "*",
          2.1,
          ["to-number", ["get", "diameter_crown"], ["get", "crown_diameter"], 8],
        ],
      ],
      "circle-color": "#06140a",
      "circle-opacity": 0.24,
      "circle-blur": 0.6,
      "circle-pitch-alignment": "map",
      "circle-pitch-scale": "map",
      "circle-translate": [6, 9],
    },
  });
  addLayerIfMissing(map, {
    id: "tree-canopy-circles",
    type: "circle",
    source: "tree-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        [
          "*",
          0.55,
          ["to-number", ["get", "diameter_crown"], ["get", "crown_diameter"], 7],
        ],
        17,
        [
          "*",
          1.15,
          ["to-number", ["get", "diameter_crown"], ["get", "crown_diameter"], 7],
        ],
        19,
        [
          "*",
          1.85,
          ["to-number", ["get", "diameter_crown"], ["get", "crown_diameter"], 7],
        ],
      ],
      "circle-color": [
        "match",
        ["get", "leaf_type"],
        "needleleaved",
        "#1f7a48",
        "broadleaved",
        "#31d158",
        "#2fbf63",
      ],
      "circle-opacity": 0.7,
      "circle-stroke-color": "#062f17",
      "circle-stroke-width": 1.1,
      "circle-pitch-alignment": "map",
      "circle-pitch-scale": "map",
    },
  });
  addLayerIfMissing(map, {
    id: "tree-circles",
    type: "circle",
    source: "tree-overlay",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        1.8,
        17,
        3.4,
        19,
        5.2,
      ],
      "circle-color": "#8b5a2b",
      "circle-opacity": 0.95,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 0.8,
      "circle-pitch-alignment": "map",
      "circle-pitch-scale": "map",
    },
  });
  addLayerIfMissing(map, {
    id: "sun-lines",
    type: "line",
    source: "sun-overlay",
    paint: {
      "line-color": MAP_LAYER_COLORS.sun,
      "line-width": 2,
      "line-dasharray": [4, 4],
    },
  });
  addLayerIfMissing(map, {
    id: "contour-lines",
    type: "line",
    source: "contour-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: {
      "line-color": MAP_LAYER_COLORS.contour,
      "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 16, 1.1, 18, 1.8],
      "line-opacity": 0.72,
      "line-dasharray": [3, 2],
    },
  });
  addLayerIfMissing(map, {
    id: "contour-labels",
    type: "symbol",
    source: "contour-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
    minzoom: 15,
    layout: {
      "symbol-placement": "line",
      "text-field": ["case", ["has", "elevation"], ["concat", ["to-string", ["get", "elevation"]], " m"], ""],
      "text-size": 10,
      "text-font": ["Noto Sans Regular"],
    },
    paint: {
      "text-color": MAP_LAYER_COLORS.contour,
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });
  addLayerIfMissing(map, {
    id: "section-user-line",
    type: "line",
    source: "section-line-overlay",
    paint: {
      "line-color": "#facc15",
      "line-width": 3,
      "line-dasharray": [1, 1],
    },
  });
  addLayerIfMissing(map, {
    id: "selected-point-circle",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-radius": 8,
      "circle-color": MAP_LAYER_COLORS.selected,
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 2,
    },
  });
}

function updateZensusWmsLayer(map: MapLibreMap, layer: string): void {
  if (map.getLayer("zensus-wms-raster")) {
    map.removeLayer("zensus-wms-raster");
  }
  if (map.getSource("zensus-wms")) {
    map.removeSource("zensus-wms");
  }
  ensureZensusWmsLayer(map, layer);
}

function ensureZensusWmsLayer(map: MapLibreMap, layer: string): void {
  if (!map.getSource("zensus-wms")) {
    map.addSource("zensus-wms", {
      type: "raster",
      tiles: [zensusWmsTileUrl(layer)],
      tileSize: 256,
      attribution:
        "Zensus 2022: © Statistische Ämter des Bundes und der Länder, 2024; Gittergeometrien: © GeoBasis-DE / BKG (2024)",
    });
  }
  addLayerIfMissing(
    map,
    {
      id: "zensus-wms-raster",
      type: "raster",
      source: "zensus-wms",
      paint: {
        "raster-opacity": 0.58,
        "raster-resampling": "nearest",
      },
      layout: {
        visibility: "none",
      },
    },
    "xl-context-fill",
  );
}

function ensureOsmRasterLayer(map: MapLibreMap): void {
  if (!map.getSource("osm-raster")) {
    map.addSource("osm-raster", {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    });
  }
  addLayerIfMissing(map, {
    id: "osm-raster-basemap",
    type: "raster",
    source: "osm-raster",
    paint: {
      "raster-opacity": 1,
      "raster-resampling": "linear",
    },
    layout: {
      visibility: "visible",
    },
  }, "landuse");
}

function ensureVersaTilesVectorLayer(map: MapLibreMap): void {
  if (!map.getSource("versatiles-vector")) {
    map.addSource("versatiles-vector", {
      type: "vector",
      tiles: ["https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}"],
      minzoom: 0,
      maxzoom: 14,
      attribution: "© OpenStreetMap contributors, VersaTiles",
    });
  }
  addLayerIfMissing(map, {
    id: "versatiles-ocean",
    type: "fill",
    source: "versatiles-vector",
    "source-layer": "ocean",
    paint: { "fill-color": "#d8e8ef", "fill-opacity": 1 },
    layout: { visibility: "none" },
  }, "landuse");
  addLayerIfMissing(map, {
    id: "versatiles-land",
    type: "fill",
    source: "versatiles-vector",
    "source-layer": "land",
    paint: {
      "fill-color": [
        "match",
        ["get", "kind"],
        "forest",
        "#d7ecd3",
        "park",
        "#d7ecd3",
        "grass",
        "#e0efd7",
        "residential",
        "#eeeae1",
        "commercial",
        "#eee5dc",
        "industrial",
        "#eaded3",
        "#f3f1ea",
      ],
      "fill-opacity": 0.92,
    },
    layout: { visibility: "none" },
  }, "landuse");
  addLayerIfMissing(map, {
    id: "versatiles-water",
    type: "fill",
    source: "versatiles-vector",
    "source-layer": "water_polygons",
    paint: { "fill-color": "#bcd9ec", "fill-opacity": 0.95 },
    layout: { visibility: "none" },
  }, "landuse");
  addLayerIfMissing(map, {
    id: "versatiles-streets",
    type: "line",
    source: "versatiles-vector",
    "source-layer": "streets",
    paint: {
      "line-color": "#404040",
      "line-opacity": 0.82,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.35, 14, 1.2, 17, 3.2],
    },
    layout: { visibility: "none" },
  }, "landuse");
  addLayerIfMissing(map, {
    id: "versatiles-buildings",
    type: "fill",
    source: "versatiles-vector",
    "source-layer": "buildings",
    minzoom: 13,
    paint: {
      "fill-color": "#d5d5d5",
      "fill-outline-color": "#9b9b9b",
      "fill-opacity": 0.88,
    },
    layout: { visibility: "none" },
  }, "landuse");
}

function ensureSatelliteRasterLayer(map: MapLibreMap): void {
  if (!map.getSource("satellite-raster")) {
    map.addSource("satellite-raster", {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    });
  }
  addLayerIfMissing(map, {
    id: "satellite-raster-basemap",
    type: "raster",
    source: "satellite-raster",
    paint: {
      "raster-opacity": 1,
      "raster-resampling": "linear",
    },
    layout: { visibility: "none" },
  }, "landuse");
}

function ensureGoogleSatelliteLayer(map: MapLibreMap): void {
  const tileUrl = googleSatelliteTileUrl();
  if (!tileUrl) return;
  if (!map.getSource("google-satellite")) {
    map.addSource("google-satellite", {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      attribution: "Google Maps Platform",
    });
  }
  addLayerIfMissing(map, {
    id: "google-satellite-raster",
    type: "raster",
    source: "google-satellite",
    paint: {
      "raster-opacity": 0.86,
      "raster-resampling": "linear",
    },
    layout: {
      visibility: "none",
    },
  }, "landuse");
}

function applyBackgroundMode(map: MapLibreMap, mode: BackgroundMode): void {
  const osmRaster = mode === "osmRaster";
  const vector = mode === "vector";
  const satellite = mode === "googleSatellite";
  setLayerVisibility(map, "osm-raster-basemap", osmRaster);
  setLayerVisibility(map, "satellite-raster-basemap", satellite);
  setLayerVisibility(map, "google-satellite-raster", false);
  for (const id of ["versatiles-ocean", "versatiles-land", "versatiles-water", "versatiles-streets", "versatiles-buildings"]) {
    setLayerVisibility(map, id, vector);
  }
  for (const id of ["landuse", "parks", "water", "buildings-base"]) {
    setLayerVisibility(map, id, false);
  }
  for (const id of ["roads-secondary", "roads-main", "boundaries", "place-labels"]) {
    setLayerVisibility(map, id, satellite);
  }
  setPaint(map, "roads-secondary", "line-opacity", satellite ? 0.42 : 1);
  setPaint(map, "roads-main", "line-opacity", satellite ? 0.66 : 0.62);
  setPaint(map, "boundaries", "line-opacity", satellite ? 0.58 : 1);
  setPaint(map, "place-labels", "text-halo-width", satellite ? 1.6 : 1);
}

function addLayerIfMissing(
  map: MapLibreMap,
  layer: Parameters<MapLibreMap["addLayer"]>[0],
  beforeId?: string,
): void {
  if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
}

function syncAnalysisToMap(
  map: MapLibreMap,
  analysis: AnalysisResult | null,
  activeScale: Scale,
  layers: LayerState,
  markerRef: MutableRefObject<maplibregl.Marker | null>,
): void {
  if (!analysis || !map.getSource("selected-point")) {
    markerRef.current?.remove();
    markerRef.current = null;
    clearAnalysisSources(map);
    hideAnalysisLayers(map);
    return;
  }

  map.resize();
  setSourceData(map, "selected-point", {
    type: "FeatureCollection",
    features: [analysis.overlays.selectedPoint],
  });
  syncScaleSources(map, analysis, activeScale);

  markerRef.current?.remove();
  markerRef.current = new maplibregl.Marker({ color: "#ffffff" })
    .setLngLat([analysis.selectedPoint.lon, analysis.selectedPoint.lat])
    .addTo(map);
  map.easeTo({
    center: [analysis.selectedPoint.lon, analysis.selectedPoint.lat],
    zoom: activeScale === "XL" ? 10.8 : activeScale === "L" ? 15 : 17.35,
    pitch: activeScale === "M" && layers["3D"] ? 62 : 0,
    bearing: activeScale === "M" && layers["3D"] ? -32 : 0,
    duration: 650,
  });
  applyLayerVisibility(map, layers, activeScale);
}

function syncScaleSources(
  map: MapLibreMap,
  analysis: AnalysisResult,
  activeScale: Scale,
): void {
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  const isXl = activeScale === "XL";
  const isL = activeScale === "L";
  const isM = activeScale === "M";
  const showLContext = isL || isM;

  setSourceData(map, "xl-context", isXl ? analysis.overlays.xlContext : empty);
  setSourceData(map, "xl-grid", isXl ? analysis.overlays.xlGrid : empty);
  setSourceData(map, "xl-sources", isXl ? analysis.overlays.xlSources : empty);

  setSourceData(map, "urban-atlas-overlay", showLContext ? analysis.overlays.urbanAtlas : empty);
  setSourceData(map, "l-buffer", showLContext ? analysis.overlays.lBuffer : empty);
  setSourceData(map, "green-overlay", showLContext ? analysis.overlays.green : empty);
  setSourceData(map, "blue-overlay", showLContext ? analysis.overlays.blue : empty);
  setSourceData(map, "poi-overlay", showLContext ? analysis.overlays.pois : empty);
  setSourceData(map, "gastronomy-overlay", showLContext ? analysis.overlays.gastronomy : empty);
  setSourceData(map, "parking-overlay", showLContext ? analysis.overlays.parkingAreas : empty);
  setSourceData(map, "transport-overlay", showLContext ? analysis.overlays.transport : empty);
  setSourceData(map, "mobility-overlay", showLContext ? analysis.overlays.mobility : empty);
  setSourceData(map, "barrier-overlay", empty);
  setSourceData(map, "development-overlay", showLContext ? analysis.overlays.development : empty);

  setSourceData(map, "m-street-segment", isM ? analysis.overlays.mStreetSegment : empty);
  setSourceData(map, "tree-overlay", isM ? analysis.overlays.trees : empty);
  setSourceData(map, "building-overlay", isL || isM ? analysis.overlays.buildings : empty);
  setSourceData(map, "sun-overlay", isM ? analysis.overlays.sun : empty);
  setSourceData(map, "contour-overlay", isM ? analysis.overlays.contours : empty);
  setSourceData(map, "section-line-overlay", isM ? analysis.overlays.sectionLine : empty);
}

function clearAnalysisSources(map: MapLibreMap): void {
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const id of [
    "selected-point",
    "xl-context",
    "xl-grid",
    "xl-sources",
    "urban-atlas-overlay",
    "l-buffer",
    "m-street-segment",
    "green-overlay",
    "blue-overlay",
    "tree-overlay",
    "building-overlay",
    "poi-overlay",
    "gastronomy-overlay",
    "parking-overlay",
    "transport-overlay",
    "mobility-overlay",
    "barrier-overlay",
    "development-overlay",
    "sun-overlay",
    "contour-overlay",
    "section-line-overlay",
  ]) {
    setSourceData(map, id, empty);
  }
}

function setMapCursor(map: MapLibreMap, locked: boolean, sectionMode = false): void {
  const pinCursor = [
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath fill='%23fff' stroke='%23000' stroke-width='2' d='M14 2a8 8 0 0 0-8 8c0 5.8 8 16 8 16s8-10.2 8-16a8 8 0 0 0-8-8Z'/%3E%3Ccircle cx='14' cy='10' r='3' fill='%23000'/%3E%3C/svg%3E\") 14 27",
    "crosshair",
  ].join(", ");
  map.getCanvas().style.cursor = locked ? "not-allowed" : sectionMode ? "crosshair" : pinCursor;
}

function setSourceData(
  map: MapLibreMap,
  id: string,
  data: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

function setLayerVisibility(
  map: MapLibreMap,
  id: string,
  visible: boolean,
): void {
  if (map.getLayer(id)) {
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

function applyLayerVisibility(
  map: MapLibreMap,
  layers: LayerState,
  activeScale: Scale,
): void {
  const isXl = activeScale === "XL";
  const isL = activeScale === "L";
  const isM = activeScale === "M";
  const showLContext = isL || isM;

  setLayerVisibility(map, "building-extrusion", isM && layers["3D"]);
  setLayerVisibility(map, "ofm-building-extrusion", isM && layers["3D"]);
  setLayerVisibility(map, "tree-canopy-extrusion", isM && layers["3D"] && layers.trees);
  setLayerVisibility(map, "tree-shadow-circles", isM && layers.trees);
  setLayerVisibility(map, "tree-canopy-circles", isM && layers.trees);
  setLayerVisibility(map, "tree-circles", isM && layers.trees);
  setLayerVisibility(map, "sun-lines", isM && layers.sun);
  setLayerVisibility(map, "section-user-line", isM && layers.section);
  setLayerVisibility(map, "contour-lines", isM && layers.contours);
  setLayerVisibility(map, "contour-labels", isM && layers.contours);
  setLayerVisibility(map, "green-fill", showLContext && layers.green);
  setLayerVisibility(map, "green-outline", showLContext && layers.green);
  setLayerVisibility(map, "blue-fill", showLContext && layers.blue);
  setLayerVisibility(map, "blue-outline", showLContext && layers.blue);
  setLayerVisibility(map, "xl-context-fill", isXl && layers.xlContext);
  setLayerVisibility(map, "xl-context-line", isXl && layers.xlContext);
  setLayerVisibility(map, "zensus-wms-raster", isXl && layers.zensusWms);
  setLayerVisibility(map, "xl-grid-fill", isXl && layers.xlGrid);
  setLayerVisibility(map, "xl-grid-line", isXl && layers.xlGrid);
  setLayerVisibility(map, "xl-source-fill", isXl && layers.xlSources);
  setLayerVisibility(map, "xl-source-line", isXl && layers.xlSources);
  setLayerVisibility(map, "urban-atlas-fill", showLContext && layers.urbanAtlas);
  setLayerVisibility(map, "urban-atlas-line", showLContext && layers.urbanAtlas);
  setLayerVisibility(map, "l-buffer-line", showLContext && layers.lBuffer);
  setLayerVisibility(map, "poi-points", showLContext && layers.pois);
  setLayerVisibility(map, "poi-education-points", showLContext && layers.poiEducation);
  setLayerVisibility(map, "poi-health-points", showLContext && layers.poiHealth);
  setLayerVisibility(map, "poi-civic-points", showLContext && layers.poiCivic);
  setLayerVisibility(map, "poi-commerce-points", showLContext && layers.poiCommerce);
  setLayerVisibility(map, "poi-food-culture-points", showLContext && layers.poiFoodCulture);
  setLayerVisibility(map, "poi-leisure-tourism-points", showLContext && layers.poiLeisureTourism);
  setLayerVisibility(map, "gastronomy-points", showLContext && layers.gastronomy);
  setLayerVisibility(map, "parking-area-fill", showLContext && layers.parkingAreas);
  setLayerVisibility(map, "parking-area-outline", showLContext && layers.parkingAreas);
  setLayerVisibility(map, "transport-lines-debug", showLContext && layers.transportAll);
  setLayerVisibility(map, "transport-lines-bus", showLContext && layers.transitBus);
  setLayerVisibility(map, "transport-lines-tram", showLContext && layers.transitTram);
  setLayerVisibility(map, "transport-lines-subway", showLContext && layers.transitSubway);
  setLayerVisibility(map, "transport-lines-light-rail", showLContext && layers.transitLightRail);
  setLayerVisibility(map, "transport-lines-rail-only", showLContext && layers.transitRail);
  setLayerVisibility(map, "transport-lines-other", showLContext && layers.transitOther);
  setLayerVisibility(map, "transport-points", showLContext && layers.transitLocal);
  setLayerVisibility(map, "transport-lines", showLContext && layers.transitLocal);
  setLayerVisibility(map, "transport-areas", showLContext && layers.transitLocal);
  setLayerVisibility(map, "transport-points-rail", showLContext && layers.transitRegional);
  setLayerVisibility(map, "transport-lines-rail", showLContext && layers.transitRegional);
  setLayerVisibility(map, "transport-areas-rail", showLContext && layers.transitRegional);
  setLayerVisibility(map, "mobility-lines", showLContext && layers.mobility);
  setLayerVisibility(map, "mobility-lines-bike", showLContext && layers.mobilityBike);
  setLayerVisibility(map, "mobility-lines-pedestrian", showLContext && layers.mobilityPedestrian);
  setLayerVisibility(map, "mobility-lines-support", showLContext && layers.mobilitySupport);
  setLayerVisibility(map, "mobility-areas", showLContext && layers.mobility);
  setLayerVisibility(map, "mobility-points", showLContext && layers.mobility);
  setLayerVisibility(map, "mobility-support-points", showLContext && layers.mobilitySupport);
  setLayerVisibility(map, "development-fill", showLContext && layers.development);
  setLayerVisibility(map, "development-points", showLContext && layers.development);
  setLayerVisibility(map, "building-footprints-fill", showLContext && layers.buildingFootprints);
  setLayerVisibility(map, "building-footprints-outline", showLContext && layers.buildingFootprints);
  setLayerVisibility(map, "barrier-lines", false);
  setLayerVisibility(map, "barrier-points", false);
  setLayerVisibility(map, "m-street-line", isM && layers.streets);
  setLayerVisibility(map, "m-corridor-fill", isM && layers.streets);
}

function hideAnalysisLayers(map: MapLibreMap): void {
  for (const id of [
    "building-extrusion",
    "ofm-building-extrusion",
    "tree-canopy-extrusion",
    "tree-shadow-circles",
    "tree-canopy-circles",
    "tree-circles",
    "sun-lines",
    "section-user-line",
    "contour-lines",
    "contour-labels",
    "green-fill",
    "green-outline",
    "blue-fill",
    "blue-outline",
    "xl-context-fill",
    "xl-context-line",
    "zensus-wms-raster",
    "xl-grid-fill",
    "xl-grid-line",
    "xl-source-fill",
    "xl-source-line",
    "urban-atlas-fill",
    "urban-atlas-line",
    "l-buffer-line",
    "poi-points",
    "poi-education-points",
    "poi-health-points",
    "poi-civic-points",
    "poi-commerce-points",
    "poi-food-culture-points",
    "poi-leisure-tourism-points",
    "gastronomy-points",
    "parking-area-fill",
    "parking-area-outline",
    "transport-lines-debug",
    "transport-lines-bus",
    "transport-lines-tram",
    "transport-lines-subway",
    "transport-lines-light-rail",
    "transport-lines-rail-only",
    "transport-lines-other",
    "transport-points",
    "transport-lines",
    "transport-areas",
    "transport-points-rail",
    "transport-lines-rail",
    "transport-areas-rail",
    "mobility-lines",
    "mobility-lines-bike",
    "mobility-lines-pedestrian",
    "mobility-lines-support",
    "mobility-areas",
    "mobility-points",
    "mobility-support-points",
    "development-fill",
    "development-points",
    "building-footprints-fill",
    "building-footprints-outline",
    "barrier-lines",
    "barrier-points",
    "m-street-line",
    "m-corridor-fill",
  ]) {
    setLayerVisibility(map, id, false);
  }
}

function applyBaseMapTheme(map: MapLibreMap, invert: boolean): void {
  const theme = invert
    ? {
        background: "#f7f7f2",
        landuse: "#ebe7dc",
        parks: "#dcefd8",
        water: "#bdd8ee",
        building: "#d8d8d8",
        buildingOutline: "#8c8c8c",
        roadsSecondary: "#8f8f8f",
        roadsMain: "#111111",
        boundary: "#5f5f5f",
        text: "#111111",
        halo: "#ffffff",
      }
    : {
        background: "#050505",
        landuse: "#181818",
        parks: "#15321d",
        water: "#102d3d",
        building: "#242424",
        buildingOutline: "#5a5a5a",
        roadsSecondary: "#6a6a6a",
        roadsMain: "#f5f5f5",
        boundary: "#9a9a9a",
        text: "#ffffff",
        halo: "#000000",
      };

  setPaint(map, "background", "background-color", theme.background);
  setPaint(map, "landuse", "fill-color", theme.landuse);
  setPaint(map, "parks", "fill-color", theme.parks);
  setPaint(map, "water", "fill-color", theme.water);
  setPaint(map, "buildings-base", "fill-color", theme.building);
  setPaint(map, "buildings-base", "fill-outline-color", theme.buildingOutline);
  setPaint(map, "roads-secondary", "line-color", theme.roadsSecondary);
  setPaint(map, "roads-main", "line-color", theme.roadsMain);
  setPaint(map, "roads-main", "line-opacity", invert ? 0.58 : 0.62);
  setPaint(map, "boundaries", "line-color", theme.boundary);
  setPaint(map, "place-labels", "text-color", theme.text);
  setPaint(map, "place-labels", "text-halo-color", theme.halo);
  applyVectorFallbackTheme(map, invert);
}

function applyVectorFallbackTheme(map: MapLibreMap, invert: boolean): void {
  const theme = invert
    ? {
        ocean: "#d8e8ef",
        landDefault: "#f3f1ea",
        forest: "#d7ecd3",
        park: "#d7ecd3",
        grass: "#e0efd7",
        residential: "#eeeae1",
        commercial: "#eee5dc",
        industrial: "#eaded3",
        water: "#bcd9ec",
        street: "#404040",
        streetOpacity: 0.78,
        building: "#d5d5d5",
        buildingOutline: "#9b9b9b",
        buildingOpacity: 0.78,
      }
    : {
        ocean: "#071014",
        landDefault: "#131512",
        forest: "#122817",
        park: "#15311b",
        grass: "#1d3420",
        residential: "#171717",
        commercial: "#1f1b17",
        industrial: "#201817",
        water: "#0f2b3b",
        street: "#6b6b6b",
        streetOpacity: 0.58,
        building: "#252525",
        buildingOutline: "#555555",
        buildingOpacity: 0.7,
      };

  setPaint(map, "versatiles-ocean", "fill-color", theme.ocean);
  setPaint(map, "versatiles-land", "fill-color", [
    "match",
    ["get", "kind"],
    "forest",
    theme.forest,
    "park",
    theme.park,
    "grass",
    theme.grass,
    "residential",
    theme.residential,
    "commercial",
    theme.commercial,
    "industrial",
    theme.industrial,
    theme.landDefault,
  ]);
  setPaint(map, "versatiles-water", "fill-color", theme.water);
  setPaint(map, "versatiles-streets", "line-color", theme.street);
  setPaint(map, "versatiles-streets", "line-opacity", theme.streetOpacity);
  setPaint(map, "versatiles-buildings", "fill-color", theme.building);
  setPaint(map, "versatiles-buildings", "fill-outline-color", theme.buildingOutline);
  setPaint(map, "versatiles-buildings", "fill-opacity", theme.buildingOpacity);
}

function setPaint(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  if (map.getLayer(layerId)) {
    map.setPaintProperty(layerId, property, value);
  }
}
