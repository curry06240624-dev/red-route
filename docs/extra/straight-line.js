/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: "Straight lines between stops" (a layer in the Layers drawer).
   When it is on, the map shows a thin dashed straight line from each stop to the next one in the plan, drawn red
   where it crosses no-go ground, and the drawer lists for every leg the straight line's length, its metres steeper
   than the plan's no-go slope and the steepest slope it meets, next to the planned route's own leg (length and
   steepest slope, read from the plan).
   Method (DERIVED): the app's 4 m slope grid (data/grid_slope.u8, the grid the planner in the browser uses), read
   with the same cell lookup as docs/router.js (cell centres; row 0 at the north edge). Each line is cut into equal
   pieces of at most 2 m of ground distance (metres per degree of latitude = R x pi / 180 with R = 3,396,190 m;
   east-west metres x cos(latitude)); the sample in the middle of each piece gives that piece's slope.
   No-go follows the planner's rule: steeper than the plan's limit, or no height data. */
(() => {
  "use strict";
  const R_MARS = 3396190;                       // m: the Mars 2000 sphere, the same as tools/build_layers.py
  const M_PER_DEG = (R_MARS * Math.PI) / 180;   // ground metres per degree of latitude
  const STEP_M = 2;                             // longest piece of line per sample, in ground metres
  const RAD = Math.PI / 180;
  const NO_DATA = 255;                          // grid_slope.u8: one byte per cell, slope = byte x slope_scale, 255 = no data

  /* ---------- measuring (no page needed, so Node can load this part for tests) ---------- */
  // The cell that holds a point: the same formula as plan() in docs/router.js. Cell centres sit at
  // lon0 + (c + 0.5) dlon and lat1 - (r + 0.5) dlat, so row 0 is the north edge. -1 = off the grid.
  function cellOf(G, lat, lon) {
    const c = Math.round((lon - G.lon0) / G.dlon - 0.5), r = Math.round((G.lat1 - lat) / G.dlat - 0.5);
    return r < 0 || r >= G.h || c < 0 || c >= G.w ? -1 : r * G.w + c;
  }

  // One straight line from a to b ({lat, lon}), as it is drawn on the map (straight in latitude and longitude).
  function measureLine(G, slope, a, b, limitDeg) {
    const dLat = b.lat - a.lat, dLon = b.lon - a.lon;
    const roughLen = Math.hypot(dLat * M_PER_DEG, dLon * M_PER_DEG * Math.cos(((a.lat + b.lat) / 2) * RAD));
    const n = Math.max(1, Math.ceil(roughLen / STEP_M));
    let len = 0, over = 0, noData = 0, maxDeg = null, runFrom = -1;
    const runs = [];   // stretches of no-go ground, as [from, to] fractions of the line (for drawing)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, lat = a.lat + t * dLat, lon = a.lon + t * dLon;
      const piece = Math.hypot((dLat / n) * M_PER_DEG, (dLon / n) * M_PER_DEG * Math.cos(lat * RAD));
      const k = cellOf(G, lat, lon), s8 = k < 0 ? NO_DATA : slope[k];
      let nogo = false;
      len += piece;
      if (s8 === NO_DATA) { noData += piece; nogo = true; }
      else {
        const s = s8 * G.slope_scale;
        if (maxDeg === null || s > maxDeg) maxDeg = s;
        if (s > limitDeg) { over += piece; nogo = true; }   // the planner's rule (docs/router.js): steeper than the limit
      }
      if (nogo && runFrom < 0) runFrom = i / n;
      if (!nogo && runFrom >= 0) { runs.push([runFrom, i / n]); runFrom = -1; }
    }
    if (runFrom >= 0) runs.push([runFrom, 1]);
    return { samples: n, len_m: len, over_m: over, nodata_m: noData, max_deg: maxDeg, runs };
  }

  if (typeof module === "object" && module.exports) { module.exports = { cellOf, measureLine, STEP_M, M_PER_DEG }; return; }

  /* ---------- the page ---------- */
  const RED = "#ef4444", PANE = "slxPane";
  const st = { on: false, slope: null, loading: null, error: "", layer: null, res: null };
  const RR = () => window.RedRoute || {};
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const shortName = (s) => (RR().api && RR().api.shortName ? RR().api.shortName(s) : s.name.replace(/\s*\(.*\)$/, "").replace(/ sample depot$/i, ""));
  const fmtM = (m) => `${Math.round(m).toLocaleString("en-US")}&nbsp;m`;   // the number and its unit stay on one line
  const fmtDeg = (d) => (d == null ? "–" : `${(Math.round(d * 10) / 10).toFixed(1)}°`);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  function compute() {
    const S = RR().S, m = S && S.m;
    if (!m || !m.grid || !st.slope || !Array.isArray(m.order)) return null;
    const limit = Number(m.assumptions && m.assumptions.max_slope_deg);
    if (!Number.isFinite(limit)) return null;
    const stop = (id) => m.stops.find((s) => s.id === id);
    const mlegs = m.legs || [];
    const legs = [];
    for (let k = 0; k + 1 < m.order.length; k++) {
      const a = stop(m.order[k]), b = stop(m.order[k + 1]);
      if (!a || !b) continue;
      const route = mlegs[k] && mlegs[k].frm === a.id && mlegs[k].to === b.id ? mlegs[k] : mlegs.find((l) => l.frm === a.id && l.to === b.id) || null;
      legs.push({ a, b, line: measureLine(m.grid, st.slope, a, b, limit), route });
    }
    // The default plan comes from the 2 m build (tools/build_layers.py); any change is re-planned on the 4 m grid.
    const isDefault = !!S.base && same(m.order, S.base.order) && same(m.legs, S.base.legs);
    return { limit, legs, grid: m.grid, isDefault };
  }

  /* ---------- the map ---------- */
  function drawMap(res) {
    const map = RR().map;
    if (!map || !window.L) return;
    if (st.layer) { map.removeLayer(st.layer); st.layer = null; }
    if (!res || !res.legs.length) return;
    if (!map.getPane(PANE)) {   // above the slope layers and the route, below the stop markers
      const p = map.createPane(PANE);
      p.style.zIndex = 440; p.style.pointerEvents = "none";
    }
    const opt = (o) => Object.assign({ pane: PANE, interactive: false }, o);
    const at = (leg, t) => [leg.a.lat + t * (leg.b.lat - leg.a.lat), leg.a.lon + t * (leg.b.lon - leg.a.lon)];
    const g = L.layerGroup();
    for (const leg of res.legs) L.polyline([at(leg, 0), at(leg, 1)], opt({ color: "#000", weight: 4, opacity: 0.45 })).addTo(g);
    for (const leg of res.legs) L.polyline([at(leg, 0), at(leg, 1)], opt({ color: "#fff", weight: 1.8, opacity: 0.95, dashArray: "6 5" })).addTo(g);
    // no-go stretches: solid red with a dark edge, so they stand out on the red "No-go slopes" layer too
    for (const leg of res.legs) for (const [t0, t1] of leg.line.runs) L.polyline([at(leg, t0), at(leg, t1)], opt({ color: "#000", weight: 7.5, opacity: 0.75 })).addTo(g);
    for (const leg of res.legs) for (const [t0, t1] of leg.line.runs) L.polyline([at(leg, t0), at(leg, t1)], opt({ color: RED, weight: 4.2, opacity: 1 })).addTo(g);
    st.layer = g.addTo(map);
  }

  /* ---------- the drawer ---------- */
  function boxHtml(res) {
    if (!st.on) return '<small class="slx-hint">Draws a straight line from each stop to the next and checks it against the same slope rule as our route.</small>';
    if (st.error) return `<p class="slx-sum bad">${esc(st.error)}</p>`;
    if (!res) return '<small class="slx-hint">Reading the slope grid…</small>';
    const lim = `${res.limit}°`;
    let lineLen = 0, lineOver = 0, lineNoData = 0, lineMax = null, routeLen = 0, routeMax = null, routeOk = true, routeAll = true;
    const rows = res.legs.map((leg, k) => {
      const ln = leg.line, r = leg.route, over = Math.round(ln.over_m);
      lineLen += Math.round(ln.len_m); lineOver += over; lineNoData += ln.nodata_m;
      if (ln.max_deg != null && (lineMax == null || ln.max_deg > lineMax)) lineMax = ln.max_deg;
      const rOk = !!r && r.max_slope <= res.limit;   // the planner never steps on ground over the limit, so its leg has 0 m there
      if (r) { routeLen += r.dist_m; routeMax = routeMax == null ? r.max_slope : Math.max(routeMax, r.max_slope); } else routeAll = false;
      if (!rOk) routeOk = false;
      return `<tr class="slx-leg"><td colspan="4">${k + 1}. ${esc(shortName(leg.a))} → ${esc(shortName(leg.b))}</td></tr>
        <tr><td>Straight line</td><td>${fmtM(ln.len_m)}</td><td class="${over > 0 ? "bad" : "ok"}">${fmtM(over)}</td><td>${fmtDeg(ln.max_deg)}</td></tr>
        <tr><td>Our route</td><td>${r ? fmtM(r.dist_m) : "–"}</td><td class="${rOk ? "ok" : ""}">${rOk ? fmtM(0) : "–"}</td><td>${r ? fmtDeg(r.max_slope) : "–"}</td></tr>`;
    }).join("");
    const total = res.legs.length > 1 ? `<tr class="slx-leg"><td colspan="4">All ${res.legs.length} legs</td></tr>
        <tr><td>Straight lines</td><td>${fmtM(lineLen)}</td><td class="${lineOver > 0 ? "bad" : "ok"}">${fmtM(lineOver)}</td><td>${fmtDeg(lineMax)}</td></tr>
        <tr><td>Our route</td><td>${routeAll ? fmtM(routeLen) : "–"}</td><td class="${routeOk ? "ok" : ""}">${routeOk ? fmtM(0) : "–"}</td><td>${fmtDeg(routeMax)}</td></tr>` : "";
    const routeSays = routeOk ? (lineOver > 0 ? " The planned route crosses none." : " The planned route crosses none either.") : "";
    let sum = lineOver > 0
      ? `Straight lines between the stops would cross <b class="bad">${fmtM(lineOver)}</b> of no-go ground (steeper than ${lim}).${routeSays}`
      : `On this walk the straight lines cross no ground steeper than ${lim}.${routeSays}`;
    if (Math.round(lineNoData) > 0) sum += ` They also cross ${fmtM(lineNoData)} with no height data, which the planner avoids too.`;
    const G = res.grid;
    const dTag = '<button type="button" class="stag d" data-how="how-route" title="Derived: worked out by Red Route from NASA data and the planning numbers. Click for the source." aria-label="Derived. Open the source."><b>D</b><span>erived</span></button>';
    return `<p class="slx-sum">${sum}</p>
      <table class="slx-tbl"><thead><tr><th>Leg</th><th>Length</th><th>Over ${lim}</th><th>Steepest</th></tr></thead><tbody>${rows}${total}</tbody></table>
      <p class="slx-src"><b>DERIVED</b> from the 4 m slope grid${dTag}</p>
      <p class="slx-how">A sample every 2 m along each straight line reads the slope of its cell in the 4 m grid (cells ${G.gx.toFixed(1)} × ${G.gy.toFixed(1)} m on the ground), the grid that the planner in the browser uses. No-go means steeper than ${lim}, the plan's own rule. Our route's numbers are read from the plan${res.isDefault ? ", which was made on the finer 2 m grid" : ", re-planned on this 4 m grid"}.</p>`;
  }

  function renderBox() {
    const box = document.getElementById("slxBox");
    if (box) box.innerHTML = boxHtml(st.res);
  }

  // The app re-writes the Layers drawer with innerHTML; put the toggle back each time (just above "Background").
  function ensureBlock() {
    const box = document.getElementById("layersPanel");
    if (!box || !box.children.length || box.querySelector("#slxBlock")) return;
    const wrap = document.createElement("div");
    wrap.id = "slxBlock";
    wrap.innerHTML = '<label class="lay"><input type="checkbox" id="slxToggle"> Straight lines between stops</label><div class="slx" id="slxBox"></div>';
    const bg = [...box.querySelectorAll(".lbl-lg")].find((e) => /background/i.test(e.textContent));
    if (bg) box.insertBefore(wrap, bg); else box.appendChild(wrap);
    const inp = wrap.querySelector("#slxToggle");
    inp.checked = st.on;
    inp.onchange = () => setOn(inp.checked);
    renderBox();
  }

  /* ---------- the legend (the app re-writes it too) ---------- */
  function syncLegend() {
    const lg = document.getElementById("legend");
    if (!lg) return;
    const res = st.on ? st.res : null;
    const want = res ? (res.legs.some((leg) => leg.line.runs.length) ? "line+red" : "line") : "";
    const have = lg.querySelector("[data-slx]");
    if ((have ? have.dataset.slx : "") === want) return;   // no change, so no loop with the observer below
    lg.querySelectorAll("[data-slx]").forEach((e) => e.remove());
    if (!want) return;
    const row = (sw, text) => { const d = document.createElement("div"); d.dataset.slx = want; d.innerHTML = `<i style="${sw}"></i><span>${text}</span>`; return d; };
    lg.appendChild(row("height:2px;background:repeating-linear-gradient(90deg,#fff 0 5px,transparent 5px 9px)", "Straight line between stops"));
    if (want === "line+red") lg.appendChild(row(`height:3px;background:${RED}`, "Straight line on no-go ground"));
  }

  function refresh() {
    st.res = st.on && st.slope && !st.error ? compute() : null;
    drawMap(st.res);
    renderBox();
    syncLegend();
  }

  function setOn(on) {
    st.on = on;
    if (on && !st.slope && !st.loading) {
      st.error = "";
      st.loading = fetch("data/grid_slope.u8", { cache: "no-cache" })   // fetched once, the first time the layer is turned on
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((buf) => {
          const G = RR().S.m.grid, a = new Uint8Array(buf);
          if (a.length !== G.w * G.h) throw new Error("size");
          st.slope = a;
        })
        .catch(() => { st.error = "Could not read the slope grid, so the straight lines cannot be checked."; })
        .finally(() => { st.loading = null; refresh(); });
    }
    refresh();
  }

  function start() {
    const panel = document.getElementById("layersPanel"), legend = document.getElementById("legend");
    if (panel) new MutationObserver(ensureBlock).observe(panel, { childList: true });
    if (legend) new MutationObserver(syncLegend).observe(legend, { childList: true });
    ensureBlock();
    document.addEventListener("redroute:render", () => { ensureBlock(); if (st.on) refresh(); });
  }
  start();
})();
