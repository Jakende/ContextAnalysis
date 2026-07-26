#!/usr/bin/env python3
"""Fail-closed OGR topology validation for a staged polygon fragment index."""

import argparse
import json
from pathlib import Path

from osgeo import gdal, ogr


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--staging-dir", required=True)
    return parser.parse_args()


def main():
    ogr.UseExceptions()
    args = parse_args()
    staging = Path(args.staging_dir)
    index = json.loads((staging / "index.json").read_text(encoding="utf-8"))
    validated = 0
    area = 0.0
    for shard in index["shards"]:
        path = staging / "shards" / f"{shard['key']}.geojson"
        collection = json.loads(path.read_text(encoding="utf-8"))
        for feature in collection["features"]:
            geometry = ogr.CreateGeometryFromJson(
                json.dumps(feature["geometry"], separators=(",", ":"))
            )
            fragment_id = feature.get("properties", {}).get(
                "fragmentId", feature.get("id", "(missing)")
            )
            if geometry is None:
                raise RuntimeError(
                    f"OGR could not parse fragment {fragment_id} in shard {shard['key']}"
                )
            if geometry.IsEmpty() or geometry.GetArea() <= 0 or not geometry.IsValid():
                raise RuntimeError(
                    f"OGR topology validation failed for fragment {fragment_id} in shard {shard['key']}"
                )
            validated += 1
            area += geometry.GetArea()
    if validated != index["fragmentCount"]:
        raise RuntimeError(
            f"OGR validated {validated} fragments, index declares {index['fragmentCount']}"
        )
    print(
        json.dumps(
            {
                "gdalVersion": gdal.VersionInfo("RELEASE_NAME"),
                "validatedFragments": validated,
                "fragmentAreaDegrees2": area,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
