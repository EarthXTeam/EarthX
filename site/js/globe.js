// Rotating globe. An equirectangular texture is painted once, then mapped onto
// a sphere pixel by pixel. flyTo() swings the chosen region into view and pins it.
const Globe = (() => {
  const cv = document.getElementById("globe");
  if (!cv) return { flyTo() {}, clear() {} };
  const ctx = cv.getContext("2d", { alpha: true });
  const D2R = Math.PI / 180;

  // ---------- 1. the texture (equirectangular world map) ----------
  const TW = 1024,
    TH = 512;
  const tex = document.createElement("canvas");
  tex.width = TW;
  tex.height = TH;
  const tc = tex.getContext("2d", { willReadFrequently: true });
  const OCEAN = "#22382b";

  const tx = (lo) => ((lo + 180) / 360) * TW,
    ty = (la) => ((90 - la) / 180) * TH;

  function tpath(poly) {
    tc.beginPath();
    poly.forEach(([lo, la], i) =>
      i ? tc.lineTo(tx(lo), ty(la)) : tc.moveTo(tx(lo), ty(la)),
    );
    tc.closePath();
  }

  function buildTexture() {
    // ocean: a little lighter at the equator so the sphere reads as water
    const g = tc.createLinearGradient(0, 0, 0, TH);
    g.addColorStop(0, "#1a2c21");
    g.addColorStop(0.5, "#2b4534");
    g.addColorStop(1, "#1a2c21");
    tc.fillStyle = g;
    tc.fillRect(0, 0, TW, TH);

    tc.lineJoin = "round";
    tc.lineWidth = 1.3;
    for (const k in GEO.land) {
      tpath(GEO.land[k]);
      tc.fillStyle = "#d5a66b";
      tc.fill();
      tc.strokeStyle = "#a65f43";
      tc.stroke();
    }
    // polar ice
    tpath(GEO.antarctica.concat([[180, -90], [-180, -90]]));
    tc.fillStyle = "#e9e1d2";
    tc.fill();
    const ice = tc.createLinearGradient(0, 0, 0, ty(68));
    ice.addColorStop(0, "rgba(233,225,210,.92)");
    ice.addColorStop(0.55, "rgba(233,225,210,.5)");
    ice.addColorStop(1, "rgba(233,225,210,0)");
    tc.fillStyle = ice;
    tc.fillRect(0, 0, TW, ty(68));
    // inland seas carved back out
    for (const k in GEO.water) {
      tpath(GEO.water[k]);
      tc.fillStyle = OCEAN;
      tc.fill();
    }
    // graticule
    tc.strokeStyle = "rgba(248,245,238,.14)";
    tc.lineWidth = 1;
    for (let lo = -180; lo <= 180; lo += 30) {
      tc.beginPath();
      tc.moveTo(tx(lo), 0);
      tc.lineTo(tx(lo), TH);
      tc.stroke();
    }
    for (let la = -60; la <= 60; la += 30) {
      tc.beginPath();
      tc.moveTo(0, ty(la));
      tc.lineTo(TW, ty(la));
      tc.stroke();
    }
    tc.strokeStyle = "rgba(248,245,238,.22)";
    tc.beginPath();
    tc.moveTo(0, ty(0));
    tc.lineTo(TW, ty(0));
    tc.stroke();
  }
  buildTexture();
  const TD = tc.getImageData(0, 0, TW, TH).data;

  // ---------- 2. per-pixel lookup tables ----------
  let S = 0,
    R = 0,
    img = null,
    px = null,
    COL = null,
    ROW = null,
    SHADE = null,
    ALPHA = null,
    builtTilt = null;

  function resize() {
    const w = cv.clientWidth || 340;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const n = Math.max(200, Math.min(Math.round(w * dpr), 480));
    if (n === S) return;
    S = n;
    cv.width = S;
    cv.height = S;
    R = S / 2 - 1;
    img = ctx.createImageData(S, S);
    px = img.data;
    builtTilt = null;
  }

  // view -> world, for a fixed tilt. Only longitude changes per frame.
  function buildTables(tiltDeg) {
    const n = S * S;
    COL = new Float32Array(n);
    ROW = new Int32Array(n);
    SHADE = new Float32Array(n);
    ALPHA = new Uint8Array(n);
    const t = tiltDeg * D2R,
      cT = Math.cos(t),
      sT = Math.sin(t);
    const c = S / 2;
    const lx = -0.42,
      ly = 0.5,
      lz = 0.76;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const vx = (x + 0.5 - c) / R,
          vy = (c - y - 0.5) / R;
        const d2 = vx * vx + vy * vy;
        if (d2 >= 1) {
          ALPHA[i] = 0;
          continue;
        }
        const vz = Math.sqrt(1 - d2);
        const wy = vy * cT + vz * sT,
          wz = vz * cT - vy * sT;
        const lat = Math.asin(Math.max(-1, Math.min(1, wy))) / D2R;
        const lon = Math.atan2(vx, wz) / D2R;
        ROW[i] = Math.min(TH - 1, Math.max(0, Math.round(((90 - lat) / 180) * (TH - 1)))) * TW;
        COL[i] = (lon / 360) * TW;
        const nd = Math.max(0, vx * lx + vy * ly + vz * lz);
        SHADE[i] = (0.46 + 0.72 * Math.pow(nd, 0.8)) * (0.78 + 0.22 * vz);
        ALPHA[i] = Math.round(255 * Math.min(1, (1 - Math.sqrt(d2)) * R));
      }
    }
    builtTilt = tiltDeg;
  }

  // ---------- 3. state ----------
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  let lon0 = -20,
    tilt = 16,
    spin = reduce ? 0 : 5.5, // degrees per second
    anim = null,
    pin = null,
    visible = true,
    last = 0;

  function shortest(a, b) {
    let d = ((b - a + 540) % 360) - 180;
    return a + d;
  }

  function flyTo(lat, lon, label) {
    pin = { lat, lon, label, t0: performance.now() };
    const targetLon = shortest(lon0, lon);
    const targetTilt = Math.max(-55, Math.min(55, lat));
    if (reduce) {
      lon0 = targetLon;
      tilt = targetTilt;
      spin = 0;
      return;
    }
    anim = {
      t0: performance.now(),
      ms: 1500,
      l0: lon0,
      l1: targetLon,
      t_0: tilt,
      t_1: targetTilt,
    };
    spin = 0;
  }

  function clear() {
    pin = null;
    anim = null;
    spin = reduce ? 0 : 5.5;
  }

  // the globe is hidden behind the results page: stop drawing it there
  let paused = false;
  function setPaused(p) {
    if (paused === p) return;
    paused = p;
    if (!p && visible) {
      last = performance.now();
      requestAnimationFrame(draw);
    }
  }

  // forward projection, for drawing the pin on top
  function project(lat, lon) {
    const la = lat * D2R,
      lo = (lon - lon0) * D2R,
      la0 = tilt * D2R;
    const cosc =
      Math.sin(la0) * Math.sin(la) +
      Math.cos(la0) * Math.cos(la) * Math.cos(lo);
    const x = Math.cos(la) * Math.sin(lo);
    const y =
      Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(lo);
    return { x: S / 2 + x * R, y: S / 2 - y * R, vis: cosc > 0 };
  }

  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  function draw(now) {
    if (paused) return;
    const dt = Math.min(0.05, (now - last) / 1000) || 0;
    last = now;
    if (anim) {
      const u = Math.min(1, (now - anim.t0) / anim.ms),
        e = ease(u);
      lon0 = anim.l0 + (anim.l1 - anim.l0) * e;
      tilt = anim.t_0 + (anim.t_1 - anim.t_0) * e;
      if (u >= 1) anim = null;
    } else if (spin) {
      lon0 += spin * dt;
    }
    if (lon0 > 360) lon0 -= 360;
    if (lon0 < -360) lon0 += 360;

    // rebuild the tables only when the tilt has moved enough to notice
    if (builtTilt === null || Math.abs(tilt - builtTilt) > 1.2) buildTables(tilt);

    // + TW/2 because texture column 0 is longitude -180, not 0
    const rot = (lon0 / 360) * TW + TW / 2;
    const n = S * S;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const a = ALPHA[i];
      if (!a) {
        px[o + 3] = 0;
        continue;
      }
      let col = (COL[i] + rot) % TW;
      if (col < 0) col += TW;
      const ti = (ROW[i] + (col | 0)) << 2;
      const s = SHADE[i];
      px[o] = TD[ti] * s;
      px[o + 1] = TD[ti + 1] * s;
      px[o + 2] = TD[ti + 2] * s;
      px[o + 3] = a;
    }
    ctx.putImageData(img, 0, 0);

    // atmosphere
    const hg = ctx.createRadialGradient(S / 2, S / 2, R * 0.82, S / 2, S / 2, R);
    hg.addColorStop(0, "rgba(213,166,107,0)");
    hg.addColorStop(1, "rgba(233,225,210,.22)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, R, 0, 7);
    ctx.fill();

    // the pin
    if (pin) {
      const p = project(pin.lat, pin.lon);
      if (p.vis) {
        const k = S / 340;
        const t = (now - pin.t0) / 1000;
        const pulse = reduce ? 0.5 : (t % 1.8) / 1.8;
        ctx.save();
        ctx.strokeStyle = `rgba(166,95,67,${(1 - pulse) * 0.85})`;
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (6 + pulse * 22) * k, 0, 7);
        ctx.stroke();
        ctx.fillStyle = "#a65f43";
        ctx.strokeStyle = "#f8f5ee";
        ctx.lineWidth = 2.2 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5 * k, 0, 7);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    if (visible) requestAnimationFrame(draw);
  }

  // ---------- 4. lifecycle ----------
  const ro = new ResizeObserver(() => resize());
  ro.observe(cv);
  resize();
  new IntersectionObserver(
    (es) => {
      const on = es[0].isIntersecting && !document.hidden;
      if (on && !visible) {
        visible = true;
        last = performance.now();
        requestAnimationFrame(draw);
      }
      visible = on;
    },
    { threshold: 0 },
  ).observe(cv);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !visible) {
      visible = true;
      last = performance.now();
      requestAnimationFrame(draw);
    } else if (document.hidden) visible = false;
  });
  requestAnimationFrame(draw);

  return { flyTo, clear, setPaused };
})();
