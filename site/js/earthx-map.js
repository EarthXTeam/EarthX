/*
 * EarthX — trend map component
 *
 * Reads the map file: one entry per 0.75 degree grid cell, no series.
 * Draws every cell on one canvas layer, so a few thousand cells stay smooth.
 *
 *   const map = EarthX.initMap(document.getElementById('map'), mapFile, {
 *     onCellClick: cell => { ... }   // cell = the map-file entry, as given
 *   });
 *   map.setData(anotherMapFile);     // swap suspect or region, same instance
 *   map.setFilter({ confirmed:true, case_open:false, no_evidence:false });
 *   map.destroy();
 *
 * Requires Leaflet 1.9 on the page before this file.
 *
 * Colour carries DIRECTION and STRENGTH of slope_per_decade.
 * Verdict is carried by pattern, not by intensity:
 *   confirmed    solid fill
 *   case_open    same colour, diagonal hatch over it
 *   no_evidence  the same colour washed out
 * That way nobody has to judge "is this a strong trend or an uncertain one"
 * from how dark a square looks, which is exactly the thing eyes are bad at.
 *
 * The key panel (bottom right) is the map's own control: it collapses to a
 * single button, its three verdict rows are filters, and the slider hides
 * cells below a rate. Reading a map is work, so the controls that make that
 * work possible live on the map itself.
 */
