/*
 * Page logic: region picker + globe, suspect cards, and the case file.
 *
 * The case file runs in three steps, in this order and no other:
 *
 *   1. MECHANISM  what should happen, and why — stated before any data is on
 *                 screen. The visitor commits to a prediction here.
 *   2. EVIDENCE   the cell map and the regional series, with the fitted trend
 *                 line withheld. The visitor inspects cells, builds a short
 *                 notebook, and commits to a verdict for the region.
 *   3. READING    only now the official verdict, the numbers, how their two
 *                 calls compared, what the result means and what would
 *                 overturn it.
 *
 * Nothing here computes a statistic — it only displays what the files say.
 * The point of the ordering is that a verdict you predicted and then tested
 * is a thing you understand, and a verdict handed to you on arrival is a
 * thing you scroll past.
 */

const VL = {
  confirmed: "CONFIRMED",
  case_open: "CASE OPEN",
  no_evidence: "NO EVIDENCE",
};

const VLS = {
  confirmed: "Confirmed",
  case_open: "Case open",
  no_evidence: "No evidence",
};

let RK = null, // chosen region
  VK = null, // chosen suspect
  D = null, // { map, series } for the open case
  SEL = null, // the clicked cell, or null for the regional view
  STEP = 1, // which of the three steps is open
  mapH = null, // EarthX map handle
  chartH = null, // EarthX chart handle
  lastFocus = null,
  pushed = false;

// What the visitor has done, per region + suspect. Kept in memory only: a
// reload starts a fresh investigation, which is the honest default for a
// page that asks people to commit to a guess.
const BOARD = {}; // "sah_p" -> { pred, call, verdict, dir, skipped }
const NOTE = {}; // "sah_p" -> [cells inspected, in click order]

function bkey(rk, vk) {
  return rk + "_" + vk;
}
function entry(rk, vk) {
  return BOARD[bkey(rk, vk)] || null;
}
function notebook(rk, vk) {
  const k = bkey(rk, vk);
  if (!NOTE[k]) NOTE[k] = [];
  return NOTE[k];
}

/* ---------- region picker ---------- */
function renderRegions() {
  const box = $("#regions");
  box.innerHTML = "";
  Object.entries(REG).forEach(([k, r]) => {
    const b = E("button", r.n);
    b.className = "chip";
    b.dataset.k = k;
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => selectRegion(k);
    box.append(b);
  });
}

function selectRegion(k) {
  RK = k;
  document
    .querySelectorAll("#regions .chip")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
  const r = REG[k];
  Globe.flyTo(r.la, r.lo, r.n);
  $("#gcap").innerHTML =
    `<b>${r.n}</b><span>${r.la.toFixed(2)}° , ${r.lo.toFixed(2)}° · ${r.b}</span>`;
  $("#pick").textContent =
    "Region locked in. Now pick a suspect — each one opens a three-step investigation.";
  renderVars();
  scrollToVars();
}

/*
 * Picking a region is the end of the first decision, so the page moves on to
 * the second one rather than leaving it below the fold. After the cards have
 * been rebuilt, so the section is its full height before the scroll measures
 * where it ends up.
 */
function scrollToVars() {
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => {
    $("#vars").scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "start",
    });
  });
}

/* ---------- suspect cards, with their board status ---------- */
function statusOf(vk) {
  if (!RK) return null;
  const e = entry(RK, vk);
  if (!e) return null;
  if (e.verdict) {
    return {
      cls: "closed",
      text: e.skipped ? "Read · " + VLS[e.verdict] : "Closed · " + VLS[e.verdict],
    };
  }
  if (e.pred) return { cls: "open", text: "In progress" };
  return null;
}

