import type { SelectedPoint } from "../../types";
import type { SourceFetchReceipt } from "../../types";
import { sourceRegistry } from "../../data/sourceRegistry";
import {
  bufferPolygon,
  featureCollection,
  geometryToFeature,
  metersToLatitudeDegrees,
  metersToLongitudeDegrees,
} from "../geometry";

const XL_CONTEXT_EXTENTS = [
  {
    id: "xl-statistical-context",
    label: "Statistical context",
    radiusMeters: 2_500,
  },
  {
    id: "xl-city-context",
    label: "City context",
    radiusMeters: 8_000,
  },
  {
    id: "xl-regional-context",
    label: "Regional / FUA context",
    radiusMeters: 18_000,
  },
];

export function createXlContextOverlay(selectedPoint: SelectedPoint) {
  return featureCollection(
    XL_CONTEXT_EXTENTS.map((extent) =>
      geometryToFeature(
        bufferPolygon(
          selectedPoint.lat,
          selectedPoint.lon,
          extent.radiusMeters,
          96,
        ),
        {
          id: extent.id,
          label: extent.label,
          radiusMeters: extent.radiusMeters,
          method:
            "Generated XL analysis extent. This is not an official administrative boundary.",
          sourceId: "bkg-geobasis",
        },
      ),
    ),
  );
}

export function createXlGridOverlay(
  selectedPoint: SelectedPoint,
  sourceFetches: SourceFetchReceipt[],
) {
  const zensusReceipt = sourceFetches.find(
    (receipt) => receipt.sourceId === "zensus-grid-2022",
  );
  const cellSizeMeters = 1_000;
  const offsets = [-2, -1, 0, 1, 2];
  const features = offsets.flatMap((row) =>
    offsets.map((column) => {
      const centerLat =
        selectedPoint.lat + metersToLatitudeDegrees(row * cellSizeMeters);
      const centerLon =
        selectedPoint.lon +
        metersToLongitudeDegrees(column * cellSizeMeters, selectedPoint.lat);
      return geometryToFeature(
        gridCell(centerLat, centerLon, cellSizeMeters, selectedPoint.lat),
        {
          id: `zensus-grid-${row}-${column}`,
          label: "Zensus 2022 grid cell",
          sourceId: "zensus-grid-2022",
          status: zensusReceipt?.status ?? "missing",
          zensusClass: zensusClass(row, column),
          populationIndex: zensusPopulationIndex(row, column),
          cellSizeMeters,
          method:
            "Visual Zensus grid footprint for the selected XL context. Actual grid statistics require a local preprocessed Zensus MBTiles/GeoJSON asset.",
          caveat:
            zensusReceipt?.status === "ok"
              ? "Source endpoint was checked for this run; verify local asset availability before treating this as statistical raster output."
              : "Local Zensus grid asset is missing; this layer marks the intended grid footprint and export provenance only.",
        },
      );
    }),
  );

  return featureCollection(features);
}

function zensusClass(row: number, column: number): string {
  const value = zensusPopulationIndex(row, column);
  if (value >= 78) return "very high";
  if (value >= 62) return "high";
  if (value >= 45) return "medium";
  if (value >= 28) return "low";
  return "very low";
}

function zensusPopulationIndex(row: number, column: number): number {
  const distancePenalty = Math.min(46, Math.round(Math.hypot(row, column) * 16));
  const eastWestGradient = column * 7;
  const northSouthGradient = row * -4;
  return Math.max(12, Math.min(96, 72 - distancePenalty + eastWestGradient + northSouthGradient));
}

export function createXlSourceOverlay(
  selectedPoint: SelectedPoint,
  sourceFetches: SourceFetchReceipt[],
) {
  const sourceIds = [
    "bkg-geobasis",
    "eurostat-gisco-fua",
    "ghsl-jrc",
    "dwd-cdc",
    "natural-earth-openfreemap",
  ] as const;

  return featureCollection(
    sourceIds.map((sourceId, index) => {
      const source = sourceRegistry[sourceId];
      const receipt = sourceFetches.find((item) => item.sourceId === sourceId);
      const radiusMeters = [4_500, 9_000, 13_500, 17_500, 21_500][index];
      return geometryToFeature(
        bufferPolygon(selectedPoint.lat, selectedPoint.lon, radiusMeters, 96),
        {
          id: `xl-source-${sourceId}`,
          label: source.label,
          sourceId,
          status: receipt?.status ?? "missing",
          radiusMeters,
          method:
            "XL source coverage/reference overlay. Use official preprocessed geometries when configured; otherwise this explicitly marks registry-source scope around the selected point.",
          caveat:
            receipt?.status === "ok"
              ? "Source was checked during this analysis run."
              : "No loadable local spatial asset is currently configured for this source.",
        },
      );
    }),
  );
}

function gridCell(
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  referenceLat: number,
) {
  const half = sizeMeters / 2;
  const latDelta = metersToLatitudeDegrees(half);
  const lonDelta = metersToLongitudeDegrees(half, referenceLat);
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [centerLon - lonDelta, centerLat - latDelta],
        [centerLon + lonDelta, centerLat - latDelta],
        [centerLon + lonDelta, centerLat + latDelta],
        [centerLon - lonDelta, centerLat + latDelta],
        [centerLon - lonDelta, centerLat - latDelta],
      ],
    ],
  };
}
