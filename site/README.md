# EarthX — site

Static site. No build step, no server code. Open `index.html` through a local
web server (VS Code Live Server, or `python3 -m http.server`) — **not** by
double-clicking it, because the page fetches its data files and browsers block
`fetch` from `file://`.

## The shape of the site

The visitor picks a region, then picks one of **four suspects**. Each suspect
opens a case file that runs in three steps, in this order:

1. **Mechanism** — the physics that would produce a trend, written out before
   any data is on screen. The visitor commits to a prediction here.
2. **Evidence** — the grid-cell map and the series, **with the fitted trend
   line withheld**. They inspect cells — clicking one puts its own 45 years on
   the chart — build a short notebook, and call the verdict for the region
   themselves.
3. **Reading** — only now the test's verdict, the numbers, how their two calls
   compared, why it reads that way in this region, and what would overturn it.

Nothing on the page computes a statistic. It displays what the results files
say, and controls the order in which it says it.

## What runs the page

| File | Does |
| --- | --- |
| `js/data.js` | Regions, suspects, mechanism texts, readings, order. **Edit here first.** |
| `js/load.js` | Fetches and caches the two JSON files per case; probes for missing ones. |
| `js/earthx-map.js` | The grid-cell trend map, its collapsible key and its filters (Leaflet). |
| `js/earthx-chart.js` | The time series and trend, regional or per cell (Plotly). |
| `js/app.js` | Page logic: picker, globe, the three-step case file, notebook, board. |
| `js/globe.js`, `js/geo.js` | The rotating globe on the landing page. |
| `css/style.css` | The site. |
| `css/earthx.css` | The map and chart, plus a trimmed Leaflet stylesheet. |

Leaflet and Plotly load from a CDN (see the bottom of `index.html`), so the
page needs internet. If they are blocked the case file still shows every
verdict and number and says why the two panels are missing.

## The data

```
data/grid_maps/<region>_<variable>_map.json              one entry per 0.75° cell
data/regional_series/<region>_<variable>_regional.json   regional mean + 540 months
data/cell_series/cells_<region>_<variable>.json          540 months for every cell
```

`<region>` and `<variable>` come from `k` on each region and each variable in
`js/data.js`. Currently nine sets are present: `mediterranean`, `sahel`,
`amazon` × `ppt`, `aet`, `soil`, `temperature`. NASA via Giovanni (1981–2025), monthly. Values were converted at import to the units the site labels: mm per month for ppt/aet, % by volume for soil, °C for temperature (see tools/import_new_data.py).

### Every cell has its own graph

`data/cell_series/` holds the monthly series for every cell, so clicking a cell
on the map puts that cell's own 25 years on the chart, with its own fitted
trend in step 3. One file per region and variable:

```json
{ "variable": "ppt", "unit": "mm", "region": "sahel",
  "dates": ["1981-01-01", ...],
  "cells": [ { "lat": 10.125, "lon": -14.625, "values": [12.3, null, ...] } ] }
```

`values` lines up with `dates`, and a missing month stays `null`. This is the
format `earthx.html` exports, so files from either route are interchangeable.

These files are 1.4–2.8 MB each, so the page **fetches one only when somebody
first clicks a cell** — opening a case costs nothing extra. If the file is
absent the case still works and the chart simply stays on the regional average.

To rebuild them from the cleaned CSVs:

```
python3 tools/make_cell_series.py \
    <csv folder> site/data/grid_maps site/data/cell_series 2
```

The last argument is decimal places; 2 matches what `earthx.html` exports.
The script keeps only cells that appear in the matching map file, since those
are the only ones the map can show.

### Surface temperature

The fourth suspect's files are in this zip, with stem **`temperature`**:
`data/grid_maps/<region>_temperature_map.json`,
`data/regional_series/<region>_temperature_regional.json` and
`data/cell_series/cells_<region>_temperature.json`, unit `"°C"`, slopes in
°C per decade.

### Re-importing a new export

`tools/import_new_data.py <json_outputs dir> <raw csv> site/data` rebuilds all
three data folders from a fresh export: it lowercases the region stems,
converts NASA's native units (kg/m²/s, m³/m³, K) to the units the site labels
(mm per month, % by volume, °C), and regenerates the per-cell series from the
raw monthly CSV. Nothing in `js/` needs to change.

Until then the page handles the gap honestly rather than breaking: the
suspect's card is hatched and labelled *Awaiting data*, and opening it shows a
panel naming the two paths and the fields each file needs. The check is a
`HEAD` request per suspect, so it costs nothing.

**If the export calls the variable something else** — `tmp`, `tmean`, `lst` —
change `k` on the `t` entry in `js/data.js`. Every path on the site is built
from it.

## The map's key panel

Bottom right of the map. It is the thing the visitor reads the map with, so it
does more than label colours:

- **One button hides and shows the whole panel.** On a narrow screen it starts
  collapsed, because otherwise it sits on top of the cells it describes.
- **The three verdict rows are filters.** Click one to hide those cells; each
  row carries its cell count, so "how much of this region is actually
  confirmed" is a number rather than a squint.
- **The slider hides cells below a rate**, up to the ramp's own maximum.

Filtering changes the map only. The tally under the notebook and every number
in the reading always cover all cells, and a note appears on the map when the
two differ.

## Common edits

- **New region**: add an entry to `REG` and `READ` in `js/data.js` with its
  `k`, centre `la`/`lo` and blurb, then put its files in `data/`. The chip,
  the globe pin and the menus follow.
- **New suspect**: add an entry to `VAR` (including `mech`, `ask` and `opts`),
  add its row to `READ` for every region, and add its key to `FLOW`.
- **Change the order suspects are offered in**: edit `FLOW` in `js/data.js`.
- **Change a mechanism, reading, definition or question**: all text lives in
  `js/data.js`.
- **Change colours**: the site palette is in `:root` in `css/style.css`. The
  map's two ramps are `FALLING` and `RISING` at the top of `js/earthx-map.js`.

## Three things the page deliberately does not do

**It does not show the verdict first.** The stamp, the rate and the p-value
only exist in step 3. Step 2 draws the monthly series and the annual means and
leaves the fitted line off, because the fitted line is the answer.

**It does not recompute anything.** A cell's chart draws that cell's months
from `cell_series`, but every statistic beside it — the rate, the p-value, the
interval, the verdict, the fitted line — comes from the map file, already
computed. The page is a reader, not a second analysis.

**Colour and confidence are separate.** Colour is direction and rate. Verdict
is pattern: solid confirmed, hatched case open, faded no evidence. Nobody
should have to judge significance from how dark a square looks.

## Known gaps in the current data

- `years_to_significance` is `null` in every file, case-open cells included, so
  the "more data needed" tile reads "not yet given".
- Some cells are `confirmed` with a rate of exactly `0.0`. Sen's slope is a
  median of pairwise slopes and can land on zero while Mann-Kendall still finds
  a direction. Those cells say "a real direction, but a rate too small to
  measure" instead of claiming a direction they do not have.
- All three water variables report their unit as `mm`. Worth confirming that is
  right for soil water storage.

## Where the state lives

The predictions, the calls and the notebook are kept in memory for the session
only — a reload starts a fresh investigation. That is deliberate for a page
whose whole premise is committing to a guess before you look, but if you want
them to survive a refresh, `BOARD` and `NOTE` at the top of `js/app.js` are the
two objects to persist.
