#!/usr/bin/env python3
"""Stream OGR topology checks and emit only invalid polygon source-part IDs."""

import argparse
import json
from pathlib import Path

from osgeo import gdal, ogr


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def main():
    ogr.UseExceptions()
    gdal.PushErrorHandler("CPLQuietErrorHandler")
    args = parse_args()
    checked = 0
    invalid_count = 0
    seen_ids = set()
    input_path = Path(args.input)
    output_path = Path(args.output)

    with input_path.open("r", encoding="utf-8") as input_stream, output_path.open(
        "w", encoding="utf-8"
    ) as output_stream:
        for line_number, line in enumerate(input_stream, start=1):
            if not line.strip():
                continue
            record = json.loads(line)
            source_part_id = record.get("sourcePartId")
            if not isinstance(source_part_id, str) or not source_part_id:
                raise RuntimeError(f"Missing sourcePartId on input line {line_number}")
            if source_part_id in seen_ids:
                raise RuntimeError(f"Duplicate sourcePartId {source_part_id}")
            seen_ids.add(source_part_id)
            geometry = ogr.CreateGeometryFromJson(
                json.dumps(record.get("geometry"), separators=(",", ":"))
            )
            if geometry is None or geometry.IsEmpty():
                raise RuntimeError(f"OGR could not parse source part {source_part_id}")
            checked += 1
            if geometry.IsValid():
                continue

            invalid_count += 1
            output_stream.write(
                json.dumps(
                    {
                        "type": "invalid",
                        "sourcePartId": source_part_id,
                        "sourceGeometryValidity": "invalid",
                        "requiredRepairMethod": "gdal-make-valid-linework",
                        "originalAreaDegrees2": geometry.GetArea(),
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )

        output_stream.write(
            json.dumps(
                {
                    "type": "summary",
                    "gdalVersion": gdal.VersionInfo("RELEASE_NAME"),
                    "checkedSourcePartCount": checked,
                    "invalidSourcePartCount": invalid_count,
                },
                separators=(",", ":"),
            )
            + "\n"
        )
    gdal.PopErrorHandler()


if __name__ == "__main__":
    main()
