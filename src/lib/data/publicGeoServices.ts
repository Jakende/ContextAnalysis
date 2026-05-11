export const SRTM_WMS_BASE_URL = "https://ows.mundialis.de/osm/service";
export const SRTM_WMS_LAYER = "SRTM30-Colored-Hillshade";

export const BKG_VG250_WMS_CAPABILITIES_URL =
  "https://sgx.geodatenzentrum.de/wms_vg250?REQUEST=GetCapabilities&SERVICE=WMS";
export const BKG_VG250_WFS_CAPABILITIES_URL =
  "https://sgx.geodatenzentrum.de/wfs_vg250?request=GetCapabilities&service=WFS";

export const GISCO_DISTRIBUTION_API_URL =
  "https://gisco-services.ec.europa.eu/distribution/v2/";

export const ESPON_FUA_WMS_CAPABILITIES_URL =
  "https://database.espon.eu/geoserver/espon_layers/wms?service=WMS&version=1.3.0&request=GetCapabilities";

export const GLOBAL_BUILDING_ATLAS_WFS_CAPABILITIES_URL =
  "https://tubvsig-so2sat-vm1.srv.mwn.de/geoserver/ows?service=WFS&request=GetCapabilities";

export function srtmWmsTileUrl(layer = SRTM_WMS_LAYER): string {
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: layer,
    styles: "",
    format: "image/png",
    transparent: "true",
    crs: "EPSG:3857",
    width: "256",
    height: "256",
  });
  return `${SRTM_WMS_BASE_URL}?${params.toString()}&bbox={bbox-epsg-3857}`;
}
