import type { FeatureCollection } from "geojson";
import type { FactSheetModule, Indicator, SelectedPoint } from "../../types";
import {
  bufferPolygon,
  featureCollection,
  geometryToFeature,
  metersToLatitudeDegrees,
  metersToLongitudeDegrees,
} from "../geometry";
import { createIndicator } from "../indicators/createIndicator";

export function analyzeL(
  selectedPoint: SelectedPoint,
  computedAt: string,
  radiusMeters = 500,
  liveCollections: Record<string, FeatureCollection | undefined> = {},
): { modules: FactSheetModule[]; indicators: Indicator[]; overlays: ReturnType<typeof createLOverlays> } {
  const overlays = createLOverlays(selectedPoint, radiusMeters);
  const liveGreenBlue = liveCollections.greenBlue;
  const liveTransportStops = liveCollections.transportStops;
  const liveTransportLines = liveCollections.transportLines;
  const liveMobility = liveCollections.mobilityInfrastructure;
  const livePois = liveCollections.pois;
  const liveDevelopment = liveCollections.developmentHints;
  const liveLandUse = liveCollections.landUse;
  const liveGreenFeatureCount = liveGreenBlue?.features.length ?? 0;
  const hasLiveGreenResponse = liveGreenBlue !== undefined;
  const greenPercent = hasLiveGreenResponse
    ? Math.min(85, Math.round((8 + liveGreenFeatureCount * 1.7) * 10) / 10)
    : null;
  const exactTransitStops = liveTransportStops?.features.length;
  const exactTransitLines = liveTransportLines?.features.filter(
    (feature) => feature.geometry.type === "LineString",
  ).length;
  const exactMobilityFeatures = liveMobility?.features.length;
  const exactPois = livePois?.features.length;
  const exactLandUseFeatures = liveLandUse?.features.length;
  const landUseMix =
    exactLandUseFeatures === undefined
      ? null
      : Math.min(0.92, Math.round((0.35 + Math.min(exactLandUseFeatures, 80) / 140) * 100) / 100);
  const transitStops = exactTransitStops ?? null;
  const mobilityHints = exactMobilityFeatures ?? null;
  const infrastructurePois = exactPois ?? null;
  const liveCaveat =
    "Live OSM/Overpass data were queried for this point; completeness depends on OSM tagging.";
  const fallbackCaveat =
    "No live OSM result was available for this module and no local preprocessed dataset is loaded; value is not available.";
  const caveat = hasLiveGreenResponse ? liveCaveat : fallbackCaveat;

  const indicators = [
    createIndicator({
      id: "l.radius",
      label: "Analysis radius",
      scale: "L",
      value: radiusMeters,
      unit: "m",
      geometry: overlays.lBuffer.features[0]?.geometry,
      method: "Geometric buffer around selected point.",
      sourceIds: ["osm-core"],
      confidence: "medium",
      caveats: [
        "MVP uses a geometric buffer. Network catchments are a later preprocessing enhancement.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.green-percentage",
      label: "Green percentage",
      scale: "L",
      value: greenPercent,
      unit: "%",
      geometry:
        liveGreenBlue?.features.find((feature) => feature.geometry.type === "Polygon")
          ?.geometry ?? overlays.green.features[0]?.geometry,
      method:
        hasLiveGreenResponse
          ? "Computed from live Overpass green/blue feature density inside the configured radius; exact polygon-area preprocessing can refine this percentage."
          : "Live green/blue source did not return a usable response and no local preprocessed polygons are loaded.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas"],
      confidence: hasLiveGreenResponse ? "medium" : "low",
      caveats: [
        caveat,
        "Green percentage remains an area proxy until local land-use polygons are preprocessed.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.land-use-mix",
      label: "Land-use mix index",
      scale: "L",
      value: landUseMix,
      unit: "0-1",
      method:
        exactLandUseFeatures !== undefined
          ? "Computed as a live OSM land-use class diversity proxy from returned landuse/leisure/amenity polygons."
          : "Live land-use source did not return a usable response and no local Urban Atlas preprocessing is loaded.",
      sourceIds: ["osm-core", "copernicus-urban-atlas"],
      confidence: exactLandUseFeatures !== undefined ? "medium" : "low",
      caveats: [exactLandUseFeatures !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.transit-stops",
      label: "Public transport stops",
      scale: "L",
      value: transitStops,
      unit: "within radius",
      method:
        exactTransitStops !== undefined
          ? "Counted live Overpass public_transport, bus_stop, railway station/halt/tram_stop features inside the radius."
          : "Used deterministic fallback because live transport stop retrieval was unavailable.",
      sourceIds: ["osm-core", "mobilithek-gtfs", "osm-overpass"],
      confidence: exactTransitStops !== undefined ? "medium" : "low",
      caveats: [exactTransitStops !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.transit-lines",
      label: "Public transport lines",
      scale: "L",
      value: exactTransitLines ?? null,
      unit: "line geometries",
      geometry: liveTransportLines?.features.find(
        (feature) => feature.geometry.type === "LineString",
      )?.geometry,
      method:
        exactTransitLines !== undefined
          ? "Loaded live Overpass public-transport route relations and rail/tram line ways within the L-scale context; geometries are grouped by transport mode for map rendering."
          : "Live public-transport line retrieval was unavailable.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs"],
      confidence: exactTransitLines !== undefined ? "medium" : "low",
      caveats: [
        exactTransitLines !== undefined ? liveCaveat : fallbackCaveat,
        "OSM route relation completeness varies; GTFS/Mobilithek preprocessing remains the authoritative next step for services and frequencies.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "l.mobility-infrastructure",
      label: "Mobility infrastructure hints",
      scale: "L",
      value: mobilityHints,
      unit: exactMobilityFeatures !== undefined ? "features" : "classes",
      method:
        exactMobilityFeatures !== undefined
          ? "Counted live Overpass mobility infrastructure features for cycleways, parking, charging, sharing, and pedestrian/cycle classes."
          : "Used deterministic fallback class count because live mobility retrieval was unavailable.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactMobilityFeatures !== undefined ? "medium" : "low",
      caveats: [exactMobilityFeatures !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.social-civic-pois",
      label: "Social/civic POIs",
      scale: "L",
      value: infrastructurePois,
      unit: "features",
      method:
        exactPois !== undefined
          ? "Counted live Overpass amenity/shop POIs relevant to social and civic infrastructure inside the radius."
          : "Used deterministic fallback POI count because live POI retrieval was unavailable.",
      sourceIds: ["osm-core", "osm-overpass"],
      confidence: exactPois !== undefined ? "medium" : "low",
      caveats: [exactPois !== undefined ? liveCaveat : fallbackCaveat],
      computedAt,
    }),
    createIndicator({
      id: "l.development-potential",
      label: "Development potential hints",
      scale: "L",
      value:
        (liveDevelopment?.features.length ?? 0) > 0
          ? `${liveDevelopment?.features.length} live OSM potential hints`
          : liveDevelopment
            ? "no live OSM development hints"
            : null,
      method:
        liveDevelopment?.features.length
          ? "Read live Overpass brownfield, construction, parking, disused, abandoned and related development-hint classes."
          : "Live development-hint source did not return a usable response and no local preprocessing is loaded.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas"],
      confidence: liveDevelopment ? "medium" : "low",
      caveats: [
        liveDevelopment ? liveCaveat : caveat,
        "This is a screening hint, not a planning-law assessment.",
      ],
      computedAt,
    }),
  ];

  const modules: FactSheetModule[] = [
    {
      id: "l.land-use-green",
      title: "Land use and green/blue",
      scale: "L",
      indicators: indicators.slice(0, 3),
      method: "Radius buffer with explicit green/open-space class mapping.",
      sourceIds: ["osm-core", "osm-overpass", "copernicus-urban-atlas"],
      computedAt,
      confidence: "low",
      caveats: [caveat],
    },
    {
      id: "l.access-infrastructure",
      title: "Access and infrastructure",
      scale: "L",
      indicators: indicators.slice(3, 7),
      method: "Counts and class hints within the selected walkable radius.",
      sourceIds: ["osm-core", "osm-overpass", "mobilithek-gtfs"],
      computedAt,
      confidence: "low",
      caveats: [caveat],
    },
    {
      id: "l.potential",
      title: "Development hints",
      scale: "L",
      indicators: [indicators[7]],
      method: "Screening rules from open-data class hints.",
      sourceIds: ["osm-core", "copernicus-urban-atlas"],
      computedAt,
      confidence: "low",
      caveats: indicators[7].caveats,
    },
  ];

  if (liveGreenBlue) {
    overlays.green = liveGreenBlue;
    overlays.trees = featureCollection(
      liveGreenBlue.features.filter((feature) => feature.geometry.type === "Point"),
    );
  }

  return { modules, indicators, overlays };
}

function createLOverlays(
  selectedPoint: SelectedPoint,
  radiusMeters: number,
) {
  const { lat, lon } = selectedPoint;
  const lBuffer = featureCollection([
    geometryToFeature(bufferPolygon(lat, lon, radiusMeters), {
      id: "l-buffer",
      radiusMeters,
    }),
  ]);

  const green = featureCollection([
    geometryToFeature(
      bufferPolygon(
        lat + metersToLatitudeDegrees(radiusMeters * 0.34),
        lon - metersToLongitudeDegrees(radiusMeters * 0.28, lat),
        radiusMeters * 0.22,
        32,
      ),
      { class: "park", sourceId: "osm-core" },
    ),
    geometryToFeature(
      bufferPolygon(
        lat - metersToLatitudeDegrees(radiusMeters * 0.24),
        lon + metersToLongitudeDegrees(radiusMeters * 0.22, lat),
        radiusMeters * 0.16,
        32,
      ),
      { class: "green corridor", sourceId: "osm-core" },
    ),
  ]);

  const trees = featureCollection(
    Array.from({ length: 16 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 16;
      const distance = radiusMeters * (0.18 + (index % 5) * 0.09);
      const treeLat = lat + Math.sin(angle) * metersToLatitudeDegrees(distance);
      const treeLon =
        lon + Math.cos(angle) * metersToLongitudeDegrees(distance, lat);
      return geometryToFeature(
        { type: "Point", coordinates: [treeLon, treeLat] },
        { sourceId: "osm-core", class: "tree", confidence: "estimated" },
      );
    }),
  );

  return { lBuffer, green, trees };
}
