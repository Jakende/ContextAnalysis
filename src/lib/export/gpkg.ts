import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { getSources } from "../data/sourceRegistry";
import type { AnalysisResult } from "../types";
import { createExportManifest } from "./manifest";

type GeometryTable = {
  name: string;
  geometryType: "POINT" | "LINESTRING" | "POLYGON";
  collection: FeatureCollection;
  styleRole?: string;
};

const MAX_TYPED_PROPERTY_COLUMNS = 120;

const PRIORITY_PROPERTY_NAMES = [
  "id",
  "name",
  "label",
  "sourceId",
  "source_id",
  "source",
  "class",
  "type",
  "category",
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "landuse",
  "natural",
  "highway",
  "railway",
  "route",
  "operator",
  "network",
  "mode",
  "value",
  "unit",
  "confidence",
  "method",
] as const;

export async function analysisToGpkgBlob(
  analysis: AnalysisResult,
): Promise<Blob> {
  const SQL = await initSqlJs({
    locateFile: () => wasmUrl,
  });
  const db = new SQL.Database();
  const createdAt = new Date().toISOString();

  createCoreTables(db);

  const tables: GeometryTable[] = [
    {
      name: "selected_point",
      geometryType: "POINT",
      collection: {
        type: "FeatureCollection",
        features: [analysis.overlays.selectedPoint],
      },
    },
    {
      name: "l_buffer",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.lBuffer, "Polygon"),
    },
    {
      name: "xl_boundaries",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.xlContext, "Polygon"),
    },
    {
      name: "xl_zensus_grid",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.xlGrid, "Polygon"),
      styleRole: "zensus-grid",
    },
    {
      name: "xl_source_coverage",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.xlSources, "Polygon"),
    },
    {
      name: "urban_atlas",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.urbanAtlas, "Polygon"),
      styleRole: "urban-atlas",
    },
    {
      name: "m_street_segment",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.mStreetSegment, "LineString"),
    },
    {
      name: "osm_pois",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.pois, "Point"),
      styleRole: "poi",
    },
    {
      name: "osm_gastronomy",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.gastronomy, "Point"),
      styleRole: "gastronomy",
    },
    {
      name: "osm_parking_areas",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.parkingAreas, "Polygon"),
      styleRole: "parking",
    },
    {
      name: "osm_streets",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.mStreetSegment, "LineString"),
    },
    {
      name: "transport_stops",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.transport, "Point"),
      styleRole: "transport",
    },
    {
      name: "transport_lines",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.transport, "LineString"),
      styleRole: "transport-line",
    },
    {
      name: "mobility_infrastructure",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.mobility, "Point"),
      styleRole: "mobility",
    },
    {
      name: "mobility_corridors",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.mobility, "LineString"),
      styleRole: "mobility",
    },
    {
      name: "mobility_isochrones",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.isochrones, "Polygon"),
      styleRole: "isochrone",
    },
    {
      name: "development_hints",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.development, "Polygon"),
      styleRole: "development",
    },
    {
      name: "development_hint_points",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.development, "Point"),
      styleRole: "development",
    },
    {
      name: "barriers",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.barriers, "LineString"),
      styleRole: "barrier",
    },
    {
      name: "barrier_points",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.barriers, "Point"),
      styleRole: "barrier",
    },
    {
      name: "green",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.green, "Polygon"),
      styleRole: "green",
    },
    {
      name: "blue_water",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.blue, "Polygon"),
      styleRole: "blue",
    },
    {
      name: "buildings",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.buildings, "Polygon"),
      styleRole: "building",
    },
    {
      name: "trees",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.trees, "Point"),
      styleRole: "tree",
    },
    {
      name: "contour_lines",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.contours, "LineString"),
      styleRole: "contour",
    },
    {
      name: "osm_overpass_raw_points",
      geometryType: "POINT",
      collection: onlyGeometry(analysis.overlays.osmRaw, "Point"),
      styleRole: "osm-raw",
    },
    {
      name: "osm_overpass_raw_lines",
      geometryType: "LINESTRING",
      collection: onlyGeometry(analysis.overlays.osmRaw, "LineString"),
      styleRole: "osm-raw",
    },
    {
      name: "osm_overpass_raw_polygons",
      geometryType: "POLYGON",
      collection: onlyGeometry(analysis.overlays.osmRaw, "Polygon"),
      styleRole: "osm-raw",
    },
  ];

  for (const table of tables) {
    createFeatureTable(db, table, createdAt);
  }

  db.run(`CREATE TABLE analysis_indicators (
    id TEXT PRIMARY KEY,
    scale TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT,
    unit TEXT,
    confidence TEXT NOT NULL,
    method TEXT NOT NULL,
    source_ids TEXT NOT NULL,
    source_version TEXT,
    caveats TEXT NOT NULL,
    computed_at TEXT NOT NULL
  )`);

  for (const indicator of analysis.indicators) {
    db.run(
      `INSERT INTO analysis_indicators VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        indicator.id,
        indicator.scale,
        indicator.label,
        indicator.value === null ? null : String(indicator.value),
        indicator.unit ?? null,
        indicator.confidence,
        indicator.method,
        indicator.sourceIds.join("|"),
        indicator.sourceVersion ?? null,
        indicator.caveats.join("|"),
        indicator.computedAt,
      ],
    );
  }

  db.run(`CREATE TABLE source_manifest (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT,
    local_path TEXT,
    license TEXT,
    attribution TEXT NOT NULL,
    scale TEXT NOT NULL,
    update_mode TEXT NOT NULL,
    notes TEXT
  )`);

  for (const source of getSources(analysis.provenance.sourceIds)) {
    db.run(
      `INSERT INTO source_manifest VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        source.id,
        source.label,
        source.type,
        source.url ?? null,
        source.localPath ?? null,
        source.license ?? null,
        source.attribution,
        source.scale.join("|"),
        source.updateMode,
        source.notes ?? null,
      ],
    );
  }

  db.run(`CREATE TABLE data_source_run (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    source_id TEXT,
    label TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    finished_at TEXT,
    elapsed_ms INTEGER,
    scale TEXT,
    url TEXT,
    local_path TEXT,
    record_count INTEGER,
    feature_count INTEGER,
    detail TEXT NOT NULL,
    caveats TEXT NOT NULL,
    error TEXT
  )`);

  for (const event of analysis.provenance.dataSourceRun) {
    db.run(
      `INSERT INTO data_source_run (
        id,
        source_id,
        label,
        phase,
        status,
        requested_at,
        finished_at,
        elapsed_ms,
        scale,
        url,
        local_path,
        record_count,
        feature_count,
        detail,
        caveats,
        error
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        event.id,
        event.sourceId ?? null,
        event.label,
        event.phase,
        event.status,
        event.requestedAt,
        event.finishedAt ?? null,
        event.elapsedMs ?? null,
        event.scale?.join("|") ?? null,
        event.url ?? null,
        event.localPath ?? null,
        event.recordCount ?? null,
        event.featureCount ?? null,
        event.detail,
        event.caveats.join("|"),
        event.error ?? null,
      ],
    );
  }

  db.run(`CREATE TABLE export_manifest (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    manifest_json TEXT NOT NULL
  )`);
  db.run(`INSERT INTO export_manifest VALUES (1, ?)`, [
    JSON.stringify(
      createExportManifest(analysis, [
        {
          name: "analysis.gpkg",
          mediaType: "application/geopackage+sqlite3",
          role: "GeoPackage export",
        },
      ]),
    ),
  ]);

  const bytes = db.export();
  db.close();
  return new Blob([new Uint8Array(bytes)], {
    type: "application/geopackage+sqlite3",
  });
}

function createCoreTables(db: import("sql.js").Database): void {
  db.run("PRAGMA application_id = 1196444487");
  db.run("PRAGMA user_version = 10300");
  db.run(`CREATE TABLE gpkg_spatial_ref_sys (
    srs_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL PRIMARY KEY,
    organization TEXT NOT NULL,
    organization_coordsys_id INTEGER NOT NULL,
    definition TEXT NOT NULL,
    description TEXT
  )`);
  db.run(
    `INSERT INTO gpkg_spatial_ref_sys VALUES
    ('Undefined Cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'),
    ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system'),
    ('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]', 'longitude/latitude coordinates in decimal degrees')`,
  );
  db.run(`CREATE TABLE gpkg_contents (
    table_name TEXT NOT NULL PRIMARY KEY,
    data_type TEXT NOT NULL,
    identifier TEXT UNIQUE,
    description TEXT DEFAULT '',
    last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    min_x DOUBLE,
    min_y DOUBLE,
    max_x DOUBLE,
    max_y DOUBLE,
    srs_id INTEGER,
    CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
  )`);
  db.run(`CREATE TABLE gpkg_geometry_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    geometry_type_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL,
    z TINYINT NOT NULL,
    m TINYINT NOT NULL,
    CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
    CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
    CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
  )`);
}

function createFeatureTable(
  db: import("sql.js").Database,
  table: GeometryTable,
  createdAt: string,
): void {
  const propertyColumns = collectPropertyColumns(table.collection);
  db.run(`CREATE TABLE ${table.name} (
    fid INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    style_role TEXT,
    style_color TEXT,
    style_opacity REAL,
    style_width REAL,
    style_symbol TEXT,
    properties_json TEXT,
    ${propertyColumns.map((column) => `${quoteIdent(column.columnName)} TEXT`).join(",\n    ")}${propertyColumns.length ? "," : ""}
    geom BLOB NOT NULL
  )`);

  const bounds = boundsFor(table.collection);
  db.run(
    `INSERT INTO gpkg_contents VALUES (?, 'features', ?, ?, ?, ?, ?, ?, ?, 4326)`,
    [
      table.name,
      table.name,
      `Urban Context Analysis layer ${table.name}`,
      createdAt,
      bounds[0],
      bounds[1],
      bounds[2],
      bounds[3],
    ],
  );
  db.run(`INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', ?, 4326, 0, 0)`, [
    table.name,
    table.geometryType,
  ]);

  for (const feature of table.collection.features) {
    const style = styleForFeature(table, feature);
    const dynamicColumnNames = propertyColumns.map((column) => quoteIdent(column.columnName));
    const dynamicValues = propertyColumns.map((column) =>
      serializePropertyValue(feature.properties?.[column.propertyName]),
    );
    db.run(
      `INSERT INTO ${table.name} (name, style_role, style_color, style_opacity, style_width, style_symbol, properties_json${dynamicColumnNames.length ? `, ${dynamicColumnNames.join(", ")}` : ""}, geom) VALUES (${["?", "?", "?", "?", "?", "?", "?", ...dynamicColumnNames.map(() => "?"), "?"].join(", ")})`,
      [
        String(feature.properties?.name ?? feature.properties?.id ?? table.name),
        style.role,
        style.color,
        style.opacity,
        style.width,
        style.symbol,
        JSON.stringify(feature.properties ?? {}),
        ...dynamicValues,
        geometryToGeoPackageBinary(feature.geometry),
      ],
    );
  }
}

