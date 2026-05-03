import alterCsv from "./csv/Alter.csv?raw";
import erwerbsstatusCsv from "./csv/Erwerbsstatus.csv?raw";
import familiengroessenCsv from "./csv/Familiengroessen.csv?raw";
import familientypenCsv from "./csv/Familientypen.csv?raw";
import mieteDerWohnungCsv from "./csv/Miete_der_Wohnung.csv?raw";
import mietpreiseStadtteileCsv from "./csv/Mietpreise_Stadtteile.csv?raw";
import stadtbezirkeCsv from "./csv/Stadtbezirke.csv?raw";
import wohnungskennzahlenCsv from "./csv/Wohnungskennzahlen.csv?raw";
import wohnungsnutzungCsv from "./csv/Wohnungsnutzung.csv?raw";

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((header) => header.trim());

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(",").map((value) => value.trim());
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );
    });
}

const tables = {
  alter: parseCsv(alterCsv),
  erwerbsstatus: parseCsv(erwerbsstatusCsv),
  familiengroessen: parseCsv(familiengroessenCsv),
  familientypen: parseCsv(familientypenCsv),
  mieteDerWohnung: parseCsv(mieteDerWohnungCsv),
  mietpreiseStadtteile: parseCsv(mietpreiseStadtteileCsv),
  stadtbezirke: parseCsv(stadtbezirkeCsv),
  wohnungskennzahlen: parseCsv(wohnungskennzahlenCsv),
  wohnungsnutzung: parseCsv(wohnungsnutzungCsv),
};

export function getCsvSourceSummary(district: string) {
  return {
    district,
    tableCount: Object.keys(tables).length,
    recordCount: Object.values(tables).reduce(
      (total, table) => total + table.length,
      0,
    ),
    matchedRows: Object.entries(tables).map(([name, table]) => ({
      name,
      ...findDistrictRowWithMatch(table, district),
    })),
  };
}

function findDistrictRow(table: CsvRow[], district: string): CsvRow {
  return findDistrictRowWithMatch(table, district).row;
}

function findDistrictRowWithMatch(
  table: CsvRow[],
  district: string,
): { row: CsvRow; match: "exact" | "city-fallback" | "first-row-fallback" } {
  const exact = table.find((row) => row.district === district);
  if (exact) return { row: exact, match: "exact" };
  const cityFallback = table.find((row) => row.district === "Muenchen");
  if (cityFallback) return { row: cityFallback, match: "city-fallback" };
  return { row: table[0], match: "first-row-fallback" };
}

export function getDistrictCsvProfile(district: string) {
  return {
    alter: findDistrictRow(tables.alter, district),
    erwerbsstatus: findDistrictRow(tables.erwerbsstatus, district),
    familiengroessen: findDistrictRow(tables.familiengroessen, district),
    familientypen: findDistrictRow(tables.familientypen, district),
    mieteDerWohnung: findDistrictRow(tables.mieteDerWohnung, district),
    mietpreiseStadtteile: findDistrictRow(tables.mietpreiseStadtteile, district),
    stadtbezirke: findDistrictRow(tables.stadtbezirke, district),
    wohnungskennzahlen: findDistrictRow(tables.wohnungskennzahlen, district),
    wohnungsnutzung: findDistrictRow(tables.wohnungsnutzung, district),
  };
}

export function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}
