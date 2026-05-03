import type { Feature, Geometry, LineString, Point, Polygon } from "geojson";
import { getSources } from "../data/sourceRegistry";
import type { AnalysisResult } from "../types";
import { createExportManifest } from "./manifest";

type Projector = (lon: number, lat: number) => [number, number];

export function analysisToSvg(
  analysis: AnalysisResult,
  sectionSvg: string,
): string {
  const features = [
    ...analysis.overlays.lBuffer.features,
    ...analysis.overlays.xlContext.features,
    ...analysis.overlays.xlGrid.features,
    ...analysis.overlays.xlSources.features,
    ...analysis.overlays.green.features,
    ...analysis.overlays.mStreetSegment.features,
    ...analysis.overlays.buildings.features,
    ...analysis.overlays.sun.features,
    ...analysis.overlays.pois.features,
    ...analysis.overlays.transport.features,
    ...analysis.overlays.mobility.features,
    ...analysis.overlays.barriers.features,
    ...analysis.overlays.development.features,
    ...analysis.overlays.trees.features,
    analysis.overlays.selectedPoint,
  ];
  const bounds = getBounds(features);
  const project = createProjector(bounds, 960, 720);
  const manifest = createExportManifest(analysis, [
    {
      name: "analysis.svg",
      mediaType: "image/svg+xml",
      role: "editable map graphic",
    },
    {
      name: "cross-section.svg",
      mediaType: "image/svg+xml",
      role: "editable cross-section",
    },
  ]);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720" role="img" aria-label="Urban Context Analysis editable analysis SVG">
  <metadata>${escapeXml(JSON.stringify(manifest))}</metadata>
  <style>
    :root{--surface:#000000;--ink:#ffffff;--muted:#b3b3b3;--border:#3a3a3a;--accent:#ffffff;--map-xl:#93c5fd;--map-zensus:#8a8f8a;--map-xl-source:#f97316;--map-green:#31d158;--map-tree:#16a34a;--map-building:#60a5fa;--map-transport:#facc15;--map-mobility:#22d3ee;--map-poi:#fb7185;--map-barrier:#ef4444;--map-development:#f97316;--map-sun:#fde047}
    text{font-family:JetBrains Mono,SFMono-Regular,Menlo,Consolas,monospace;fill:var(--ink)}
    .frame{fill:var(--surface);stroke:var(--border);stroke-width:1}
    .buffer{fill:none;stroke:var(--muted);stroke-width:1;stroke-dasharray:6 6}
    .xl-context{fill:var(--map-xl);fill-opacity:.08;stroke:var(--map-xl);stroke-width:2;stroke-dasharray:8 4}
    .xl-grid{fill:var(--map-zensus);fill-opacity:.12;stroke:var(--map-zensus);stroke-opacity:.38;stroke-width:1}
    .xl-source{fill:var(--map-xl-source);fill-opacity:.04;stroke:var(--map-xl-source);stroke-width:1;stroke-dasharray:4 4}
    .green{fill:var(--map-green);fill-opacity:.24;stroke:var(--map-green);stroke-width:1}
    .street{fill:none;stroke:var(--accent);stroke-width:3}
    .building{fill:var(--map-building);fill-opacity:.25;stroke:var(--map-building);stroke-width:1}
    .sun{stroke:var(--map-sun);stroke-width:1;stroke-dasharray:8 4}
    .tree{fill:var(--map-tree);stroke:var(--surface);stroke-width:1}
    .poi{fill:var(--map-poi);stroke:var(--surface);stroke-width:1}
    .transport{fill:var(--map-transport);stroke:var(--surface);stroke-width:1}
    .mobility{fill:var(--map-mobility);fill-opacity:.9;stroke:var(--map-mobility);stroke-width:2;stroke-dasharray:5 4}
    .barrier{fill:var(--map-barrier);stroke:var(--map-barrier);stroke-width:1}
    .development{fill:var(--map-development);fill-opacity:.25;stroke:var(--map-development);stroke-width:1}
    .point{fill:var(--ink);stroke:var(--surface);stroke-width:2}
    .label{font-size:12px;letter-spacing:.08em;text-transform:uppercase}
  </style>
  <rect class="frame" x="0" y="0" width="960" height="720"/>
    <g id="map-layers">
    <g id="xl-context">${featuresToSvg(analysis.overlays.xlContext.features, project, "xl-context")}</g>
    <g id="xl-grid">${featuresToSvg(analysis.overlays.xlGrid.features, project, "xl-grid")}</g>
    <g id="xl-sources">${featuresToSvg(analysis.overlays.xlSources.features, project, "xl-source")}</g>
    <g id="l-buffer">${featuresToSvg(analysis.overlays.lBuffer.features, project, "buffer")}</g>
    <g id="green">${featuresToSvg(analysis.overlays.green.features, project, "green")}</g>
    <g id="buildings">${featuresToSvg(analysis.overlays.buildings.features, project, "building")}</g>
    <g id="m-street-segment">${featuresToSvg(analysis.overlays.mStreetSegment.features, project, "street")}</g>
    <g id="pois">${featuresToSvg(analysis.overlays.pois.features, project, "poi")}</g>
    <g id="transport">${featuresToSvg(analysis.overlays.transport.features, project, "transport")}</g>
    <g id="mobility">${featuresToSvg(analysis.overlays.mobility.features, project, "mobility")}</g>
    <g id="barriers">${featuresToSvg(analysis.overlays.barriers.features, project, "barrier")}</g>
    <g id="development">${featuresToSvg(analysis.overlays.development.features, project, "development")}</g>
    <g id="sun">${featuresToSvg(analysis.overlays.sun.features, project, "sun")}</g>
    <g id="trees">${featuresToSvg(analysis.overlays.trees.features, project, "tree")}</g>
    <g id="selected-point">${featuresToSvg([analysis.overlays.selectedPoint], project, "point")}</g>
  </g>
  <g id="north-arrow" transform="translate(888 42)">
    <line x1="0" y1="44" x2="0" y2="0" stroke="var(--ink)" stroke-width="1"/>
    <path d="M0 0 L-7 14 L7 14 Z" fill="var(--ink)"/>
    <text x="-5" y="64" class="label">N</text>
  </g>
  <g id="scale-bar" transform="translate(42 650)">
    <line x1="0" y1="0" x2="120" y2="0" stroke="var(--ink)" stroke-width="2"/>
    <text x="0" y="24" class="label">0</text>
    <text x="84" y="24" class="label">500M</text>
  </g>
  <g id="legend" transform="translate(42 42)">
    <text class="label">SD STADTDATEN / ${analysis.selectedPoint.lat.toFixed(5)}, ${analysis.selectedPoint.lon.toFixed(5)}</text>
    <text y="24" class="label" fill="var(--muted)">SOURCES ${getSources(analysis.provenance.sourceIds).length} / SCALE XL L M</text>
  </g>
  <g id="embedded-cross-section" transform="translate(42 420) scale(.42)">
    ${stripSvgWrapper(sectionSvg)}
  </g>
</svg>`;
}

export async function svgToPngBlob(svg: string): Promise<Blob> {
  const image = new Image();
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("PNG export failed");
  return blob;
}

function getBounds(features: Feature[]): [number, number, number, number] {
  const coords: number[][] = [];
  for (const feature of features) collectCoords(feature.geometry, coords);
  const xs = coords.map(([x]) => x);
  const ys = coords.map(([, y]) => y);
  return [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
}

function collectCoords(geometry: Geometry, coords: number[][]): void {
  if (geometry.type === "Point") coords.push(geometry.coordinates);
  if (geometry.type === "LineString") coords.push(...geometry.coordinates);
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) coords.push(...ring);
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) coords.push(...ring);
    }
  }
}

function createProjector(
  bounds: [number, number, number, number],
  width: number,
  height: number,
): Projector {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const pad = 72;
  const xScale = (width - pad * 2) / Math.max(0.000001, maxLon - minLon);
  const yScale = (height - pad * 2) / Math.max(0.000001, maxLat - minLat);
  const scale = Math.min(xScale, yScale);
  const xOffset = (width - (maxLon - minLon) * scale) / 2;
  const yOffset = (height - (maxLat - minLat) * scale) / 2;
  return (lon, lat) => [
    xOffset + (lon - minLon) * scale,
    height - (yOffset + (lat - minLat) * scale),
  ];
}

function featuresToSvg(
  features: Feature[],
  project: Projector,
  className: string,
): string {
  return features
    .map((feature) => geometryToSvg(feature.geometry, project, className))
    .join("\n");
}

function geometryToSvg(
  geometry: Geometry,
  project: Projector,
  className: string,
): string {
  if (geometry.type === "Point") {
    const [x, y] = projectPoint(geometry, project);
    return `<circle class="${className}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${className === "point" ? 7 : 4}"/>`;
  }
  if (geometry.type === "LineString") {
    return `<path class="${className}" d="${linePath(geometry, project)}"/>`;
  }
  if (geometry.type === "Polygon") {
    return `<path class="${className}" d="${polygonPath(geometry, project)}"/>`;
  }
  return "";
}

function projectPoint(point: Point, project: Projector): [number, number] {
  return project(point.coordinates[0], point.coordinates[1]);
}

function linePath(line: LineString, project: Projector): string {
  return line.coordinates
    .map(([lon, lat], index) => {
      const [x, y] = project(lon, lat);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function polygonPath(polygon: Polygon, project: Projector): string {
  return polygon.coordinates
    .map((ring) =>
      ring
        .map(([lon, lat], index) => {
          const [x, y] = project(lon, lat);
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ")
        .concat(" Z"),
    )
    .join(" ");
}

function stripSvgWrapper(svg: string): string {
  return svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[char] ?? char;
  });
}