function styleForFeature(table: GeometryTable, feature: Feature): {
  role: string;
  color: string;
  opacity: number;
  width: number;
  symbol: string;
} {
  const role = table.styleRole ?? String(feature.properties?.sourceId ?? table.name);
  if (role === "zensus-grid") {
    const hasMeasuredValue =
      feature.properties?.valueStatus === "measured" &&
      typeof feature.properties?.populationIndex === "number";
    return {
      role,
      color: hasMeasuredValue
        ? zensusColor(Number(feature.properties?.populationIndex))
        : "#8a8f8a",
      opacity: hasMeasuredValue ? 0.44 : 0.12,
      width: 0.8,
      symbol: hasMeasuredValue ? "zensus-value-fill" : "zensus-footprint-no-value",
    };
  }
  const styles: Record<string, { color: string; opacity: number; width: number; symbol: string }> = {
    "urban-atlas": { color: "#8b5cf6", opacity: 0.24, width: 0.8, symbol: "urban-atlas-purple-fill" },
    green: { color: "#31d158", opacity: 0.42, width: 0.8, symbol: "green-fill" },
    blue: { color: "#0ea5e9", opacity: 0.42, width: 0.9, symbol: "water-blue-fill" },
    transport: { color: "#facc15", opacity: 0.95, width: 5, symbol: "transit-stop-circle" },
    "transport-line": { color: "#facc15", opacity: 0.92, width: 2.8, symbol: "transit-line-by-mode" },
    mobility: { color: "#22d3ee", opacity: 0.9, width: table.geometryType === "LINESTRING" ? 2.2 : 4, symbol: "mobility-cyan" },
    isochrone: { color: "#eab308", opacity: 0.18, width: 1.2, symbol: "ors-isochrone-fill" },
    poi: { color: "#fb7185", opacity: 0.9, width: 3, symbol: "poi-pink-circle" },
    gastronomy: { color: "#d946ef", opacity: 0.92, width: 3.2, symbol: "gastronomy-magenta-circle" },
    parking: { color: "#64748b", opacity: 0.34, width: 0.9, symbol: "parking-gray-fill" },
    development: { color: "#f97316", opacity: 0.38, width: 1.2, symbol: "development-orange" },
    barrier: { color: "#ef4444", opacity: 0.9, width: 1.8, symbol: "barrier-red" },
    building: { color: "#60a5fa", opacity: 0.62, width: 0.7, symbol: "building-blue-extrusion-source" },
    tree: { color: "#16a34a", opacity: 0.95, width: 4.5, symbol: "tree-green-circle" },
    contour: { color: "#f3d35c", opacity: 0.72, width: 0.9, symbol: "opentopography-contour-line" },
    "osm-raw": { color: "#94a3b8", opacity: 0.45, width: 1, symbol: "raw-overpass-feature" },
  };
  return { role, ...(styles[role] ?? { color: "#ffffff", opacity: 0.8, width: 1, symbol: "default" }) };
}

