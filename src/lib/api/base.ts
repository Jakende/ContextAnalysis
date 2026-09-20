/** Asset, geodata and API origins are independent deployment decisions. */
export function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL?.trim();
  const fallback =
    import.meta.env.VITE_PRODUCT_VARIANT === "verplant"
      ? `${import.meta.env.BASE_URL}api`
      : "/api";
  return `${(base || fallback).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
