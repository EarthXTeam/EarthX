/*
 * EarthX — trend chart component
 *
 * Reads the regional series file: the regional average, its trend statistics,
 * and its 300 monthly points.
 *
 *   const chart = EarthX.initChart(document.getElementById('chart'), seriesFile,
 *                                  { showHeader: false, showTrend: false });
 *   chart.setTrendVisible(true);     // at the reading step
 *   chart.setData(anotherSeriesFile);
 *   chart.destroy();
 *
 * Requires Plotly 2.x on the page before this file.
 *
 * What it draws, and why:
 *   - the monthly series, faint, because 300 points of seasonal cycle is
 *     texture rather than information
 *   - the annual mean on top of it, solid, because that is what the trend
 *     test actually ran on
 *   - Sen's slope as the trend line
 *   - the slope confidence interval as a cone around it, which is the honest
 *     shape: the uncertainty is in the slope, so it widens away from the middle
 *
 * showTrend is OFF while the visitor is still reading the evidence. The
 * fitted line and its colour give the verdict away, and the whole point of
 * that step is that they reach a call themselves first.
 *
 * showHeader is off in this site: the verdict card already says the verdict,
 * the rate and the interval, and saying it twice on one screen reads as two
 * different claims rather than one.
 */
(function (global) {
  "use strict";

  var INK = "#22352a";
  var MONTHLY = "#b9c3b6";
  var ANNUAL = "#263b2d";
  var VERDICT_COLOR = {
    confirmed: "#2f5d3a",
    case_open: "#9d6f2e",
    no_evidence: "#7d8a7e",
  };
  var VERDICT_LABEL = {
    confirmed: "Confirmed",
    case_open: "Case open",
    no_evidence: "No evidence",
  };
  var BAND_FILL = {
    confirmed: "rgba(47,93,58,0.16)",
    case_open: "rgba(157,111,46,0.18)",
    no_evidence: "rgba(125,138,126,0.16)",
  };

  function prettyVariable(name) {
    var s = String(name || "").replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function prettyRegion(name) {
    return String(name || "")
      .replace(/_/g, "-")
      .replace(/\b[a-z]/g, function (m) {
        return m.toUpperCase();
      });
  }

  function prettyUnit(unit) {
    if (!unit) return "";
    if (unit === "mm_per_month") return "mm / month";
    if (unit === "kg/m2") return "kg / m²";
    return String(unit).replace(/_/g, " ");
  }

  function yearOf(dateStr) {
    return parseInt(String(dateStr).slice(0, 4), 10);
  }

  /*
   * Numbers for reading, not for storing. Real statistics output carries the
   * full float — +0.21951650238814693 — and nobody can read that from a
   * projector. Three significant figures, and never more than three decimals.
   */
  function num(v) {
    if (typeof v !== "number" || isNaN(v)) return String(v);
    var a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  function pval(p) {
    if (typeof p !== "number" || isNaN(p)) return String(p);
    if (p < 0.001) return "< 0.001";
    return p.toFixed(3);
  }

  // Monthly points -> one mean per calendar year, which is what the test used.
  function annualMeans(series) {
    var sums = {},
      counts = {};
    for (var i = 0; i < series.length; i++) {
      var v = series[i].value;
      if (v == null) continue; // missing months are skipped, never zeroed
      var y = yearOf(series[i].date);
      sums[y] = (sums[y] || 0) + v;
      counts[y] = (counts[y] || 0) + 1;
    }
    var years = Object.keys(sums)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    return years.map(function (y) {
      return { year: y, value: sums[y] / counts[y] };
    });
  }

  function buildTraces(data, withTrend) {
    var series = data.series || [];
    var unit = prettyUnit(data.unit);
    var annual = annualMeans(series);

    var traces = [];

    traces.push({
      x: series.map(function (p) {
        return p.date;
      }),
      y: series.map(function (p) {
        return p.value;
      }),
      type: "scattergl",
      mode: "lines",
      name: "Monthly",
      line: { color: MONTHLY, width: 1.2 },
      hovertemplate: "%{x|%b %Y}<br>%{y:.1f} " + unit + "<extra></extra>",
    });

    if (annual.length) {
      traces.push({
        x: annual.map(function (p) {
          return p.year + "-07-01";
        }),
        y: annual.map(function (p) {
          return p.value;
        }),
        type: "scatter",
        mode: "lines+markers",
        name: "Annual mean",
        line: { color: ANNUAL, width: 2.4 },
        marker: { size: 6, color: ANNUAL },
        hovertemplate: "%{x|%Y} average<br>%{y:.1f} " + unit + "<extra></extra>",
      });

      if (!withTrend) return traces;

      // The trend line and its cone, both drawn through the centre of the
      // record: slope uncertainty pivots about the middle, it does not
      // translate the whole line up and down.
      var y0 = annual[0].year;
      var y1 = annual[annual.length - 1].year;
      var midYear = (y0 + y1) / 2;
      var midValue =
        annual.reduce(function (a, p) {
          return a + p.value;
        }, 0) / annual.length;

      var slope = (data.slope_per_decade || 0) / 10; // per year
      var lo = (data.ci_low != null ? data.ci_low : data.slope_per_decade) / 10;
      var hi = (data.ci_high != null ? data.ci_high : data.slope_per_decade) / 10;

      var xs = [y0 + "-01-01", y1 + "-12-01"];
      function at(slopePerYear, yr) {
        return midValue + slopePerYear * (yr - midYear);
      }

      traces.push({
        x: [xs[0], xs[1], xs[1], xs[0]],
        y: [at(hi, y0), at(hi, y1), at(lo, y1), at(lo, y0)],
        type: "scatter",
        mode: "lines",
        name: "95% confidence",
        fill: "toself",
        fillcolor: BAND_FILL[data.verdict] || BAND_FILL.no_evidence,
        line: { width: 0 },
        hoverinfo: "skip",
      });

      traces.push({
        x: xs,
        y: [at(slope, y0), at(slope, y1)],
        type: "scatter",
        mode: "lines",
        name: "Trend",
        line: {
          color: VERDICT_COLOR[data.verdict] || INK,
          width: 3.4,
          dash: data.verdict === "confirmed" ? "solid" : "dash",
        },
        hovertemplate:
          "Trend: " +
          (data.slope_per_decade > 0 ? "+" : "") +
          num(data.slope_per_decade) +
          " " +
          unit +
          " / decade<extra></extra>",
      });
    }

    return traces;
  }

  function layoutFor(data, title) {
    var unit = prettyUnit(data.unit);
    var name = title || prettyVariable(data.variable);
    return {
      margin: { l: 64, r: 18, t: 10, b: 44 },
      height: null,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#fffdf8",
      font: { family: "Figtree, system-ui, sans-serif", size: 14, color: INK },
      xaxis: {
        type: "date",
        gridcolor: "rgba(38,59,45,0.10)",
        linecolor: "rgba(38,59,45,0.32)",
        ticks: "outside",
        tickfont: { size: 13 },
      },
      yaxis: {
        title: {
          text: name + " (" + unit + ")",
          font: { size: 14 },
        },
        gridcolor: "rgba(38,59,45,0.10)",
        zeroline: false,
        linecolor: "rgba(38,59,45,0.32)",
        ticks: "outside",
        tickfont: { size: 13 },
      },
      legend: {
        orientation: "h",
        y: 1.14,
        x: 0,
        font: { size: 13 },
        bgcolor: "rgba(0,0,0,0)",
      },
      hovermode: "x unified",
      showlegend: true,
    };
  }

  function headerHtml(data) {
    var color = VERDICT_COLOR[data.verdict] || INK;
    var unit = prettyUnit(data.unit);
    var sign = data.slope_per_decade > 0 ? "+" : "";
    var extra = "";
    if (data.verdict === "case_open" && data.years_to_significance != null) {
      extra =
        '<span class="earthx-chart-extra">about ' +
        data.years_to_significance +
        " more years of data would settle it</span>";
    }
    var ci =
      typeof data.ci_low === "number" && typeof data.ci_high === "number"
        ? '<span class="earthx-chart-ci"> (95% CI ' +
          num(data.ci_low) +
          " to " +
          num(data.ci_high) +
          ")</span>"
        : "";

    var text =
      data.verdict_text ||
      (data.verdict === "confirmed"
        ? "significant trend, p = " + pval(data.p_value)
        : "no statistically significant trend, p = " + pval(data.p_value));

    return (
      '<div class="earthx-chart-head">' +
      '<span class="earthx-badge" style="background:' +
      color +
      '">' +
      (VERDICT_LABEL[data.verdict] || data.verdict) +
      "</span>" +
      '<span class="earthx-chart-what">' +
      prettyVariable(data.variable) +
      ", " +
      (data.place || prettyRegion(data.region)) +
      "</span>" +
      '<span class="earthx-chart-rate">' +
      sign +
      num(data.slope_per_decade) +
      " " +
      unit +
      " per decade" +
      ci +
      "</span>" +
      "</div>" +
      '<div class="earthx-chart-verdict">' +
      text +
      extra +
      "</div>"
    );
  }

  function initChart(el, data, options) {
    var Plotly = global.Plotly;
    if (!Plotly)
      throw new Error(
        "EarthX.initChart: Plotly (window.Plotly) must be loaded first.",
      );
    if (!el) throw new Error("EarthX.initChart: no container element.");

    var opts = options || {};
    var withHeader = opts.showHeader === true;
    var withTrend = opts.showTrend !== false;
    var current = null;

    el.classList.add("earthx-chart");
    el.innerHTML =
      (withHeader ? '<div class="earthx-chart-text"></div>' : "") +
      '<div class="earthx-chart-plot"></div>';
    var textEl = withHeader ? el.querySelector(".earthx-chart-text") : null;
    var plotEl = el.querySelector(".earthx-chart-plot");

    var config = {
      displayModeBar: opts.showToolbar !== false,
      modeBarButtonsToRemove: [
        "select2d",
        "lasso2d",
        "autoScale2d",
        "toggleSpikelines",
      ],
      displaylogo: false,
      responsive: true,
    };

    function render() {
      if (!current) return;
      if (textEl) textEl.innerHTML = headerHtml(current);
      Plotly.react(
        plotEl,
        buildTraces(current, withTrend),
        layoutFor(current, opts.title),
        config,
      );
    }

    function setData(seriesFile) {
      if (!seriesFile || !seriesFile.series) {
        throw new Error(
          "EarthX.initChart: expected a series object with .series",
        );
      }
      current = seriesFile;
      render();
      return handle;
    }

    var handle = {
      setData: setData,
      setTrendVisible: function (on) {
        var next = !!on;
        if (next === withTrend) return handle;
        withTrend = next;
        render();
        return handle;
      },
      resize: function () {
        Plotly.Plots.resize(plotEl);
      },
      destroy: function () {
        Plotly.purge(plotEl);
        el.innerHTML = "";
      },
    };

    if (data) setData(data);
    return handle;
  }

  global.EarthX = global.EarthX || {};
  global.EarthX.initChart = initChart;
  global.EarthX.verdictColors = VERDICT_COLOR;
  global.EarthX.pval = pval;
})(window);