function renderVars() {
  const g = $("#vgrid");
  g.innerHTML = "";
  FLOW.forEach((vk, i) => {
    const v = VAR[vk];
    const st = statusOf(vk);
    const c = E("article");
    c.className = "vcard" + (RK ? "" : " off");
    c.dataset.v = vk;
    c.innerHTML =
      `<div class="vtop"><span class="vnum">0${i + 1}</span><span class="vrole">${v.role}</span></div>
      <h3>${v.n}</h3>
      <p class="vq">${RK ? v.q(REG[RK].s) : "Pick a region above to open this case."}</p>
      <p class="vd">${v.d}</p>
      <p class="vwhy"><b>Why:</b> ${v.w}</p>` +
      (st ? `<p class="vstatus ${st.cls}">${st.text}</p>` : "");
    const b = E("button", RK ? (st ? "Reopen the case →" : "Open the case →") : "Pick a region first");
    b.className = "btn p";
    b.disabled = !RK;
    c.append(b);
    c.onclick = () => (RK ? openResults(vk) : nudge());
    g.append(c);
  });
  renderProgress();
  refreshAvailability();
}

function renderProgress() {
  const el = $("#vprog");
  if (!el) return;
  if (!RK) {
    el.textContent = "";
    return;
  }
  const done = FLOW.filter((vk) => entry(RK, vk) && entry(RK, vk).verdict).length;
  el.textContent =
    done === 0
      ? `Four suspects in ${REG[RK].n}. None investigated yet.`
      : `${done} of ${FLOW.length} suspects closed in ${REG[RK].n}.`;
}

/*
 * Grey out a suspect whose results files are not on disk yet, so nobody
 * works through a mechanism and a prediction only to hit a 404. The probe is
 * a HEAD request, and an unreachable server counts as available on purpose.
 */
async function refreshAvailability() {
  if (!RK) return;
  const rk = RK;
  for (const vk of FLOW) {
    const ok = await probeCase(rk, vk);
    if (rk !== RK) return; // the region changed while we were asking
    if (ok) continue;
    const card = document.querySelector(`.vcard[data-v="${vk}"]`);
    if (!card) continue;
    card.classList.add("pending");
    if (!card.querySelector(".vstatus")) {
      const p = E("p", "Awaiting data");
      p.className = "vstatus wait";
      card.insertBefore(p, card.querySelector(".btn"));
    }
  }
}

function nudge() {
  $("#start").scrollIntoView({ behavior: "smooth", block: "start" });
  const box = $("#regions");
  box.classList.remove("flash");
  void box.offsetWidth;
  box.classList.add("flash");
}

/* ---------- the verdict block ---------- */
/*
 * Takes whichever object is in scope: the regional series file, or one cell
 * from the map file. They carry the same statistics fields, which is the
 * whole point of the agreed format.
 */
function verdictHTML(o, where, text, delay) {
  const n = EarthX.num;
  const sign = o.slope_per_decade > 0 ? "+" : "";
  const unit = D.series.unit || "";

  // The files currently carry years_to_significance as null everywhere,
  // case-open cells included. Say so rather than printing "~null yrs".
  let need = "—";
  if (o.verdict === "case_open") {
    need =
      o.years_to_significance != null
        ? "~" + o.years_to_significance + " yrs"
        : "not yet given";
  }

  return `<span class="stamp s-${o.verdict}" style="--d:${delay}">${VL[o.verdict]}</span>
<div class="nums">
<div><b>${sign}${n(o.slope_per_decade)}</b>${unit} per decade</div>
<div><b>${EarthX.pnum(o.p_value)}</b>p-value</div>
<div><b>${need}</b>more data needed</div>
<div><b>${n(o.ci_low)} to ${n(o.ci_high)}</b>95% range</div></div>
<p class="vtext">${where}: <b>${text}</b></p>`;
}

function showRegional(delay) {
  SEL = null;
  const s = D.series;
  const vd = $("#vd");
  if (!vd) return;
  vd.innerHTML = verdictHTML(
    s,
    `Averaged over all ${D.map.cells.length} cells in ${REG[RK].n}`,
    s.verdict_text || "—",
    delay || "0s",
  );
  $("#scopelbl").textContent = "— the regional average";
  $("#scopeback").hidden = true;
}

function showCell(cell) {
  SEL = cell;
  const vd = $("#vd");
  if (!vd) return;
  vd.innerHTML = verdictHTML(
    cell,
    "This grid cell at " + posOf(cell),
    cellVerdictText(cell),
    "0s",
  );
  $("#scopelbl").textContent = "— one grid cell";
  $("#scopeback").hidden = false;
}

function posOf(cell) {
  return (
    Math.abs(cell.lat).toFixed(2) +
    (cell.lat >= 0 ? "°N" : "°S") +
    ", " +
    Math.abs(cell.lon).toFixed(2) +
    (cell.lon >= 0 ? "°E" : "°W")
  );
}

