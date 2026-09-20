import "maplibre-gl/dist/maplibre-gl.css";
import { lazy, Suspense, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { productVariant } from "./config/productVariant";
const App = lazy(() =>
  import.meta.env.VITE_PRODUCT_VARIANT === "verplant"
    ? import("./app/VerplantApp").then((m) => ({ default: m.VerplantApp }))
    : import("./app/App").then((m) => ({ default: m.App })),
);
if (productVariant.perspectives) {
  document.documentElement.lang = productVariant.language;
  document.title = productVariant.title;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense
      fallback={
        <p role="status">
          {productVariant.perspectives ? "Anwendung wird geladen…" : "Loading…"}
        </p>
      }
    >
      <App />
    </Suspense>
  </StrictMode>,
);
