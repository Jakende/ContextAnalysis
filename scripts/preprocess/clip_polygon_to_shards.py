#!/usr/bin/env python3
"""Exact GDAL/GEOS fallback for pathological polygon-to-shard clipping."""

import argparse
import json
from pathlib import Path

from osgeo import gdal, ogr


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def polygonal_only(geometry):
    if geometry is None or geometry.IsEmpty():
        return None
    geometry_type = ogr.GT_Flatten(geometry.GetGeometryType())
    if geometry_type == ogr.wkbPolygon:
        return geometry.Clone()
    if geometry_type == ogr.wkbMultiPolygon:
        return geometry.Clone()
    polygons = []
    for index in range(geometry.GetGeometryCount()):
        child = polygonal_only(geometry.GetGeometryRef(index))
        if child is None:
            continue
        child_type = ogr.GT_Flatten(child.GetGeometryType())
        if child_type == ogr.wkbPolygon:
            polygons.append(child)
        elif child_type == ogr.wkbMultiPolygon:
            for child_index in range(child.GetGeometryCount()):
                polygons.append(child.GetGeometryRef(child_index).Clone())
    if not polygons:
        return None
    if len(polygons) == 1:
        return polygons[0]
    multi_polygon = ogr.Geometry(ogr.wkbMultiPolygon)
    for polygon in polygons:
        multi_polygon.AddGeometry(polygon)
    return multi_polygon


def rectangle(bbox):
    west, south, east, north = bbox
    ring = ogr.Geometry(ogr.wkbLinearRing)
    ring.AddPoint_2D(west, south)
    ring.AddPoint_2D(east, south)
    ring.AddPoint_2D(east, north)
    ring.AddPoint_2D(west, north)
    ring.AddPoint_2D(west, south)
    polygon = ogr.Geometry(ogr.wkbPolygon)
    polygon.AddGeometry(ring)
    return polygon


def main():
    ogr.UseExceptions()
    args = parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    geometry = ogr.CreateGeometryFromJson(
        json.dumps(payload["geometry"], separators=(",", ":"))
    )
    if geometry is None:
        raise RuntimeError("OGR could not parse the source geometry")

    source_geometry_valid = bool(geometry.IsValid())
    repair_applied = not source_geometry_valid
    repair_method = None
    if repair_applied:
        repair_method = "gdal-make-valid-linework"
        geometry = geometry.MakeValid(["METHOD=LINEWORK", "KEEP_COLLAPSED=NO"])
        geometry = polygonal_only(geometry)
        if geometry is None or geometry.IsEmpty() or not geometry.IsValid():
            raise RuntimeError("GDAL MakeValid(LINEWORK) did not produce valid polygonal geometry")
    else:
        geometry = polygonal_only(geometry)
    if geometry is None or geometry.IsEmpty():
        raise RuntimeError("Source geometry has no polygonal area")

    metadata = {
        "type": "metadata",
        "gdalVersion": gdal.VersionInfo("RELEASE_NAME"),
        "sourceGeometryValid": source_geometry_valid,
        "repairApplied": repair_applied,
        "repairMethod": repair_method,
        "sourceAreaDegrees2": geometry.GetArea(),
    }
    output_path = Path(args.output)
    with output_path.open("w", encoding="utf-8") as output:
        output.write(json.dumps(metadata, separators=(",", ":")) + "\n")
        for shard in payload["shards"]:
            clipped = polygonal_only(geometry.Intersection(rectangle(shard["bbox"])))
            if clipped is None or clipped.IsEmpty() or clipped.GetArea() <= 0:
                continue
            if not clipped.IsValid():
                raise RuntimeError(f"OGR produced invalid output for shard {shard['key']}")
            output.write(
                json.dumps(
                    {
                        "type": "fragment",
                        "shardKey": shard["key"],
                        "geometry": json.loads(
                            clipped.ExportToJson(["COORDINATE_PRECISION=12"])
                        ),
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )


if __name__ == "__main__":
    main()