function collectPropertyColumns(
  collection: FeatureCollection,
): Array<{ propertyName: string; columnName: string }> {
  const used = new Set([
    "fid",
    "name",
    "style_role",
    "style_color",
    "style_opacity",
    "style_width",
    "style_symbol",
    "properties_json",
    "geom",
  ]);
  const candidates = rankPropertyNames(collection);
  const columns: Array<{ propertyName: string; columnName: string }> = [];
  const byPropertyName = new Map<string, string>();
  for (const key of candidates) {
    if (columns.length >= MAX_TYPED_PROPERTY_COLUMNS) break;
    if (byPropertyName.has(key)) continue;
    const baseName = sanitizeColumnName(key);
    if (!baseName) continue;
    let columnName = baseName;
    let suffix = 2;
    while (used.has(columnName)) {
      columnName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    used.add(columnName);
    byPropertyName.set(key, columnName);
    columns.push({ propertyName: key, columnName });
  }
  return columns;
}

function rankPropertyNames(collection: FeatureCollection): string[] {
  const stats = new Map<string, { count: number; firstSeen: number }>();
  for (const feature of collection.features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      const current = stats.get(key);
      if (current) {
        current.count += 1;
      } else {
        stats.set(key, { count: 1, firstSeen: stats.size });
      }
    }
  }
  const priority = new Map<string, number>(
    PRIORITY_PROPERTY_NAMES.map((name, index) => [name.toLowerCase(), index]),
  );
  return [...stats.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      const leftPriority = priority.get(leftKey.toLowerCase()) ?? Number.POSITIVE_INFINITY;
      const rightPriority = priority.get(rightKey.toLowerCase()) ?? Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (left.count !== right.count) return right.count - left.count;
      return left.firstSeen - right.firstSeen;
    })
    .map(([key]) => key);
}

