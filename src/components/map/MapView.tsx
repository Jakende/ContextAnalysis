import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "../../lib/api/geocoding";
import { openFreeMapStyle } from "../../lib/tiles/openFreeMapStyle";
import type { AnalysisResult, LayerId, LayerState, SectionLine } from "../../lib/types";
import { LayerTogglePanel } from "./LayerTogglePanel";
import { ScaleSwitcher } from "./ScaleSwitcher";
import type { Scale } from "../../lib/types";

const DEFAULT_CENTER: [number, number] = [11.5755, 48.1397];
const DEFAULT_ZOOM = 12;

const MAP_LAYER_COLORS = {
  xl: "#93c5fd",
  zensus: "#f3d35c",
  zensusLow: "#15321d",
  zensusMedium: "#f3d35c",
  zensusHigh: "#d45a33",
  zensusMissing: "#8a8f8a",
  xlSource: "#f97316",
  buffer: "#e5e7eb",
  selected: "#ffffff",
  green: "#31d158",
  tree: "#16a34a",
  building: "#60a5fa",
  street: "#f8fafc",
  transport: "#facc15",
  transportBus: "#facc15",
  transportTram: "#ef4444",
  transportSubway: "#22d3ee",
  transportRail: "#a78bfa",
  transportLightRail: "#31d158",
  mobility: "#22d3ee",
  poi: "#fb7185",
  barrier: "#ef4444",
  development: "#f97316",
  sun: "#fde047",
} as const;

export function MapView({
  analysis,
  activeScale,
  layers,
  mode,
  isAnalyzing,
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
  mode: "guided" | "direct";
  isAnalyzing: boolean;
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
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          'OpenFreeMap © OpenMapTiles Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      }),
      "bottom-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

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
      applyBaseMapTheme(map, themeInvertRef.current);
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
  }, [themeInvert]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("selected-point")) return;
    applyLayerVisibility(map, layers, activeScale);
  }, [layers, activeScale]);

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
      <div className="map-actions panel">
        <button
          type="button"
          className="ghost-button"
          onClick={() => requestElementFullscreen(shellRef.current)}
        >
          Map fullscreen
        </button>
      </div>
      <div className="map-topbar">
        <ScaleSwitcher activeScale={activeScale} onChange={onScaleChange} />
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
      </div>
      <div className="map-left">
        <LayerTogglePanel
          layers={layers}
          onToggle={onLayerToggle}
          onReset={onLayerReset}
        />
      </div>
      <div className="map-status panel">
        <span className="label">{mode === "guided" ? "Guided" : "Direct"} mode</span>
        <strong>{isAnalyzing ? "Analysis running" : analysis ? "Analysis loaded" : "Awaiting point"}</strong>
        <span>
          {analysis
            ? `${analysis.selectedPoint.lat.toFixed(5)}, ${analysis.selectedPoint.lon.toFixed(5)}`
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
      {analysis ? (
        <MapLegend activeScale={activeScale} layers={layers} analysis={analysis} />
      ) : null}
    </section>
  );
}

function requestElementFullscreen(element: HTMLElement | null): void {
  if (!element) return;
  if (document.fullscreenElement === element) {
    void document.exitFullscreen().then(() => window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0));
    return;
  }
  void element.requestFullscreen().then(() => window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0));
}