/* ---------- which series the chart is showing ---------- */
/*
 * The chart follows the map. Click a cell and it draws that cell's own 25
 * years; the regional average is one button away and is what the page opens
 * on, because the regional verdict is what the case is about.
 *
 * The months come from the cell series file, which is 1.4-2.8 MB and so is
 * fetched on the first click rather than when the case opens. `chartToken`
 * guards the gap: click three cells quickly and only the last one's data is
 * allowed to land.
 */
let chartCell = null; // the cell the chart is on, or null for the region
let chartToken = 0;

function chartScopeHTML(state, cell) {
  if (state === "loading") {
    return `<span class="csnow">Loading this cell's 45 years…</span>`;
  }
  if (state === "missing") {
    return `<span class="csnow">No monthly series on file for this suspect, so the
      chart stays on the regional average.</span>`;
  }
  if (state === "cell") {
    return `<span class="csnow"><b>One grid cell</b> — ${posOf(cell)}</span>
      <button class="csback" id="csback">← the regional average</button>`;
  }
  return `<span class="csnow"><b>Regional average</b> — all ${D.map.cells.length}
    cells in ${REG[RK].n}</span>
    <span class="cshint">click any cell on the map for its own 45 years</span>`;
}

function setChartScope(state, cell) {
  const el = $("#chartscope");
  if (!el) return;
  el.innerHTML = chartScopeHTML(state, cell);
  const back = $("#csback");
  if (back) back.onclick = () => showRegionalChart();
}

function showRegionalChart() {
  chartCell = null;
  chartToken++;
  if (mapH) mapH.clearSelection();
  if (chartH) chartH.setData(D.series);
  setChartScope("region");
  renderNotebook();
  if (STEP >= 3) showRegional("0s");
}

async function showCellChart(cell) {
  if (!chartH) return;
  const token = ++chartToken;
  chartCell = cell;
  setChartScope("loading", cell);
  renderNotebook(); // move the highlight to this cell's row straight away

  const store = await loadCellSeries(RK, VK);
  if (token !== chartToken) return; // a later click already won

  const file = cellAsSeriesFile(cell, store, D.series);
  if (!file) {
    setChartScope("missing", cell);
    return;
  }
  chartH.setData(file);
  setChartScope("cell", cell);
}

/* ---------- step 2: the notebook ---------- */
/*
 * Every cell the visitor clicks lands here. It is the record of the work they
 * did, it is what unlocks the call at the end of step 2, and the tally under
 * it is the one honest way to answer "how much of this region agrees" without
 * eyeballing a colour wash.
 */
function addToNotebook(cell) {
  const list = notebook(RK, VK);
  const already = list.findIndex((c) => c.lat === cell.lat && c.lon === cell.lon);
  if (already >= 0) list.splice(already, 1); // re-clicking moves it to the top
  list.unshift(cell);
  if (list.length > 8) list.pop();
  renderNotebook();
}

