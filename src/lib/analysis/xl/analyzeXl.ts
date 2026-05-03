import { getDistrictCsvProfile, toNumber } from "../../data/csvLoader";
import type { FactSheetModule, Indicator, SelectedPoint } from "../../types";
import { createIndicator } from "../indicators/createIndicator";

function inferMunichDistrict(lat: number, lon: number): string {
  if (lat > 48.155 && lon < 11.59) return "Schwabing";
  if (lat > 48.13 && lon > 11.56 && lon < 11.59) return "Altstadt-Lehel";
  if (lat > 48.13 && lon < 11.57) return "Maxvorstadt";
  return "Muenchen";
}

function normalizeDistrictName(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.toLowerCase();
  if (normalized.includes("maxvorstadt")) return "Maxvorstadt";
  if (normalized.includes("altstadt") || normalized.includes("lehel")) {
    return "Altstadt-Lehel";
  }
  if (normalized.includes("schwabing")) return "Schwabing";
  if (normalized.includes("münchen") || normalized.includes("munich")) {
    return "Muenchen";
  }
  return value;
}

export function analyzeXl(
  selectedPoint: SelectedPoint,
  computedAt: string,
): { modules: FactSheetModule[]; indicators: Indicator[]; district: string } {
  const district =
    normalizeDistrictName(selectedPoint.district) ||
    inferMunichDistrict(selectedPoint.lat, selectedPoint.lon);
  const municipality =
    selectedPoint.municipality ??
    (selectedPoint.address?.includes("Berlin") ? "Berlin" : "Muenchen");
  const profile = getDistrictCsvProfile(district);
  const population = toNumber(profile.stadtbezirke.population);
  const medianAge = toNumber(profile.alter.median_age);
  const medianRent = toNumber(profile.mieteDerWohnung.median_rent_eur_m2);
  const rentIndex = toNumber(profile.mietpreiseStadtteile.city_index);
  const area = toNumber(profile.stadtbezirke.area_km2);
  const density =
    population !== null && area !== null ? Math.round(population / area) : null;

  const caveat =
    "Local CSVs use the required MVP schema with sample rows; replace with authoritative Destatis/Zensus exports in preprocessing.";

  const indicators = [
    createIndicator({
      id: "xl.municipality",
      label: "Municipality",
      scale: "XL",
      value: municipality,
      method:
        "Municipality is read from Nominatim reverse-geocoding context where available; local CSV joins are used when matching rows exist.",
      sourceIds: ["osm-nominatim", "bkg-geobasis", "destatis-genesis"],
      sourceVersion: profile.stadtbezirke.source_version,
      confidence: "medium",
      caveats: [
        municipality === "Muenchen"
          ? caveat
          : "No local CSV row is available for this municipality yet; citywide sample rows are used only for schema continuity.",
      ],
      computedAt,
    }),
    createIndicator({
      id: "xl.district",
      label: "District / Stadtbezirk",
      scale: "XL",
      value: district,
      method:
        "District is read from Nominatim when available, otherwise inferred by the local MVP coordinate bucket; official boundaries are expected from BKG preprocessing.",
      sourceIds: ["osm-nominatim", "bkg-geobasis", "destatis-genesis"],
      sourceVersion: profile.stadtbezirke.source_version,
      confidence: "low",
      caveats: [
        "District assignment is an MVP deterministic approximation until official boundaries are loaded.",
        caveat,
      ],
      computedAt,
    }),
    createIndicator({
      id: "xl.population",
      label: "Population",
      scale: "XL",
      value: population,
      unit: "residents",
      method: "Read from local Stadtbezirke CSV by district key.",
      sourceIds: ["destatis-genesis"],
      sourceVersion: profile.stadtbezirke.source_version,
      confidence: "medium",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "xl.population-density",
      label: "Population density",
      scale: "XL",
      value: density,
      unit: "residents/km2",
      method: "Population divided by district area from local CSV fields.",
      sourceIds: ["destatis-genesis"],
      sourceVersion: profile.stadtbezirke.source_version,
      confidence: "medium",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "xl.median-age",
      label: "Median age",
      scale: "XL",
      value: medianAge,
      unit: "years",
      method: "Read from local Alter CSV by district key.",
      sourceIds: ["destatis-genesis"],
      sourceVersion: profile.alter.source_version,
      confidence: "medium",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "xl.median-rent",
      label: "Median rent",
      scale: "XL",
      value: medianRent,
      unit: "EUR/m2",
      method: "Read from local Miete_der_Wohnung CSV by district key.",
      sourceIds: ["destatis-genesis"],
      sourceVersion: profile.mieteDerWohnung.source_version,
      confidence: "medium",
      caveats: [caveat],
      computedAt,
    }),
    createIndicator({
      id: "xl.rent-index",
      label: "Rent index vs city",
      scale: "XL",
      value: rentIndex,
      unit: "city=100",
      method: "Read from local Mietpreise_Stadtteile CSV.",
      sourceIds: ["destatis-genesis"],
      sourceVersion: profile.mietpreiseStadtteile.source_version,
      confidence: "medium",
      caveats: [caveat],
      computedAt,
    }),
  ];

  const modules: FactSheetModule[] = [
    {
      id: "xl.district-profile",
      title: "District profile",
      scale: "XL",
      indicators: indicators.slice(0, 4),
      method: "City and district context assembled from local CSV fields.",
      sourceIds: ["destatis-genesis", "bkg-geobasis"],
      computedAt,
      confidence: "medium",
      caveats: [caveat],
    },
    {
      id: "xl.housing-demography",
      title: "Demography and housing",
      scale: "XL",
      indicators: indicators.slice(4, 7),
      method: "Demographic and rent fields joined by district label.",
      sourceIds: ["destatis-genesis"],
      computedAt,
      confidence: "medium",
      caveats: [caveat],
    },
  ];

  return { modules, indicators, district };
}