function MapLegend({
  activeScale,
  layers,
  analysis,
}: {
  activeScale: Scale;
  layers: LayerState;
  analysis: AnalysisResult;
}) {
  const items = getLegendItems(activeScale, layers, analysis);
  return (
    <div className="map-legend panel" aria-label="Map layer colors">
      <span className="label">Map layers</span>
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

function getLegendItems(activeScale: Scale, layers: LayerState, analysis: AnalysisResult) {
  const items: Array<{ label: string; color: string; count?: number }> = [
    { label: "Selected point", color: MAP_LAYER_COLORS.selected },
  ];
  if (activeScale === "XL") {
    items.push({ label: "XL context rings", color: MAP_LAYER_COLORS.xl });
    if (hasMeasuredZensusGrid(analysis)) {
      items.push({ label: "Zensus low", color: MAP_LAYER_COLORS.zensusLow });
      items.push({ label: "Zensus medium", color: MAP_LAYER_COLORS.zensusMedium });
      items.push({ label: "Zensus high", color: MAP_LAYER_COLORS.zensusHigh });
    } else {
      items.push({ label: "Zensus grid footprint - values missing", color: MAP_LAYER_COLORS.zensusMissing });
    }
    if (analysis.overlays.xlSources.features.length) {
      items.push({ label: "Official XL source geometry", color: MAP_LAYER_COLORS.xlSource });
    }
  }
  if (activeScale === "L") {
    if (layers.green) items.push({ label: "Green / blue", color: MAP_LAYER_COLORS.green });
    items.push({ label: "Transit stops", color: MAP_LAYER_COLORS.transport });
    const transportBreakdown = getTransportBreakdown(analysis);
    for (const item of transportBreakdown) items.push(item);
    items.push({ label: "Mobility", color: MAP_LAYER_COLORS.mobility });
    items.push({ label: "POI / civic", color: MAP_LAYER_COLORS.poi });
    items.push({ label: "Development hints", color: MAP_LAYER_COLORS.development });
  }
  if (activeScale === "M") {
    items.push({ label: "Street segment", color: MAP_LAYER_COLORS.street });
    if (layers["3D"]) items.push({ label: "3D buildings", color: MAP_LAYER_COLORS.building });
    if (layers.trees) items.push({ label: "Trees", color: MAP_LAYER_COLORS.tree });
    items.push({ label: "Barriers", color: MAP_LAYER_COLORS.barrier });
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

function getTransportBreakdown(analysis: AnalysisResult): Array<{
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
          feature.geometry.type === "LineString" &&
          feature.properties?.transportMode === mode.mode,
      ).length,
    }))
    .filter((item) => item.count > 0);
}

function addAnalysisSourcesAndLayers(map: MapLibreMap): void {
  for (const id of [
    "selected-point",
    "xl-context",
    "xl-grid",
    "xl-sources",
    "l-buffer",
    "m-street-segment",
    "green-overlay",
    "tree-overlay",
    "building-overlay",
    "poi-overlay",
    "transport-overlay",
    "mobility-overlay",
    "barrier-overlay",
    "development-overlay",
    "sun-overlay",
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
    id: "transport-lines",
    type: "line",
    source: "transport-overlay",
    filter: ["==", ["geometry-type"], "LineString"],
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
        -2,
        "tram",
        0,
        "subway",
        2,
        "light_rail",
        4,
        "rail",
        6,
        0,
      ],
    },
  });
  addLayerIfMissing(map, {
    id: "transport-points",
    type: "circle",
    source: "transport-overlay",
    filter: ["==", ["geometry-type"], "Point"],
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
        ["*", ["to-number", ["get", "building:levels"], 5], 3.2],
        14,
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
          ["*", ["to-number", ["get", "building:levels"], 6], 3],
          18,
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
        ["*", ["to-number", ["get", "building:levels"], 6], 3],
        18,
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
      "fill-extrusion-height": ["to-number", ["get", "canopyHeight"], 9],
      "fill-extrusion-base": ["to-number", ["get", "trunkHeight"], 3],
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
        8,
        17,
        18,
        19,
        28,
      ],
      "circle-color": "#06140a",
      "circle-opacity": 0.38,
      "circle-blur": 0.45,
      "circle-pitch-alignment": "map",
      "circle-pitch-scale": "map",
      "circle-translate": [4, 7],
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
        6,
        17,
        14,
        19,
        22,
      ],
      "circle-color": "#21b85a",
      "circle-opacity": 0.82,
      "circle-stroke-color": "#062f17",
      "circle-stroke-width": 1.2,
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
        2,
        17,
        4,
        19,
        7,
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

