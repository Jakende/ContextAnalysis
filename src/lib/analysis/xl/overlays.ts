import type { FeatureCollection } from "geojson";
import type { SelectedPoint } from "../../types";
import type { SourceFetchReceipt } from "../../types";
import { featureCollection } from "../geometry";

export function createXlContextOverlay(
  _selectedPoint: SelectedPoint,
  bkgBoundaries?: FeatureCollection,
) {
  return bkgBoundaries ?? featureCollection();
}

export function createXlGridOverlay(
  _selectedPoint: SelectedPoint,
  _sourceFetches: SourceFetchReceipt[],
  zensusGrid?: FeatureCollection,
) {
  return zensusGrid ?? featureCollection();
}

export function createXlSourceOverlay(
  _selectedPoint: SelectedPoint,
  _sourceFetches: SourceFetchReceipt[],
  fuaGeometries?: FeatureCollection,
) {
  return fuaGeometries ?? featureCollection();
}