function renderNotebook() {
  const box = $("#nblist");
  if (!box) return;
  const list = notebook(RK, VK);
  const unit = D.series.unit || "";
  const n = EarthX.num;

  $("#nbcount").textContent =
    list.length === 1 ? "1 cell" : list.length + " cells";

  box.innerHTML = list.length
    ? list
        .map((c, i) => {
          const sign = c.slope_per_decade > 0 ? "+" : "";
          const on = chartCell && chartCell.lat === c.lat && chartCell.lon === c.lon;
          return `<li>
            <button class="nbrow${on ? " on" : ""}" data-nb="${i}"
              title="Show this cell's 45 years on the chart">
            <span class="nbv v-${c.verdict}">${VLS[c.verdict]}</span>
            <span class="nbrate">${sign}${n(c.slope_per_decade)} ${unit}/dec</span>
            <span class="nbpos">${posOf(c)}</span>
            <span class="nbp">p = ${EarthX.pnum(c.p_value)}</span>
          </button></li>`;
        })
        .join("")
    : `<li class="nbempty">Empty. Click any cell on the map and it lands here —
       the verdict, the rate and the p-value for that one square of ground, and
       its own 45 years on the chart.</li>`;

  // a row puts its cell back on the chart and back under the outline
  box.querySelectorAll("[data-nb]").forEach((b) => {
    b.onclick = () => {
      const c = notebook(RK, VK)[Number(b.dataset.nb)];
      if (!c) return;
      if (mapH) mapH.select(c.lat, c.lon);
      showCellChart(c);
      if (STEP >= 3) showCell(c);
    };
  });

  // the tally: what the whole region is made of, counted rather than guessed
  const t = mapH ? mapH.counts() : null;
  const tally = $("#nbtally");
  if (t && tally) {
    const pct = (x) => Math.round((100 * x) / Math.max(t.total, 1));
    tally.innerHTML = `<b>All ${t.total} cells:</b>
      <span class="v-confirmed">${t.confirmed} confirmed (${pct(t.confirmed)}%)</span>
      <span class="v-case_open">${t.case_open} case open (${pct(t.case_open)}%)</span>
      <span class="v-no_evidence">${t.no_evidence} no evidence (${pct(t.no_evidence)}%)</span>`;
  }

  const need = Math.max(0, 2 - list.length);
  const note = $("#callnote");
  const buttons = document.querySelectorAll("#callbox .choice");
  if (note) {
    note.textContent = need
      ? `Inspect ${need} more cell${need > 1 ? "s" : ""} before you call it. The map is the evidence; the stamp comes after.`
      : "Your call. The regional average is one number over every cell — it can disagree with the majority of them.";
  }
  buttons.forEach((b) => (b.disabled = need > 0));
}

/* ---------- the two calls the visitor makes ---------- */
function recordPrediction(dir) {
  const k = bkey(RK, VK);
  BOARD[k] = Object.assign({}, BOARD[k], { pred: dir });
  document.querySelectorAll("#predict .choice").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.pred === dir));
  });
  const v = VAR[VK];
  $("#s1done").hidden = false;
  $("#s1recorded").innerHTML =
    `Recorded: you expect <b>${v.opts[dir].toLowerCase()}</b>. That is now on the record, and the evidence does not know about it.`;
}

function recordCall(call) {
  const k = bkey(RK, VK);
  BOARD[k] = Object.assign({}, BOARD[k], { call: call });
  document.querySelectorAll("#callbox .choice").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.call === call));
  });
  $("#s2done").hidden = false;
  $("#s2recorded").innerHTML =
    `Recorded: you call it <b>${VLS[call].toLowerCase()}</b> for ${REG[RK].n}.`;
}

/*
 * How the two calls compared. Written to teach rather than to score: reading
 * the direction right and the confidence wrong is the normal outcome and the
 * more interesting half, so it does not get called a failure.
 */
function scoreHTML() {
  const e = entry(RK, VK) || {};
  const v = VAR[VK];
  const s = D.series;
  const dir = directionOf(s);
  const rows = [];

  if (e.pred) {
    const hit = e.pred === dir;
    rows.push(`<div class="scrow ${hit ? "hit" : "miss"}">
      <span class="sclab">Mechanism</span>
      <span class="scbody">You expected <b>${v.opts[e.pred].toLowerCase()}</b>; this dataset says
      <b>${v.opts[dir].toLowerCase()}</b>.${
        hit
          ? " The mechanism and the record agree here."
          : " The mechanism is not wrong — it is competing with something stronger in this region, and that is what the reading below is about."
      }</span></div>`);
  }

  if (e.call) {
    const hit = e.call === s.verdict;
    rows.push(`<div class="scrow ${hit ? "hit" : "miss"}">
      <span class="sclab">Confidence</span>
      <span class="scbody">You called it <b>${VLS[e.call].toLowerCase()}</b>; the test returns
      <b>${VLS[s.verdict].toLowerCase()}</b>.${
        hit
          ? " You read the strength of the evidence, not just its direction."
          : " Worth knowing: the regional average is a single series over every cell, so it can land somewhere no individual cell does."
      }</span></div>`);
  }

  if (!rows.length) {
    rows.push(`<div class="scrow"><span class="sclab">Skipped</span>
      <span class="scbody">You came straight to the result. The two steps above are
      still there if you want to test yourself against the next suspect.</span></div>`);
  }

  return rows.join("");
}

