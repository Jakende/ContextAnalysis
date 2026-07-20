const DEFAULT_GEODATA_BASE_URL = "/data";

/**
 * Resolve one immutable geodata-release asset without coupling runtime code to
 * the UI deployment origin. VITE_GEODATA_BASE_URL points at the release's data
 * root, for example https://cdn.example/uca-geodata/2026-07-20.
 */
export function dataAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const relativePath = path
    .replace(/^\/?data\//, "")
    .replace(/^\/+/, "");
  const configuredBase = import.meta.env.VITE_GEODATA_BASE_URL?.trim();
  const base = (configuredBase || DEFAULT_GEODATA_BASE_URL).replace(/\/+$/, "");
  return `${base}/${relativePath}`;
}

