import type { StyleSpecification } from "maplibre-gl";

export const openFreeMapStyle: StyleSpecification = {
  version: 8,
  name: "SD Stadtdaten analytical base",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
  sources: {
    openfreemap: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#000000" },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openfreemap",
      "source-layer": "landuse",
      paint: { "fill-color": "#101010", "fill-opacity": 0.9 },
    },
    {
      id: "parks",
      type: "fill",
      source: "openfreemap",
      "source-layer": "park",
      paint: { "fill-color": "#161616", "fill-opacity": 1 },
    },
    {
      id: "water",
      type: "fill",
      source: "openfreemap",
      "source-layer": "water",
      paint: { "fill-color": "#222222", "fill-opacity": 1 },
    },
    {
      id: "buildings-base",
      type: "fill",
      source: "openfreemap",
      "source-layer": "building",
      minzoom: 12,
      paint: {
        "fill-color": "#1d1d1d",
        "fill-outline-color": "#3a3a3a",
      },
    },
    {
      id: "roads-secondary",
      type: "line",
      source: "openfreemap",
      "source-layer": "transportation",
      paint: {
        "line-color": "#444444",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 16, 2.4],
      },
    },
    {
      id: "roads-main",
      type: "line",
      source: "openfreemap",
      "source-layer": "transportation",
      filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "motorway", "trunk"]]],
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.42,
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 16, 3.5],
      },
    },
    {
      id: "boundaries",
      type: "line",
      source: "openfreemap",
      "source-layer": "boundary",
      paint: {
        "line-color": "#777777",
        "line-width": 1,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "openfreemap",
      "source-layer": "place",
      layout: {
        "text-field": ["coalesce", ["get", "name:de"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 15, 14],
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#000000",
        "text-halo-width": 1,
      },
    },
  ],
};
