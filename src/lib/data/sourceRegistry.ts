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
    label: "Zensus 2022 grid cells / Zensus-Atlas WMS",
    type: "tile-service",
    url: "https://www.wms.nrw.de/wms/zensusatlas?service=WMS&request=GetCapabilities&version=1.3.0",
    localPath: "data/processed/zensus-grid.geojson",
    license: "Zensus 2022 open data terms",
    attribution:
      "© Statistische Ämter des Bundes und der Länder, 2024; Gittergeometrien: © GeoBasis-DE / BKG (2024)",
    scale: ["XL", "L"],
    updateMode: "preprocessed",
    notes:
      "Primary runtime path uses the official queryable WMS. Optional local GeoJSON/MBTiles preprocessing can be added for exports. Individual-level data must never be exposed.",
  },
  "lod2-bayern": {
    id: "lod2-bayern",
    label: "LOD2 Bayern buildings (Bavaria only)",
    type: "external-download",
    url: "https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2",
    localPath: "public/data/processed/lod2-buildings.geojson",
    license: "Bayerische Vermessungsverwaltung open-data terms",
    attribution:
      "Landesamt fuer Digitalisierung, Breitband und Vermessung / Bayerische Vermessungsverwaltung",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Runtime loads local preprocessed LOD2 GeoJSON for M-scale massing where available in Bavaria. This is not a Germany-wide building source; outside coverage, Overture or OSM-derived buildings remain lower-confidence fallbacks.",
  },
  "global-building-atlas": {
    id: "global-building-atlas",
    label: "GlobalBuildingAtlas WFS / LoD1 buildings",
    type: "external-download",
    url: "https://tubvsig-so2sat-vm1.srv.mwn.de/geoserver/ows?service=WFS&request=GetCapabilities",
    localPath: "public/data/processed/global-building-atlas.geojson",
    license:
      "Mixed: ODbL polygons and CC BY-NC 4.0 polygons/LoD1/height products; verify use before redistribution",
    attribution:
      "GlobalBuildingAtlas / TUM Data Science in Earth Observation / Zhu et al.",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Use as optional global fallback only after local preprocessing. Live WFS is too heavy for default point analysis and license classes must remain visible.",
  },
  "overture-buildings": {
    id: "overture-buildings",
    label: "Overture Maps buildings",
    type: "external-download",
    url: "https://docs.overturemaps.org/guides/buildings/",
    localPath: "public/data/processed/overture-buildings.geojson",
    license: "CDLA Permissive 2.0 / Overture Maps data terms",
    attribution: "Overture Maps Foundation contributors",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Preferred global building-footprint fallback for non-Bavaria contexts after preprocessing to local tiles or clipped GeoJSON. Heights may be incomplete and must remain lower-confidence than LOD2.",
  },
  "srtm-30m": {
    id: "srtm-30m",
    label: "SRTM 30m terrain raster",
    type: "tile-service",
    url: "https://ows.mundialis.de/osm/service?service=WMS&request=GetCapabilities",
    localPath: "public/data/processed/srtm-30m/samples.geojson",
    license: "NASA / USGS public domain where applicable; verify derived dataset terms",
    attribution: "NASA Shuttle Radar Topography Mission / USGS",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Runtime can render the public mundialis/terrestris SRTM WMS for visual terrain context. Section sampling uses local preprocessed elevation points when available.",
  },
  "eurostat-gisco-fua": {
    id: "eurostat-gisco-fua",
    label: "Eurostat GISCO Cities and Functional Urban Areas",
    type: "external-download",
    url: "https://gisco-services.ec.europa.eu/distribution/v2/",
    localPath: "public/data/processed/eurostat-gisco-fua.geojson",
    attribution: "Eurostat GISCO",
    scale: ["XL"],
    updateMode: "preprocessed",
    notes:
      "Supports European FUA context through GISCO distribution data. ESPON WMS can be used as visual/reference service where appropriate. Legacy wording may reference European foam as an alias.",
  },
  "copernicus-urban-atlas": {
    id: "copernicus-urban-atlas",
    label: "Copernicus Land Monitoring Service Urban Atlas",
    type: "external-download",
    url: "https://land.copernicus.eu/en/products/urban-atlas",
    localPath: "public/data/processed/copernicus-urban-atlas.geojson",
    attribution: "Copernicus Land Monitoring Service / European Environment Agency",
    scale: ["L"],
    updateMode: "preprocessed",
    notes:
      "Use only after local preprocessing of the relevant Urban Atlas FUA extract. Product pages are not treated as analysis data.",
  },
  "ghsl-jrc": {
    id: "ghsl-jrc",
    label: "Global Human Settlement Layer",
    type: "external-download",
    url: "https://ghsl.jrc.ec.europa.eu/",
    localPath: "public/data/processed/ghsl.geojson",
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
    url: "https://sgx.geodatenzentrum.de/wfs_vg250?request=GetCapabilities&service=WFS",
    localPath: "public/data/processed/bkg-boundaries.geojson",
    attribution: "GeoBasis-DE / BKG",
    scale: ["XL"],
    updateMode: "preprocessed",
    notes:
      "VG250 WFS is the preferred vector reference for analysis. VG250 WMS can be used for visual boundary context.",
  },
  "dwd-cdc": {
    id: "dwd-cdc",
    label: "DWD Climate Data Center",
    type: "external-download",
    url: "https://www.dwd.de/DE/klimaumwelt/cdc/cdc_node.html",
    localPath: "public/data/processed/dwd-climate.geojson",
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
    localPath: "public/data/processed/gtfs-stops.geojson",
    attribution: "Mobilithek / DELFI / GTFS feed providers",
    scale: ["L"],
    updateMode: "preprocessed",
    notes:
      "Runtime expects preprocessed stop points. Feed licensing and provider coverage must be checked before preprocessing.",
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
