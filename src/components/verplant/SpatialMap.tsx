import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { openFreeMapStyle } from "../../lib/tiles/openFreeMapStyle";
import type { SpatialScope, ResultObject } from "../../lib/verplant/types";
import type { AnalysisResult, Scale } from "../../lib/types";
export function SpatialMap({
  scope,
  analysis,
  scale,
  objects,
  selected,
  onPoint,
  onSelect,
}: {
  scope: SpatialScope | null;
  analysis?: AnalysisResult;
  scale: Scale;
  objects: ResultObject[];
  selected: string;
  onPoint: (lat: number, lon: number) => void;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null);
  const pointCallback = useRef(onPoint),
    selectCallback = useRef(onSelect);
  pointCallback.current = onPoint;
  selectCallback.current = onSelect;
  const [external, setExternal] = useState(false),
    [ready, setReady] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    const instance = new maplibregl.Map({
      container: host.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e7eee9" },
          },
        ],
      },
      center: [11.5755, 48.1372],
      zoom: 14,
      locale: {
        "NavigationControl.ZoomIn": "Vergrößern",
        "NavigationControl.ZoomOut": "Verkleinern",
        "NavigationControl.ResetBearing": "Nach Norden ausrichten",
        "Map.Title": "Karte",
      },
      attributionControl: { compact: true },
    });
    map.current = instance;
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "top-right",
    );
    instance.on("style.load", () => setReady((x) => x + 1));
    instance.on("error", () =>
      setError(
        "Kartendienst nicht verfügbar. Koordinaten und textliche Ergebnisse bleiben nutzbar.",
      ),
    );
    instance.on("click", (e) => {
      const features = instance.getLayer("result-points")
        ? instance.queryRenderedFeatures(e.point, {
            layers: ["result-points", "result-lines", "result-polygons"],
          })
        : [];
      const id = features[0]?.properties?.objectId;
      if (id) selectCallback.current(String(id));
      else pointCallback.current(e.lngLat.lat, e.lngLat.lng);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (external) map.current?.setStyle(openFreeMapStyle);
  }, [external]);
  useEffect(() => {
    const m = map.current;
    if (!m || ready === 0) return;
    const features: FeatureCollection["features"] = [];
    if (scope) {
      features.push(
        {
          type: "Feature",
          properties: { objectId: "scope:context", color: "#00763a" },
          geometry: scope.context,
        },
        {
          type: "Feature",
          properties: { objectId: "scope:project", color: "#7028a0" },
          geometry: scope.project,
        },
      );
    }
    for (const o of objects)
      if (o.geometry && !o.id.startsWith("scope:"))
        features.push({
          type: "Feature",
          properties: {
            objectId: o.id,
            color: o.id === selected ? "#b53c00" : "#2256a0",
          },
          geometry: o.geometry,
        });
    if (analysis)
      for (const key of scale === "XL"
        ? ["xlContext"]
        : scale === "M"
          ? ["mStreetSegment", "buildings", "trees"]
          : ["green", "blue", "transport"]) {
        const collection =
          analysis.overlays[key as keyof typeof analysis.overlays];
        if (collection.type === "FeatureCollection")
          for (const f of collection.features)
            features.push({
              ...f,
              properties: { ...f.properties, color: "#386c51" },
            });
      }
    const data: FeatureCollection = { type: "FeatureCollection", features };
    const source = m.getSource("verplant-results") as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      m.addSource("verplant-results", { type: "geojson", data });
      m.addLayer({
        id: "result-polygons",
        type: "fill",
        source: "verplant-results",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 },
      });
      m.addLayer({
        id: "result-lines",
        type: "line",
        source: "verplant-results",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: { "line-color": ["get", "color"], "line-width": 2 },
      });
      m.addLayer({
        id: "result-points",
        type: "circle",
        source: "verplant-results",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 9,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
    }
  }, [scope, analysis, scale, objects, selected, ready]);
  useEffect(() => {
    if (scope)
      map.current?.jumpTo({ center: [scope.anchor.lon, scope.anchor.lat] });
  }, [scope?.anchor.lat, scope?.anchor.lon]);
  useEffect(() => {
    const o = objects.find((o) => o.id === selected);
    if (!o?.geometry || !map.current) return;
    const coords: number[][] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) {
        if (typeof x[0] === "number" && typeof x[1] === "number")
          coords.push(x as number[]);
        else x.forEach(walk);
      }
    };
    if ("coordinates" in o.geometry) walk(o.geometry.coordinates);
    if (coords.length) {
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend([c[0], c[1]]));
      map.current.fitBounds(b, { padding: 50, maxZoom: 16, duration: 0 });
    }
  }, [selected, objects]);
  return (
    <section
      className="vp-map"
      id="karte"
      aria-label="Untersuchungsgebiet auf der Karte"
      tabIndex={-1}
    >
      <div ref={host} className="vp-map-canvas" />
      <div className="vp-map-note">
        <strong>Projektgegenstand</strong> violett ·{" "}
        <strong>Kontextgebiet</strong> grün
        <br />
        {!external ? (
          <>
            <span>
              Grundkarte ausgeschaltet. Beim Laden erhält OpenFreeMap den
              Kartenausschnitt.
            </span>
            <button onClick={() => setExternal(true)}>Grundkarte laden</button>
          </>
        ) : (
          <span>Grundkarte: OpenFreeMap / OpenStreetMap</span>
        )}
        {error && <p role="status">{error}</p>}
        <a href="#raumeingabe">Koordinaten eingeben</a>
      </div>
    </section>
  );
}
