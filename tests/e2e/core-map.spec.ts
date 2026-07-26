import { expect, test, type Page } from "playwright/test";
import { installDeterministicNetwork } from "./fixtures/network";

const PROJECT_LAYER = {
  type: "Feature",
  properties: { name: "Playwright project" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [11.574, 48.133],
        [11.586, 48.133],
        [11.586, 48.142],
        [11.574, 48.142],
        [11.574, 48.133],
      ],
    ],
  },
};

const REGRESSION_PROJECTS = [
  {
    id: "frankfurt",
    geometry: rectanglePolygon(8.675, 50.105, 8.687, 50.113),
  },
  {
    id: "rosenheim",
    geometry: rectanglePolygon(12.12, 47.852, 12.132, 47.86),
  },
  {
    id: "munich-multipart",
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        rectanglePolygon(11.568, 48.132, 11.574, 48.138).coordinates,
        rectanglePolygon(11.579, 48.136, 11.585, 48.142).coordinates,
      ],
    },
  },
] as const;

test.beforeEach(async ({ page }) => {
  await installDeterministicNetwork(page);
});

test("app identity, framework health, and viewport containment", async ({
  page,
}) => {
  const runtimeErrors = watchRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("Urban Context Analysis");
  await expect(
    page.getByRole("main").getByText("Map-first urban context workspace"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Interactive map workspace" }),
  ).toBeVisible();
  await expect(page.getByLabel("Structured fact sheet")).toContainText(
    "Select a point to load the structured modules.",
  );
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Internal server error");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await assertNoHorizontalViewportOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("uploaded project layer drives analysis without responsive overflow", async ({
  page,
}, testInfo) => {
  const runtimeErrors = watchRuntimeErrors(page);

  await page.goto("/");
  await waitForMapReady(page);
  await page
    .getByLabel("Upload project boundary as GeoJSON")
    .setInputFiles({
      name: "playwright-project.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify(PROJECT_LAYER)),
    });

  await expect(page.locator(".project-area-status")).toContainText(
    "playwright-project",
  );
  await expect(page.locator(".analysis-phase-badge")).toHaveText("Complete", {
    timeout: 30_000,
  });
  await expect(page.locator(".point-readout")).toContainText(
    "Boundary: playwright-project",
  );
  const performanceSnapshot = await page.evaluate(
    () => (window as Window & { __UCA_PERFORMANCE__?: unknown }).__UCA_PERFORMANCE__,
  ) as {
    app?: { appReadyElapsedMs?: number };
    latestAnalysis?: {
      marks?: Array<{ id: string }>;
      durations?: {
        firstUsableStructuredResultMs?: number;
        liveEnrichmentCompleteMs?: number;
      };
    };
  };
  expect(performanceSnapshot.app?.appReadyElapsedMs).toBeGreaterThanOrEqual(0);
  expect(performanceSnapshot.latestAnalysis?.marks?.map((mark) => mark.id)).toEqual(
    expect.arrayContaining([
      "analysis-start",
      "local-data-lookup-start",
      "local-data-lookup-complete",
      "first-usable-structured-result",
      "live-enrichment-complete",
    ]),
  );
  expect(
    performanceSnapshot.latestAnalysis?.durations?.firstUsableStructuredResultMs,
  ).toBeLessThanOrEqual(5_000);
  expect(
    performanceSnapshot.latestAnalysis?.durations?.liveEnrichmentCompleteMs,
  ).toBeGreaterThanOrEqual(
    performanceSnapshot.latestAnalysis?.durations?.firstUsableStructuredResultMs ?? 0,
  );
  await testInfo.attach("analysis-performance.json", {
    body: Buffer.from(JSON.stringify(performanceSnapshot, null, 2)),
    contentType: "application/json",
  });
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await assertNoHorizontalViewportOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("city and multipart regression contexts publish bounded timing baselines", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The full city timing matrix runs once on desktop.",
  );
  const runtimeErrors = watchRuntimeErrors(page);

  for (const regression of REGRESSION_PROJECTS) {
    await page.goto("/");
    await waitForMapReady(page);
    await page
      .getByLabel("Upload project boundary as GeoJSON")
      .setInputFiles({
        name: `${regression.id}.geojson`,
        mimeType: "application/geo+json",
        buffer: Buffer.from(
          JSON.stringify({
            type: "Feature",
            properties: { name: regression.id },
            geometry: regression.geometry,
          }),
        ),
      });
    await expect(page.locator(".project-area-status")).toContainText(
      regression.id,
    );
    await expect(page.locator(".analysis-phase-badge")).toHaveText("Complete", {
      timeout: 30_000,
    });
    const performanceSnapshot = await readPerformanceSnapshot(page);
    expect(
      performanceSnapshot.latestAnalysis?.durations
        ?.firstUsableStructuredResultMs,
    ).toBeLessThanOrEqual(5_000);
    await testInfo.attach(`${regression.id}-performance.json`, {
      body: Buffer.from(JSON.stringify(performanceSnapshot, null, 2)),
      contentType: "application/json",
    });
    await assertNoHorizontalViewportOverflow(page);
  }

  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("rectangle and polygon drawing produce canonical project analyses", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Precise drawing interactions run once on desktop.",
  );
  const runtimeErrors = watchRuntimeErrors(page);
  await page.goto("/");
  await waitForMapReady(page);

  await page.getByRole("button", { name: "Draw rectangle" }).click();
  await clickMapAt(page, 0.44, 0.44);
  await clickMapAt(page, 0.56, 0.56);
  await expect(page.locator(".project-area-status")).toContainText(
    "Project rectangle",
  );
  await expect(page.locator(".analysis-phase-badge")).toHaveText("Complete", {
    timeout: 30_000,
  });

  await page
    .getByRole("button", { name: "Close analysis / new point" })
    .click();
  await page
    .getByRole("button", { name: /Clear project area Project rectangle/ })
    .click();
  await page.getByRole("button", { name: "Draw polygon" }).click();
  await clickMapAt(page, 0.46, 0.47);
  await clickMapAt(page, 0.54, 0.47);
  await clickMapAt(page, 0.5, 0.54);
  const finishPolygon = page.getByRole("button", { name: "Finish polygon" });
  await expect(finishPolygon).toBeEnabled();
  await finishPolygon.click();
  await expect(page.locator(".project-area-status")).toContainText(
    "Drawn project area",
  );
  await expect(page.locator(".analysis-phase-badge")).toHaveText("Complete", {
    timeout: 30_000,
  });
  await expect(page.locator(".point-readout")).toContainText(
    "Boundary: Drawn project area",
  );
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("point analysis supports scale, scenario, and export interactions", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The full interaction loop runs once on desktop; responsive analysis runs in the project-layer test.",
  );
  const runtimeErrors = watchRuntimeErrors(page);

  await page.goto("/");
  await waitForMapReady(page);
  await clickOpenMapArea(page);

  await expect(page.locator(".analysis-phase-badge")).toHaveText("Complete", {
    timeout: 30_000,
  });
  await expect(page.locator(".point-readout")).toContainText("Stub Street");
  await expect(page.locator(".map-control-status")).toContainText(
    "Point fixed.",
  );

  const scaleSwitcher = page.getByLabel("Scale switching");
  for (const scale of ["L", "M", "XL"] as const) {
    const scaleButton = scaleSwitcher.getByRole("button", {
      name: new RegExp(`^${scale}\\b`),
    });
    await scaleButton.click();
    await expect(scaleButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".fact-sheet-header .label")).toContainText(
      `Fact sheet / ${scale}`,
    );
  }

  const scenarioPanel = page.locator("details.scenario-panel");
  await scenarioPanel.locator("summary").click();
  await scenarioPanel
    .getByRole("button", { name: /^Transit stop/ })
    .click();
  await clickOpenMapArea(page);
  if (!(await scenarioPanel.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await scenarioPanel.locator("summary").click();
  }
  await expect(
    scenarioPanel.getByRole("button", { name: "Remove Transit stop" }),
  ).toBeVisible();
  await expect(scenarioPanel.locator("summary small")).toHaveText("1");

  await page.locator(".export-dock-toggle").click();
  const exports = page.getByRole("region", { name: "Exports" });
  await expect(exports).toBeVisible();
  await expect(exports.getByRole("button", { name: "JSON" }).first()).toBeVisible();
  await expect(exports.getByRole("button", { name: "GPKG" }).first()).toBeVisible();
  await expect(
    exports.getByRole("button", { name: "Scenario GeoJSON" }).first(),
  ).toBeVisible();

  await page.locator(".export-dock-toggle").click();
  await scenarioPanel
    .getByRole("button", { name: "Remove Transit stop" })
    .click();
  await expect(scenarioPanel.locator("summary small")).toHaveText("0");
  await page.locator(".export-dock-toggle").click();
  await expect(
    exports.getByRole("button", { name: "Scenario GeoJSON" }),
  ).toHaveCount(0);

  const [ollamaDownload] = await Promise.all([
    page.waitForEvent("download"),
    exports.getByRole("button", { name: "Ollama report" }).first().click(),
  ]);
  expect(ollamaDownload.suggestedFilename()).toMatch(/-ollama-report\.md$/);
  await expect(page.locator(".app-footer strong")).toContainText(
    "Ollama unavailable; deterministic report exported.",
  );

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    exports.getByRole("button", { name: "JSON" }).first().click(),
  ]);
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const snapshot = (
          window as Window & {
            __UCA_PERFORMANCE__?: {
              exports?: Array<{ kind: string; status: string; elapsedMs?: number }>;
            };
          }
        ).__UCA_PERFORMANCE__;
        return snapshot?.exports?.at(-1);
      }),
    )
    .toMatchObject({ kind: "json", status: "ok" });

  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await assertNoHorizontalViewportOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("external API outages preserve a usable local analysis", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The explicit outage matrix runs once on desktop.",
  );
  await page.unroute("**/*");
  await installDeterministicNetwork(page, { failLiveApis: true });
  const runtimeErrors = watchRuntimeErrors(page);

  await page.goto("/");
  await waitForMapReady(page);
  await clickOpenMapArea(page);
  await expect(page.locator(".analysis-phase-badge")).toHaveText("Complete", {
    timeout: 30_000,
  });
  await expect(page.locator(".point-readout")).toContainText(
    "Address not available",
  );
  await expect(page.locator(".map-control-status")).toContainText(
    "Point fixed.",
  );
  await expect(page.locator(".dependency-strip")).toContainText(/Overpass/i);
  await expect(page.locator(".dependency-strip")).toContainText(/failed/i);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await assertNoHorizontalViewportOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

function watchRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Interactive map workspace" }),
  ).toBeVisible();
}

async function clickOpenMapArea(page: Page): Promise<void> {
  await clickMapAt(page, 0.5, 0.55);
}

async function clickMapAt(
  page: Page,
  xRatio: number,
  yRatio: number,
): Promise<void> {
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas has no rendered bounding box.");
  await page.mouse.click(
    box.x + box.width * xRatio,
    box.y + box.height * yRatio,
  );
}

async function assertNoHorizontalViewportOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const selectors = [".app-shell", ".top-rail", ".workspace", ".app-footer"];
    const viewportWidth = window.innerWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const offenders = selectors.flatMap((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return [`${selector}:missing`];
      const bounds = element.getBoundingClientRect();
      return bounds.left < -1 || bounds.right > viewportWidth + 1
        ? [
            `${selector}:${Math.round(bounds.left)}..${Math.round(bounds.right)} viewport=${viewportWidth}`,
          ]
        : [];
    });
    return {
      documentWidth,
      viewportWidth,
      offenders,
    };
  });

  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.offenders).toEqual([]);
}

async function readPerformanceSnapshot(page: Page): Promise<{
  latestAnalysis?: {
    durations?: {
      firstUsableStructuredResultMs?: number;
      liveEnrichmentCompleteMs?: number;
    };
  };
}> {
  return page.evaluate(
    () =>
      (window as Window & { __UCA_PERFORMANCE__?: unknown })
        .__UCA_PERFORMANCE__,
  ) as Promise<{
    latestAnalysis?: {
      durations?: {
        firstUsableStructuredResultMs?: number;
        liveEnrichmentCompleteMs?: number;
      };
    };
  }>;
}

function rectanglePolygon(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}
