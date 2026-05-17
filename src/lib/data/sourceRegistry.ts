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
  "global-building-atlas-odbl-polygons": {
    id: "global-building-atlas-odbl-polygons",
    label: "GlobalBuildingAtlas ODbL building polygons",
    type: "external-download",
    url: "https://huggingface.co/datasets/zhu-xlab/GBA.ODbLPolygon",
    localPath: "public/data/processed/global-building-atlas.geojson",
    license: "ODbL polygon subset; verify dataset release metadata before redistribution",
    attribution:
      "GlobalBuildingAtlas / TUM Data Science in Earth Observation / Zhu et al.",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Experimental fallback. Only the license-compatible polygon subset should feed the standard runtime pipeline; LoD1/height products require separate review.",
  },
  "overture-buildings": {
    id: "overture-buildings",
    label: "Overture Maps buildings",
    type: "external-download",
    url: "https://stac.overturemaps.org/catalog.json",
    localPath: "public/data/processed/overture-buildings/index.json",
    license: "CDLA Permissive 2.0 / Overture Maps data terms",
    attribution: "Overture Maps Foundation contributors",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Preferred broad building-footprint fallback for non-Bavaria contexts after preprocessing to local tiles or clipped GeoJSON. Resolve releases through STAC/CLI instead of pinning a stale release path. Heights may be incomplete and must remain lower-confidence than LOD2.",
  },
  "overture-building-parts": {
    id: "overture-building-parts",
    label: "Overture Maps building parts",
    type: "external-download",
    url: "https://stac.overturemaps.org/catalog.json",
    localPath: "public/data/processed/overture-building-parts/index.json",
    license: "CDLA Permissive 2.0 / Overture Maps data terms",
    attribution: "Overture Maps Foundation contributors",
    scale: ["M"],
    updateMode: "preprocessed",
    notes:
      "Optional richer massing source. Keep separate from building footprints until the runtime explicitly handles part hierarchies and duplicate geometry.",
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
    localPath: "public/data/processed/copernicus-urban-atlas/index.json",
    attribution: "Copernicus Land Monitoring Service / European Environment Agency",
    scale: ["L"],
    updateMode: "preprocessed",
    notes:
      "Use only after local preprocessing of the relevant Urban Atlas FUA extract. Product pages are not treated as analysis data.",
  },
  "urban-atlas-2021-catalog": {
    id: "urban-atlas-2021-catalog",
    label: "Copernicus Urban Atlas 2021 CSV catalog",
    type: "external-download",
    url: "https://s3.waw3-1.cloudferro.com/swift/v1/CatalogueCSV/land_cover_use_in_priority_areas/urban_atlas/clms_ua_land-cover-land-use_europe_V025ha_3yearly_v1/clms_ua_land-cover-land-use_europe_V025ha_3yearly_v1_flatgeobuf.csv",
    localPath: "public/data/processed/copernicus-urban-atlas/index.json",
    attribution: "Copernicus Land Monitoring Service / European Environment Agency",
    scale: ["L"],
    updateMode: "preprocessed",
    notes:
      "Preferred Urban Atlas resolver. Preprocessing should select the relevant FUA FlatGeobuf from this catalog, convert it locally, and only then expose L-scale land-use indicators.",
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
  "ghsl-direct-download": {
    id: "ghsl-direct-download",
    label: "GHSL direct download catalog",
    type: "external-download",
    url: "https://human-settlement.emergency.copernicus.eu/download.php",
    localPath: "public/data/processed/ghsl.geojson",
    attribution: "European Commission Joint Research Centre / GHSL",
    scale: ["XL", "L"],
    updateMode: "preprocessed",
    notes:
      "Resolver for modelled GHSL products such as built-up surface, population grid, settlement model, and built-up height. Use as comparative context, not cadastral truth.",
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
  "dwd-cdc-grids-germany": {
    id: "dwd-cdc-grids-germany",
    label: "DWD CDC grids Germany",
    type: "external-download",
    url: "https://opendata.dwd.de/climate_environment/CDC/grids_germany/",
    localPath: "public/data/processed/dwd-climate.geojson",
    attribution: "Deutscher Wetterdienst / Climate Data Center",
    scale: ["XL", "L", "M"],
    updateMode: "preprocessed",
    notes:
      "Preferred climate-grid resolver for annual/monthly temperature, hot days, summer days, precipitation, and global radiation. Runtime values must remain coarse climate proxies.",
  },
  "mobilithek-gtfs": {
    id: "mobilithek-gtfs",
    label: "Mobilithek / DELFI / GTFS feeds",
    type: "external-download",
    url: "https://mobilithek.info/",
    localPath: "public/data/processed/gtfs-stops/index.json",
    attribution: "Mobilithek / DELFI / GTFS feed providers",
    scale: ["L"],
    updateMode: "preprocessed",
    notes:
      "Runtime expects preprocessed stop points. Feed licensing and provider coverage must be checked before preprocessing.",
  },
  "gtfs-de-local-transit": {
    id: "gtfs-de-local-transit",
    label: "GTFS.DE local public transit feed",
    type: "external-download",
    url: "https://download.gtfs.de/germany/nv_free/latest.zip",
    localPath: "public/data/processed/gtfs-stops/index.json",
    license: "GTFS.DE / DELFI feed terms; verify current feed metadata",
    attribution: "GTFS.DE / DELFI / participating public transport providers",
    scale: ["L"],
    updateMode: "preprocessed",
    notes:
      "Preferred MVP feed for stop-distance and mode-availability indicators. It is preprocessed to stop points; GTFS-RT is intentionally out of MVP scope.",
  },
  "gtfs-de-full": {
    id: "gtfs-de-full",
    label: "GTFS.DE full Germany feed",
    type: "external-download",
    url: "https://download.gtfs.de/germany/free/latest.zip",
    localPath: "public/data/processed/gtfs-full-stops/index.json",
    license: "GTFS.DE / DELFI feed terms; verify current feed metadata",
    attribution: "GTFS.DE / DELFI / participating public transport providers",
    scale: ["L", "XL"],
    updateMode: "preprocessed",
    notes:
      "Optional broader feed including long-distance services. Keep separate from the default local-transit stop layer to avoid over-counting L-scale accessibility.",
  },
  "gtfs-de-regional-rail": {
    id: "gtfs-de-regional-rail",
    label: "GTFS.DE regional rail feed",
    type: "external-download",
    url: "https://download.gtfs.de/germany/rv_free/latest.zip",
    localPath: "public/data/processed/gtfs-regional-rail-stops/index.json",
    license: "GTFS.DE / DELFI feed terms; verify current feed metadata",
    attribution: "GTFS.DE / DELFI / participating rail and public transport providers",
    scale: ["L", "XL"],
    updateMode: "preprocessed",
    notes:
      "Optional regional-rail feed for rail-accessibility contexts. Not part of the default L-scale stop count unless explicitly preprocessed and wired.",
  },
  "gtfs-de-long-distance-rail": {
    id: "gtfs-de-long-distance-rail",
    label: "GTFS.DE long-distance rail feed",
    type: "external-download",
    url: "https://download.gtfs.de/germany/fv_free/latest.zip",
    localPath: "public/data/processed/gtfs-long-distance-rail-stops/index.json",
    license: "GTFS.DE / DELFI feed terms; verify current feed metadata",
    attribution: "GTFS.DE / DELFI / participating rail providers",
    scale: ["XL"],
    updateMode: "preprocessed",
    notes:
      "Optional long-distance service context. Keep separate from neighbourhood stop accessibility to avoid inflated L-scale results.",
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