/* ---------- step machine ---------- */
function setStep(n, opts) {
  const o = opts || {};
  STEP = n;
  for (const i of [1, 2, 3]) {
    const card = $("#s" + i);
    if (card) card.hidden = i > n;
  }
  document.querySelectorAll("#steps .step").forEach((li) => {
    const i = Number(li.dataset.step);
    li.classList.toggle("on", i === n);
    li.classList.toggle("done", i < n);
    li.classList.toggle("locked", i > n);
  });

  if (n >= 2) mountEvidence();
  if (n >= 3) mountReading();

  if (!o.silent) {
    const target = $("#s" + n);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/*
 * The map and chart are built the first time step 2 opens, not before: both
 * need a container with a real size, and a Leaflet map created inside a
 * hidden element comes up as a grey square.
 */
let mounted2 = false;
function mountEvidence() {
  if (mounted2) return;
  mounted2 = true;

  if (!window.L || !window.Plotly) {
    $(".evid").innerHTML = `<div class="evid-foot" style="margin:0">
      <b>The map and chart could not load.</b> They need the Leaflet and Plotly
      libraries, which this network appears to be blocking. Every number in the
      reading below comes from the results files directly and is unaffected.</div>`;
    renderNotebook();
    document
      .querySelectorAll("#callbox .choice")
      .forEach((b) => (b.disabled = false));
    const note = $("#callnote");
    if (note)
      note.textContent =
        "With no map to read, make the call from the series description and move on.";
    return;
  }

  mapH = EarthX.initMap($("#xmap"), D.map, {
    title: VAR[VK].n,
    // on a narrow screen the key covers the cells it describes, so it starts
    // folded away there and the visitor opens it with its own button
    legendOpen: window.innerWidth > 900,
    onCellClick: (cell) => {
      addToNotebook(cell);
      showCellChart(cell);
      if (STEP >= 3) showCell(cell);
    },
    onBasemapUnavailable: () => {
      const t = $("#tilenote");
      if (t) t.hidden = false;
    },
    onFilterChange: (f, shown, total) => {
      const el = $("#filtnote");
      if (!el) return;
      el.hidden = shown === total;
      el.textContent =
        shown === total
          ? ""
          : `Filtered: ${shown} of ${total} cells on the map. The tally and every number below still cover all ${total}.`;
    },
  });

  // the fitted line stays off until step 3 — it is the answer
  chartH = EarthX.initChart($("#xchart"), D.series, {
    title: VAR[VK].n,
    showHeader: false,
    showTrend: false,
  });

  setChartScope("region");

  // once now, so the notebook is never briefly an empty <ul>, and again after
  // a frame, when the map and chart know their real size
  renderNotebook();
  requestAnimationFrame(() => {
    if (mapH) mapH.invalidateSize();
    if (chartH) chartH.resize();
    renderNotebook();
  });
}

let mounted3 = false;
function mountReading() {
  if (mounted3) return;
  mounted3 = true;
  // The reading is about the region, so step 3 opens on the region however the
  // visitor left the evidence. They can go back to any cell from the map or
  // the notebook straight afterwards.
  chartCell = null;
  chartToken++;
  if (mapH) mapH.clearSelection();
  if (chartH) {
    chartH.setTrendVisible(true);
    chartH.setData(D.series);
  }
  setChartScope("region");

  $("#score").innerHTML = scoreHTML();
  showRegional(".2s");
  const sb = $("#scopeback");
  if (sb) sb.onclick = () => showRegionalChart();

  const k = bkey(RK, VK);
  BOARD[k] = Object.assign({}, BOARD[k], {
    verdict: D.series.verdict,
    dir: directionOf(D.series),
  });
  renderBoardStrip();
  renderVars(); // the landing page cards carry the outcome now
}

function renderBoardStrip() {
  const el = $("#bstrip");
  if (!el || !RK) return;
  el.innerHTML = FLOW.map((vk) => {
    const e = entry(RK, vk);
    const cls = e && e.verdict ? "b-" + e.verdict : e && e.pred ? "b-open" : "b-none";
    const label = e && e.verdict ? VLS[e.verdict] : e && e.pred ? "started" : "not opened";
    return `<button class="bchip ${cls}${vk === VK ? " cur" : ""}" data-v="${vk}"
      title="${VAR[vk].n} — ${label}">${VAR[vk].n}</button>`;
  }).join("");
  el.querySelectorAll("[data-v]").forEach((b) => {
    b.onclick = () => openResults(b.dataset.v);
  });
}

/* ---------- the case file ---------- */
async function openResults(vk) {
  VK = vk;
  const v = VAR[vk],
    r = REG[RK];

  // tear down the previous case's map and chart before their containers go
  if (mapH) {
    mapH.destroy();
    mapH = null;
  }
  if (chartH) {
    chartH.destroy();
    chartH = null;
  }
  mounted2 = false;
  mounted3 = false;
  SEL = null;

  $("#rmeta").innerHTML =
    `<span class="dot"></span>${r.n} · ${v.n}` +
    `<span class="tabs">${FLOW.map(
      (k) =>
        `<button class="tab${k === vk ? " on" : ""}" data-v="${k}">${VAR[k].n}</button>`,
    ).join("")}</span>`;

  $("#rbody").innerHTML =
    `<div class="wrap"><p class="loading">Opening the case file for ${r.n} · ${v.n}…</p></div>`;
  show();
  $("#results").scrollTop = 0;

  let loaded;
  try {
    loaded = await loadCase(RK, vk);
  } catch (err) {
    $("#rbody").innerHTML = pendingHTML(err, r, v);
    wireButtons();
    return;
  }
  if (VK !== vk || !loaded) return; // a faster tab click won the race
  D = loaded;

  $("#rbody").innerHTML = caseHTML(r, v);

  // step 1
  document.querySelectorAll("#predict .choice").forEach((b) => {
    b.onclick = () => recordPrediction(b.dataset.pred);
  });
  $("#to2").onclick = () => setStep(2);
  $("#skip").onclick = () => {
    BOARD[bkey(RK, VK)] = Object.assign({}, BOARD[bkey(RK, VK)], {
      skipped: true,
    });
    setStep(3);
  };

  // step 2
  document.querySelectorAll("#callbox .choice").forEach((b) => {
    b.onclick = () => recordCall(b.dataset.call);
  });
  $("#to3").onclick = () => setStep(3);

  document.querySelectorAll("#steps .step").forEach((li) => {
    li.onclick = () => {
      const i = Number(li.dataset.step);
      if (i <= STEP) setStep(i);
    };
  });

  renderBoardStrip();
  wireButtons();

  // a case already read through opens at its reading, not back at step 1
  const e = entry(RK, vk);
  if (e && e.verdict) {
    if (e.pred) recordPrediction(e.pred);
    if (e.call) recordCall(e.call);
    setStep(3, { silent: true });
  } else {
    setStep(1, { silent: true });
  }
}

function caseHTML(r, v) {
  const e = entry(RK, VK) || {};
  const choice = (dir) =>
    `<button class="choice" data-pred="${dir}" aria-pressed="${e.pred === dir}">${v.opts[dir]}</button>`;
  const callBtn = (c) =>
    `<button class="choice" data-call="${c}" aria-pressed="${e.call === c}" disabled>${VLS[c]}</button>`;

  return `<div class="wrap">
  <header class="rhead">
    <p class="eyebrow">Case file · ${r.n} · ${v.role} · 1981–2025 · monthly · 0.75° grid</p>
    <h1 id="rq">${v.q(r.s)}</h1>
    <p class="rsub">${v.d}</p>
    <div class="bstrip" id="bstrip"></div>
  </header>

  <ol class="steps" id="steps">
    <li class="step on" data-step="1"><b>1</b> Mechanism</li>
    <li class="step locked" data-step="2"><b>2</b> Evidence</li>
    <li class="step locked" data-step="3"><b>3</b> Reading</li>
  </ol>

  <!-- ---------------- step 1 · mechanism ---------------- -->
  <section class="card stepcard" id="s1">
    <h3 class="ch">Step 1 · The mechanism <span class="scope-note">— what should happen, and why</span></h3>
    <p class="mech">${v.mech}</p>
    <div class="askbox">
      <p class="askq">${v.ask}</p>
      <div class="choices" id="predict">
        ${choice("up")}${choice("down")}${choice("flat")}
      </div>
      <p class="asknote">No data has loaded yet. Commit to one — a prediction you
      have to defend is what makes the next screen worth reading, and being wrong
      here is the most informative thing that can happen.</p>
      <div class="stepdone" id="s1done" hidden>
        <p id="s1recorded"></p>
        <button class="btn p" id="to2">Open the evidence →</button>
      </div>
      <p class="skipline"><button class="linkbtn" id="skip">Skip the investigation and show me the result</button></p>
    </div>
  </section>

  <!-- ---------------- step 2 · evidence ---------------- -->
  <section class="card stepcard" id="s2" hidden>
    <h3 class="ch">Step 2 · The evidence <span class="scope-note">— no verdict yet</span></h3>
    <p class="rsub">Every square is one 0.75° cell, tested on its own. Colour is
    direction and rate; pattern is confidence. Hover to read a cell; <b>click one and
    the chart switches to that cell's own 45 years</b> and the cell lands in your
    notebook. Use the key at the bottom right of the map to hide whole classes of
    cell or filter out the slow ones.</p>
    <div class="evid">
      <div id="xmap"></div>
      <div class="chartwrap">
        <div class="chartscope" id="chartscope"></div>
        <div id="xchart"></div>
      </div>
      <div class="evid-foot">
        Forest green is rising, terracotta is falling, and a stronger colour means
        a faster change. Solid is confirmed, hatched is case open, faded is no
        evidence. On the chart, monthly values are in grey and the annual means the
        test actually ran on are in dark green — for the region, or for whichever
        cell you last clicked. <b>The fitted trend line is deliberately missing:</b>
        it is the answer, and it arrives in step 3.
        <span id="tilenote" hidden>· Basemap tiles could not load here, so the map
        is showing a latitude and longitude grid instead.</span>
        <span id="filtnote" hidden></span>
      </div>
    </div>

    <div class="nbook">
      <div class="nbhead">Your notebook <span class="nbn" id="nbcount">0 cells</span></div>
      <ul class="nblist" id="nblist"></ul>
      <div class="nbtally" id="nbtally"></div>
    </div>

    <div class="askbox">
      <p class="askq">On that evidence, what is the verdict for ${r.n} as a whole?</p>
      <div class="choices" id="callbox">
        ${callBtn("confirmed")}${callBtn("case_open")}${callBtn("no_evidence")}
      </div>
      <p class="asknote" id="callnote"></p>
      <div class="stepdone" id="s2done" hidden>
        <p id="s2recorded"></p>
        <button class="btn p" id="to3">See the reading →</button>
      </div>
    </div>
  </section>

  <!-- ---------------- step 3 · reading ---------------- -->
  <div id="s3" hidden>
    <section class="card verdict"><h3 class="ch">Step 3 · The reading
      <span class="scope-note" id="scopelbl">— the regional average</span>
      <button class="scope-back" id="scopeback" hidden>← back to the regional average</button>
    </h3><div id="vd"></div></section>

    <section class="card"><h3 class="ch">Your two calls</h3>
      <div class="score" id="score"></div>
    </section>

    <div class="two">
      <section class="card"><h3 class="ch">What the test did</h3>
        <p>Mann-Kendall asks whether the yearly averages keep drifting one way more
        often than luck would explain. The Sen slope is the typical rate of that drift,
        and the p-value is the chance of seeing it if nothing were really changing.
        Below 0.05 the verdict is confirmed; a visible direction above it is case open;
        no direction at all is no evidence.</p></section>
      <section class="card"><h3 class="ch">Why it reads this way here</h3>
        <p>${READ[RK][VK]}</p></section>
    </div>

    <section class="card"><h3 class="ch">What would overturn this</h3>
      <p>${OVERTURN[D.series.verdict] || OVERTURN.no_evidence}</p></section>

    <div class="note"><b>Honest limits.</b> These are NASA monthly values retrieved
    through Giovanni, 1981–2025, averaged onto a 0.75° grid. Evapotranspiration and soil
    moisture are land-model outputs constrained by observations, not direct measurements.
    Neighbouring cells are not independent, so a cluster of confirmed cells is one piece of
    evidence, not many. Read every verdict on this page as a trend in this dataset rather
    than a settled fact about the region.</div>

    <div class="rnav">
      <button class="btn" data-close="1">← Back to the suspects</button>
      ${FLOW.filter((k) => k !== VK)
        .map(
          (k) =>
            `<button class="btn${k === nextSuspect() ? " p" : ""}" data-v="${k}">${
              k === nextSuspect() ? "Next suspect" : "Go to"
            }: ${VAR[k].n} →</button>`,
        )
        .join("")}
    </div>
  </div>
</div>`;
}

// the first suspect after this one that has not been read yet, for the nav
function nextSuspect() {
  const i = FLOW.indexOf(VK);
  const order = FLOW.slice(i + 1).concat(FLOW.slice(0, i));
  return order.find((k) => !(entry(RK, k) && entry(RK, k).verdict)) || order[0];
}

/*
 * No files for this suspect yet. This is a different thing from a broken file,
 * and it says so plainly, with the two paths the export needs to land at.
 */
function pendingHTML(err, r, v) {
  const p = casePaths(RK, VK);
  if (err && err.name === "MissingData") {
    return `<div class="wrap"><section class="card">
      <h3 class="ch">${v.n} · ${r.n} <span class="pill">awaiting data</span></h3>
      <p>The mechanism and the question for this suspect are written and wired up.
      What is missing is the run: this page builds every path from the short name
      <code>${VAR[VK].k}</code> in <code>js/data.js</code>, and expects two files.</p>
      <p class="rsub">Drop these in and the case opens with no other change:</p>
      <ul class="paths"><li><code>${p.map}</code> — one entry per 0.75° cell:
      <code>lat, lon, slope_per_decade, p_value, verdict, years_to_significance,
      ci_low, ci_high</code></li>
      <li><code>${p.series}</code> — the same statistics for the regional average,
      plus <code>series</code>: 540 monthly <code>{ date, value }</code> points</li>
      <li><code>${p.cells}</code> — optional, and what gives every cell its own
      graph: one shared <code>dates</code> array and one <code>values</code> array
      per cell. Without it the case still works and the chart stays regional.
      <code>tools/make_cell_series.py</code> builds it from the cleaned CSV.</li></ul>
      <p class="rsub">If the export names the variable something other than
      <code>${VAR[VK].k}</code>, change <code>k</code> on that suspect in
      <code>js/data.js</code> and the paths follow.</p>
      <div class="rnav"><button class="btn" data-close="1">← Back to the suspects</button>
      ${FLOW.filter((k) => k !== VK)
        .map((k) => `<button class="btn" data-v="${k}">${VAR[k].n} →</button>`)
        .join("")}</div>
    </section></div>`;
  }
  return `<div class="wrap"><section class="card">
    <h3 class="ch">Could not load this case</h3>
    <p>${err.message}</p>
    <p class="rsub">The page expects the two files for this region and suspect at
    <code>${p.map}</code> and <code>${p.series}</code>.</p>
    <div class="rnav"><button class="btn" data-close="1">← Back to the suspects</button></div>
  </section></div>`;
}

function wireButtons() {
  document
    .querySelectorAll("#results [data-v]")
    .forEach((b) => (b.onclick = () => openResults(b.dataset.v)));
  document
    .querySelectorAll("#results [data-close]")
    .forEach((b) => (b.onclick = () => closeResults()));
}

function show() {
  const el = $("#results");
  if (!el.hidden) return;
  lastFocus = document.activeElement;
  Globe.setPaused(true);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("on"));
  document.body.classList.add("locked");
  $("#back").focus();
  try {
    history.pushState({ r: 1 }, "");
    pushed = true;
  } catch (e) {
    pushed = false;
  }
}

function closeResults(fromPop) {
  const el = $("#results");
  if (el.hidden) return;
  el.classList.remove("on");
  document.body.classList.remove("locked");
  Globe.setPaused(false);
  setTimeout(() => (el.hidden = true), 260);
  if (lastFocus) lastFocus.focus();
  renderVars();
  if (pushed && !fromPop) {
    pushed = false;
    try {
      history.back();
    } catch (e) {}
  }
}

/* ---------- wiring ---------- */
$("#back").onclick = () => closeResults();
addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeResults();
});
addEventListener("popstate", () => {
  pushed = false;
  closeResults(true);
});

renderRegions();
renderVars();
