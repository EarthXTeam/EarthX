/*
 * Loads the results files.
 *
 * Two files per region and variable:
 *   the map file     — one entry per 0.75° grid cell, no time series
 *   the series file  — the regional average, its statistics, and 300 months
 *
 * Each pair is fetched once and kept, so switching suspects and coming back
 * is instant. A map file is 330-515 KB, which is why they are fetched on
 * demand rather than all of them up front.
 */

const CASES = {}; // "mediterranean_ppt" -> { map, series }
const AVAIL = {}; // "mediterranean_ppt" -> true | false, once probed
const CELLS = {}; // "mediterranean_ppt" -> { dates, byCell } once fetched

function caseKey(rk, vk) {
  return REG[rk].k + "_" + VAR[vk].k;
}

function casePaths(rk, vk) {
  const key = caseKey(rk, vk);
  return {
    map: `data/grid_maps/${key}_map.json`,
    series: `data/regional_series/${key}_regional.json`,
    cells: `data/cell_series/cells_${key}.json`,
  };
}

/*
 * MissingData is thrown when a suspect has no files yet, as opposed to a file
 * that exists and is broken. The two need different things said about them:
 * one is waiting on an export, the other is a bug.
 */
class MissingData extends Error {
  constructor(rk, vk) {
    super("no results files for " + caseKey(rk, vk));
    this.name = "MissingData";
    this.rk = rk;
    this.vk = vk;
  }
}

async function loadCase(rk, vk) {
  const key = caseKey(rk, vk);
  if (CASES[key]) return CASES[key];
  const p = casePaths(rk, vk);

  const grab = async (path) => {
    const res = await fetch(path);
    if (res.status === 404) throw new MissingData(rk, vk);
    if (!res.ok) throw new Error(path + " — " + res.status);
    return res.json();
  };

  const [map, series] = await Promise.all([grab(p.map), grab(p.series)]);

  AVAIL[key] = true;
  CASES[key] = { map, series };
  return CASES[key];
}

/*
 * Is this suspect's data on disk? A HEAD request, so the 500 KB body never
 * travels. The answer is cached, and an unreachable server counts as "yes"
 * on purpose: better to try the real fetch and report that than to grey out a
 * card over one failed probe.
 */
async function probeCase(rk, vk) {
  const key = caseKey(rk, vk);
  if (key in AVAIL) return AVAIL[key];
  try {
    const res = await fetch(casePaths(rk, vk).map, { method: "HEAD" });
    AVAIL[key] = res.status !== 404;
  } catch (e) {
    AVAIL[key] = true;
  }
  return AVAIL[key];
}

/*
 * Every cell's own 45 years.
 *
 * One file per region and variable, 1.4-2.8 MB of it, holding one `values`
 * array per cell against a single shared `dates` array. That is why it is
 * fetched on the first cell click rather than when the case opens: most of
 * the evidence step costs nothing until somebody actually wants a curve.
 *
 * Returns null if the file is not there, which is not an error — a suspect
 * can perfectly well have its trends computed and its cell series not yet
 * exported. The chart stays on the regional average and says so.
 */
async function loadCellSeries(rk, vk) {
  const key = caseKey(rk, vk);
  if (key in CELLS) return CELLS[key];

  let data;
  try {
    const res = await fetch(casePaths(rk, vk).cells);
    if (res.status === 404) {
      CELLS[key] = null;
      return null;
    }
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    CELLS[key] = null;
    return null;
  }

  // Address cells the same way the map does: by coordinates rounded to three
  // decimals. A 0.75° grid built by averaging a finer one puts centres on
  // values like 35.625, and the two files must agree to the digit.
  const byCell = {};
  for (const c of data.cells) {
    byCell[cellSeriesKey(c.lat, c.lon)] = c.values;
  }

  CELLS[key] = { dates: data.dates, byCell: byCell, unit: data.unit };
  return CELLS[key];
}

function cellSeriesKey(lat, lon) {
  return Number(lat).toFixed(3) + "|" + Number(lon).toFixed(3);
}

/*
 * Dress one cell up as a series file, so the chart can draw it with exactly
 * the code that draws the regional average. The months come from the cell
 * series file; every statistic comes from the map file, already computed —
 * nothing here re-runs a test.
 */
function cellAsSeriesFile(cell, store, base) {
  if (!store) return null;
  const values = store.byCell[cellSeriesKey(cell.lat, cell.lon)];
  if (!values) return null;
  return {
    variable: base.variable,
    unit: base.unit || store.unit,
    region: base.region,
    place: "this grid cell",
    series: store.dates.map((d, i) => ({ date: d, value: values[i] })),
    slope_per_decade: cell.slope_per_decade,
    p_value: cell.p_value,
    ci_low: cell.ci_low,
    ci_high: cell.ci_high,
    verdict: cell.verdict,
    years_to_significance: cell.years_to_significance,
    verdict_text: cellVerdictText(cell),
  };
}

/*
 * The map file carries no verdict_text — only the regional series file does —
 * so a clicked cell needs its sentence built here, in the same words.
 *
 * A rate of exactly zero is not a rounding artefact: Sen's slope is a median
 * of pairwise slopes, and on data with many tied values that median can land
 * precisely on zero while Mann-Kendall still finds a direction. Saying
 * "rising" at 0.0 would be a lie, so those cells say what actually happened.
 */
function cellVerdictText(c) {
  const flat = c.slope_per_decade === 0;
  const dir = c.slope_per_decade > 0 ? "rising" : "falling";
  if (c.verdict === "confirmed") {
    return flat
      ? "a real direction, but a rate too small to measure"
      : dir + ", significant";
  }
  if (c.verdict === "case_open") {
    return flat
      ? "a hint of change, too small to put a rate on"
      : dir + ", not yet significant";
  }
  return "no clear trend";
}

// Which way a result points, in the same three buckets the visitor predicts in.
function directionOf(o) {
  if (!o || o.verdict === "no_evidence") return "flat";
  if (typeof o.slope_per_decade !== "number" || o.slope_per_decade === 0)
    return "flat";
  return o.slope_per_decade > 0 ? "up" : "down";
}
