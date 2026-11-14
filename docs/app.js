/* Red Route: Marswalk planner for Jezero Crater.
   Map tiles: NASA JPL Mars Trek (WMTS, Mars 2000 sphere, geographic grid).
   Route, slope, roughness and return-time layers: built by tools/build_layers.py from the USGS Mars 2020 TRN HiRISE DTM. */
(() => {
  const TREK = "https://trek.nasa.gov/tiles/Mars/EQ/";
  const trekUrl = (layer, ext) => `${TREK}${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
  const JEZ_HIRISE = [[18.3068, 77.2229], [18.6693, 77.5840]];
  const JEZ_CTX = [[15.9058, 75.1538], [19.4453, 78.8717]];

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmtMin = (m) => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const map = L.map("map", { crs: L.CRS.EPSG4326, center: [18.461, 77.414], zoom: 13.5, minZoom: 3, maxZoom: 19,
    zoomSnap: 0.25, zoomDelta: 0.5, worldCopyJump: false, attributionControl: true });
  map.attributionControl.setPrefix(false);
  const credit = 'Tiles: <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA JPL Mars Trek</a>';
  const base = {
    hirise: L.tileLayer(trekUrl("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png"),
      { maxNativeZoom: 17, maxZoom: 19, bounds: JEZ_HIRISE, attribution: `${credit} · HiRISE (NASA/JPL/UArizona, USGS)` }),
    ctx: L.tileLayer(trekUrl("Jezero_CTX_BlockAdj_dd", "png"),
      { maxNativeZoom: 14, maxZoom: 19, bounds: JEZ_CTX, attribution: `${credit} · CTX (NASA/JPL/MSSS)` }),
    mola: L.tileLayer(trekUrl("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg"),
      { maxNativeZoom: 7, maxZoom: 19, attribution: `${credit} · MOLA (NASA/GSFC)` }),
  };
  const context = L.tileLayer(trekUrl("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg"), { maxNativeZoom: 8, maxZoom: 19, opacity: 1 });
  context.addTo(map);
  let currentBase = "hirise";
  base.hirise.addTo(map);

  const state = { mission: null, overlays: {}, hoverMarker: null, routeLine: null, stopMarkers: {} };
  window.RedRoute = { map, state };

  Promise.all([
    fetch("data/mission.json").then((r) => r.json()),
    fetch("data/route.geojson").then((r) => r.json()),
    fetch("data/m20_traverse.json").then((r) => r.json()).catch(() => null),
    fetch("data/donki.json").then((r) => r.json()).catch(() => null),
    fetch("data/meda.json").then((r) => r.json()).catch(() => null),
  ]).then(([mission, route, traverse, donki, meda]) => {
    state.mission = mission;
    state.base = JSON.parse(JSON.stringify(mission));
    state.donki = donki; state.meda = meda;
    buildOverlays(mission, traverse);
    drawRoute(route, mission);
    renderSummary(mission);
    renderConditions(mission, donki, meda);
    renderStops(mission);
    renderLayers();
    renderAbout(mission);
    drawProfile(mission);
    refreshDonki(mission);
    initPlanner(mission);
  }).catch((e) => { $("#statusPill").textContent = "Could not load mission data"; console.error(e); });

  /* ---------- layers ---------- */
  const OVERLAYS = [
    { id: "slope", name: "Slope", file: "slope.png", on: true, legend: [["#facc15", "8–12°"], ["#f97316", "12–15°"], ["#dc2626", "> 15° (no-go)"]] },
    { id: "hazard", name: "Rough ground", file: "hazard.png", on: false, legend: [["#a855f7", "Boulders / ridges"], ["#7e22ce", "Very rough"]] },
    { id: "returntime", name: "Walk-back time to base", file: "returntime.png", on: false,
      legend: [["#22c55e", "< 15 min"], ["#84cc16", "15–30 min"], ["#eab308", "30–60 min"], ["#f97316", "60–90 min"], ["#ef4444", "> 90 min"]] },
    { id: "hillshade", name: "Terrain shading (HiRISE DTM)", file: "hillshade.png", on: false, legend: null },
    { id: "traverse", name: "Perseverance's real path", on: true, legend: [["#38bdf8", "Rover traverse (NASA/JPL)"]] },
  ];

  function buildOverlays(m, traverse) {
    const b = m.overlay_bounds;
    for (const o of OVERLAYS) {
      if (o.file) {
        state.overlays[o.id] = L.imageOverlay(`data/${o.file}`, b, { opacity: o.id === "hillshade" ? 0.85 : 1, interactive: false, className: `ov-${o.id}` });
      }
    }
    if (traverse) {
      state.overlays.traverse = L.geoJSON(traverse, { style: { color: "#38bdf8", weight: 2, opacity: 0.85, dashArray: "4 4" }, interactive: false });
    }
    for (const o of OVERLAYS) if (o.on && state.overlays[o.id]) state.overlays[o.id].addTo(map);
    updateLegend();
  }

  function updateLegend() {
    const lg = $("#legend");
    lg.innerHTML = "";
    for (const o of OVERLAYS) {
      if (!o.legend || !state.overlays[o.id] || !map.hasLayer(state.overlays[o.id])) continue;
      lg.appendChild(el("b", null, esc(o.name)));
      for (const [c, t] of o.legend) lg.appendChild(el("div", "lg", `<span class="sw" style="background:${c}"></span>${esc(t)}`));
    }
    lg.appendChild(el("b", null, "Route"));
    lg.appendChild(el("div", "lg", '<span class="sw" style="background:#ff5a36"></span>Planned Marswalk'));
  }

  function renderLayers() {
    const box = $("#layers");
    box.innerHTML = "<h2>Map layers</h2>";
    for (const o of OVERLAYS) {
      if (!state.overlays[o.id]) continue;
      const row = el("div", "layer-row");
      const id = `chk-${o.id}`;
      row.innerHTML = `<input type="checkbox" id="${id}" ${map.hasLayer(state.overlays[o.id]) ? "checked" : ""}>
        <label for="${id}">${esc(o.name)}</label>`;
      row.querySelector("input").addEventListener("change", (e) => {
        e.target.checked ? state.overlays[o.id].addTo(map) : map.removeLayer(state.overlays[o.id]);
        if (state.routeLine) state.routeLine.bringToFront();
        updateLegend();
      });
      box.appendChild(row);
    }
    const sel = el("div", "base-select");
    const names = { hirise: "HiRISE 25 cm photo", ctx: "CTX 6 m photo", mola: "MOLA elevation" };
    for (const k of Object.keys(base)) {
      const btn = el("button", k === currentBase ? "on" : "", names[k]);
      btn.addEventListener("click", () => {
        map.removeLayer(base[currentBase]); base[k].addTo(map); currentBase = k;
        sel.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === btn));
      });
      sel.appendChild(btn);
    }
    box.appendChild(el("div", "small", "Background"));
    box.appendChild(sel);
  }

  /* ---------- route + stops ---------- */
  function drawRouteLine(route) {
    if (state.routeLine) { map.removeLayer(state.routeLine); map.removeLayer(state.routeCasing); }
    state.routeCasing = L.geoJSON(route, { style: { color: "#0a0d14", weight: 8, opacity: 0.7 }, interactive: false }).addTo(map);
    state.routeLine = L.geoJSON(route, { style: { color: "#ff5a36", weight: 4, opacity: 1 } }).addTo(map);
    Object.values(state.stopMarkers).forEach((mk) => mk.setZIndexOffset(1000));
  }

  function stopIcon(id, m) {
    const isBase = id === "base";
    const i = m.order.indexOf(id);
    const label = isBase ? "B" : i > 0 ? String(i) : "–";
    return L.divIcon({ className: "", html: `<div class="stop-icon ${isBase ? "base" : ""} ${i < 0 ? "off" : ""}">${label}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  function drawRoute(route, m) {
    drawRouteLine(route);
    for (const s of m.stops) {
      const mk = L.marker([s.lat, s.lon], { icon: stopIcon(s.id, m), keyboard: true, title: `${s.name} (drag to move)`, draggable: true }).addTo(map);
      const pic = (s.photos || [])[0];
      mk.bindPopup(`<div class="popup"><h4>${esc(s.name)}</h4><div class="small">${esc(s.role)}</div>
        <div class="small">Perseverance was here on sol ${s.rover_sol}. Drag the marker to move this stop.</div>
        ${pic ? `<img src="${pic.medium}" alt="Perseverance view near ${esc(s.name)}">` : ""}</div>`, { maxWidth: 260 });
      mk.on("dragend", () => { const ll = mk.getLatLng(); const st = state.mission.stops.find((x) => x.id === s.id); st.lat = ll.lat; st.lon = ll.lng; st.moved = true; replan(); });
      state.stopMarkers[s.id] = mk;
    }
    map.fitBounds(state.routeLine.getBounds(), { paddingTopLeft: [40, 60], paddingBottomRight: [260, 30] });
  }

  function renderSummary(m) {
    const t = m.totals, wb = m.walkback;
    const ok = wb.worst.margin_min >= 0;
    const pill = $("#statusPill");
    pill.textContent = ok ? "Walk-back check: PASS" : "Walk-back check: FAIL";
    pill.className = `pill ${ok ? "ok" : "bad"}`;
    $("#summary").innerHTML = `<h2>Mission: Delta Front Sample Run</h2>
      <div class="stats">
        <div class="stat"><b>${t.dist_km.toFixed(1)} km</b><span>walking distance</span></div>
        <div class="stat"><b>${fmtMin(t.eva_h * 60)}</b><span>EVA time incl. ${t.dwell_min} min of science</span></div>
        <div class="stat"><b>+${t.gain_m} m</b><span>total climb (−${t.loss_m} m down)</span></div>
        <div class="stat"><b>${t.max_slope.toFixed(0)}°</b><span>steepest ground on the route</span></div>
      </div>
      <div class="check ${ok ? "ok" : "bad"}">${ok
        ? `<b>Walk-back rule: safe</b>At every point the crew can reach base camp with at least ${Math.round(wb.worst.margin_min)} min to spare inside the ${wb.eva_limit_h} h EVA (${Math.round(wb.reserve * 100)} % kept in reserve).`
        : `<b>Walk-back rule: broken</b>At the worst point, ${fmtMin(wb.worst.t)} into the EVA, the walk back to base takes ${fmtMin(wb.worst.back)}. That is ${fmtMin(-wb.worst.margin_min)} over the ${fmtMin(wb.budget_min)} budget (${wb.eva_limit_h} h EVA, ${Math.round(wb.reserve * 100)} % reserve). Drop a stop, move base camp closer, or split it into two EVAs.`}
      </div>
      <p class="small">Terrain: ${esc(m.dtm)} · ${m.grid_m} m grid</p>`;
  }

  function renderStops(m) {
    const box = $("#stops");
    box.innerHTML = '<div class="section-title" style="margin:4px 4px 10px">Route and stops</div>';
    m.order.forEach((id, i) => {
      const s = m.stops.find((x) => x.id === id);
      const isBase = id === "base";
      const card = el("div", "stop");
      const isReturn = i === m.order.length - 1;
      card.innerHTML = `<div class="stop-head"><span class="num ${isBase ? "base" : ""}">${isBase ? "B" : i}</span>
          <h3>${isReturn ? "Back at base camp" : esc(s.name)}</h3></div>
        ${isReturn ? "" : `<p class="role">${esc(s.role)}</p>
        <div class="meta"><span>${s.elev_m} m</span><span>sol ${s.rover_sol}</span>${s.dwell_min ? `<span>${s.dwell_min} min on site</span>` : ""}</div>`}`;
      if (!isReturn && s.photos && s.photos.length) {
        const th = el("div", "thumbs");
        for (const p of s.photos.slice(0, 3)) {
          const img = el("img");
          img.src = p.small || p.medium; img.alt = `${p.cam} image near ${s.name}`; img.loading = "lazy";
          img.addEventListener("click", (e) => { e.stopPropagation(); openLightbox(p, s); });
          th.appendChild(img);
        }
        card.appendChild(th);
      }
      card.addEventListener("click", () => { map.flyTo([s.lat, s.lon], 16.5, { duration: 0.8 }); state.stopMarkers[id].openPopup(); });
      box.appendChild(card);
      if (i < m.legs.length) {
        const l = m.legs[i];
        box.appendChild(el("div", "leg", `${(l.dist_m / 1000).toFixed(2)} km · ${fmtMin(l.walk_min)} · +${l.gain_m} m / −${l.loss_m} m ·
          <span class="${l.max_slope > 12 ? "warn" : ""}">max ${l.max_slope}°</span>`));
      }
    });
  }

  /* ---------- conditions ---------- */
  function spaceWeatherVerdict(notes) {
    const now = Date.now();
    const recent = (h) => notes.filter((n) => now - Date.parse(n.issued) < h * 3600e3);
    const r72 = recent(72), r7d = recent(24 * 7);
    const sep = r72.filter((n) => n.type === "SEP");
    const big = r72.filter((n) => n.type === "FLR" && /X\d|M[5-9]/.test(n.body || ""));
    const cme = r72.filter((n) => n.type === "CME");
    if (sep.length) return { cls: "bad", word: "SHELTER", text: `Solar energetic particle alert in the last 72 h. Stay inside the habitat.`, notes: sep };
    if (big.length || cme.length) return { cls: "warn", word: "WATCH", text: `${big.length ? "Strong solar flare" : "Coronal mass ejection"} reported in the last 72 h. Plan a short EVA close to shelter.`, notes: big.length ? big : cme };
    return { cls: "ok", word: "CLEAR", text: `No particle alerts in the last 72 h (${r7d.length} notices this week).`, notes: r7d.slice(0, 1) };
  }

  function renderConditions(m, donki, meda) {
    const box = $("#conditions");
    let html = "<h2>EVA conditions</h2><div class='cond'>";
    if (donki && donki.notes) {
      const v = spaceWeatherVerdict(donki.notes);
      const latest = v.notes[0];
      html += `<div class="cond-row"><span class="badge ${v.cls}">${v.word}</span><p><b>Space weather</b><br>${esc(v.text)}
        ${latest ? `<br><span class="small">Latest: ${esc(latest.type)} · ${esc(latest.issued.replace("T", " "))} · <a href="${esc(latest.url)}" target="_blank" rel="noopener">NASA DONKI</a></span>` : ""}</p></div>`;
    }
    if (meda && meda.sols && meda.sols.length) {
      const w = meda.sols[meda.sols.length - 1];
      const [rh, rm] = w.sunrise.split(":").map(Number), [sh, sm] = w.sunset.split(":").map(Number);
      const windowH = ((sh * 60 + sm) - (rh * 60 + rm) - 120) / 60;
      const fits = windowH >= m.totals.eva_h;
      html += `<div class="cond-row"><span class="badge ${fits ? "ok" : "warn"}">${fits ? "DAYLIGHT OK" : "TOO LONG"}</span><p><b>Weather at Jezero</b><br>
        ${w.min_temp}°C to ${w.max_temp}°C · ${w.pressure} Pa · sun ${w.sunrise}–${w.sunset} (local)<br>
        <span class="small">Usable daylight ${windowH.toFixed(1)} h (1 h margin each end) vs ${m.totals.eva_h.toFixed(1)} h EVA. Latest public MEDA summary: sol ${w.sol}, ${w.season}.</span></p></div>`;
    }
    html += "</div>";
    box.innerHTML = html;
  }

  function refreshDonki(m) {
    const end = new Date(), start = new Date(end - 30 * 864e5);
    const d = (x) => x.toISOString().slice(0, 10);
    fetch(`https://api.nasa.gov/DONKI/notifications?startDate=${d(start)}&endDate=${d(end)}&type=all&api_key=DEMO_KEY`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((notes) => {
        const slim = notes.map((n) => ({ type: n.messageType, id: n.messageID, issued: n.messageIssueTime, url: n.messageURL, body: (n.messageBody || "").slice(0, 1200) }));
        return fetch("data/meda.json").then((r) => r.json()).then((meda) => renderConditions(m, { notes: slim }, meda));
      })
      .catch(() => {});
  }

  /* ---------- elevation profile ---------- */
  function drawProfile(m) {
    const svg = $("#profileSvg");
    const P = m.profile;
    const W = svg.clientWidth || 800, H = svg.clientHeight || 132;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const pad = { l: 44, r: 10, t: 8, b: 18 };
    const dMax = P[P.length - 1].d;
    const zs = P.map((p) => p.z), zMin = Math.min(...zs) - 5, zMax = Math.max(...zs) + 5;
    const X = (d) => pad.l + (d / dMax) * (W - pad.l - pad.r);
    const Y = (z) => pad.t + (1 - (z - zMin) / (zMax - zMin)) * (H - pad.t - pad.b);
    const col = (s) => (s > 15 ? "#dc2626" : s > 12 ? "#f97316" : s > 8 ? "#facc15" : "#ff5a36");
    let g = "";
    g += `<path d="M${X(0)},${Y(zMin)} ${P.map((p) => `L${X(p.d).toFixed(1)},${Y(p.z).toFixed(1)}`).join(" ")} L${X(dMax)},${Y(zMin)} Z" fill="rgba(255,90,54,.12)"/>`;
    for (let i = 1; i < P.length; i++) {
      g += `<line x1="${X(P[i - 1].d).toFixed(1)}" y1="${Y(P[i - 1].z).toFixed(1)}" x2="${X(P[i].d).toFixed(1)}" y2="${Y(P[i].z).toFixed(1)}" stroke="${col(P[i].s)}" stroke-width="2"/>`;
    }
    for (const z of [zMin + 5, (zMin + zMax) / 2, zMax - 5]) {
      g += `<text x="4" y="${Y(z) + 4}" fill="#98a2b3" font-size="10" font-family="JetBrains Mono">${Math.round(z)} m</text>`;
    }
    // stop markers at leg boundaries
    let lastLeg = -1;
    P.forEach((p) => {
      if (p.leg !== lastLeg) {
        lastLeg = p.leg;
        g += `<line x1="${X(p.d)}" x2="${X(p.d)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#3a4558" stroke-dasharray="3 3"/>`;
        const id = m.order[p.leg], label = id === "base" ? "B" : String(p.leg);
        g += `<text x="${X(p.d) + 3}" y="${H - 5}" fill="#98a2b3" font-size="10" font-family="JetBrains Mono">${label}</text>`;
      }
    });
    g += `<text x="${W - pad.r}" y="${H - 5}" text-anchor="end" fill="#98a2b3" font-size="10" font-family="JetBrains Mono">${(dMax / 1000).toFixed(1)} km</text>`;
    g += `<line id="cursor" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="#fff" stroke-width="1" visibility="hidden"/>`;
    svg.innerHTML = g;

    const tip = $("#tip"), cursor = svg.querySelector("#cursor");
    svg.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      const d = ((x - pad.l) / (W - pad.l - pad.r)) * dMax;
      let best = P[0];
      for (const p of P) if (Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
      cursor.setAttribute("x1", X(best.d)); cursor.setAttribute("x2", X(best.d)); cursor.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.style.left = `${Math.min(rect.width - 230, Math.max(0, (X(best.d) / W) * rect.width + 12))}px`;
      tip.innerHTML = `${(best.d / 1000).toFixed(2)} km · ${best.z} m · ${best.s}°<br>t+${fmtMin(best.t || 0)} · walk back ${fmtMin(best.back || 0)}`;
      const pt = pointAtDistance(best.d);
      if (pt) {
        if (!state.hoverMarker) state.hoverMarker = L.circleMarker(pt, { radius: 7, color: "#fff", weight: 2, fillColor: "#ff5a36", fillOpacity: 1 }).addTo(map);
        state.hoverMarker.setLatLng(pt);
      }
    };
    svg.onmouseleave = () => { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); if (state.hoverMarker) { map.removeLayer(state.hoverMarker); state.hoverMarker = null; } };
  }

  function pointAtDistance(d) {
    // walk the route geometry and return the point at distance d (metres, ground distance approximated on the sphere)
    const R = 3396190, toRad = Math.PI / 180;
    let acc = 0, prev = null;
    for (const layer of state.routeLine.getLayers()) {
      for (const ll of layer.getLatLngs()) {
        if (prev) {
          const dy = (ll.lat - prev.lat) * toRad * R, dx = (ll.lng - prev.lng) * toRad * R * Math.cos(ll.lat * toRad);
          const seg = Math.hypot(dx, dy);
          if (acc + seg >= d) { const f = (d - acc) / (seg || 1); return [prev.lat + (ll.lat - prev.lat) * f, prev.lng + (ll.lng - prev.lng) * f]; }
          acc += seg;
        }
        prev = ll;
      }
    }
    return prev ? [prev.lat, prev.lng] : null;
  }
  window.addEventListener("resize", () => state.mission && drawProfile(state.mission));

  /* ---------- live re-planning (web worker on the terrain grid) ---------- */
  const DEFAULT_ORDER = ["base", "depot", "gap", "top", "base"];
  let worker = null, planId = 0, planTimer = 0;

  function initPlanner(m) {
    const a = m.assumptions;
    const box = el("section", "card", "");
    box.id = "settings";
    box.innerHTML = `<h2>Plan your own EVA</h2>
      <p class="small" style="margin-top:-4px">Drag any stop on the map, switch stops on or off, or change the safety rules. The route and the walk-back check update live.</p>
      ${slider("maxSlope", "No-go slope", 10, 25, 1, a.max_slope_deg, "°")}
      ${slider("vFlat", "Suited walking speed", 0.4, 1.3, 0.05, a.v_flat_ms, " m/s")}
      ${slider("roughPenalty", "Rough ground slows you", 1, 5, 0.5, a.rough_penalty, "×")}
      ${slider("evaH", "EVA time limit", 4, 10, 0.5, a.eva_limit_h, " h")}
      ${slider("reserve", "Reserve kept for safety", 0, 50, 5, Math.round(a.reserve * 100), " %")}
      <div class="toggles">${m.stops.filter((s) => s.id !== "base").map((s) => `<label class="tog"><input type="checkbox" data-stop="${s.id}" checked> ${esc(s.name)}</label>`).join("")}</div>
      <div class="planbar"><button id="resetPlan" class="ghost">Reset</button><span id="planStatus" class="small">Default plan · ${m.grid_m} m grid</span></div>`;
    $("#summary").after(box);
    box.querySelectorAll("input[type=range]").forEach((inp) => inp.addEventListener("input", () => {
      inp.closest(".sl").querySelector("output").textContent = inp.value + inp.dataset.unit;
      clearTimeout(planTimer); planTimer = setTimeout(replan, 250);
    }));
    box.querySelectorAll("input[data-stop]").forEach((inp) => inp.addEventListener("change", replan));
    $("#resetPlan").addEventListener("click", resetPlan);

    const g = m.grid;
    if (!g || !window.Worker) { $("#planStatus").textContent = "Live re-planning is not available in this browser."; return; }
    Promise.all(["grid_slope.u8", "grid_rough.u8", "grid_dem.i16"].map((f) => fetch(`data/${f}`).then((r) => r.arrayBuffer())))
      .then(([slope, rough, dem]) => {
        worker = new Worker("router.js");
        worker.onmessage = onPlan;
        worker.postMessage({ type: "init", grid: g, slope, rough, dem }, [slope, rough, dem]);
      })
      .catch(() => { $("#planStatus").textContent = "Could not load the terrain grid."; });
  }

  function slider(id, label, min, max, step, val, unit) {
    return `<div class="sl"><label for="sl-${id}">${label}<output>${val}${unit}</output></label>
      <input type="range" id="sl-${id}" data-k="${id}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  }

  function params() {
    const v = (k) => parseFloat(document.querySelector(`#sl-${k}`).value);
    return { maxSlope: v("maxSlope"), vFlat: v("vFlat"), roughPenalty: v("roughPenalty"), roughM: state.base.assumptions.rough_m,
      evaH: v("evaH"), reserve: v("reserve") / 100 };
  }

  function replan() {
    if (!worker) return;
    const on = new Set([...document.querySelectorAll("input[data-stop]")].filter((i) => i.checked).map((i) => i.dataset.stop));
    const order = DEFAULT_ORDER.filter((id, i) => id === "base" || on.has(id));
    const m = state.mission;
    $("#planStatus").textContent = "Re-planning…";
    worker.postMessage({ type: "plan", id: ++planId, params: params(), order,
      stops: m.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dwell_min: s.dwell_min })) });
  }

  function onPlan(e) {
    const r = e.data;
    if (r.type === "ready") { $("#planStatus").textContent = `Live re-planning ready · ${state.mission.grid.gx.toFixed(1)} m grid`; return; }
    if (r.type !== "plan" || r.id !== planId) return;
    if (r.error) { $("#planStatus").innerHTML = `<span style="color:#fca5a5">${esc(r.error)}</span>`; return; }
    const m = state.mission;
    const p = params();
    m.order = [...new Set(r.legs.map((l) => l.frm))].concat(["base"]);
    m.legs = r.legs.map(({ coords, ...l }) => l);
    m.totals = r.totals; m.walkback = r.walkback; m.profile = r.profile;
    m.assumptions = Object.assign({}, m.assumptions, { v_flat_ms: p.vFlat, max_slope_deg: p.maxSlope, rough_penalty: p.roughPenalty, eva_limit_h: p.evaH, reserve: p.reserve });
    for (const s of m.stops) {
      const c = r.stopCells[s.id];
      if (c) { s.lon = c.lonlat[0]; s.lat = c.lonlat[1]; s.elev_m = c.z; }
      state.stopMarkers[s.id].setLatLng([s.lat, s.lon]).setIcon(stopIcon(s.id, m));
    }
    drawRouteLine({ type: "FeatureCollection", features: r.legs.map((l, i) => ({ type: "Feature", properties: { leg: i }, geometry: { type: "LineString", coordinates: l.coords } })) });
    renderSummary(m); renderStops(m); drawProfile(m); renderConditions(m, state.donki, state.meda);
    $("#planStatus").textContent = `Re-planned in ${(r.ms / 1000).toFixed(1)} s · ${state.mission.grid.gx.toFixed(1)} m grid`;
  }

  function resetPlan() {
    const b = JSON.parse(JSON.stringify(state.base));
    document.querySelectorAll("#settings input[type=range]").forEach((inp) => {
      const a = b.assumptions, k = inp.dataset.k;
      const val = { maxSlope: a.max_slope_deg, vFlat: a.v_flat_ms, roughPenalty: a.rough_penalty, evaH: a.eva_limit_h, reserve: Math.round(a.reserve * 100) }[k];
      inp.value = val; inp.closest(".sl").querySelector("output").textContent = val + inp.dataset.unit;
    });
    document.querySelectorAll("input[data-stop]").forEach((i) => (i.checked = true));
    state.mission = b;
    for (const s of b.stops) state.stopMarkers[s.id].setLatLng([s.lat, s.lon]).setIcon(stopIcon(s.id, b));
    fetch("data/route.geojson").then((x) => x.json()).then((route) => {
      drawRouteLine(route); renderSummary(b); renderStops(b); drawProfile(b); renderConditions(b, state.donki, state.meda);
      $("#planStatus").textContent = `Default plan · ${b.grid_m} m grid`;
    });
  }

  /* ---------- EVA playback with a helmet-style HUD ---------- */
  const hud = el("div", "hud");
  hud.hidden = true;
  $(".mapwrap").appendChild(hud);
  const playBtn = el("button", "play-btn", '<span class="tri"></span>Play EVA');
  $(".mapwrap").appendChild(playBtn);
  let anim = null;
  playBtn.addEventListener("click", () => (anim ? stopPlay() : startPlay()));

  function bearing(a, b) {
    const toRad = Math.PI / 180, y = Math.sin((b[1] - a[1]) * toRad) * Math.cos(b[0] * toRad);
    const x = Math.cos(a[0] * toRad) * Math.sin(b[0] * toRad) - Math.sin(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.cos((b[1] - a[1]) * toRad);
    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    return (deg + 360) % 360;
  }
  const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];

  function startPlay() {
    const m = state.mission, P = m.profile;
    const tEnd = P[P.length - 1].t, realMs = 30000;
    const budget = m.walkback.budget_min;
    const marker = L.circleMarker([P[0].d, 0], { radius: 9, color: "#fff", weight: 3, fillColor: "#38bdf8", fillOpacity: 1 });
    const pulse = L.circleMarker([0, 0], { radius: 18, color: "#38bdf8", weight: 2, fill: false, opacity: 0.6 });
    playBtn.innerHTML = '<span class="sq"></span>Stop';
    hud.hidden = false;
    const t0 = performance.now();
    map.flyTo([m.stops[0].lat, m.stops[0].lon], 15, { duration: 0.6 });
    anim = { marker, pulse, raf: 0 };
    const frame = (now) => {
      const T = Math.min(tEnd, ((now - t0) / realMs) * tEnd);
      let i = 0;
      while (i < P.length - 1 && P[i + 1].t <= T) i++;
      const p = P[i], q = P[Math.min(i + 1, P.length - 1)];
      const gap = q.leg !== p.leg;            // between legs = working at a stop
      const f = !gap && q.t > p.t ? (T - p.t) / (q.t - p.t) : 0;
      const d = p.d + (q.d - p.d) * f;
      const pos = pointAtDistance(d);
      if (pos) {
        if (!map.hasLayer(marker)) { marker.addTo(map); pulse.addTo(map); }
        marker.setLatLng(pos); pulse.setLatLng(pos);
        if (!map.getBounds().pad(-0.25).contains(pos)) map.panTo(pos, { animate: true, duration: 0.5 });
      }
      const leg = gap ? q.leg : p.leg;
      const nextId = m.order[leg + 1] || "base", nextStop = m.stops.find((s) => s.id === nextId);
      const here = gap ? m.stops.find((s) => s.id === m.order[q.leg]) : null;
      const back = p.back + ((q.back ?? p.back) - p.back) * f;
      const margin = budget - (T + back);
      const distNext = pos && nextStop ? map.distance(pos, [nextStop.lat, nextStop.lon]) * (3396190 / 6378137) : 0;
      const brg = pos && nextStop ? bearing(pos, [nextStop.lat, nextStop.lon]) : 0;
      const hh = String(Math.floor(T / 60)).padStart(2, "0"), mm = String(Math.floor(T % 60)).padStart(2, "0");
      hud.className = `hud ${margin < 0 ? "alarm" : margin < 30 ? "caution" : ""}`;
      hud.innerHTML = `<div class="hud-row"><span>MET</span><b>${hh}:${mm}</b><span>EVA ${m.walkback.eva_limit_h} h</span></div>
        ${here ? `<div class="hud-stop">ON SITE · ${esc(here.name.toUpperCase())}<br><small>${esc(here.role)}</small></div>`
               : `<div class="hud-row"><span>NEXT</span><b>${esc(nextStop.name)}</b><span>${(distNext / 1000).toFixed(2)} km ${compass(brg)}</span></div>`}
        <div class="hud-grid">
          <div><span>SLOPE</span><b class="${p.s > 12 ? "warnc" : ""}">${p.s.toFixed(0)}°</b></div>
          <div><span>ELEV</span><b>${Math.round(p.z)} m</b></div>
          <div><span>WALK BACK</span><b>${fmtMin(back)}</b></div>
          <div><span>MARGIN</span><b class="${margin < 0 ? "badc" : margin < 30 ? "warnc" : "okc"}">${margin < 0 ? "−" : "+"}${fmtMin(Math.abs(margin))}</b></div>
        </div>
        ${margin < 0 ? '<div class="hud-alarm">TURN BACK: walk-back limit exceeded</div>' : ""}`;
      const cursor = document.querySelector("#cursor");
      if (cursor) {
        const svg = $("#profileSvg"), W = svg.viewBox.baseVal.width, x = 44 + (d / P[P.length - 1].d) * (W - 54);
        cursor.setAttribute("x1", x); cursor.setAttribute("x2", x); cursor.setAttribute("visibility", "visible");
      }
      if (T < tEnd) anim.raf = requestAnimationFrame(frame);
      else { playBtn.innerHTML = '<span class="tri"></span>Replay EVA'; anim.done = true; }
    };
    anim.raf = requestAnimationFrame(frame);
  }

  function stopPlay() {
    cancelAnimationFrame(anim.raf);
    map.removeLayer(anim.marker); map.removeLayer(anim.pulse);
    anim = null;
    hud.hidden = true;
    playBtn.innerHTML = '<span class="tri"></span>Play EVA';
    const cursor = document.querySelector("#cursor");
    if (cursor) cursor.setAttribute("visibility", "hidden");
  }

  /* ---------- lightbox ---------- */
  function openLightbox(p, s) {
    $("#lbImg").src = p.large || p.medium;
    $("#lbImg").alt = `${p.cam} image near ${s.name}`;
    $("#lbCap").innerHTML = `Perseverance ${esc(p.cam.replace(/_/g, " "))} · sol ${p.sol} · near ${esc(s.name)} · Image: NASA/JPL-Caltech${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">source</a>` : ""}`;
    $("#lightbox").hidden = false;
  }
  $("#lbClose").addEventListener("click", () => ($("#lightbox").hidden = true));
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });

  /* ---------- tabs + about ---------- */
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("#viewPlan").hidden = b.dataset.view !== "plan";
    $("#viewAbout").hidden = b.dataset.view !== "about";
  }));

  function renderAbout(m) {
    const a = m.assumptions;
    $("#viewAbout").innerHTML = `<section class="card">
      <h2>What Red Route does</h2>
      <p>Red Route plans a walking EVA (a "Marswalk") for astronauts in Jezero Crater. It layers NASA terrain, imagery, rover photos and space weather into one map, then finds the safest walking route between science stops and checks it against a walk-back rule: at every point the crew must be able to get back to base camp inside the EVA time budget.</p>
      <h3>How the route is found</h3>
      <ol>
        <li>Slope and roughness are computed from the 1 m HiRISE elevation model (USGS Mars 2020 TRN DTM), corrected for the map projection.</li>
        <li>Each cell gets a walking time from a hiking model (Tobler-style) scaled to suited walking: ${a.v_flat_ms} m/s on flat ground, slower on slopes.</li>
        <li>Ground steeper than ${a.max_slope_deg}° is treated as no-go. Rough ground (more than ${a.rough_m} m of local relief) takes ${a.rough_penalty}× longer.</li>
        <li>A least-cost path search links the stops. A second search from base camp gives the walk-back time from every point.</li>
      </ol>
      <h3>Planning assumptions</h3>
      <table>
        <tr><td>Suited speed, flat</td><td>${a.v_flat_ms} m/s (about ${(a.v_flat_ms * 3.6).toFixed(1)} km/h)</td></tr>
        <tr><td>No-go slope</td><td>&gt; ${a.max_slope_deg}°</td></tr>
        <tr><td>EVA time budget</td><td>${m.walkback.eva_limit_h} h, ${Math.round(m.walkback.reserve * 100)} % reserve</td></tr>
        <tr><td>Terrain grid</td><td>${m.grid_m} m (${esc(m.dtm)})</td></tr>
      </table>
      <p class="small">These are planning assumptions for a hackathon prototype, not NASA flight rules.</p>
      <h3>NASA and USGS data used</h3>
      <ul>
        <li>HiRISE 1 m DTM and 25 cm orthomosaic of Jezero: USGS Astrogeology, Mars 2020 Terrain Relative Navigation products.</li>
        <li>Map tiles: NASA JPL Mars Trek (HiRISE, CTX, MOLA, Viking).</li>
        <li>Perseverance waypoints and traverse: NASA/JPL-Caltech (MMGIS).</li>
        <li>Perseverance raw images (Navcam, Mastcam-Z, Hazcam): NASA/JPL-Caltech.</li>
        <li>Weather: Perseverance MEDA summaries, NASA/JPL-Caltech.</li>
        <li>Space weather: NASA DONKI notifications (CCMC), via api.nasa.gov.</li>
      </ul>
      <h3>Use of AI tools</h3>
      <p>Code was written with help from an AI coding assistant (Claude). All data come from NASA and USGS; no AI-generated images are used in the app.</p>
      </section>`;
  }
})();
