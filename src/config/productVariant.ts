export type ProductVariant = {
  id: "uca" | "verplant";
  title: string;
  brand: string;
  language: "en" | "de";
  reportLanguage: "en" | "de";
  perspectives: boolean;
  tokens: {
    accent: string;
    background: string;
    text: string;
    heading: string;
    body: string;
  };
};
export function resolveProductVariant(value?: string): ProductVariant {
  if (value && value !== "uca" && value !== "verplant")
    throw new Error(`Unknown product variant: ${value}`);
  return value === "verplant"
    ? {
        id: "verplant",
        title: "verplant — ausprobieren",
        brand: "verplant",
        language: "de",
        reportLanguage: "de",
        perspectives: true,
        tokens: {
          accent: "#00FF6A",
          background: "#FDFDFC",
          text: "#111111",
          heading: "Urbanist, system-ui, sans-serif",
          body: "Quicksand, system-ui, sans-serif",
        },
      }
    : {
        id: "uca",
        title: "Urban Context Analysis",
        brand: "Urban Context Analysis",
        language: "en",
        reportLanguage: "en",
        perspectives: false,
        tokens: {
          accent: "#ffffff",
          background: "#000000",
          text: "#ffffff",
          heading: "monospace",
          body: "monospace",
        },
      };
}
export const productVariant = resolveProductVariant(
  import.meta.env.VITE_PRODUCT_VARIANT,
);