function sanitizeColumnName(key: string): string {
  const normalized = key
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!normalized) return "";
  return /^[a-z_]/.test(normalized) ? normalized.slice(0, 58) : `p_${normalized}`.slice(0, 58);
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function serializePropertyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function zensusColor(value: number): string {
  if (value >= 78) return "#b5292e";
  if (value >= 62) return "#f0a23b";
  if (value >= 45) return "#f3d35c";
  if (value >= 28) return "#275aa5";
  return "#15321d";
}

function onlyGeometry(
  collection: FeatureCollection,
  type: Geometry["type"],
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.filter((feature) => feature.geometry.type === type),
  };
}

function boundsFor(collection: FeatureCollection): [number, number, number, number] {
  const coords: number[][] = [];
  for (const feature of collection.features) collectCoords(feature.geometry, coords);
  if (!coords.length) return [0, 0, 0, 0];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of coords) {
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  return [west, south, east, north];
}

function collectCoords(geometry: Geometry, coords: number[][]): void {
  if (geometry.type === "Point") coords.push(geometry.coordinates);
  if (geometry.type === "LineString") pushCoordinates(coords, geometry.coordinates);
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) pushCoordinates(coords, ring);
  }
}

function pushCoordinates(target: number[][], coordinates: number[][]): void {
  for (const coordinate of coordinates) target.push(coordinate);
}

