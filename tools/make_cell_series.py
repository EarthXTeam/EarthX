"""
Turn the cleaned TerraClimate CSVs into one compact per-cell series file per
region and variable, in the format the team's earthx.html demo exports:

    { variable, unit, region, dates: [...],
      cells: [ { lat, lon, values: [...] } ] }

`values` lines up with `dates`; a missing month stays null.

Only cells that appear in the matching grid map file are kept — those are the
only cells the site can show, and the rest are ocean with no values at all.
"""

import csv
import json
import os
import sys


def load_map_cells(map_path):
    with open(map_path, encoding="utf-8") as fh:
        data = json.load(fh)
    keys = set()
    for c in data["cells"]:
        keys.add((round(float(c["lat"]), 3), round(float(c["lon"]), 3)))
    return keys, data.get("unit")


def build(csv_path, map_path, out_path, decimals):
    keep, unit = load_map_cells(map_path)

    dates = []
    seen_dates = set()
    series = {}  # (lat, lon) -> { date -> value }

    with open(csv_path, encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        variable = None
        for row in reader:
            if variable is None:
                variable = row["variable"]
            t = row["time"]
            if t not in seen_dates:
                seen_dates.add(t)
                dates.append(t)
            key = (round(float(row["lat"]), 3), round(float(row["lon"]), 3))
            if key not in keep:
                continue
            raw = row["value"]
            if raw == "" or raw is None:
                value = None
            else:
                value = round(float(raw), decimals)
                # 12.0 serialises shorter as 12, and reads the same
                if value == int(value):
                    value = int(value)
            series.setdefault(key, {})[t] = value

    dates.sort()

    cells = []
    for (lat, lon), by_date in series.items():
        values = [by_date.get(d) for d in dates]
        # a cell with nothing in it is not worth shipping
        if all(v is None for v in values):
            continue
        cells.append({"lat": lat, "lon": lon, "values": values})

    cells.sort(key=lambda c: (c["lat"], c["lon"]))

    out = {
        "variable": variable,
        "unit": unit,
        "region": os.path.basename(csv_path).split("_")[0],
        "dates": dates,
        "cells": cells,
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))

    missing = len(keep) - len(cells)
    return len(cells), len(dates), missing, os.path.getsize(out_path)


def main():
    csv_dir, map_dir, out_dir, decimals = (
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        int(sys.argv[4]),
    )
    os.makedirs(out_dir, exist_ok=True)

    total = 0
    for name in sorted(os.listdir(csv_dir)):
        if not name.endswith(".csv"):
            continue
        region, variable = name.split("_")[0], name.split("_")[1]
        map_path = os.path.join(map_dir, f"{region}_{variable}_map.json")
        if not os.path.exists(map_path):
            print(f"  skip {name}: no map file")
            continue
        out_path = os.path.join(out_dir, f"cells_{region}_{variable}.json")
        n, d, missing, size = build(
            os.path.join(csv_dir, name), map_path, out_path, decimals
        )
        total += size
        print(
            f"  {os.path.basename(out_path):34s} {n:5d} cells x {d} months"
            f"  {size / 1048576:5.2f} MB"
            + (f"   [{missing} map cells had no series]" if missing else "")
        )
    print(f"  total {total / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
