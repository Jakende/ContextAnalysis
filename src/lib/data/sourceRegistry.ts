import type { DataSource } from "../types";

export const sourceRegistry = {
  "openfreemap-planet": {
    id: "openfreemap-planet",
    label: "OpenFreeMap planet vector tiles",
    type: "tile-service",
    url: "https://tiles.openfreemap.org/planet",
    license: "OpenMapTiles-compatible; source data under ODbL where applicable",
    attribution:
      "OpenFreeMap, © OpenMapTiles, data from OpenStreetMap contributors",
    scale: ["XL", "L", "M"],
    updateMode: "live",
    notes:
      "Visual base map only. Analysis logic must not depend on rendered tile availability.",
  },
  "openfreemap-fonts": {
    id: "openfreemap-fonts",
    label: "OpenFreeMap glyphs and sprites",
    type: "tile-service",
    url: "https://tiles.openfreemap.org/fonts",
    attribution: "OpenFreeMap",
    scale: ["XL", "L", "M"],
    updateMode: "live",
  },
  "osm-nominatim": {
    id: "osm-nominatim",
    label: "OpenStreetMap Nominatim",
    type: "live-api",
    url: "https://nominatim.openstreetmap.org",
    license: "ODbL",
    attribution: "OpenStreetMap contributors / ODbL",
    scale: ["XL", "L", "M"],
    updateMode: "live",
    notes:
      "Optional reverse geocoding. Point analysis requests fresh live results and does not use cache fallback.",
  },
  "osm-overpass": {
    id: "osm-overpass",
    label: "OpenStreetMap Overpass API",
    type: "live-api",
    url: "https://overpass-api.de/api/interpreter",
    license: "ODbL",
    attribution: "OpenStreetMap contributors / ODbL",
    scale: ["L", "M"],
    updateMode: "live",
    notes:
      "Deterministic query modules with radius caps, endpoint failover, caching, and visible partial-result caveats.",
  },
  "osm-core": {
    id: "osm-core",
    label: "OpenStreetMap feature data",
    type: "external-download",
    url: "https://www.openstreetmap.org",
    license: "ODbL",
    attribution: "OpenStreetMap contributors / ODbL",
    scale: ["L", "M"],
    updateMode: "preprocessed",
    notes:
      "Used for land-use, POI, street, green, tree, blue-space, and infrastructure hints where local extracts exist.",
  },
  "destatis-genesis": {
    id: "destatis-genesis",
    label: "Destatis / GENESIS-Online / Zensus 2022 CSV",
    type: "local-file",
    url: "https://www-genesis.destatis.de/datenbank/online/",
    localPath: "src/lib/data/csv",
    license: "German official statistics terms; see source metadata",
    attribution: "Statistisches Bundesamt / Destatis, GENESIS-Online",
    scale: ["XL"],
    updateMode: "manual",
    notes:
      "MVP sample CSVs are local placeholders with source-compatible schema. Replace with authoritative exports during preprocessing.",
  },
  "zensus-grid-2022": {
    id: "zensus-grid-2022",
    label: "Zensus 2022 grid cells",
    type: "local-tile",
    url: "https://atlas.zensus2022.de/",
    localPath: "data/processed/zensus-grid.mbtiles",
    license: "Zensus 2022 open data terms",
    attribution:
      "© Statistische Ämter des Bundes und der Länder, 2024; Gittergeometrien: © GeoBasis-DE / BKG (2024)",
    scale: ["XL", "L"],
    updateMode: "preprocessed",
    notes:
      "Aggregated grid context only. Individual-level data must never be exposed.",
  },
  "lod2-bayern": {
    id: "lod2-bayern",
    label: "LOD2 Bayern buildings",
    type: "external-download",
    url: "https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2",
    localPath: "public/tiles/lod2",
    license: "Bayerische Vermessungsverwaltung open-data terms",
    attribution:
      "Landesamt fuer Digitalisierung, Breitband und Vermessung / Bayerische Vermessungsverwaltung",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Used where local 3D building tiles are available. MVP falls back to clearly labelled OSM-derived estimates.",
  },
  "srtm-30m": {
    id: "srtm-30m",
    label: "SRTM 30m terrain raster",
    type: "external-download",
    url: "https://www2.jpl.nasa.gov/srtm/",
    localPath: "data/processed/srtm-30m",
    license: "NASA / USGS public domain where applicable; verify derived dataset terms",
    attribution: "NASA Shuttle Radar Topography Mission / USGS",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Used for terrain profile sampling along user-defined M-scale section lines when preprocessed elevation tiles are available.",
  },
  "eurostat-gisco-fua": {
    id: "eurostat-gisco-fua",
    label: "Eurostat GISCO Cities and Functional Urban Areas",
    type: "external-download",
    url: "https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/cities-functional-urban-areas",
    attribution: "Eurostat GISCO",
    scale: ["XL"],
    updateMode: "preprocessed",
    notes:
      "Supports European FUA context. Legacy wording may reference European foam as an alias.",
  },
  "copernicus-urban-atlas": {
    id: "copernicus-urban-atlas",
    label: "Copernicus Land Monitoring Service Urban Atlas",
    type: "external-download",
    url: "https://land.copernicus.eu/en/products/urban-atlas",
    attribution: "Copernicus Land Monitoring Service / European Environment Agency",
    scale: ["L"],
    updateMode: "preprocessed",
  },
  "ghsl-jrc": {
    id: "ghsl-jrc",
    label: "Global Human Settlement Layer",
    type: "external-download",
    url: "https://ghsl.jrc.ec.europa.eu/",
    attribution: "European Commission Joint Research Centre / GHSL",
    scale: ["XL", "L"],
    updateMode: "preprocessed",
    notes:
      "Comparative/modelled context only; not cadastral or street-level truth.",
  },
  "bkg-geobasis": {
    id: "bkg-geobasis",
    label: "BKG / GeoBasis-DE open administrative boundaries",
    type: "external-download",
    url: "https://gdz.bkg.bund.de/",
    attribution: "GeoBasis-DE / BKG",
    scale: ["XL"],
    updateMode: "preprocessed",
  },
  "dwd-cdc": {
    id: "dwd-cdc",
    label: "DWD Climate Data Center",
    type: "external-download",
    url: "https://www.dwd.de/DE/klimaumwelt/cdc/cdc_node.html",
    attribution: "Deutscher Wetterdienst / Climate Data Center",
    scale: ["XL", "L", "M"],
    updateMode: "preprocessed",
    notes:
      "Optional climate context. Coarse grids are never presented as street-level measurements.",
  },
  "mobilithek-gtfs": {
    id: "mobilithek-gtfs",
    label: "Mobilithek / DELFI / GTFS feeds",
    type: "external-download",
    url: "https://mobilithek.info/",
    attribution: "Mobilithek / DELFI / GTFS feed providers",
    scale: ["L"],
    updateMode: "preprocessed",
  },
  "natural-earth-openfreemap": {
    id: "natural-earth-openfreemap",
    label: "Natural Earth raster via OpenFreeMap",
    type: "tile-service",
    url: "https://tiles.openfreemap.org/natural_earth/",
    attribution: "Natural Earth via OpenFreeMap",
    scale: ["XL"],
    updateMode: "live",
    notes:
      "Small-scale contextual background only, not neighbourhood or street-level analysis.",
  },
} as const satisfies Record<string, DataSource>;

export type SourceId = keyof typeof sourceRegistry;

export function getSource(id: string): DataSource {
  const source = sourceRegistry[id as SourceId];
  if (!source) {
    throw new Error(`Unknown data source id: ${id}`);
  }
  return source;
}

export function getSources(ids: string[]): DataSource[] {
  return [...new Set(ids)].map(getSource);
}