(function (global) {
  "use strict";

  var STEP = 0.75; // grid size in degrees; overridable per call

  // Diverging ramp, light in the middle, dark at the ends. Terracotta for
  // falling, forest for rising. The rising ramp runs slightly cool through its
  // mid tones so the two ends stay apart for red-green colour blindness,
  // where a warm green and a terracotta do not.
  var FALLING = ["#ece3d6", "#dcb79b", "#c68a65", "#a65f43", "#7a3f29"];
  var RISING = ["#e4ebe4", "#aac4b0", "#73997e", "#436f53", "#263b2d"];

  var FADE = 0.45;

  // Keyless basemaps, tried in order. A light, quiet basemap first: the data
  // is the colour on this map, so the geography underneath should not compete.
  var PROVIDERS = [
    {
      name: "Esri light gray",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      labels:
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
      maxZoom: 12,
    },
    {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 12,
      opacity: 0.55, // muted, or its colours fight the cells
    },
  ];

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function hexToRgb(h) {
    return [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
  }

  function rampColor(ramp, t) {
    // t in 0..1 across the stops, blended between them rather than snapped,
    // so neighbouring shades stay distinguishable
    var x = clamp(t, 0, 1) * (ramp.length - 1);
    var i = Math.floor(x);
    if (i >= ramp.length - 1) return ramp[ramp.length - 1];
    var f = x - i;
    var a = hexToRgb(ramp[i]),
      b = hexToRgb(ramp[i + 1]);
    return (
      "rgb(" +
      Math.round(a[0] + (b[0] - a[0]) * f) +
      "," +
      Math.round(a[1] + (b[1] - a[1]) * f) +
      "," +
      Math.round(a[2] + (b[2] - a[2]) * f) +
      ")"
    );
  }

  // Robust colour scale: the 95th percentile of |slope| over cells that have
  // a trend at all. One outlier cell should not flatten the whole map.
  function scaleFor(cells) {
    var mags = [];
    for (var i = 0; i < cells.length; i++) {
      if (typeof cells[i].slope_per_decade === "number") {
        mags.push(Math.abs(cells[i].slope_per_decade));
      }
    }
    if (!mags.length) return 1;
    mags.sort(function (a, b) {
      return a - b;
    });
    var v = mags[Math.floor(0.95 * (mags.length - 1))];
    return v > 0 ? v : 1;
  }

  function maxRateOf(cells) {
    var m = 0;
    for (var i = 0; i < cells.length; i++) {
      var v = Math.abs(cells[i].slope_per_decade);
      if (typeof v === "number" && !isNaN(v) && v > m) m = v;
    }
    return m;
  }

  /*
   * Colour strength is led by the verdict, with the rate varying within it:
   *
   *   confirmed    the strong end of the ramp   (0.60 - 1.00)
   *   case_open    the middle                   (0.30 - 0.52)
   *   no_evidence  the pale end, and faded      (0.00 - 0.22)
   *
   * The bands do not overlap, so the palest confirmed cell is still darker
   * than the strongest case-open one. Overlapping them lets a fast
   * unconfirmed trend outshout a slow confirmed one, which is the opposite
   * of what the map is for.
   */
  var BANDS = {
    confirmed: [0.6, 1.0],
    case_open: [0.3, 0.52],
    no_evidence: [0.0, 0.22],
  };

  function cellColor(cell, scale) {
    var t = clamp(Math.abs(cell.slope_per_decade) / scale, 0, 1);
    var band = BANDS[cell.verdict] || BANDS.no_evidence;
    var shade = band[0] + t * (band[1] - band[0]);
    return cell.slope_per_decade >= 0
      ? rampColor(RISING, shade)
      : rampColor(FALLING, shade);
  }

  /*
   * Cell addresses.
   *
   * Never assume cells sit at multiples of the step. A grid built by
   * averaging a finer dataset starts at whatever edge its region box had, so
   * centres like 35.625 are perfectly normal and 35.625 is not a multiple of
   * 0.75. Addressing cells by their position relative to the grid's own
   * origin works whatever the alignment.
   */
  function cellKey(lat, lon, step, origin) {
    return (
      Math.round((lat - origin.lat) / step) +
      "|" +
      Math.round((lon - origin.lon) / step)
    );
  }

  function prettyVariable(name) {
    return String(name || "").replace(/_/g, " ");
  }

  // readable numbers: three significant figures is plenty on a map
  function num(v) {
    if (typeof v !== "number" || isNaN(v)) return String(v);
    var a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  function pnum(p) {
    if (typeof p !== "number" || isNaN(p)) return String(p);
    return p < 0.001 ? "< 0.001" : p.toFixed(3);
  }

  var VERDICT_LABEL = {
    confirmed: "Confirmed",
    case_open: "Case open",
    no_evidence: "No evidence",
  };

  var VERDICT_NOTE = {
    confirmed: "significant",
    case_open: "trend, not yet significant",
    no_evidence: "no trend detected",
  };

  /* ---------------------------------------------------------------- *
   * The canvas layer: all cells, one <canvas>, redrawn on move/zoom.  *
   * ---------------------------------------------------------------- */
  function makeCellLayer(L) {
    return L.Layer.extend({
      initialize: function (opts) {
        this._cells = [];
        this._scale = 1;
        this._step = (opts && opts.step) || STEP;
        this._selected = null;
        this._hovered = null;
      },

      setCells: function (cells, scale, step) {
        this._cells = cells || [];
        this._scale = scale || 1;
        if (step) this._step = step;
        this._schedule();
        return this;
      },

      setSelected: function (cell) {
        this._selected = cell;
        this._schedule();
      },
      setHovered: function (cell) {
        this._hovered = cell;
        this._schedule();
      },

      onAdd: function (map) {
        this._map = map;
        var canvas = (this._canvas = L.DomUtil.create(
          "canvas",
          "earthx-cell-canvas",
        ));
        canvas.style.position = "absolute";
        canvas.style.pointerEvents = "none";
        map.getPanes().overlayPane.appendChild(canvas);
        map.on(
          "move zoom resize viewreset zoomend moveend",
          this._schedule,
          this,
        );
        this._resize();
        this._draw();
      },

      onRemove: function (map) {
        map.off(
          "move zoom resize viewreset zoomend moveend",
          this._schedule,
          this,
        );
        if (this._canvas && this._canvas.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
        this._canvas = null;
        this._map = null;
      },

      _schedule: function () {
        if (this._raf) return;
        var self = this;
        this._raf = global.requestAnimationFrame(function () {
          self._raf = null;
          self._resize();
          self._draw();
        });
      },

      _resize: function () {
        if (!this._map || !this._canvas) return;
        var size = this._map.getSize();
        var dpr = global.devicePixelRatio || 1;
        if (
          this._canvas.width !== size.x * dpr ||
          this._canvas.height !== size.y * dpr
        ) {
          this._canvas.width = size.x * dpr;
          this._canvas.height = size.y * dpr;
          this._canvas.style.width = size.x + "px";
          this._canvas.style.height = size.y + "px";
        }
        // keep the canvas pinned to the top-left of the current view
        var topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
      },

      _draw: function () {
        if (!this._map || !this._canvas) return;
        var map = this._map;
        var ctx = this._canvas.getContext("2d");
        var dpr = global.devicePixelRatio || 1;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var size = map.getSize();
        ctx.clearRect(0, 0, size.x, size.y);

        if (this._graticule) this._drawGraticule(ctx, map, size);

        var half = this._step / 2;
        var cells = this._cells;
        var scale = this._scale;
        var hatched = [];

        for (var i = 0; i < cells.length; i++) {
          var c = cells[i];
          var nw = map.latLngToContainerPoint([c.lat + half, c.lon - half]);
          var se = map.latLngToContainerPoint([c.lat - half, c.lon + half]);
          var x = nw.x,
            y = nw.y;
          var w = se.x - nw.x,
            h = se.y - nw.y;

          // skip anything off screen
          if (x + w < -4 || y + h < -4 || x > size.x + 4 || y > size.y + 4)
            continue;

          // +1 closes the hairline seams between neighbouring cells
          var rw = Math.max(w + 1, 1),
            rh = Math.max(h + 1, 1);

          ctx.globalAlpha = c.verdict === "no_evidence" ? FADE : 1;
          ctx.fillStyle = cellColor(c, scale);
          ctx.fillRect(x, y, rw, rh);
          ctx.globalAlpha = 1;

          if (c.verdict === "case_open") hatched.push([x, y, rw, rh]);
        }

        // Diagonal hatch for case_open, drawn in one pass over a clipped region
        if (hatched.length) {
          ctx.save();
          ctx.beginPath();
          for (var k = 0; k < hatched.length; k++) {
            ctx.rect(hatched[k][0], hatched[k][1], hatched[k][2], hatched[k][3]);
          }
          ctx.clip();
          ctx.strokeStyle = "rgba(34,53,42,0.55)";
          ctx.lineWidth = 1.1;
          var gap = 5;
          ctx.beginPath();
          for (var d = -size.y; d < size.x + size.y; d += gap) {
            ctx.moveTo(d, 0);
            ctx.lineTo(d + size.y, size.y);
          }
          ctx.stroke();
          ctx.restore();
        }

        this._outline(ctx, map, this._hovered, "rgba(34,53,42,0.75)", 1.5);
        this._outline(ctx, map, this._selected, "#a65f43", 3);
      },

      setGraticule: function (on) {
        this._graticule = !!on;
        this._schedule();
      },

      /*
       * Fallback geography: latitude and longitude lines with labels, for when
       * basemap tiles cannot load. Not as good as a coastline, but it keeps the
       * map readable as a map instead of coloured squares floating in nothing.
       */
      _drawGraticule: function (ctx, map, size) {
        var b = map.getBounds();
        var zoom = map.getZoom();
        var stepDeg = zoom >= 7 ? 1 : zoom >= 5 ? 2 : zoom >= 4 ? 5 : 10;

        ctx.strokeStyle = "rgba(38,59,45,0.16)";
        ctx.fillStyle = "#61705f";
        ctx.lineWidth = 1;
        ctx.font = "11px Figtree, system-ui, sans-serif";
        ctx.textBaseline = "top";

        var lat0 = Math.floor(b.getSouth() / stepDeg) * stepDeg;
        var lat1 = Math.ceil(b.getNorth() / stepDeg) * stepDeg;
        for (var la = lat0; la <= lat1; la += stepDeg) {
          var y = map.latLngToContainerPoint([la, b.getWest()]).y;
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(size.x, y + 0.5);
          ctx.stroke();
          ctx.fillText(Math.abs(la) + "°" + (la < 0 ? "S" : "N"), 4, y + 3);
        }

        var lon0 = Math.floor(b.getWest() / stepDeg) * stepDeg;
        var lon1 = Math.ceil(b.getEast() / stepDeg) * stepDeg;
        for (var lo = lon0; lo <= lon1; lo += stepDeg) {
          var x = map.latLngToContainerPoint([b.getNorth(), lo]).x;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, size.y);
          ctx.stroke();
          ctx.fillText(Math.abs(lo) + "°" + (lo < 0 ? "W" : "E"), x + 3, 4);
        }
      },

      _outline: function (ctx, map, cell, color, width) {
        if (!cell) return;
        var half = this._step / 2;
        var nw = map.latLngToContainerPoint([cell.lat + half, cell.lon - half]);
        var se = map.latLngToContainerPoint([cell.lat - half, cell.lon + half]);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      },
    });
  }

  /* ------------------------- the key panel ------------------------- */
  /*
   * One button hides and shows the whole panel, because on a small screen the
   * key covers the very cells it describes. The three verdict rows double as
   * filters and carry their cell counts, so "how much of this region is
   * actually confirmed" is a number you can read rather than a judgement you
   * have to squint at.
   */
  function legendHtml(data, scale, state) {
    var unit = data.unit || "";
    var v = state.title || prettyVariable(data.variable);
    var max = scale;
    var f = state.filter;

    function swatches(ramp, reverse) {
      var out = "";
      var list = reverse ? ramp.slice().reverse() : ramp;
      for (var i = 0; i < list.length; i++) {
        out += '<i style="background:' + list[i] + '"></i>';
      }
      return out;
    }

    function keyRow(verdict, cls) {
      var on = f[verdict];
      return (
        '<button type="button" class="earthx-key' +
        (on ? "" : " off") +
        '" data-verdict="' +
        verdict +
        '" aria-pressed="' +
        on +
        '" title="Show or hide these cells">' +
        '<span class="earthx-key-box ' +
        cls +
        '"></span>' +
        '<span class="earthx-key-text">' +
        VERDICT_LABEL[verdict] +
        " <em>" +
        VERDICT_NOTE[verdict] +
        "</em></span>" +
        '<span class="earthx-key-n">' +
        (state.counts[verdict] || 0) +
        "</span>" +
        "</button>"
      );
    }

    /*
     * The slider runs to the ramp's own maximum, not to the fastest cell in
     * the file. One outlier ten times the typical rate would otherwise put
     * every useful cutoff in the first two pixels of the track.
     */
    var sliderMax = scale > 0 ? scale : 1;

    return (
      '<div class="earthx-legend-head">' +
      '<span class="earthx-legend-name">' +
      v +
      " trend <em>" +
      unit +
      " per decade</em></span>" +
      '<button type="button" class="earthx-legend-toggle" aria-expanded="' +
      state.legendOpen +
      '">' +
      (state.legendOpen ? "Hide key" : "Show key") +
      "</button>" +
      "</div>" +
      '<div class="earthx-legend-body"' +
      (state.legendOpen ? "" : " hidden") +
      ">" +
      '<div class="earthx-ramp">' +
      '<span class="earthx-ramp-end">−' +
      max.toFixed(1) +
      "</span>" +
      swatches(FALLING, true) +
      '<i class="earthx-ramp-zero"></i>' +
      swatches(RISING, false) +
      '<span class="earthx-ramp-end">+' +
      max.toFixed(1) +
      "</span>" +
      "</div>" +
      '<div class="earthx-ramp-words"><span>falling</span><span>rising</span></div>' +
      '<div class="earthx-legend-sub">Click a verdict to hide those cells</div>' +
      '<div class="earthx-keys">' +
      keyRow("confirmed", "k-conf") +
      keyRow("case_open", "k-open") +
      keyRow("no_evidence", "k-none") +
      "</div>" +
      '<label class="earthx-slider">' +
      "<span>" +
      (f.minRate > 0
        ? "Hiding rates under <b>" + num(f.minRate) + "</b> " + unit + "/decade"
        : "Drag to hide the slowest cells") +
      "</span>" +
      '<input type="range" min="0" max="' +
      sliderMax +
      '" step="' +
      sliderMax / 100 +
      '" value="' +
      f.minRate +
      '">' +
      "</label>" +
      '<div class="earthx-legend-count">' +
      state.shown +
      " of " +
      state.total +
      " cells shown</div>" +
      "</div>"
    );
  }

  /* ------------------------------ main ------------------------------ */
  function initMap(el, data, options) {
    var L = global.L;
    if (!L)
      throw new Error(
        "EarthX.initMap: Leaflet (window.L) must be loaded first.",
      );
    if (!el) throw new Error("EarthX.initMap: no container element.");

    var opts = options || {};
    var step = opts.step || STEP;
    var CellLayer = makeCellLayer(L);

    el.classList.add("earthx-map");

    var map = L.map(el, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: false,
      minZoom: 2,
    });

    var layer = new CellLayer({ step: step }).addTo(map);

    /*
     * Basemap, with a fallback. Tiles are remote images, which some hosts
     * block. Rather than leave a grey void, the first tile error switches the
     * map to a labelled graticule.
     */
    var tiles = [];

    function clearTiles() {
      tiles.forEach(function (t) {
        map.removeLayer(t);
      });
      tiles = [];
    }

    function useGraticule() {
      clearTiles();
      layer.setGraticule(true);
      if (typeof opts.onBasemapUnavailable === "function")
        opts.onBasemapUnavailable();
    }

    /*
     * Try each basemap in turn, fall back to the graticule if none works.
     * Every one of these is keyless — a provider that wants an API key serves
     * tiles stamped "API KEY REQUIRED" with a perfectly normal 200, so nothing
     * detects the failure except your eyes.
     */
    function useProvider(i) {
      clearTiles();
      if (i >= PROVIDERS.length) {
        useGraticule();
        return;
      }
      var p = PROVIDERS[i];

      var base = L.tileLayer(p.url, {
        attribution: p.attribution,
        maxZoom: p.maxZoom || 12,
        opacity: p.opacity == null ? 1 : p.opacity,
        crossOrigin: true,
      });
      tiles.push(base);
      if (p.labels) {
        // place names above the data, so the cells never hide where you are
        tiles.push(
          L.tileLayer(p.labels, {
            maxZoom: p.maxZoom || 12,
            pane: "shadowPane",
          }),
        );
      }

      var loaded = 0,
        failed = 0,
        moved = false;
      base.on("tileload", function () {
        loaded++;
      });
      base.on("tileerror", function () {
        failed++;
        // one missing tile at the edge of the world is normal; none loading is not
        if (!moved && loaded === 0 && failed >= 3) {
          moved = true;
          useProvider(i + 1);
        }
      });
      global.setTimeout(function () {
        if (!moved && loaded === 0) {
          moved = true;
          useProvider(i + 1);
        }
      }, 5000);

      tiles.forEach(function (t) {
        t.addTo(map);
      });
    }

    if (opts.basemap === "none") {
      layer.setGraticule(true);
    } else {
      useProvider(0);
    }

    /*
     * Keep the view fitted to the data. Leaflet works out the zoom from the
     * container's size, and on first paint that size can still be wrong, which
     * leaves the region as a small patch in the middle of a large empty map.
     * So re-fit once the layout has settled, and again whenever the container
     * changes size — but stop as soon as the person has moved the map
     * themselves, because then the view is theirs, not ours.
     */
    var userMoved = false;
    var fitting = false;

    function fitTo(bounds) {
      if (!bounds) return;
      fitting = true;
      // animate:false keeps this synchronous, so the zoomstart it fires lands
      // while the flag is still up. With animation it fires a frame later,
      // after the flag is down, and the map mistakes its own fit for the
      // person moving it — then refuses to re-fit ever again.
      map.fitBounds(bounds, { padding: [20, 20], animate: false });
      fitting = false;
    }

    map.on("dragstart", function () {
      userMoved = true;
    });
    map.on("zoomstart", function () {
      if (!fitting) userMoved = true;
    });

    function ensureFit() {
      if (!state.data) return; // nothing loaded yet
      map.invalidateSize({ animate: false });
      if (!userMoved) fitTo(state.bounds);
    }

    global.requestAnimationFrame(ensureFit);
    global.setTimeout(ensureFit, 300);
    if (global.ResizeObserver) {
      new global.ResizeObserver(ensureFit).observe(el);
    }

    var legend = L.control({ position: "bottomright" });
    legend.onAdd = function () {
      var div = L.DomUtil.create("div", "earthx-legend");
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    legend.addTo(map);

    var tip = L.DomUtil.create("div", "earthx-tip", el);
    tip.style.display = "none";

    var state = {
      data: null,
      all: [],
      visible: [],
      index: {},
      scale: 1,
      maxRate: 0,
      selected: null,
      bounds: null,
      origin: null,
      counts: {},
      total: 0,
      shown: 0,
      title: opts.title || "",
      legendOpen: opts.legendOpen !== false,
      filter: {
        confirmed: true,
        case_open: true,
        no_evidence: true,
        minRate: 0,
      },
    };

    function passes(c) {
      if (!state.filter[c.verdict]) return false;
      if (Math.abs(c.slope_per_decade) < state.filter.minRate) return false;
      return true;
    }

    /* Rebuild what is drawn and what is clickable from the current filter. */
    function applyFilter() {
      if (!state.data) return;
      var vis = [];
      state.index = {};
      for (var i = 0; i < state.all.length; i++) {
        var c = state.all[i];
        if (!passes(c)) continue;
        vis.push(c);
        state.index[cellKey(c.lat, c.lon, step, state.origin)] = c;
      }
      state.visible = vis;
      state.shown = vis.length;
      layer.setCells(vis, state.scale, step);

      // a selection that has just been filtered out should not keep its outline
      if (state.selected && !passes(state.selected)) {
        layer.setSelected(null);
      } else {
        layer.setSelected(state.selected);
      }
      drawLegend();
      if (typeof opts.onFilterChange === "function") {
        opts.onFilterChange(
          {
            confirmed: state.filter.confirmed,
            case_open: state.filter.case_open,
            no_evidence: state.filter.no_evidence,
            minRate: state.filter.minRate,
          },
          state.shown,
          state.total,
        );
      }
    }

    function drawLegend() {
      var box = legend.getContainer();
      if (!box || !state.data) return;
      /*
       * Toggle the one class, never assign className. Leaflet adds
       * `leaflet-control` to a control's container itself, and that class is
       * the only thing restoring pointer events inside a corner — the corners
       * are pointer-events:none so the map stays draggable around them.
       * Overwriting className drops it, and the whole panel silently turns
       * click-through: it still draws, but no button in it can be pressed.
       */
      box.classList.toggle("collapsed", !state.legendOpen);
      box.innerHTML = legendHtml(state.data, state.scale, state);

      var tog = box.querySelector(".earthx-legend-toggle");
      if (tog)
        tog.onclick = function () {
          state.legendOpen = !state.legendOpen;
          drawLegend();
        };

      box.querySelectorAll("[data-verdict]").forEach(function (b) {
        b.onclick = function () {
          var v = b.dataset.verdict;
          state.filter[v] = !state.filter[v];
          applyFilter();
        };
      });

      var sl = box.querySelector('input[type="range"]');
      if (sl) {
        sl.oninput = function () {
          state.filter.minRate = parseFloat(sl.value) || 0;
          applyFilter();
        };
      }
    }

    function lookup(latlng) {
      if (!state.origin) return null;
      var cell =
        state.index[cellKey(latlng.lat, latlng.lng, step, state.origin)];
      if (!cell) return null;
      // a click past the edge of the grid snaps to the nearest cell, so check
      // it really is inside that cell before claiming it
      if (
        Math.abs(cell.lat - latlng.lat) > step * 0.55 ||
        Math.abs(cell.lon - latlng.lng) > step * 0.55
      )
        return null;
      return cell;
    }

    function showTip(cell, point) {
      if (!cell) {
        tip.style.display = "none";
        return;
      }
      var unit = state.data.unit || "";
      var sign = cell.slope_per_decade > 0 ? "+" : "";
      tip.innerHTML =
        "<b>" +
        VERDICT_LABEL[cell.verdict] +
        "</b><br>" +
        sign +
        num(cell.slope_per_decade) +
        " " +
        unit +
        " / decade<br>p = " +
        pnum(cell.p_value) +
        (cell.years_to_significance != null
          ? "<br>~" + cell.years_to_significance + " more years needed"
          : "") +
        '<br><span class="earthx-tip-pos">' +
        Math.abs(cell.lat).toFixed(2) +
        (cell.lat >= 0 ? "°N " : "°S ") +
        Math.abs(cell.lon).toFixed(2) +
        (cell.lon >= 0 ? "°E" : "°W") +
        "</span>" +
        '<br><span class="earthx-tip-hint">click to add to your notebook</span>';
      tip.style.display = "block";
      var w = tip.offsetWidth,
        h = tip.offsetHeight;
      var size = map.getSize();
      var x = point.x + 14,
        y = point.y + 14;
      if (x + w > size.x - 8) x = point.x - w - 14;
      if (y + h > size.y - 8) y = point.y - h - 14;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    }

    map.on("mousemove", function (e) {
      var cell = lookup(e.latlng);
      layer.setHovered(cell);
      showTip(cell, e.containerPoint);
      el.style.cursor = cell ? "pointer" : "";
    });

    map.on("mouseout", function () {
      layer.setHovered(null);
      showTip(null);
    });

    map.on("click", function (e) {
      var cell = lookup(e.latlng);
      if (!cell) return;
      state.selected = cell;
      layer.setSelected(cell);
      if (typeof opts.onCellClick === "function")
        opts.onCellClick(cell, state.data);
    });

    function setData(mapFile, fit) {
      if (!mapFile || !mapFile.cells)
        throw new Error("EarthX.initMap: expected a map object with .cells");
      state.data = mapFile;
      state.all = mapFile.cells;
      state.total = mapFile.cells.length;
      state.scale = scaleFor(mapFile.cells);
      state.maxRate = maxRateOf(mapFile.cells);
      state.filter.minRate = 0; // a new variable has a new unit; keep no stale cutoff

      state.counts = { confirmed: 0, case_open: 0, no_evidence: 0 };
      var lats = [],
        lons = [];
      for (var i = 0; i < mapFile.cells.length; i++) {
        var c = mapFile.cells[i];
        lats.push(c.lat);
        lons.push(c.lon);
        if (state.counts[c.verdict] != null) state.counts[c.verdict]++;
      }
      // the grid's own origin, so cell addresses work whatever the alignment
      state.origin = {
        lat: Math.min.apply(null, lats),
        lon: Math.min.apply(null, lons),
      };

      // keep the selected cell across a variable swap, if it still exists
      if (state.selected) {
        var sel = state.selected;
        var again = null;
        for (var j = 0; j < mapFile.cells.length; j++) {
          if (
            mapFile.cells[j].lat === sel.lat &&
            mapFile.cells[j].lon === sel.lon
          ) {
            again = mapFile.cells[j];
            break;
          }
        }
        state.selected = again;
      }

      applyFilter();

      if (lats.length) {
        var half = step / 2;
        state.bounds = [
          [Math.min.apply(null, lats) - half, Math.min.apply(null, lons) - half],
          [Math.max.apply(null, lats) + half, Math.max.apply(null, lons) + half],
        ];
        if (fit !== false) {
          userMoved = false; // a new region is a new view
          map.invalidateSize({ animate: false });
          fitTo(state.bounds);
        }
      }
      return handle;
    }

    var handle = {
      map: map,
      setData: setData,
      counts: function () {
        return {
          confirmed: state.counts.confirmed || 0,
          case_open: state.counts.case_open || 0,
          no_evidence: state.counts.no_evidence || 0,
          total: state.total,
        };
      },
      getSelected: function () {
        return state.selected;
      },
      select: function (lat, lon) {
        var cell = state.origin
          ? state.index[cellKey(lat, lon, step, state.origin)] || null
          : null;
        state.selected = cell;
        layer.setSelected(cell);
        return cell;
      },
      clearSelection: function () {
        state.selected = null;
        layer.setSelected(null);
      },
      setFilter: function (f) {
        if (!f) return handle;
        ["confirmed", "case_open", "no_evidence"].forEach(function (k) {
          if (typeof f[k] === "boolean") state.filter[k] = f[k];
        });
        if (typeof f.minRate === "number") state.filter.minRate = f.minRate;
        applyFilter();
        return handle;
      },
      setLegendOpen: function (on) {
        state.legendOpen = !!on;
        drawLegend();
        return handle;
      },
      invalidateSize: function () {
        map.invalidateSize();
        if (!userMoved) fitTo(state.bounds);
      },
      destroy: function () {
        map.remove();
      },
    };

    if (data) setData(data);
    return handle;
  }

  global.EarthX = global.EarthX || {};
  global.EarthX.initMap = initMap;
  global.EarthX.mapColors = { FALLING: FALLING, RISING: RISING, FADE: FADE };
  global.EarthX.verdictLabel = VERDICT_LABEL;
  global.EarthX.num = num;
  global.EarthX.pnum = pnum;
})(window);