function geometryToGeoPackageBinary(geometry: Geometry): Uint8Array {
  const wkb = geometryToWkb(geometry);
  const buffer = new ArrayBuffer(8 + wkb.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 0x47;
  bytes[1] = 0x50;
  bytes[2] = 0;
  bytes[3] = 1;
  new DataView(buffer).setInt32(4, 4326, true);
  bytes.set(wkb, 8);
  return bytes;
}

function geometryToWkb(geometry: Geometry): Uint8Array {
  if (geometry.type === "Point") return pointToWkb(geometry);
  if (geometry.type === "LineString") return lineToWkb(geometry);
  if (geometry.type === "Polygon") return polygonToWkb(geometry);
  throw new Error(`Unsupported GeoPackage geometry type: ${geometry.type}`);
}

function pointToWkb(point: Point): Uint8Array {
  const buffer = new ArrayBuffer(1 + 4 + 8 + 8);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 1, true);
  view.setFloat64(5, point.coordinates[0], true);
  view.setFloat64(13, point.coordinates[1], true);
  return new Uint8Array(buffer);
}

function lineToWkb(line: LineString): Uint8Array {
  const buffer = new ArrayBuffer(1 + 4 + 4 + line.coordinates.length * 16);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 2, true);
  view.setUint32(5, line.coordinates.length, true);
  line.coordinates.forEach(([x, y], index) => {
    const offset = 9 + index * 16;
    view.setFloat64(offset, x, true);
    view.setFloat64(offset + 8, y, true);
  });
  return new Uint8Array(buffer);
}

function polygonToWkb(polygon: Polygon): Uint8Array {
  const pointCount = polygon.coordinates.reduce(
    (total, ring) => total + ring.length,
    0,
  );
  const buffer = new ArrayBuffer(
    1 + 4 + 4 + polygon.coordinates.length * 4 + pointCount * 16,
  );
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint32(1, 3, true);
  view.setUint32(5, polygon.coordinates.length, true);
  let offset = 9;
  for (const ring of polygon.coordinates) {
    view.setUint32(offset, ring.length, true);
    offset += 4;
    for (const [x, y] of ring) {
      view.setFloat64(offset, x, true);
      view.setFloat64(offset + 8, y, true);
      offset += 16;
    }
  }
  return new Uint8Array(buffer);
}