function addLayerIfMissing(
  map: MapLibreMap,
  layer: Parameters<MapLibreMap["addLayer"]>[0],
): void {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
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
    applyLayerVisibility(map, layers, activeScale);
    return;
  }

  map.resize();
  setSourceData(map, "selected-point", {
    type: "FeatureCollection",
    features: [analysis.overlays.selectedPoint],
  });
  setSourceData(map, "xl-context", analysis.overlays.xlContext);
  setSourceData(map, "xl-grid", analysis.overlays.xlGrid);
  setSourceData(map, "xl-sources", analysis.overlays.xlSources);
  setSourceData(map, "l-buffer", analysis.overlays.lBuffer);
  setSourceData(map, "m-street-segment", analysis.overlays.mStreetSegment);
  setSourceData(map, "green-overlay", analysis.overlays.green);
  setSourceData(map, "tree-overlay", analysis.overlays.trees);
  setSourceData(map, "building-overlay", analysis.overlays.buildings);
  setSourceData(map, "poi-overlay", analysis.overlays.pois);
  setSourceData(map, "transport-overlay", analysis.overlays.transport);
  setSourceData(map, "mobility-overlay", analysis.overlays.mobility);
  setSourceData(map, "barrier-overlay", analysis.overlays.barriers);
  setSourceData(map, "development-overlay", analysis.overlays.development);
  setSourceData(map, "sun-overlay", analysis.overlays.sun);
  setSourceData(map, "section-line-overlay", analysis.overlays.sectionLine);

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

function clearAnalysisSources(map: MapLibreMap): void {
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const id of [
    "selected-point",
    "xl-context",
    "xl-grid",
    "xl-sources",
    "l-buffer",
    "m-street-segment",
    "green-overlay",
    "tree-overlay",
    "building-overlay",
    "poi-overlay",
    "transport-overlay",
    "mobility-overlay",
    "barrier-overlay",
    "development-overlay",
    "sun-overlay",
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
  setLayerVisibility(map, "building-extrusion", activeScale === "M" && layers["3D"]);
  setLayerVisibility(map, "ofm-building-extrusion", activeScale === "M" && layers["3D"]);
  setLayerVisibility(map, "tree-canopy-extrusion", activeScale === "M" && layers["3D"] && layers.trees);
  setLayerVisibility(map, "tree-shadow-circles", activeScale === "M" && layers.trees);
  setLayerVisibility(map, "tree-canopy-circles", activeScale === "M" && layers.trees);
  setLayerVisibility(map, "tree-circles", activeScale !== "XL" && layers.trees);
  setLayerVisibility(map, "sun-lines", activeScale === "M" && layers.sun);
  setLayerVisibility(map, "section-user-line", activeScale === "M" && layers.section);
  setLayerVisibility(map, "green-fill", activeScale === "L" && layers.green);
  setLayerVisibility(map, "green-outline", activeScale === "L" && layers.green);
  setLayerVisibility(map, "xl-context-fill", activeScale === "XL");
  setLayerVisibility(map, "xl-context-line", activeScale === "XL");
  setLayerVisibility(map, "xl-grid-fill", activeScale === "XL");
  setLayerVisibility(map, "xl-grid-line", activeScale === "XL");
  setLayerVisibility(map, "xl-source-fill", activeScale === "XL");
  setLayerVisibility(map, "xl-source-line", activeScale === "XL");
  setLayerVisibility(map, "l-buffer-line", activeScale === "L");
  setLayerVisibility(map, "poi-points", activeScale === "L");
  setLayerVisibility(map, "transport-points", activeScale === "L");
  setLayerVisibility(map, "transport-lines", activeScale === "L");
  setLayerVisibility(map, "mobility-lines", activeScale === "L");
  setLayerVisibility(map, "mobility-points", activeScale === "L");
  setLayerVisibility(map, "development-fill", activeScale === "L");
  setLayerVisibility(map, "development-points", activeScale === "L");
  setLayerVisibility(map, "barrier-lines", activeScale === "M");
  setLayerVisibility(map, "barrier-points", activeScale === "M");
  setLayerVisibility(map, "m-street-line", activeScale === "M");
  setLayerVisibility(map, "m-corridor-fill", activeScale === "M");
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
