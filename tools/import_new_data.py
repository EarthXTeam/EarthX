"""
Import the final 1981-2025 NASA results into the EarthX site WITHOUT changing
how the site works: same file names (lowercase region stems), same JSON keys,
same display units the site already labels.

  usage: import_new_data.py <json_outputs dir> <raw csv> <site/data dir>

Conversions (the files carry NASA's native units, the site labels mm / % / °C):
  ppt, aet     kg/m2/s -> mm per month   value x 86400 x days in that month
                                         slope, ci x 86400 x 30.4375
  soil         m3/m3   -> % by volume    x 100
  temperature  K       -> °C             value - 273.15; slope, ci unchanged

Also rebuilds data/cell_series/cells_<region>_<variable>.json from the raw CSV
in the team's own format: { variable, unit, region, dates, cells:[{lat,lon,values}] }.
"""
import csv, json, os, sys, calendar, shutil
from array import array
from collections import defaultdict

SRC, RAW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SEC = 86400.0
MONTH = 30.4375

VARS = {
    "ppt": dict(unit="mm", dec=2),
    "aet": dict(unit="mm", dec=2),
    "soil": dict(unit="% vol", dec=2),
    "temperature": dict(unit="°C", dec=2),
}


def days_in(date):
    y, m = int(date[:4]), int(date[5:7])
    return calendar.monthrange(y, m)[1]


def conv_value(var, v, date):
    if v is None:
        return None
    if var in ("ppt", "aet"):
        return v * SEC * days_in(date)
    if var == "soil":
        return v * 100.0
    if var == "temperature":
        return v - 273.15
    raise KeyError(var)


def conv_rate(var, v):
    if v is None:
        return None
    if var in ("ppt", "aet"):
        return v * SEC * MONTH
    if var == "soil":
        return v * 100.0
    return v


def tidy(v, dec):
    if v is None:
        return None
    r = round(v, dec)
    return int(r) if r == int(r) else r


# ---------------------------------------------------------------- stats files
for sub in ("grid_maps", "regional_series", "cell_series"):
    d = os.path.join(OUT, sub)
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)

keep = {}  # (region_lc, var) -> set of (lat, lon) rounded
for name in sorted(os.listdir(os.path.join(SRC, "grid_maps"))):
    if not name.endswith("_map.json"):
        continue
    region, var = name[:-len("_map.json")].split("_", 1)
    if var not in VARS:
        print("skip", name)
        continue
    rl = region.lower()
    d = json.load(open(os.path.join(SRC, "grid_maps", name)))
    cells = []
    for c in d["cells"]:
        if not isinstance(c.get("slope_per_decade"), (int, float)):
            continue
        cells.append({
            "lat": c["lat"], "lon": c["lon"],
            "slope_per_decade": conv_rate(var, c["slope_per_decade"]),
            "p_value": c["p_value"],
            "verdict": c["verdict"],
            "years_to_significance": c.get("years_to_significance"),
            "ci_low": conv_rate(var, c["ci_low"]),
            "ci_high": conv_rate(var, c["ci_high"]),
        })
    keep[(rl, var)] = {(round(c["lat"], 3), round(c["lon"], 3)) for c in cells}
    out = {"variable": var, "unit": VARS[var]["unit"], "region": rl,
           "period": d.get("period"), "cells": cells}
    json.dump(out, open(os.path.join(OUT, "grid_maps", f"{rl}_{var}_map.json"), "w"))

    r = json.load(open(os.path.join(SRC, "regional_series", f"{region}_{var}_regional.json")))
    series = [{"date": p["date"], "value": conv_value(var, p["value"], p["date"])} for p in r["series"]]
    reg = {
        "variable": var, "unit": VARS[var]["unit"], "region": rl,
        "slope_per_decade": conv_rate(var, r["slope_per_decade"]),
        "p_value": r["p_value"], "verdict": r["verdict"],
        "years_to_significance": r.get("years_to_significance"),
        "ci_low": conv_rate(var, r["ci_low"]), "ci_high": conv_rate(var, r["ci_high"]),
        "verdict_text": r["verdict_text"], "series": series,
    }
    json.dump(reg, open(os.path.join(OUT, "regional_series", f"{rl}_{var}_regional.json"), "w"))
    print(f"{rl}_{var}: {len(cells)} cells, {len(series)} months, regional {r['verdict']} "
          f"{reg['slope_per_decade']:+.3g} {VARS[var]['unit']}/decade")

# ---------------------------------------------------------------- cell series
# one pass over the raw CSV; dates are the first of the month, sorted
dates = []
seen = set()
store = defaultdict(lambda: defaultdict(lambda: None))  # (region,var) -> (lat,lon) -> array
with open(RAW, newline="") as f:
    rd = csv.reader(f)
    hdr = next(rd)
    ir, iv, ila, ilo, idt, ival = (hdr.index(k) for k in ("region", "variable", "lat", "lon", "date", "value"))
    # first pass: dates (cheap enough to collect while reading)
    rows_kept = 0
    for row in rd:
        var = row[iv]
        if var not in VARS:
            continue
        rl = row[ir].lower()
        key = (round(float(row[ila]), 3), round(float(row[ilo]), 3))
        if key not in keep.get((rl, var), ()):
            continue
        dt = row[idt]
        if dt not in seen:
            seen.add(dt); dates.append(dt)
        cell = store[(rl, var)]
        if cell[key] is None:
            cell[key] = {}
        cell[key][dt] = None if row[ival] == "" else float(row[ival])
        rows_kept += 1
dates.sort()
print("cell rows kept", rows_kept, "months", len(dates), dates[0], dates[-1])

total = 0
for (rl, var), cells in sorted(store.items()):
    dec = VARS[var]["dec"]
    out_cells = []
    for (lat, lon), by in cells.items():
        vals = [tidy(conv_value(var, by.get(d), d), dec) for d in dates]
        if all(v is None for v in vals):
            continue
        out_cells.append({"lat": lat, "lon": lon, "values": vals})
    out_cells.sort(key=lambda c: (c["lat"], c["lon"]))
    path = os.path.join(OUT, "cell_series", f"cells_{rl}_{var}.json")
    json.dump({"variable": var, "unit": VARS[var]["unit"], "region": rl,
               "dates": dates, "cells": out_cells}, open(path, "w"), separators=(",", ":"))
    size = os.path.getsize(path); total += size
    missing = len(keep[(rl, var)]) - len(out_cells)
    print(f"  cells_{rl}_{var}.json {len(out_cells):5d} cells x {len(dates)} months {size/1048576:5.2f} MB"
          + (f"  [{missing} map cells had no series]" if missing else ""))
print(f"  total {total/1048576:.1f} MB")
