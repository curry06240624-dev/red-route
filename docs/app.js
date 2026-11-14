/* Red Route: a Marswalk planner for Jezero Crater.
   Map tiles: NASA JPL Mars Trek (WMTS, Mars 2000 sphere, geographic grid).
   Route, slope, roughness and walk-home layers: tools/build_layers.py, from the USGS Mars 2020 TRN HiRISE DTM.
   Live re-planning and the get-home zone: router.js (web worker) on the exported terrain grid. */
(() => {
  "use strict";
  const TREK = "https://trek.nasa.gov/tiles/Mars/EQ/";
  const trekUrl = (layer, ext) => `${TREK}${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
  const JEZ_HIRISE = [[18.3068, 77.2229], [18.6693, 77.5840]];
  const JEZ_CTX = [[15.9058, 75.1538], [19.4453, 78.8717]];
  const R_MARS = 3396190;

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtMin = (m) => { m = Math.round(Math.abs(m)); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
  const hm = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
  const sgn = (m) => (m < 0 ? "−" : "+");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

  /* ---------- map ---------- */
  const map = L.map("map", { crs: L.CRS.EPSG4326, center: [18.462, 77.396], zoom: 14, minZoom: 3, maxZoom: 19,
    zoomSnap: 0.25, zoomDelta: 0.5, zoomControl: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  const credit = 'Tiles: <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA JPL Mars Trek</a>';
  const BASES = {
    hirise: { name: "HiRISE 25 cm", layer: L.tileLayer(trekUrl("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png"),
      { maxNativeZoom: 17, maxZoom: 19, bounds: JEZ_HIRISE, attribution: `${credit} · HiRISE (NASA/JPL/UArizona, USGS)` }) },
    ctx: { name: "CTX 6 m", layer: L.tileLayer(trekUrl("Jezero_CTX_BlockAdj_dd", "png"),
      { maxNativeZoom: 14, maxZoom: 19, bounds: JEZ_CTX, attribution: `${credit} · CTX (NASA/JPL/MSSS)` }) },
    hrsc: { name: "HRSC + MOLA relief", layer: L.tileLayer(trekUrl("Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", "jpg"),
      { maxNativeZoom: 8, maxZoom: 19, attribution: `${credit} · Mars Express HRSC (ESA/DLR/FU Berlin) + MOLA (NASA), USGS blend` }) },
    mola: { name: "MOLA elevation", layer: L.tileLayer(trekUrl("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg"),
      { maxNativeZoom: 7, maxZoom: 19, attribution: `${credit} · MOLA (NASA/GSFC)` }) },
  };
  // zoomed-out context under everything: ESA Mars Express HRSC blended with NASA MOLA
  L.tileLayer(trekUrl("Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", "jpg"), { maxNativeZoom: 8, maxZoom: 19, className: "ctx-relief" }).addTo(map);
  let baseKey = "hirise";
  BASES.hirise.layer.addTo(map);

  const S = { m: null, base: null, overlays: {}, markers: {}, sel: "top", donki: null, meda: null, routeLine: null, routeCasing: null };
  window.RedRoute = { map, S };

  const getJSON = (f) => fetch(`data/${f}`, { cache: "no-cache" }).then((r) => r.json());   // always check for a newer build
  Promise.all([
    getJSON("mission.json"),
    getJSON("route.geojson"),
    getJSON("m20_traverse.json").catch(() => null),
    getJSON("donki.json").catch(() => null),
    getJSON("meda.json").catch(() => null),
  ]).then(([mission, route, traverse, donki, meda]) => {
    S.m = mission; S.base = clone(mission); S.donki = donki; S.meda = meda; S.route = route;
    buildOverlays(mission, traverse);
    drawRouteLine(route);
    createMarkers(mission);
    renderAll();
    fitRoute();
    renderLayersPanel(); renderPlanPanel(mission); renderAbout(mission);
    maybeShowGuide();
    initWorker(mission);
    refreshDonki();
  }).catch((e) => { console.error(e); $("#checks").innerHTML = '<div class="bad">Could not load the mission data.</div>'; });

  function renderAll() { renderChecks(); renderStopList(); renderConditions(); renderStopPanel(); renderLegend(); drawTimeline(); }

  function fitRoute() {
    const b = S.routeLine.getBounds();
    if (isMobile()) map.fitBounds(b, { padding: [20, 20] });
    else map.fitBounds(b, { paddingTopLeft: [350, 90], paddingBottomRight: [420, 170] });
  }

  /* ---------- stops, numbering and names ---------- */
  const stopById = (id) => S.m.stops.find((s) => s.id === id);
  const numberOf = (id) => { const i = S.m.order.indexOf(id); return i < 0 ? "–" : String(i + 1); };
  const shortName = (s) => s.name.replace(/\s*\(.*\)$/, "").replace(/ sample depot$/i, "");
  function nearestStopName(lat, lon) {
    let best = null, bd = Infinity;
    for (const id of S.m.order) {
      const s = stopById(id), d = (s.lat - lat) ** 2 + ((s.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best ? best.name : "the route";
  }

  /* ---------- the three get-home checks ---------- */
  function getChecks(m) {
    const wb = m.walkback, out = [];
    const w = wb.worst;
    out.push({ key: "plan", name: "Plan fits", ok: w.margin_min >= 0,
      val: `${w.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(w.margin_min)}${fmtMin(w.margin_min)}`,
      sub: w.margin_min >= 0 ? `Home at normal pace inside the usable ${hm(wb.budget_min)} (${wb.eva_limit_h} h minus ${Math.round(wb.reserve * 100)} % reserve)`
        : `Over by ${fmtMin(w.margin_min)} near ${nearestStopName(w.lat, w.lon)} at T+${hm(w.t)}. Leave earlier, shorten a stop or drop one.` });
    if (wb.bad) {
      const b = wb.bad.worst;
      out.push({ key: "bad", name: "If something goes wrong", ok: b.margin_min >= 0,
        val: `${b.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(b.margin_min)}${fmtMin(b.margin_min)}`,
        sub: b.margin_min >= 0 ? `Home at half speed (crewmate hurt), may use the reserve, before ${wb.eva_limit_h} h`
          : `At T+${hm(b.t)} near ${nearestStopName(b.lat, b.lon)} a half-speed walk home takes ${fmtMin(b.back)}: ${fmtMin(b.margin_min)} past ${wb.eva_limit_h} h. Leave that stop earlier or change the stop order.` });
    }
    if (wb.suit) {
      const s = wb.suit.worst, lim = wb.suit.limit_min, ok = s.back <= lim;
      out.push({ key: "suit", name: "Suit failure", ok,
        val: `${ok ? "PASS" : "FAIL"} ${Math.round(s.back)} / ${lim} min`,
        sub: ok ? "Longest walk home stays inside the 1 h backup oxygen"
          : `Near ${nearestStopName(s.lat, s.lon)} the walk home is ${fmtMin(s.back)}, more than ${lim} min of backup oxygen. Move base camp closer or drop the far stop.` });
    }
    return out;
  }

  function renderChecks() {
    const m = S.m, t = m.totals, rc = m.rover_check;
    const rows = getChecks(m).map((c) => `<div class="chk"><span class="k">${c.name}</span><span class="v ${c.ok ? "ok" : "bad"}">${esc(c.val)}</span><span class="s">${esc(c.sub)}</span></div>`).join("");
    $("#checks").innerHTML = `<div class="lbl-lg"><span class="gnum" aria-hidden="true">1</span>Get-home checks</div>${rows}
      <div class="mission">${t.dist_km.toFixed(1)} KM · ${fmtMin(t.eva_h * 60).toUpperCase()} EVA · +${t.gain_m} M · MAX ${t.max_slope.toFixed(1)}°</div>
      ${rc ? `<div class="proof">Slope map vs Perseverance's tilt sensor: ${rc.slope_mae_deg}° average difference at ${rc.n} spots. <a href="#" id="proofLink">See the test</a></div>` : ""}
      <hr class="r">`;
    const pl = $("#proofLink");
    if (pl) pl.onclick = (e) => { e.preventDefault(); openModal("about"); setTimeout(() => $("#tests")?.scrollIntoView(), 50); };
  }

  function renderStopList() {
    const m = S.m, tl = m.timeline || [];
    let html = '<div class="lbl-lg" style="display:flex;justify-content:space-between"><span>Route stops</span><span>Leave by</span></div><ul class="stops">';
    m.order.forEach((id, i) => {
      const s = stopById(id), last = i === m.order.length - 1, t = tl[i];
      if (last) {
        html += `<li class="ret"><span class="n">${i + 1}</span><span class="nm">Back at base camp</span><span class="lb"><span class="lbl">Arrive</span><b>${t ? `T+${hm(t.arrive_min)}` : ""}</b></span></li>`;
      } else {
        const late = t && t.spare_min < 0;
        const right = i === 0 ? `<span class="lbl">Start</span><b>T+0:00</b>`
          : `${late ? '<span class="lbl bad">Late</span>' : ""}<b class="${late ? "bad" : t && t.spare_min < 30 ? "warn" : ""}">${t ? `T+${hm(t.leave_by_min)}` : ""}</b>`;
        html += `<li data-id="${id}" class="${S.sel === id ? "sel" : ""}"><span class="n">${numberOf(id)}</span><span class="nm">${esc(s.name)}</span><span class="lb">${right}</span></li>`;
      }
    });
    html += "</ul><hr class=\"r\">";
    $("#stopList").innerHTML = html;
    $("#stopList").querySelectorAll("li[data-id]").forEach((li) => (li.onclick = () => selectStop(li.dataset.id, true)));
  }

  /* ---------- conditions: space weather + daylight ---------- */
  // NASA's CME notices list their targets in the "Message Type: ... CME (targets)" line and give a predicted
  // arrival time for each target. Every notice also carries the office name "Moon to Mars Space Weather
  // Analysis Office", so the word Mars on its own means nothing.
  function marsCme(n) {
    if (n.type !== "CME") return null;
    const body = n.body || "", head = /Message Type:[^\n]*\(([^)]*)\)/.exec(body);
    if (!head || !/\bMars\b/.test(head[1])) return null;
    const at = /\bMars at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)/.exec(body), pm = /\(plus minus (\d+) hours\)/.exec(body);
    const how = /\bMars \(([^)]+)\)/.exec(body);
    const issued = Date.parse(n.issued), arrive = at ? Date.parse(at[1]) : null, pmH = pm ? +pm[1] : 7;
    // watch from the notice until a day after the latest predicted arrival (72 h from the notice if it gives no time)
    const until = arrive != null && !isNaN(arrive) ? arrive + (pmH + 24) * 3600e3 : issued + 72 * 3600e3;
    return { n, issued, arrive: isNaN(arrive) ? null : arrive, pmH, how: how ? how[1] : "", until };
  }
  const utcShort = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };

  // "now" is the time the notices describe: the present for live data, the save date for the saved copy
  function spaceWeather(notes, now = Date.now()) {
    const newest = (list) => list.slice().sort((a, b) => Date.parse(b.issued) - Date.parse(a.issued))[0];
    const within = (n, h) => { const t = Date.parse(n.issued); return t <= now && now - t < h * 3600e3; };
    const sep = notes.filter((n) => n.type === "SEP" && within(n, 72));
    if (sep.length) return { cls: "bad", word: "SHELTER", sub: "Solar particle alert in the last 72 h (measured near Earth). Stay in the habitat.", n: newest(sep) };
    const cmes = notes.map(marsCme).filter((c) => c && c.issued <= now && now <= c.until).sort((a, b) => b.issued - a.issued);
    if (cmes.length) {
      const c = cmes[0];
      const when = c.arrive != null ? ` around ${utcShort(c.arrive)} (±${c.pmH} h${c.how ? `, ${c.how}` : ""})` : "";
      return { cls: "warn", word: "WATCH", n: c.n,
        sub: `NASA's model ${c.arrive != null && c.arrive < now ? "predicted" : "predicts"} a solar eruption (CME) reaching Mars${when}. Keep the EVA short and close to shelter.` };
    }
    const xfl = notes.filter((n) => n.type === "FLR" && /\bX\d/.test(n.body || "") && within(n, 72));
    if (xfl.length) return { cls: "warn", word: "WATCH", sub: "X-class solar flare in the last 72 h.", n: newest(xfl) };
    return { cls: "ok", word: "CLEAR", sub: "No solar particle alert in the last 72 h and no eruption (CME) predicted at Mars now.", n: newest(notes) };
  }

  function renderConditions() {
    let html = '<div class="lbl-lg">Conditions</div>';
    if (S.donki && S.donki.notes) {
      const live = !!S.donki.live, saved = S.donki.fetched || "an earlier date";
      const ref = live ? Date.now() : (Date.parse(`${S.donki.fetched}T23:59:59+08:00`) || Date.now());
      const v = spaceWeather(S.donki.notes, ref);
      const src = live ? "Live NASA DONKI notices" : `Saved NASA DONKI notices from ${saved}; the live feed did not answer`;
      const link = v.n && /^https:\/\//.test(v.n.url || "") ? v.n.url : "";
      html += `<div class="cond-row"><span>Space weather</span><b class="${v.cls}">${v.word}</b><span class="s">${live ? "" : `As of ${esc(saved)}: `}${esc(v.sub)} ${src}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">${v.cls === "ok" ? "latest notice" : "the notice"}</a>` : ""}.</span></div>`;
    }
    if (S.meda && S.meda.sols && S.meda.sols.length) {
      const w = S.meda.sols[S.meda.sols.length - 1];
      const [rh, rm] = w.sunrise.split(":").map(Number), [sh, sm] = w.sunset.split(":").map(Number);
      const day = ((sh * 60 + sm) - (rh * 60 + rm) - 120) / 60, fits = day >= S.m.totals.eva_h;
      html += `<div class="cond-row"><span>Daylight</span><b class="${fits ? "ok" : "warn"}">${fits ? "OK" : "TOO LONG"}</b><span class="s">${day.toFixed(1)} h usable vs ${S.m.totals.eva_h.toFixed(1)} h EVA · ${w.min_temp}°C to ${w.max_temp}°C · latest available Perseverance MEDA data (${medaLatest()})</span></div>`;
    }
    $("#conditions").innerHTML = html;
  }

  // e.g. "sol 1133, April 2024": the public MEDA feed stops in 2024, so the app never calls it live
  function medaLatest() {
    const s = S.meda && S.meda.sols && S.meda.sols[S.meda.sols.length - 1];
    if (!s) return "";
    const when = new Date(`${s.terrestrial_date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return `sol ${s.sol}, ${when}`;
  }

  function refreshDonki() {
    const end = new Date(), start = new Date(end - 30 * 864e5), d = (x) => x.toISOString().slice(0, 10);
    const q = `startDate=${d(start)}&endDate=${d(end)}&type=all`;
    const get = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    // NASA's CCMC serves the notices without a key; api.nasa.gov (demo key, rate-limited) is the second try
    get(`https://ccmc.gsfc.nasa.gov/DONKI/WS/get/notifications?${q}`)
      .catch(() => get(`https://api.nasa.gov/DONKI/notifications?${q}&api_key=DEMO_KEY`))
      .then((notes) => {
        if (!Array.isArray(notes)) return;
        S.donki = { live: true, fetched: d(end),
          notes: notes.map((n) => ({ type: n.messageType, id: n.messageID, issued: n.messageIssueTime, url: n.messageURL, body: (n.messageBody || "").slice(0, 8000) })) };
        renderConditions();
      })
      .catch(() => {});
  }

  /* ---------- selected stop panel ---------- */
  function selectStop(id, fly) {
    S.sel = id;
    renderStopList(); renderStopPanel(); refreshMarkers();
    const s = stopById(id);
    if (fly) map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15.5), { duration: 0.7 });
  }

  function renderStopPanel() {
    const m = S.m, s = stopById(S.sel);
    if (!s) return;
    const i = m.order.indexOf(s.id), t = (m.timeline || [])[i];
    const photos = s.photos || [];
    const tr = s.terrain;
    const awayM = s.rover_lat != null ? map.distance([s.lat, s.lon], [s.rover_lat, s.rover_lon]) * (R_MARS / 6378137) : 0;
    let html = `<div class="lbl">Selected stop</div>
      <div class="stop-title"><span class="n">${numberOf(s.id)}</span><h2>${esc(s.name)}</h2></div>`;
    if (photos.length) {
      html += `<div class="grid6">${photos.slice(0, 6).map((p, k) => `<button data-k="${k}" aria-label="Open photo ${k + 1}"><img src="${p.thumb || p.small || p.medium}" alt="${esc(p.cam)} view near ${esc(s.name)}"></button>`).join("")}</div>
        <button class="more" id="allPhotos">View all ${photos.length} rover photos</button>
        <div class="src">Perseverance, sol ${s.rover_sol}${awayM > 30 ? `, ${Math.round(awayM)} m from this stop` : ""} · NASA/JPL-Caltech</div>`;
    }
    if (tr) {
      html += `<hr class="r"><div class="lbl-lg">Terrain within 50 m</div><table class="tbl">
        <tr><td>Slope, mean / max</td><td>${tr.slope_mean}° / ${tr.slope_max}°</td></tr>
        <tr><td>Roughness (RMS)</td><td>${tr.rough_rms} m</td></tr>
        <tr><td>Elevation</td><td>${Math.round(tr.elev_min)} to ${Math.round(tr.elev_max)} m</td></tr>
        <tr><td>No-go ground (&gt; ${m.assumptions.max_slope_deg}°)</td><td class="${tr.nogo_pct > 10 ? "warn" : ""}">${tr.nogo_pct} %</td></tr></table>`;
    }
    if (s.notes && !s.moved) {
      html += `<hr class="r"><div class="lbl-lg">What Perseverance did here</div><p class="note">${esc(s.notes.text)}</p>
        <div class="src">${s.notes.sources.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}</div>`;
    } else if (s.moved) {
      html += `<hr class="r"><p class="note">You moved this stop. The photos show where Perseverance stopped on sol ${s.rover_sol}${awayM > 30 ? `, ${Math.round(awayM)} m away` : ""}.</p>`;
    }
    html += `<hr class="r"><div class="lbl-lg">Get home from here</div><table class="tbl">`;
    if (s.id === "base") {
      html += `<tr><td>Safe haven</td><td>Base camp</td></tr><tr><td>Start</td><td>T+0:00</td></tr>${t ? "" : ""}`;
      const ret = (m.timeline || [])[m.order.length - 1];
      if (ret) html += `<tr><td>Back home</td><td>T+${hm(ret.arrive_min)}</td></tr>`;
    } else if (t) {
      const bf = m.walkback.bad ? m.walkback.bad.factor : 2, lim = m.walkback.suit ? m.walkback.suit.limit_min : 50;
      html += `<tr><td>Walk home, normal pace</td><td>${fmtMin(t.back_min)}</td></tr>
        <tr><td>Walk home if something goes wrong</td><td>${fmtMin(t.back_min * bf)}</td></tr>
        <tr><td>Suit failure (backup O2)</td><td class="${t.back_min <= lim ? "ok" : "bad"}">${t.back_min <= lim ? "PASS" : "FAIL"} ${Math.round(t.back_min)} / ${lim} min</td></tr>
        <tr><td>Leave by · plan fits</td><td class="${t.spare_min < 0 ? "bad" : t.spare_min < 30 ? "warn" : ""}">T+${hm(t.leave_by_min)} (${sgn(t.spare_min)}${fmtMin(t.spare_min)})</td></tr>
        ${t.bad_leave_by_min != null ? `<tr><td>Leave by · if something goes wrong</td><td class="${t.bad_spare_min < 0 ? "bad" : ""}">T+${hm(t.bad_leave_by_min)} (${sgn(t.bad_spare_min)}${fmtMin(t.bad_spare_min)})</td></tr>` : ""}
        <tr><td>On site</td><td>T+${hm(t.arrive_min)} – T+${hm(t.depart_min)}</td></tr>`;
    }
    html += `</table><div class="drag-hint">Drag the stop on the map to move it. The route and every check update live.</div>`;
    const box = $("#right");
    box.innerHTML = html;
    box.querySelectorAll(".grid6 button").forEach((b) => (b.onclick = () => openLightbox(s, +b.dataset.k)));
    const all = $("#allPhotos");
    if (all) all.onclick = () => openLightbox(s, 0);
  }

  /* ---------- overlays + legend ---------- */
  const OVERLAYS = [
    { id: "slope", name: "No-go slopes", file: "slope.png", on: true, sw: "linear-gradient(90deg,#facc15,#f97316,#dc2626)" },
    { id: "hazard", name: "Rough ground", file: "hazard.png", on: false, sw: "#a855f7" },
    { id: "returntime", name: "Walk-home time map", file: "returntime.png", on: false, sw: "linear-gradient(90deg,#22c55e,#eab308,#ef4444)" },
    { id: "hillshade", name: "Terrain shading", file: "hillshade.png", on: false, sw: "linear-gradient(90deg,#222,#ddd)" },
    { id: "traverse", name: "Perseverance's real path", on: true, sw: "repeating-linear-gradient(90deg,#38bdf8 0 4px,transparent 4px 7px)" },
    { id: "o2", name: "50-min backup-oxygen line", on: true, sw: "repeating-linear-gradient(90deg,#fbbf24 0 5px,transparent 5px 8px)" },
  ];

  function buildOverlays(m, traverse) {
    for (const o of OVERLAYS) {
      if (o.file) S.overlays[o.id] = L.imageOverlay(`data/${o.file}`, m.overlay_bounds, { interactive: false, opacity: o.id === "hillshade" ? 0.85 : 1 });
    }
    if (traverse) S.overlays.traverse = L.geoJSON(traverse, { style: { color: "#38bdf8", weight: 2, opacity: 0.8, dashArray: "4 4" }, interactive: false });
    for (const o of OVERLAYS) if (o.on && S.overlays[o.id]) S.overlays[o.id].addTo(map);
  }

  function renderLegend() {
    const rows = [['<i style="height:3px;background:var(--route)"></i>', "Planned Marswalk"],
      ['<i style="width:12px;height:12px;border-radius:50%;background:var(--route);border:2px solid #fff"></i>', "Stop"]];
    if (zone.active) {
      rows.push(['<i style="background:rgba(74,222,128,.35);border:1px solid #bbf7d0"></i>', "Can still get home (if something goes wrong)"]);
      rows.push(['<i style="height:2px;background:rgba(255,255,255,.7)"></i>', "Normal-pace limit"]);
      rows.push(['<i style="width:12px;height:12px;border-radius:50%;background:#38bdf8;border:2px solid #fff"></i>', "Crew now"]);
      rows.push(['<i style="width:10px;height:10px;border-radius:50%;border:2px solid var(--warn)"></i>', "Tightest point of the plan"]);
    }
    for (const o of OVERLAYS) {
      const lay = S.overlays[o.id] || (o.id === "o2" ? zone.o2 : null);
      if (lay && map.hasLayer(lay) && o.id !== "hillshade") rows.push([`<i style="background:${o.sw}"></i>`, o.name]);
    }
    $("#legend").innerHTML = rows.map(([i, t]) => `<div>${i}<span>${t}</span></div>`).join("");
  }

  function renderLayersPanel() {
    const box = $("#layersPanel");
    let html = '<button class="x" data-close="layersPanel" aria-label="Close">&times;</button><div class="lbl-lg">Map layers</div>';
    for (const o of OVERLAYS) html += `<label class="lay"><input type="checkbox" data-ov="${o.id}" ${o.on ? "checked" : ""}> ${o.name}</label>`;
    html += '<div class="lbl-lg" style="margin-top:14px">Background</div><div class="bases">';
    for (const k of Object.keys(BASES)) html += `<button data-base="${k}" class="${k === baseKey ? "on" : ""}">${BASES[k].name}</button>`;
    html += "</div>";
    box.innerHTML = html;
    box.querySelectorAll("input[data-ov]").forEach((inp) => (inp.onchange = () => {
      const id = inp.dataset.ov, lay = id === "o2" ? zone.o2 : S.overlays[id];
      OVERLAYS.find((o) => o.id === id).on = inp.checked;
      if (lay) inp.checked ? lay.addTo(map) : map.removeLayer(lay);
      bringRouteToFront(); renderLegend();
    }));
    box.querySelectorAll("button[data-base]").forEach((b) => (b.onclick = () => {
      map.removeLayer(BASES[baseKey].layer); baseKey = b.dataset.base; BASES[baseKey].layer.addTo(map);
      box.querySelectorAll("button[data-base]").forEach((x) => x.classList.toggle("on", x === b));
    }));
    wireClose(box);
  }

  /* ---------- route + markers ---------- */
  function drawRouteLine(route) {
    if (S.routeLine) { map.removeLayer(S.routeLine); map.removeLayer(S.routeCasing); }
    S.routeCasing = L.geoJSON(route, { style: { color: "#0b0b0b", weight: 7, opacity: 0.65 }, interactive: false }).addTo(map);
    S.routeLine = L.geoJSON(route, { style: { color: "#ff6a3d", weight: 3.5, opacity: 1 }, interactive: false }).addTo(map);
  }
  function bringRouteToFront() { if (S.routeCasing) { S.routeCasing.bringToFront(); S.routeLine.bringToFront(); } }

  function markerIcon(s) {
    const n = numberOf(s.id), off = n === "–", sel = S.sel === s.id;
    return L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="mk-wrap"><div class="mk ${sel ? "sel" : ""} ${off ? "off" : ""}">${n}</div><div class="mk-lbl">${esc(shortName(s))}</div></div>` });
  }
  function createMarkers(m) {
    for (const s of m.stops) {
      const mk = L.marker([s.lat, s.lon], { icon: markerIcon(s), draggable: true, keyboard: true, title: `${s.name}: click to see it, drag to move it`, zIndexOffset: 1000 }).addTo(map);
      mk.on("click", () => selectStop(s.id, false));
      mk.on("dragend", () => {
        const ll = mk.getLatLng(), st = stopById(s.id);
        S.undo = { id: s.id, lat: st.lat, lon: st.lon, moved: !!st.moved };   // where to put it back if no route is found
        st.lat = ll.lat; st.lon = ll.lng; st.moved = true;
        S.sel = s.id; replan();
      });
      S.markers[s.id] = mk;
    }
  }
  function refreshMarkers() { for (const s of S.m.stops) S.markers[s.id].setLatLng([s.lat, s.lon]).setIcon(markerIcon(s)); }

  /* ---------- timeline: EVA clock + elevation along time ---------- */
  const TL = { pad: { l: 16, r: 18, t: 8 }, axisY: 22, stopY: 44, profTop: 62 };
  function tlScale() {
    const svg = $("#tlSvg"), W = svg.clientWidth || 900, H = svg.clientHeight || 130;
    const P = S.m.profile, lim = S.m.walkback.eva_limit_h * 60;
    const Tmax = Math.max(lim, Math.ceil(P[P.length - 1].t / 60) * 60);   // stretch the axis if the walk runs past the EVA limit
    return { svg, W, H, Tmax, lim, X: (t) => TL.pad.l + (Math.max(0, Math.min(Tmax, t)) / Tmax) * (W - TL.pad.l - TL.pad.r) };
  }
  function drawTimeline() {
    const m = S.m, P = m.profile, { svg, W, H, Tmax, lim, X } = tlScale();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const zs = P.map((p) => p.z), zMin = Math.min(...zs) - 4, zMax = Math.max(...zs) + 4;
    const Y = (z) => TL.profTop + (1 - (z - zMin) / (zMax - zMin)) * (H - TL.profTop - 8);
    let g = "";
    const narrow = W < 640;   // phones: label every 2nd hour and number-only stops
    // hour ticks
    for (let h = 0; h <= Tmax / 60; h++) {
      const x = X(h * 60);
      g += `<line x1="${x}" x2="${x}" y1="${TL.axisY - 4}" y2="${TL.axisY + 4}" stroke="rgba(255,255,255,.55)"/>`;
      if (h % (W < 330 ? 4 : narrow ? 2 : 1)) continue;   // fewer hour labels on narrow timelines
      g += `<text x="${x}" y="${TL.axisY - 8}" fill="#a3a9b1" font-size="11" font-family="Barlow Semi Condensed" letter-spacing="1.2" text-anchor="${h === 0 ? "start" : h === Tmax / 60 ? "end" : "middle"}">T+${h}:00</text>`;
    }
    g += `<line x1="${X(0)}" x2="${X(Tmax)}" y1="${TL.axisY}" y2="${TL.axisY}" stroke="rgba(255,255,255,.35)"/>`;
    // usable budget marker (plan fits) and EVA end
    const xb = X(m.walkback.budget_min);
    g += `<line x1="${xb}" x2="${xb}" y1="${TL.axisY}" y2="${H - 6}" stroke="#fbbf24" stroke-dasharray="3 3" opacity=".6"/>`;
    g += `<text x="${xb + 4}" y="${TL.stopY + 4}" fill="#fbbf24" font-size="10" font-family="Barlow Semi Condensed" letter-spacing="1">USABLE ${hm(m.walkback.budget_min)}</text>`;
    if (Tmax > lim) {
      const xl = X(lim);
      g += `<line x1="${xl}" x2="${xl}" y1="${TL.axisY}" y2="${H - 6}" stroke="#f87171" stroke-dasharray="3 3"/>`;
      g += `<text x="${xl + 4}" y="${TL.stopY + 16}" fill="#f87171" font-size="10" font-family="Barlow Semi Condensed" letter-spacing="1">EVA LIMIT ${hm(lim)}</text>`;
    }
    // stops on the clock
    (m.timeline || []).forEach((t, i) => {
      const id = m.order[i], s = stopById(id), last = i === m.order.length - 1;
      const xa = X(t.arrive_min), xd = X(t.depart_min);
      if (xd > xa) g += `<rect x="${xa}" y="${TL.axisY - 3}" width="${xd - xa}" height="6" fill="#ff6a3d" opacity=".85"/>`;
      g += `<circle cx="${xa}" cy="${TL.axisY}" r="4" fill="#ff6a3d" stroke="#fff" stroke-width="1.5"/>`;
      if (i > 0) g += `<text x="${xa}" y="${TL.stopY}" fill="#f1f2f3" font-size="10.5" font-family="Barlow Semi Condensed" letter-spacing="1.2" text-anchor="middle">${last ? m.order.length : numberOf(id)}${narrow ? "" : ` ${esc(last ? "HOME" : shortName(s).toUpperCase())}`}</text>`;
    });
    // elevation along the EVA (time axis); steep stretches drawn in orange (12-15°) and red (over 15°)
    const pts = P.map((p) => `${X(p.t).toFixed(1)},${Y(p.z).toFixed(1)}`).join(" ");
    g += `<polygon points="${X(P[0].t)},${H - 8} ${pts} ${X(P[P.length - 1].t)},${H - 8}" fill="rgba(255,255,255,.08)"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.2"/>`;
    const steepCol = (s) => (s > 15 ? "#f87171" : s > 12 ? "#fb923c" : null);
    let run = [], runCol = null;
    const flush = () => { if (run.length > 1 && runCol) g += `<polyline points="${run.join(" ")}" fill="none" stroke="${runCol}" stroke-width="2.4"/>`; run = []; };
    for (let i = 1; i < P.length; i++) {
      const c = P[i].leg === P[i - 1].leg ? steepCol(Math.max(P[i].s, P[i - 1].s)) : null;
      if (c !== runCol) { flush(); runCol = c; }
      if (c) {
        if (!run.length) run.push(`${X(P[i - 1].t).toFixed(1)},${Y(P[i - 1].z).toFixed(1)}`);
        run.push(`${X(P[i].t).toFixed(1)},${Y(P[i].z).toFixed(1)}`);
      }
    }
    flush();
    g += `<text x="${W - TL.pad.r}" y="${TL.profTop + 6}" fill="#6f7680" font-size="10" font-family="Barlow Semi Condensed" text-anchor="end" letter-spacing="1">${Math.round(zMax)} M</text>`;
    g += `<text x="${W - TL.pad.r}" y="${H - 10}" fill="#6f7680" font-size="10" font-family="Barlow Semi Condensed" text-anchor="end" letter-spacing="1">${Math.round(zMin)} M</text>`;
    // playhead
    const xp = X(eva.T);
    g += `<g id="playhead" visibility="${zone.active ? "visible" : "hidden"}"><line x1="${xp}" x2="${xp}" y1="${TL.axisY - 12}" y2="${H - 6}" stroke="#fff" stroke-width="1.5"/><rect x="${xp - 5}" y="${TL.axisY - 5}" width="10" height="10" fill="#fff"/></g>`;
    svg.innerHTML = g;
  }
  function movePlayhead(T) {
    const ph = $("#playhead");
    if (!ph) return;
    const { X } = tlScale(), x = X(T);
    ph.setAttribute("visibility", "visible");
    const [ln, rc] = ph.children;
    ln.setAttribute("x1", x); ln.setAttribute("x2", x); rc.setAttribute("x", x - 5);
  }
  (function wireTimeline() {
    const svg = $("#tlSvg"), tip = $("#tlTip");
    let drag = false;
    const tAt = (e) => { const { W, Tmax } = tlScale(), r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
      return Math.max(0, Math.min(Tmax, ((x - TL.pad.l) / (W - TL.pad.l - TL.pad.r)) * Tmax)); };
    svg.addEventListener("pointerdown", (e) => { if (!S.m) return; drag = true; svg.setPointerCapture(e.pointerId); pause(); setTime(tAt(e)); });
    svg.addEventListener("pointermove", (e) => {
      if (!S.m) return;
      const T = tAt(e);
      if (drag) { setTime(T); return; }
      const st = stateAt(T), r = svg.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = `${Math.min(r.width - 230, Math.max(0, e.clientX - r.left + 12))}px`;
      tip.textContent = st.after ? `T+${hm(T)} · back at base camp` : `T+${hm(T)} · ${Math.round(st.p.z)} m · slope ${Math.round(st.p.s)}° · walk home ${fmtMin(st.p.back)}`;
      // show the same moment on the map
      const b = stopById("base"), pos = st.after ? [b.lat, b.lon] : pointAtDistance(st.d);
      if (!S.hover) S.hover = L.circleMarker(pos, { radius: 7, color: "#fff", weight: 2, fill: false, interactive: false });
      S.hover.setLatLng(pos).addTo(map);
    });
    const end = () => { drag = false; };
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", () => { tip.hidden = true; if (S.hover) map.removeLayer(S.hover); });
  })();
  window.addEventListener("resize", () => S.m && drawTimeline());

  /* ---------- where the crew is at mission time T ---------- */
  function stateAt(T) {
    const P = S.m.profile, last = P[P.length - 1];
    if (T >= last.t) return { p: last, q: last, f: 0, d: last.d, gap: false, after: true };
    let i = 0;
    while (i < P.length - 1 && P[i + 1].t <= T) i++;
    const p = P[i], q = P[Math.min(i + 1, P.length - 1)], gap = q.leg !== p.leg;
    const f = !gap && q.t > p.t ? (T - p.t) / (q.t - p.t) : 0;
    return { p, q, f, d: p.d + (q.d - p.d) * f, gap, after: false };
  }
  function pointAtDistance(d) {
    const toRad = Math.PI / 180;
    let acc = 0, prev = null;
    for (const layer of S.routeLine.getLayers()) for (const ll of layer.getLatLngs()) {
      if (prev) {
        const dy = (ll.lat - prev.lat) * toRad * R_MARS, dx = (ll.lng - prev.lng) * toRad * R_MARS * Math.cos(ll.lat * toRad);
        const seg = Math.hypot(dx, dy);
        if (acc + seg >= d) { const f = (d - acc) / (seg || 1); return [prev.lat + (ll.lat - prev.lat) * f, prev.lng + (ll.lng - prev.lng) * f]; }
        acc += seg;
      }
      prev = ll;
    }
    return prev ? [prev.lat, prev.lng] : null;
  }
  const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
  function bearing(a, b) {
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  /* ---------- EVA clock, crew marker and the "can still get home" zone ---------- */
  const eva = { T: 0, playing: false, raf: 0, marker: null, pulse: null };
  const zone = { field: null, overlay: null, o2: null, canvas: document.createElement("canvas"), img: null, url: null, busy: false, pending: null, active: false };
  const playBtn = $("#playBtn");
  playBtn.onclick = () => { closeGuide(); eva.playing ? pause() : play(); };
  function setPlayBtn(mode) {   // "play" | "pause" | "replay"
    const label = mode === "pause" ? "Pause" : mode === "replay" ? "Walk it again" : "Walk the plan";
    playBtn.innerHTML = `<span class="${mode === "pause" ? "sq" : "tri"}"></span><span class="pl">${label}</span><span class="gnum" aria-hidden="true">2</span>`;
    playBtn.setAttribute("aria-label", label);
  }

  function setField(field) {
    zone.field = field;
    drawO2Line();
    if (zone.active) renderZone(eva.T);
  }

  // Fixed line: everywhere within 50 min of walking from base camp (suit failure, 1 h backup oxygen).
  function drawO2Line() {
    const g = S.m && S.m.grid, f = zone.field;
    if (!g || !f) return;
    const lim = ((S.m.walkback.suit && S.m.walkback.suit.limit_min) || 50) * 10;
    const c = document.createElement("canvas"); c.width = g.w; c.height = g.h;
    const ctx = c.getContext("2d"), img = ctx.createImageData(g.w, g.h), px = img.data, w = g.w, n = g.w * g.h;
    for (let i = 0; i < n; i++) {
      if (f[i] > lim) continue;
      const edge = (i % w < w - 1 && f[i + 1] > lim) || (i % w > 0 && f[i - 1] > lim) || (i + w < n && f[i + w] > lim) || (i >= w && f[i - w] > lim);
      const x = i % w, y = (i / w) | 0;
      if (edge && (x + y) % 6 < 4) { const o = i * 4; px[o] = 251; px[o + 1] = 191; px[o + 2] = 36; px[o + 3] = 240; }
    }
    ctx.putImageData(img, 0, 0);
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const on = OVERLAYS.find((o) => o.id === "o2").on;
      if (zone.o2) { zone.o2.setUrl(url); } else { zone.o2 = L.imageOverlay(url, S.m.overlay_bounds, { interactive: false }); }
      if (on && !map.hasLayer(zone.o2)) zone.o2.addTo(map);
      bringRouteToFront(); renderLegend();
    }, "image/png");
  }

  function renderZone(T) {
    const g = S.m && S.m.grid;
    if (!zone.field || !g) return;
    if (zone.busy) { zone.pending = T; return; }
    zone.busy = true;
    const { w, h } = g, wb = S.m.walkback, bf = wb.bad ? wb.bad.factor : 2;
    if (zone.canvas.width !== w) { zone.canvas.width = w; zone.canvas.height = h; zone.img = null; }
    const ctx = zone.canvas.getContext("2d");
    if (!zone.img) zone.img = ctx.createImageData(w, h);
    const px = zone.img.data, f = zone.field, n = w * h;
    const thrBad = ((wb.eva_limit_h * 60 - T) / bf) * 10, thrN = (wb.budget_min - T) * 10;
    for (let i = 0; i < n; i++) {
      const o = i * 4, v = f[i];
      px[o + 3] = 0;
      if (v <= thrBad) {
        const edge = (i % w < w - 1 && f[i + 1] > thrBad) || (i % w > 0 && f[i - 1] > thrBad) || (i + w < n && f[i + w] > thrBad) || (i >= w && f[i - w] > thrBad);
        if (edge) { px[o] = 187; px[o + 1] = 247; px[o + 2] = 208; px[o + 3] = 240; } else { px[o] = 74; px[o + 1] = 222; px[o + 2] = 128; px[o + 3] = 52; }
      }
      if (v <= thrN && thrN > 0) {
        const e2 = (i % w < w - 1 && f[i + 1] > thrN) || (i % w > 0 && f[i - 1] > thrN) || (i + w < n && f[i + w] > thrN) || (i >= w && f[i - w] > thrN);
        if (e2) { px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = 150; }
      }
    }
    ctx.putImageData(zone.img, 0, 0);
    zone.canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      if (!zone.overlay) zone.overlay = L.imageOverlay(url, S.m.overlay_bounds, { interactive: false });
      else zone.overlay.setUrl(url);
      if (zone.active && !map.hasLayer(zone.overlay)) zone.overlay.addTo(map);
      if (zone.url) URL.revokeObjectURL(zone.url);
      zone.url = url;
      bringRouteToFront();
      zone.busy = false;
      if (zone.pending !== null) { const t = zone.pending; zone.pending = null; renderZone(t); }
    }, "image/png");
  }

  function setTime(T) {
    const m = S.m;
    if (!m) return;
    eva.T = T;
    if (!zone.active) { zone.active = true; renderLegend(); }
    movePlayhead(T);
    const wb = m.walkback, bf = wb.bad ? wb.bad.factor : 2, lim = wb.suit ? wb.suit.limit_min : 50;
    const st = stateAt(T), baseS = stopById("base");
    const pos = st.after ? [baseS.lat, baseS.lon] : pointAtDistance(st.d);
    if (!eva.marker) {
      eva.pulse = L.circleMarker(pos, { radius: 16, color: "#38bdf8", weight: 1.5, fill: false, opacity: 0.7, interactive: false });
      eva.marker = L.circleMarker(pos, { radius: 7, color: "#fff", weight: 2.5, fillColor: "#38bdf8", fillOpacity: 1, interactive: false });
    }
    eva.pulse.setLatLng(pos).addTo(map); eva.marker.setLatLng(pos).addTo(map);
    if (eva.playing && !map.getBounds().pad(-0.3).contains(pos)) map.panTo(pos, { animate: true, duration: 0.5 });
    renderZone(T);

    // the tightest point of the plan (smallest "plan fits" margin), shown while the clock is in use
    const w = wb.worst;
    if (w && w.lat != null) {
      const txt = `Tightest ${sgn(w.margin_min)}${fmtMin(w.margin_min)}`, key = `${w.lat},${w.lon},${txt}`;
      if (eva.tightKey !== key) {
        const icon = L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="tight-dot"></div><div class="tight-lbl">${txt}</div>` });
        if (!eva.tight) eva.tight = L.marker([w.lat, w.lon], { icon, interactive: false, keyboard: false });
        else eva.tight.setLatLng([w.lat, w.lon]).setIcon(icon);
        eva.tightKey = key;
      }
      if (!map.hasLayer(eva.tight)) eva.tight.addTo(map);
    }

    const back = st.after ? 0 : st.p.back + ((st.q.back ?? st.p.back) - st.p.back) * st.f;
    const Tm = st.after ? m.profile[m.profile.length - 1].t : T;   // once home, the margins stay at their arrival values
    const mPlan = wb.budget_min - (Tm + back), mBad = wb.eva_limit_h * 60 - (Tm + bf * back);
    const leg = st.gap ? st.q.leg : st.p.leg;
    const nextS = stopById(m.order[leg + 1] || "base");
    const here = st.gap ? stopById(m.order[st.q.leg]) : null;
    const dist = nextS ? map.distance(pos, [nextS.lat, nextS.lon]) * (R_MARS / 6378137) : 0;
    let whereLbl, whereVal, whereSub = "";
    if (st.after) { whereLbl = "Status"; whereVal = "BACK AT BASE CAMP"; whereSub = `Home at T+${hm(m.profile[m.profile.length - 1].t)}`; }
    else if (here) {
      const tl = (m.timeline || [])[st.q.leg];
      whereLbl = "On site"; whereVal = shortName(here).toUpperCase();
      if (tl) whereSub = `Leave by T+${hm(tl.leave_by_min)}`;
    } else {
      whereLbl = "Next stop";
      whereVal = `${shortName(nextS).toUpperCase()} · ${(dist / 1000).toFixed(2)} KM ${compass(bearing(pos, [nextS.lat, nextS.lon]))}`;
      whereSub = `Slope ${Math.round(st.p.s)}° · ${Math.round(st.p.z)} m`;
    }
    const worstNow = Math.min(mPlan, mBad), suitBad = back > lim, alarm = !st.after && (worstNow < 0 || suitBad);
    const live = $("#live");
    live.hidden = false;
    live.className = `pnl live ${alarm ? "alarm" : ""}`;
    live.innerHTML = `<div><span class="lbl">MET</span><b>T+${hm(T)}</b></div>
      <div class="where"><span class="lbl">${whereLbl}</span><b>${esc(whereVal)}</b>${whereSub ? `<small>${esc(whereSub)}</small>` : ""}</div>
      <div><span class="lbl">Walk home</span><b class="${suitBad ? "bad" : ""}">${fmtMin(back)}</b></div>
      <div><span class="lbl">If something goes wrong</span><b class="${mBad < 0 ? "bad" : "ok"}">${sgn(mBad)}${fmtMin(mBad)}</b></div>
      <div><span class="lbl">Plan fits</span><b class="${mPlan < 0 ? "bad" : mPlan < 30 ? "warn" : "ok"}">${sgn(mPlan)}${fmtMin(mPlan)}</b></div>
      ${alarm ? '<div class="alarm-txt">TURN BACK</div>' : ""}`;
  }

  function play() {
    const m = S.m;
    if (!m) return;
    const lastT = m.profile[m.profile.length - 1].t;
    const end = Math.min(tlScale().Tmax, lastT + 10);   // stop shortly after the crew is home
    const start = eva.T >= end - 0.5 ? 0 : eva.T;
    if (start === 0) { const b = stopById("base"); map.flyTo([b.lat, b.lon], Math.max(map.getZoom(), 15), { duration: 0.6 }); }
    eva.playing = true;
    setPlayBtn("pause");
    const t0 = performance.now(), realMs = 32000 * ((end - start) / end);
    const frame = (now) => {
      if (!eva.playing) return;
      const T = Math.min(end, start + ((now - t0) / realMs) * (end - start));
      setTime(T);
      if (T < end) eva.raf = requestAnimationFrame(frame);
      else pause();
    };
    eva.raf = requestAnimationFrame(frame);
  }
  function pause() {
    eva.playing = false;
    cancelAnimationFrame(eva.raf);
    const P = S.m && S.m.profile;
    setPlayBtn(P && eva.T >= P[P.length - 1].t ? "replay" : "play");
  }

  /* ---------- live re-planning (web worker) ---------- */
  const DEFAULT_ORDER = ["base", "depot", "gap", "top", "base"];
  let worker = null, planId = 0, planTimer = 0;

  function renderPlanPanel(m) {
    const a = m.assumptions;
    const sl = (id, label, min, max, step, val, unit) => `<div class="sl"><label for="sl-${id}">${label}<output>${val}${unit}</output></label>
      <input type="range" id="sl-${id}" data-k="${id}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
    const box = $("#planPanel");
    box.innerHTML = `<button class="x" data-close="planPanel" aria-label="Close">&times;</button><div class="lbl-lg">Plan your EVA</div>
      ${sl("vFlat", "Suited walking speed", 0.3, 1.2, 0.02, a.v_flat_ms, " m/s")}
      ${sl("maxSlope", "No-go slope", 10, 25, 1, a.max_slope_deg, "°")}
      ${sl("roughPenalty", "Rough ground slows you", 1, 3, 0.1, a.rough_penalty, "×")}
      ${sl("evaH", "EVA time limit", 4, 10, 0.5, a.eva_limit_h, " h")}
      ${sl("reserve", "Reserve", 0, 50, 5, Math.round(a.reserve * 100), " %")}
      <div class="lbl-lg" style="margin-top:12px">Stops</div>
      ${m.stops.filter((s) => s.id !== "base").map((s) => `<label class="tog"><input type="checkbox" data-stop="${s.id}" checked> ${esc(s.name)}</label>`).join("")}
      <div class="planbar"><button class="ghost" id="resetPlan">Reset</button><span id="planStatus">Default plan · ${m.grid_m} m grid</span></div>`;
    box.querySelectorAll("input[type=range]").forEach((inp) => (inp.oninput = () => {
      inp.closest(".sl").querySelector("output").textContent = inp.value + inp.dataset.unit;
      clearTimeout(planTimer); planTimer = setTimeout(replan, 250);
    }));
    box.querySelectorAll("input[data-stop]").forEach((inp) => (inp.onchange = replan));
    $("#resetPlan").onclick = resetPlan;
    wireClose(box);
  }

  function params() {
    const v = (k) => parseFloat(document.querySelector(`#sl-${k}`).value);
    const a = S.base.assumptions;
    return { maxSlope: v("maxSlope"), vFlat: v("vFlat"), roughPenalty: v("roughPenalty"), roughM: a.rough_m,
      evaH: v("evaH"), reserve: v("reserve") / 100, badFactor: a.bad_day_factor || 2, suitMin: a.suit_fail_min || 50 };
  }

  function initWorker(m) {
    if (!m.grid || !window.Worker) return;
    Promise.all(["grid_slope.u8", "grid_rough.u8", "grid_dem.i16"].map((f) => fetch(`data/${f}`, { cache: "no-cache" }).then((r) => r.arrayBuffer())))
      .then(([slope, rough, dem]) => {
        worker = new Worker("router.js?v=7");
        worker.onmessage = onWorker;
        worker.postMessage({ type: "init", grid: m.grid, slope, rough, dem }, [slope, rough, dem]);
      }).catch(() => {});
  }
  function requestField() {
    if (!worker) return;
    worker.postMessage({ type: "field", id: ++planId, params: params(), stops: S.m.stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })) });
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 8000);
  }
  function replan() {
    if (!worker) { S.pendingReplan = true; $("#planStatus").textContent = "Loading the terrain…"; return; }   // re-run when the terrain is in
    const on = new Set([...document.querySelectorAll("input[data-stop]")].filter((i) => i.checked).map((i) => i.dataset.stop));
    const order = DEFAULT_ORDER.filter((id) => id === "base" || on.has(id));
    if (!order.includes(S.sel)) S.sel = order[1] || "base";
    $("#planStatus").textContent = "Re-planning…";
    worker.postMessage({ type: "plan", id: ++planId, params: params(), order,
      stops: S.m.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dwell_min: s.dwell_min })) });
  }
  function onWorker(e) {
    const r = e.data;
    if (r.type === "ready") { requestField(); if (S.pendingReplan) { S.pendingReplan = false; replan(); } return; }
    if (r.type === "field") { if (r.id === planId) setField(r.field); return; }
    if (r.type !== "plan" || r.id !== planId) return;
    if (r.error) {
      if (S.undo) {   // put the dragged stop back where it was
        const st = stopById(S.undo.id);
        st.lat = S.undo.lat; st.lon = S.undo.lon; st.moved = S.undo.moved; S.undo = null;
        refreshMarkers(); renderStopList(); renderStopPanel();
      }
      $("#planStatus").innerHTML = `<span class="bad">${esc(r.error)}</span>`;
      toast(`${r.error}. Showing the last plan that worked.`);
      return;
    }
    S.undo = null;
    const m = S.m, p = params();
    m.order = [...new Set(r.legs.map((l) => l.frm))].concat(["base"]);
    m.legs = r.legs.map(({ coords, ...l }) => l);
    m.totals = r.totals; m.walkback = r.walkback; m.profile = r.profile; m.timeline = r.timeline;
    m.assumptions = Object.assign({}, m.assumptions, { v_flat_ms: p.vFlat, max_slope_deg: p.maxSlope, rough_penalty: p.roughPenalty, eva_limit_h: p.evaH, reserve: p.reserve });
    for (const s of m.stops) {
      const c = r.stopCells[s.id];
      if (c) { s.lon = c.lonlat[0]; s.lat = c.lonlat[1]; s.elev_m = c.z; if (c.terrain && (s.moved || !s.terrain)) s.terrain = c.terrain; }
    }
    drawRouteLine({ type: "FeatureCollection", features: r.legs.map((l, i) => ({ type: "Feature", properties: { leg: i }, geometry: { type: "LineString", coordinates: l.coords } })) });
    refreshMarkers();
    setField(r.field);
    renderAll();
    if (zone.active && !eva.playing) setTime(Math.min(eva.T, m.walkback.eva_limit_h * 60));
    $("#planStatus").textContent = `Re-planned in ${(r.ms / 1000).toFixed(1)} s · ${m.grid.gx.toFixed(1)} m grid`;
  }
  function resetPlan() {
    const b = clone(S.base);
    S.m = b; S.sel = "top";
    pause(); zone.active = false; eva.T = 0;
    for (const k of ["marker", "pulse", "tight"]) if (eva[k]) map.removeLayer(eva[k]);
    eva.tightKey = null;
    if (zone.overlay) map.removeLayer(zone.overlay);
    $("#live").hidden = true;
    renderPlanPanel(b);
    drawRouteLine(S.route); refreshMarkers(); renderAll(); requestField();
  }

  /* ---------- panels ---------- */
  function openModal(id) { const e = document.getElementById(id); e.hidden = false; }
  function wireClose(root) { root.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { document.getElementById(b.dataset.close).hidden = true; syncNav(); })); }
  function syncNav() { document.querySelectorAll(".topnav button[data-open]").forEach((b) => b.classList.toggle("on", !document.getElementById(b.dataset.open).hidden)); }
  document.querySelectorAll(".topnav button[data-open]").forEach((b) => (b.onclick = () => {
    closeGuide();
    const target = document.getElementById(b.dataset.open), show = target.hidden;
    for (const id of ["layersPanel", "planPanel", "about"]) document.getElementById(id).hidden = true;
    target.hidden = !show;
    syncNav();
  }));
  wireClose(document);
  $("#about").addEventListener("click", (e) => { if (e.target.id === "about") { e.currentTarget.hidden = true; syncNav(); } });

  /* ---------- first-visit guide: 3 steps, numbers pulse on the real controls ---------- */
  const GUIDE_KEY = "rr-guide-v1";
  function openGuide() { $("#guide").hidden = false; document.body.classList.add("guide-on"); }
  function closeGuide() {
    if ($("#guide").hidden) return;
    $("#guide").hidden = true;
    document.body.classList.remove("guide-on");
    try { localStorage.setItem(GUIDE_KEY, "seen"); } catch (e) { /* private mode: show it again next time */ }
  }
  function maybeShowGuide() {
    let seen = false;
    try { seen = localStorage.getItem(GUIDE_KEY) === "seen"; } catch (e) { /* ignore */ }
    if (!seen) openGuide();
  }
  $("#guideGo").onclick = () => { closeGuide(); play(); };
  $("#guideClose").onclick = closeGuide;
  $("#helpBtn").onclick = () => ($("#guide").hidden ? openGuide() : closeGuide());

  /* ---------- photo gallery ---------- */
  const lb = { s: null, k: 0 };
  function openLightbox(s, k) { lb.s = s; lb.k = k; showPhoto(); $("#lightbox").hidden = false; }
  function showPhoto() {
    const p = lb.s.photos[lb.k];
    $("#lbImg").src = p.large || p.medium;
    $("#lbImg").alt = `${p.cam} image near ${lb.s.name}`;
    $("#lbCap").innerHTML = `${lb.k + 1} / ${lb.s.photos.length} · Perseverance ${esc(p.cam.replace(/_/g, " ").toLowerCase())} · sol ${p.sol} · ${esc(lb.s.name)} · NASA/JPL-Caltech${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">source</a>` : ""}`;
  }
  const step = (d) => { lb.k = (lb.k + d + lb.s.photos.length) % lb.s.photos.length; showPhoto(); };
  $("#lbPrev").onclick = () => step(-1);
  $("#lbNext").onclick = () => step(1);
  $("#lbClose").onclick = () => ($("#lightbox").hidden = true);
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (!$("#lightbox").hidden) { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); if (e.key === "Escape") $("#lightbox").hidden = true; return; }
    if (e.key === "Escape") { closeGuide(); for (const id of ["layersPanel", "planPanel", "about"]) document.getElementById(id).hidden = true; syncNav(); }
    if (e.key === " " && e.target === document.body) { e.preventDefault(); eva.playing ? pause() : play(); }
  });

  /* ---------- how it works ---------- */
  function scatterSvg(pairs) {
    const W = 360, H = 240, pad = 38, max = Math.max(20, ...pairs.flat());
    const X = (v) => pad + (v / max) * (W - pad - 12), Y = (v) => H - pad + 8 - (v / max) * (H - pad - 14);
    let g = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(max)}" y2="${Y(max)}" stroke="rgba(255,255,255,.3)" stroke-dasharray="4 4"/>`;
    for (const t of [0, 5, 10, 15, 20].filter((t) => t <= max)) {
      g += `<text x="${X(t)}" y="${H - 12}" font-size="11" fill="#a3a9b1" text-anchor="middle">${t}°</text><text x="${pad - 8}" y="${Y(t) + 4}" font-size="11" fill="#a3a9b1" text-anchor="end">${t}°</text>`;
    }
    for (const [s, t] of pairs) g += `<circle cx="${X(t).toFixed(1)}" cy="${Y(s).toFixed(1)}" r="3" fill="#ff6a3d" fill-opacity=".7"/>`;
    g += `<text x="${W / 2}" y="${H}" font-size="11" fill="#d9dcdf" text-anchor="middle">Perseverance tilt sensor</text>`;
    g += `<text x="11" y="${H / 2}" font-size="11" fill="#d9dcdf" transform="rotate(-90 11 ${H / 2})" text-anchor="middle">Red Route slope map</text>`;
    return `<svg viewBox="0 0 ${W} ${H + 6}" width="100%" style="max-width:420px" role="img" aria-label="Slope map versus rover tilt">${g}</svg>`;
  }

  function renderAbout(m) {
    const a = m.assumptions, rc = m.rover_check, v = m.validation;
    $("#aboutBody").innerHTML = `<h2>How Red Route works</h2>
      <p>Red Route plans a walking EVA in Jezero Crater and checks, at every minute of the walk, that the crew can still get home.</p>
      <h3>The get-home checks</h3>
      <table><tr><th>Check</th><th>Rule</th><th>Where the rule comes from</th></tr>
        <tr><td>Plan fits</td><td>Time so far + walk home at normal pace ≤ ${a.eva_limit_h} h minus ${Math.round(a.reserve * 100)} % reserve</td><td>NASA plans about 6 h inside an 8 h suit (<a href="https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf" target="_blank" rel="noopener">EVA-EXP-0042</a>)</td></tr>
        <tr><td>If something goes wrong</td><td>Time so far + walk home at half speed ≤ ${a.eva_limit_h} h (the reserve may be used)</td><td>Our assumption, built on NASA's walk-back idea (<a href="https://ttu-ir.tdl.org/handle/2346/74208" target="_blank" rel="noopener">EVA walk-back limit study</a>) and rescue of a hurt crewmate (<a href="https://ntrs.nasa.gov/citations/20230005461" target="_blank" rel="noopener">NASA NTRS 20230005461</a>)</td></tr>
        <tr><td>Suit failure</td><td>Walk home ≤ ${a.suit_fail_min || 50} min from every point (1 h backup oxygen, ~10 min to get inside)</td><td>NASA sizes walking EVAs on the backup oxygen (<a href="https://ntrs.nasa.gov/api/citations/20210026296/downloads/Scoville%20Final%20presentation%20-%20compressed.pptx.pdf" target="_blank" rel="noopener">Artemis III EVA study</a>)</td></tr></table>
      <h3>How the route is found</h3>
      <ol><li>Slope and rough ground come from the 1 m HiRISE elevation model of Jezero (USGS, Mars 2020 landing products), corrected for the map projection.</li>
        <li>Each spot gets a walking time: ${a.v_flat_ms} m/s on flat ground, slower on slopes (Tobler's hiking curve), ${a.rough_penalty}× slower on rough ground.</li>
        <li>Ground steeper than ${a.max_slope_deg}° is no-go.</li>
        <li>A least-time path search links the stops. A second search from base camp gives the walk-home time from every spot, which drives all three checks and the green zone.</li></ol>
      <h3>Planning numbers</h3>
      <table><tr><th>Number</th><th>Value</th><th>Source</th></tr>
        <tr><td>Suited walking speed</td><td>${a.v_flat_ms} m/s (2 km/h)</td><td>NASA Artemis planning pace (<a href="https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf" target="_blank" rel="noopener">EVA-EXP-0042 Rev B</a>)</td></tr>
        <tr><td>No-go slope</td><td>${a.max_slope_deg}°</td><td>NASA suit requirement is 20°; Apollo crews walked on slopes under 15° (<a href="https://meetingorganizer.copernicus.org/EPSC2024/EPSC2024-196.html" target="_blank" rel="noopener">Iqbal et al. 2024</a>)</td></tr>
        <tr><td>Speed on slopes</td><td>× exp(−3.5 tan slope)</td><td>Tobler's hiking function, tested on analog missions (<a href="https://discovery.ucl.ac.uk/id/eprint/10201492/1/1-s2.0-S0094576524007501-main.pdf" target="_blank" rel="noopener">Goodwin et al. 2024</a>)</td></tr>
        <tr><td>Rough ground</td><td>&gt; ${a.rough_m} m relief, ${a.rough_penalty}× slower</td><td>Tobler's off-path factor; HiRISE misses rocks under about 1.5 m (<a href="https://marsoweb.nas.nasa.gov/landingsites/msl/workshops/4th_workshop/talks/Golombek_Rocks_4th_Wkshp.pdf" target="_blank" rel="noopener">Golombek</a>)</td></tr>
        <tr><td>EVA limit</td><td>${a.eva_limit_h} h, ${Math.round(a.reserve * 100)} % reserve</td><td>NASA suit design limit (EVA-EXP-0042)</td></tr></table>
      <p style="font-size:12px;color:#6f7680">Half speed after an accident and using the reserve on a bad day are our planning assumptions, not NASA flight rules.</p>
      <h3 id="tests">Real-world tests</h3>
      ${rc ? `<p><b>Slope map vs Perseverance's tilt sensor.</b> The rover logs how far it is tilted at every stop. Its sensor never sees our map. At ${rc.n} stops inside our area our slope agrees with the measured tilt: ${rc.slope_mae_deg}° average difference, ${rc.within_3deg_pct} % within 3°, correlation ${rc.slope_r}.</p>${scatterSvg(rc.pairs)}
      <p><b>Height.</b> Our terrain height matches the rover's logged elevation to ${rc.elev_mae_m} m on average. The rover's positions are tied to the same orbital maps, so this mainly confirms the layers line up.</p>` : ""}
      ${v ? `<p><b>Same climb, different ramp.</b> Between the rover's start and end of its climb onto the delta (sols ${v.sols[0]}–${v.sols[1]}), our walking route stays a median ${Math.round(v.median_m)} m from the rover's track. The rover took a longer path for a one-tonne vehicle and stopped for science, so the two are not expected to match.${v.steep ? ` A straight line between the same two points would cross ${v.steep.line.steep_m} m of slopes steeper than ${v.steep.limit_deg}°, and the rover crossed ${v.steep.rover.steep_m} m; our walk crosses ${v.steep.ours.steep_m ? `${v.steep.ours.steep_m} m` : "none"}.` : ""}</p>
      <figure class="fig"><a href="img/rover_check.jpg" target="_blank" rel="noopener"><img src="img/rover_check.jpg" alt="Map of Perseverance's climb to the delta top: the rover's real path, Red Route's planned walk and a straight line, over slopes steeper than 15 degrees" loading="lazy"></a></figure>` : ""}
      <h3>Where it can be wrong</h3>
      <ul><li>Rocks smaller than about 1.5 m are not in the elevation model. Crews still need the photos to spot boulders.</li>
        <li>The walking curve is Earth-calibrated. Real suited speed depends on the suit, the load and fatigue.</li>
        <li>Solar-particle alerts come from sensors near Earth. Eruption (CME) alerts include Mars arrival times.</li>
        <li>The public MEDA weather summaries end in 2024, so the daylight check uses the latest available sols.</li>
        <li>Base camp sits on flat ground (slopes up to ${(m.stops.find((s) => s.id === "base").terrain || {}).slope_max}° within 50 m), but landing-zone size and rocket-plume distance from the sample depot are not checked.</li></ul>
      <h3>Data</h3>
      <ul><li>HiRISE 1 m elevation model and 25 cm photo mosaic of Jezero: USGS Astrogeology (Mars 2020 landing products), tiles via NASA JPL Mars Trek.</li>
        <li>CTX and MOLA backgrounds: NASA JPL Mars Trek. ESA Mars Express HRSC + NASA MOLA blended relief (USGS).</li>
        <li>Perseverance waypoints, traverse and raw images: NASA/JPL-Caltech.</li>
        <li>Weather: the latest available Perseverance MEDA summaries (${medaLatest()}), NASA/JPL-Caltech. They are not live.</li>
        <li>Space weather: NASA DONKI notices, read live from NASA's CCMC service; if it does not answer, the app shows a saved copy and its date.</li></ul>
      <h3>Use of AI tools</h3>
      <p>The code was written with help from an AI coding assistant (Claude by Anthropic), which also suggested the first version of the site, stops and route rules; the team reviewed and approved them and asked for later changes. The mission badge is an AI-generated image (Higgsfield). All map and rover data are from NASA, USGS and ESA.</p>`;
  }
})();
