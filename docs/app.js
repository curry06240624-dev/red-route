/* Red Route: a Marswalk planner for Jezero Crater.
   Map tiles: NASA JPL Mars Trek (WMTS, Mars 2000 sphere, geographic grid).
   Route, slope, roughness and walk-home layers: tools/build_layers.py, from the USGS Mars 2020 TRN HiRISE DTM.
   Live re-planning and the get-home zone: router.js (web worker) on the exported terrain grid.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
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
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  const credit = 'Tiles: <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA JPL Mars Trek</a>';
  const BASES = {
    hirise: { name: "HiRISE 25 cm", layer: L.tileLayer(trekUrl("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png"),
      { maxNativeZoom: 17, maxZoom: 19, bounds: JEZ_HIRISE, attribution: `${credit} · HiRISE (NASA/JPL/UArizona, USGS)` }) },
    ctx: { name: "CTX 6 m", layer: L.tileLayer(trekUrl("Jezero_CTX_BlockAdj_dd", "png"),
      { maxNativeZoom: 12, maxZoom: 19, bounds: JEZ_CTX, attribution: `${credit} · CTX (NASA/JPL/MSSS)` }) },
    hrsc: { name: "HRSC + MOLA relief", layer: L.tileLayer(trekUrl("Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", "jpg"),
      { maxNativeZoom: 8, maxZoom: 19, attribution: `${credit} · Mars Express HRSC (ESA/DLR/FU Berlin) + MOLA (NASA), USGS blend` }) },
    mola: { name: "MOLA elevation", layer: L.tileLayer(trekUrl("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg"),
      { maxNativeZoom: 7, maxZoom: 19, attribution: `${credit} · MOLA (NASA/GSFC)` }) },
  };
  // zoomed-out context under everything: ESA Mars Express HRSC blended with NASA MOLA
  L.tileLayer(trekUrl("Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", "jpg"), { maxNativeZoom: 8, maxZoom: 19, className: "ctx-relief",
    attribution: "Relief: HRSC (ESA/DLR/FU Berlin) + MOLA (NASA)" }).addTo(map);
  let baseKey = "hirise";
  BASES.hirise.layer.addTo(map);

  const S = { m: null, base: null, overlays: {}, markers: {}, sel: "depot", donki: null, meda: null, routeLine: null, routeCasing: null };
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

  function renderAll() { closeDrill(); renderChecks(); renderStopList(); renderConditions(); renderStopPanel(); renderLegend(); drawTimeline(); if (astro.open) { renderAstroTrack(); drawAstroRoute(); } document.dispatchEvent(new CustomEvent("redroute:render")); }

  function fitRoute() {
    const b = S.routeLine.getBounds();
    for (const s of S.m.stops) b.extend([s.lat, s.lon]);   // optional stops too, so they can be seen and ticked on
    if (isMobile()) {   // phones: keep the route clear of the logo and top bar (top) and of the map buttons and credit line (right, bottom)
      const h = map.getSize().y, top = Math.max($(".brand").getBoundingClientRect().bottom, $(".topnav").getBoundingClientRect().bottom) + 10;
      map.fitBounds(b, { paddingTopLeft: [16, Math.min(top, h * 0.45)], paddingBottomRight: [136, Math.min(96, h * 0.3)] });
    }
    else map.fitBounds(b, { paddingTopLeft: [350, 90], paddingBottomRight: [470, 170] });
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

  /* ---------- source tags: say where each number comes from ----------
     N = NASA data (measured by a NASA mission), D = derived (worked out by Red Route from that data and the
     planning numbers), A = assumed (a planning number we set; its source is listed). A click opens the
     matching part of "How it works". */
  const STAG = { n: ["N", "NASA data", "Measured by a NASA mission"], d: ["D", "Derived", "Worked out by Red Route from NASA data and the planning numbers"],
    a: ["A", "Assumed", "A planning number we set. Its source is listed"] };
  const stag = (k, how, full) => `<button type="button" class="stag ${k}${full ? " full" : ""}" data-how="${how}" title="${STAG[k][1]}: ${STAG[k][2].toLowerCase()}. Click for the source." aria-label="${STAG[k][1]}. Open the source."><b>${STAG[k][0]}</b><span>${STAG[k][1].slice(1)}</span></button>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".stag");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    $("#about").style.zIndex = astro.open ? "3300" : "";   // the astronaut view sits above normal dialogs
    openModal("about");
    setTimeout(() => document.getElementById(b.dataset.how)?.scrollIntoView({ block: "start" }), 50);
  }, true);

  /* ---------- breaking point (DERIVED): how much slower the whole walk can be before a check fails ----------
     Every walking time and every walk-home time scales with 1 / speed; the time at the stops does not.
     So for each point of the walk the slowest pace that still passes has a closed form, and the check
     breaks at the largest of those. Same numbers as the planner, no new route search. */
  function breakingPoints(m) {
    const P = m.profile || [], tl = m.timeline || [], wb = m.walkback;
    if (!P.length || !tl.length || !wb) return null;
    const dwellBefore = []; let d = 0;   // minutes spent at stops before each leg starts
    for (let i = 0; i < tl.length - 1; i++) { d += tl[i].depart_min - tl[i].arrive_min; dwellBefore[i] = d; }
    const B = wb.budget_min, k = wb.bad ? wb.bad.factor : 2, Bb = wb.bad ? wb.bad.budget_min : B;
    let fPlan = 0, fBad = 0, backMax = 0, hurt = 0;
    for (const p of P) {
      const dw = dwellBefore[p.leg] || 0, walk = p.t - dw;
      fPlan = Math.max(fPlan, B - dw > 0 ? (walk + p.back) / (B - dw) : Infinity);
      fBad = Math.max(fBad, Bb - dw > 0 ? (walk + k * p.back) / (Bb - dw) : Infinity);
      backMax = Math.max(backMax, p.back);
      if (p.back > 0) hurt = Math.max(hurt, Bb - p.t > 0 ? p.back / (Bb - p.t) : Infinity);   // slowest walk-home pace from here
    }
    return { plan: fPlan, bad: fBad, suit: wb.suit ? backMax / wb.suit.limit_min : null, hurt, hurtRule: 1 / k, v: m.assumptions.v_flat_ms };
  }
  // percentages are rounded down and speeds up, so the text never promises more room than there is
  function bpText(f, v) {
    if (f == null || !isFinite(f) || f <= 0) return "";
    const sp = (Math.ceil(f * v * 100 - 1e-6) / 100).toFixed(2);
    if (f <= 1) {
      const pct = Math.floor((1 - f) * 100 + 1e-6);
      return pct >= 1 ? `Breaking point: still passes with the whole walk ${pct} % slower (${sp} m/s).` : `Breaking point: no room to walk slower (${sp} m/s).`;
    }
    return `Would pass only if the whole walk were ${Math.ceil((f - 1) * 100 - 1e-6)} % faster (${sp} m/s).`;
  }

  /* ---------- the three get-home checks ---------- */
  function getChecks(m) {
    const wb = m.walkback, out = [], bp = breakingPoints(m);
    const w = wb.worst, air = wb.airlock_min || 0, homeBy = `T+${hm(wb.budget_min)}`;
    // the time for walking and stops: the suit limit, minus the reserve, minus the time to get out and back in
    const how = `${wb.eva_limit_h} h suit limit minus ${Math.round(wb.reserve * 100)} % reserve${air ? ` minus ${air % 60 ? fmtMin(air) : `${air / 60} h`} to get out and back in` : ""}`;
    out.push({ key: "plan", name: "Plan fits", ok: w.margin_min >= 0,
      val: `${w.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(w.margin_min)}${fmtMin(w.margin_min)}`,
      sub: w.margin_min >= 0 ? `Home at normal pace by ${homeBy} (${how})`
        : `Over by ${fmtMin(w.margin_min)} near ${nearestStopName(w.lat, w.lon)} at T+${hm(w.t)}: the crew must be home by ${homeBy} (${how}). Leave earlier, shorten a stop or drop one.` });
    if (wb.bad) {
      const b = wb.bad.worst, badBy = `T+${hm(wb.bad.budget_min)}`;
      out.push({ key: "bad", name: "If something goes wrong", ok: b.margin_min >= 0,
        val: `${b.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(b.margin_min)}${fmtMin(b.margin_min)}`,
        sub: b.margin_min >= 0 ? `Home by ${badBy} even if EV2 is hurt and EV1 helps at half speed, from any point of the walk. The reserve stays untouched.`
          : `At T+${hm(b.t)} near ${nearestStopName(b.lat, b.lon)} a half-speed walk home takes ${fmtMin(b.back)}: ${fmtMin(b.margin_min)} past ${badBy}. Leave that stop earlier, shorten a stop or drop one.` });
    }
    if (wb.suit) {
      const s = wb.suit.worst, lim = wb.suit.limit_min, ok = s.back <= lim;
      out.push({ key: "suit", name: "Suit failure", ok,
        val: `${ok ? "PASS" : "FAIL"} ${Math.round(s.back)} / ${lim} min`,
        sub: ok ? "Longest walk home stays inside the 1 h backup oxygen"
          : `Near ${nearestStopName(s.lat, s.lon)} the walk home is ${fmtMin(s.back)}, more than ${lim} min of backup oxygen. Move base camp closer or drop the far stop.` });
    }
    if (bp) for (const c of out) {
      c.bp = bpText(bp[c.key], bp.v);
      if (c.key === "bad" && c.ok && isFinite(bp.hurt) && bp.hurt <= bp.hurtRule)
        c.bp += ` The hurt crewmate (EV2) could be as slow as ${Math.ceil(bp.hurt * 100 - 1e-6)} % of normal pace; the rule assumes ${Math.round(bp.hurtRule * 100)} %.`;
    }
    return out;
  }

  function renderChecks() {
    const m = S.m, t = m.totals, rc = m.rover_check, air = m.walkback.airlock_min || 0;
    const rows = getChecks(m).map((c) => `<div class="chk"><span class="k">${c.name}${stag("d", "how-checks")}</span><span class="v ${c.ok ? "ok" : "bad"}">${esc(c.val)}</span><span class="s">${esc(c.sub)}</span>${c.bp ? `<span class="bp" data-src="derived">${esc(c.bp)}${stag("d", "bpHow")}</span>` : ""}</div>`).join("");
    $("#checks").innerHTML = `<div class="lbl-lg"><span class="gnum" aria-hidden="true">1</span>Get-home checks</div>${rows}
      <div class="mission">${t.dist_km.toFixed(1)} KM · +${t.gain_m} M · MAX ${t.max_slope.toFixed(1)}°<br>${fmtMin(t.eva_h * 60).toUpperCase()} OUTSIDE${air ? ` · ${fmtMin(t.eva_h * 60 + air).toUpperCase()} IN THE SUIT` : ""}${stag("d", "how-route")}<br>CREW OF TWO · EV1 AND EV2 WALK TOGETHER</div>
      ${rc ? `<div class="proof">Slope map vs Perseverance's tilt sensor: ${rc.slope_mae_deg}° average difference at ${rc.n} waypoint records.${stag("n", "tests")} <a href="#" id="proofLink">See the test</a></div>` : ""}
      <div class="stag-key">${stag("n", "how-data", 1)} measured by a NASA mission ${stag("d", "how-route", 1)} worked out from it ${stag("a", "how-numbers", 1)} a planning number we set. Click a tag for its source.</div>
      <hr class="r">`;
    const pl = $("#proofLink");
    if (pl) pl.onclick = (e) => { e.preventDefault(); openModal("about"); setTimeout(() => $("#tests")?.scrollIntoView(), 50); };
  }

  // "Leave by" = the latest time to turn for home that keeps both time checks green (the half-speed rule is the stricter one)
  const leaveBy = (t) => (t.bad_leave_by_min != null ? Math.min(t.leave_by_min, t.bad_leave_by_min) : t.leave_by_min);
  const leaveSpare = (t) => (t.bad_spare_min != null ? Math.min(t.spare_min, t.bad_spare_min) : t.spare_min);

  function renderStopList() {
    const m = S.m, tl = m.timeline || [];
    let html = `<div class="lbl-lg" style="display:flex;justify-content:space-between"><span>Route stops</span><span>Leave by${stag("d", "how-checks")}</span></div><ul class="stops">`;
    m.order.forEach((id, i) => {
      const s = stopById(id), last = i === m.order.length - 1, t = tl[i];
      if (last) {
        html += `<li class="ret"><span class="n">${i + 1}</span><span class="nm">Back at base camp</span><span class="lb"><span class="lbl">Arrive</span><b>${t ? `T+${hm(t.arrive_min)}` : ""}</b></span></li>`;
      } else {
        const spare = t ? leaveSpare(t) : 0, late = t && spare < 0;
        const right = i === 0 ? `<span class="lbl">Start</span><b>T+0:00</b>`
          : `${late ? '<span class="lbl bad">Late</span>' : ""}<b class="${late ? "bad" : t && spare < 30 ? "warn" : ""}">${t ? `T+${hm(leaveBy(t))}` : ""}</b>`;
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

  /* Radiation, for scale only (no pass or fail). Both numbers were read in their sources on 15 Nov 2026:
     - 0.210 ± 0.040 mGy a day: average galactic-cosmic-ray dose rate on the surface at Gale Crater, measured by
       Curiosity's RAD over about 300 sols (Hassler et al. 2014, Science 343, 1244797, doi:10.1126/science.1244797).
     - 8,100 micrograys: what NASA reported for a person next to Curiosity in the solar storm of 20 May 2024 (NASA/JPL
       news release, 10 June 2024). Quoted for scale only. The release does not say how it was worked out, and our own
       sum of RAD's archived readings (extra/storm-replay.js) is a different measure, so nothing is computed from it. */
  const RAD = { gale_mgy_day: 0.21, storm_ugy: 8100,
    paper: "https://doi.org/10.1126/science.1244797", storm: "https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/" };
  /* Results of two checks that are run outside the browser. Both are re-run by the tests (tests/bad-day-simulation.test.js
     and tests/browser-engine.test.js), which fail if the numbers written here stop matching.
     - BENEFIT: validation/bad_day_simulation.mjs (seed 20261115). The same 1,000 simulated walks for three plans on the
       same stops; each walk is up to 20 % slower than planned (the "30" numbers: up to 30 %) and a crewmate is hurt at
       a random moment. Counted: walks that had to use the reserve.
         usual = planned with the normal-pace walk-back rule only, all the time that rule allows spent at the last stop;
         maxed = planned with our bad-day rule, all the time that rule allows spent at the last stop (rule against rule);
         ours  = our own plan, which also keeps 14 min spare.
       The rule costs 29 min at the stops (128 - 99); our plan keeps 14 more as spare (99 - 85).
       The "apollo" numbers are the same 1,000 walks with the slowdown drawn from NASA's Apollo records instead of our
       assumed range: travel time between stops, performed against planned, on 8 moonwalks (0.69 to 1.83 times the plan;
       our sums of Appendix A of NASA/TP-2017-219457; tests/apollo-traverse.test.mjs re-does the sums).
     - ENGINE4: the default walk re-planned by the browser's engine on the 4 m grid (the stored plan is from a 2 m grid). */
  const BENEFIT = { walks: 1000, usual: 320, maxed: 111, ours: 18, usual30: 347, maxed30: 160, ours30: 59, usualApollo: 368, maxedApollo: 256, oursApollo: 224, rule_cost_min: 29, plan_spare_min: 14 };
  const APOLLO_SRC = "https://ntrs.nasa.gov/citations/20170007261";
  const ENGINE4 = { plan: 43.9, bad: 14.7, suit: 41.9 };
  /* Oxygen, for scale only (no pass or fail). 0.086 kg of oxygen per crew member per hour: NASA's planning value for a
     spacewalk at an average workload of 1.06 MJ an hour (295 W), from the Life Support Baseline Values and Assumptions
     Document, NASA/TP-2015-218570 Rev 2 (February 2022), Table 4-70; read in the report on 15 Nov 2026.
     It is a rate per hour. We found no NASA measurement of suited walking at our pace in Mars gravity, so the app does
     not model oxygen per metre, per slope or per kilogram carried. What NASA did test (read in the reports on 15 Nov 2026):
     suited walking in Mars gravity at 1.07 to 1.53 m/s, about twice our planning pace of 0.56 m/s and faster (EVA Walkback
     Test, NASA/TP-2009-214796, pp. 17-18); its slower suit tests (0.56 to 0.98 m/s) stopped at 0.32 g (NASA/TP-2010-216115
     and NASA/TP-2010-216125), and both of those reports say their models "should not be generalized beyond the
     conditions under which the data were collected". */
  const OXY = { kg_per_h: 0.086, src: "https://ntrs.nasa.gov/citations/20210024855", mars_test_ms: [1.07, 1.53],
    walkback: "https://web.archive.org/web/20170503083749/https://ston.jsc.nasa.gov/collections/TRS//_techrep/TP-2009-214796.pdf" };
  const walkOxygenKg = (m) => OXY.kg_per_h * m.totals.eva_h;   // per crew member, for the time outside
  const walkDoseUGy = (m) => RAD.gale_mgy_day * 1000 * ((m.totals.eva_h * 60) / 1440);   // quiet-day dose for the time outside

  function renderConditions() {
    let html = '<div class="lbl-lg">Conditions</div>';
    if (S.donki && S.donki.notes) {
      const live = !!S.donki.live, saved = S.donki.fetched || "an earlier date";
      const ref = live ? Date.now() : (Date.parse(`${S.donki.fetched}T23:59:59+08:00`) || Date.now());
      const v = spaceWeather(S.donki.notes, ref);
      const link = v.n && /^https:\/\//.test(v.n.url || "") ? v.n.url : "";
      const a = link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">${v.cls === "ok" ? "latest notice" : "the notice"}</a>` : "";
      if (live) {
        html += `<div class="cond-row"><span>Space weather${stag("n", "how-data")}</span><b class="${v.cls}">${v.word}</b><span class="s">${esc(v.sub)} Live NASA DONKI notices${a}.</span></div>`;
      } else if (S.donki.failed) {   // never a green CLEAR from old data; a saved warning is quoted with its date
        const was = v.cls === "ok" ? "showed no alert" : `said ${v.word}: ${esc(v.sub)}`;
        html += `<div class="cond-row"><span>Space weather${stag("n", "how-data")}</span><b class="warn">NOT CHECKED</b><span class="s">The live NASA DONKI feed did not answer, so today's space weather is not checked. The saved notices from ${esc(saved)} ${was}${a}.</span></div>`;
      } else {
        html += `<div class="cond-row"><span>Space weather${stag("n", "how-data")}</span><b>CHECKING</b><span class="s">Reading the live NASA DONKI notices.</span></div>`;
      }
    }
    if (S.meda && S.meda.sols && S.meda.sols.length) {
      const w = S.meda.sols[S.meda.sols.length - 1];
      const [rh, rm] = w.sunrise.split(":").map(Number), [sh, sm] = w.sunset.split(":").map(Number);
      const day = ((sh * 60 + sm) - (rh * 60 + rm) - 120) / 60, fits = day >= S.m.totals.eva_h;
      html += `<div class="cond-row"><span>Daylight${stag("d", "how-data")}</span><b class="${fits ? "ok" : "warn"}">${fits ? "OK" : "TOO LONG"}</b><span class="s">${day.toFixed(1)} h usable (sunrise to sunset, less 2 h of margin, our choice) vs ${S.m.totals.eva_h.toFixed(1)} h outside · ${w.min_temp}°C to ${w.max_temp}°C · latest available Perseverance MEDA data (${medaLatest()})</span></div>`;
    }
    const dose = walkDoseUGy(S.m);
    html += `<div class="cond-row" id="radRow"><span>Radiation${stag("d", "how-numbers")}</span><b>about ${Math.round(dose)} µGy</b><span class="s">Quiet-day dose for this walk's ${fmtMin(S.m.totals.eva_h * 60)} outside: about ${Math.round(dose)} microgray, from the average that Curiosity's RAD measured at Gale Crater, ${RAD.gale_mgy_day} mGy a day (<a href="${RAD.paper}" target="_blank" rel="noopener">Hassler et al. 2014</a>). A Gale value. Jezero sits about 2 km higher, so we expect a little more there (our estimate). For scale, NASA reported that a person next to Curiosity would have received ${RAD.storm_ugy.toLocaleString("en-US")} microgray in the solar storm of 20 May 2024 (<a href="${RAD.storm}" target="_blank" rel="noopener">NASA</a>). The storm drill can replay that storm from RAD's own readings. Shown for scale, not a pass or fail.</span></div>`;
    const o2 = walkOxygenKg(S.m);
    html += `<div class="cond-row" id="oxyRow"><span>Oxygen${stag("d", "how-numbers")}</span><b>about ${o2.toFixed(2)} kg each</b><span class="s">Oxygen breathed in this walk's ${fmtMin(S.m.totals.eva_h * 60)} outside: about ${o2.toFixed(2)} kg per crew member, ${(2 * o2).toFixed(1)} kg for EV1 and EV2 together. NASA's planning rate for a spacewalk, ${OXY.kg_per_h} kg an hour (<a href="${OXY.src}" target="_blank" rel="noopener">NASA life-support baseline values, 2022</a>), times the time outside. A rate per hour, not per metre: we found no NASA measurement of suited walking at this pace in Mars gravity (NASA's suit tests in Mars gravity started at ${OXY.mars_test_ms[0]} m/s, about twice our pace), so we do not model one. It is oxygen breathed, not what the tank must hold. Shown for scale, not a pass or fail.</span></div>`;
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
    const list = (r) => (Array.isArray(r) ? r : Promise.reject(new Error("not a list")));
    get(`https://ccmc.gsfc.nasa.gov/DONKI/WS/get/notifications?${q}`).then(list)
      .catch(() => get(`https://api.nasa.gov/DONKI/notifications?${q}&api_key=DEMO_KEY`).then(list))
      .then((notes) => {
        S.donki = { live: true, fetched: d(end),
          notes: notes.map((n) => ({ type: n.messageType, id: n.messageID, issued: n.messageIssueTime, url: n.messageURL, body: (n.messageBody || "").slice(0, 8000) })) };
        renderConditions();
      })
      .catch(() => { if (S.donki && !S.donki.live) { S.donki.failed = true; renderConditions(); } });
  }

  /* ---------- selected stop panel ---------- */
  function selectStop(id, fly) {
    S.sel = id;
    renderStopList(); renderStopPanel(); refreshMarkers();
    const s = stopById(id);
    if (fly) map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15.5), { duration: 0.7 });
  }

  // e.g. "NASA/JPL-Caltech · ASU · LANL/CNES/IRAP": every team credited on this stop's photos (each photo's own credit is in the viewer)
  function photoCredits(photos) {
    const base = "NASA/JPL-Caltech", extra = [];
    for (const p of photos) {
      const c = (p.credit || base).replace(base, "").replace(/^\//, "");
      if (c && !extra.includes(c)) extra.push(c);
    }
    return [base, ...extra].join(" · ");
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
    // the science goal of the stop (base camp has its own note further down); hidden once the stop is moved elsewhere
    if (s.id !== "base" && s.role && !s.moved) html += `<div class="why"><div class="lbl">Why go here</div><p>${esc(s.role)}</p></div>`;
    if (photos.length) {
      html += `<div class="grid6">${photos.slice(0, 6).map((p, k) => `<button data-k="${k}" aria-label="Open photo ${k + 1}"><img src="${p.thumb || p.small || p.medium}" alt="${esc(p.cam)} view near ${esc(s.name)}"></button>`).join("")}</div>
        <button class="more" id="allPhotos">View all ${photos.length} rover photos</button>
        <div class="src">Perseverance, sol ${s.rover_sol}${awayM > 30 ? `, ${Math.round(awayM)} m from this stop` : ""} · ${esc(photoCredits(photos))}</div>`;
    }
    if (tr) {
      html += `<hr class="r"><div class="lbl-lg">Terrain within 50 m${stag("d", "how-route", 1)}</div><table class="tbl">
        <tr><td>Slope, mean / max</td><td>${tr.slope_mean}° / ${tr.slope_max}°</td></tr>
        <tr><td>Roughness (RMS)</td><td>${tr.rough_rms} m</td></tr>
        <tr><td>Elevation</td><td>${Math.round(tr.elev_min)} to ${Math.round(tr.elev_max)} m</td></tr>
        <tr><td>No-go ground (&gt; ${m.assumptions.max_slope_deg}°)</td><td class="${tr.nogo_pct > 10 ? "warn" : ""}">${tr.nogo_pct} %</td></tr></table>`;
    }
    if (s.notes && !s.moved) {
      html += `<hr class="r"><div class="lbl-lg">What Perseverance did here${stag("n", "how-data", 1)}</div><p class="note">${esc(s.notes.text)}</p>
        <div class="src">${s.notes.sources.map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}</div>`;
      if (s.id === "base" && s.site_check) {
        html += `<p class="note">Base camp was placed here, on top of the delta, so that the loop fits the time rules. It is not checked as a landing site: within ${s.site_check.radius_m} m the ground reaches ${s.site_check.slope_max}°.</p>`;
      }
    } else if (s.moved) {
      html += `<hr class="r"><p class="note">You moved this stop. The photos show where Perseverance stopped on sol ${s.rover_sol}${awayM > 30 ? `, ${Math.round(awayM)} m away` : ""}.</p>`;
    }
    html += `<hr class="r"><div class="lbl-lg">Get home from here${stag("d", "how-checks", 1)}</div><table class="tbl">`;
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
    if (i < 0) html += `<tr><td>On this walk</td><td>No</td></tr>`;
    html += `</table><div class="drag-hint">${i < 0 ? "This stop is not on the walk. Tick it under Plan your EVA to add it: the checks show at once if the plan still fits."
      : "Drag the stop on the map to move it. The route and every check update live."}</div>`;
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
    // Mars Odyssey THEMIS night-time infrared, 100 m pixels (NASA JPL Mars Trek). Context only: it is not used in the route.
    { id: "themis", name: "Night heat (THEMIS infrared)", on: false, sw: "linear-gradient(90deg,#1a1a1a,#e5e5e5)",
      note: "100 m pixels, from Mars Odyssey. At night, rock stays warmer (bright) and loose sand or dust cools faster (dark). Shades are relative, not temperatures. Zoom out to see it. Context only: not used in the route." },
    { id: "traverse", name: "Perseverance's real path", on: true, sw: "repeating-linear-gradient(90deg,#38bdf8 0 4px,transparent 4px 7px)" },
    { id: "o2", name: "50-min backup-oxygen line", on: true, sw: "repeating-linear-gradient(90deg,#fbbf24 0 5px,transparent 5px 8px)" },
    // The advice the Curiosity RAD team published from the storms it has measured: stay within 30 min of shelter (Löwe et al. 2025).
    // Off by default; no check uses it.
    { id: "storm", name: "Storm-shelter line: inside within 30 min", on: false, sw: "repeating-linear-gradient(90deg,#c084fc 0 5px,transparent 5px 8px)",
      note: "Where the walk home takes 20 min, plus about 10 min to get inside. From the advice the team behind Curiosity's radiation detector published after the storms it has measured (Löwe et al. 2025): do not go more than 30 min from shelter. A research result, not a NASA flight rule, and none of the three checks uses it." },
  ].filter((o) => o.id !== "storm" || window.StormReplay);

  function buildOverlays(m, traverse) {
    for (const o of OVERLAYS) {
      if (o.file) S.overlays[o.id] = L.imageOverlay(`data/${o.file}`, m.overlay_bounds, { interactive: false, opacity: o.id === "hillshade" ? 0.85 : 1 });
    }
    map.createPane("thermal"); map.getPane("thermal").style.zIndex = 250; map.getPane("thermal").style.pointerEvents = "none";   // above the background, below the other layers
    S.overlays.themis = L.tileLayer(trekUrl("THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", "png"), { pane: "thermal", maxNativeZoom: 9, maxZoom: 19, opacity: 0.62,
      attribution: `${credit} · THEMIS night infrared (NASA/JPL-Caltech/Arizona State University)` });
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
      rows.push(['<i style="width:10px;height:10px;border-radius:50%;border:2px solid var(--warn)"></i>', "Tightest point (plan fits)"]);
      if (drill.line) rows.push(['<i style="height:0;border-top:3px dotted #f9a8d4;background:none"></i>', "Way home (drill)"]);
    }
    for (const o of OVERLAYS) {
      const lay = S.overlays[o.id] || (o.id === "o2" || o.id === "storm" ? zone[o.id] : null);
      if (lay && map.hasLayer(lay) && o.id !== "hillshade") rows.push([`<i style="background:${o.sw}"></i>`, o.name]);
    }
    $("#legend").innerHTML = rows.map(([i, t]) => `<div>${i}<span>${t}</span></div>`).join("");
  }

  function renderLayersPanel() {
    const box = $("#layersPanel");
    let html = '<button class="x" data-close="layersPanel" aria-label="Close">&times;</button><div class="lbl-lg">Map layers</div>';
    for (const o of OVERLAYS) html += `<label class="lay"><input type="checkbox" data-ov="${o.id}" ${o.on ? "checked" : ""}> ${o.name}</label>${o.note ? `<small class="lay-note">${o.note}</small>` : ""}`;
    html += '<div class="lbl-lg" style="margin-top:14px">Background</div><div class="bases">';
    for (const k of Object.keys(BASES)) html += `<button data-base="${k}" class="${k === baseKey ? "on" : ""}">${BASES[k].name}</button>`;
    html += "</div>";
    box.innerHTML = html;
    box.querySelectorAll("input[data-ov]").forEach((inp) => (inp.onchange = () => {
      const id = inp.dataset.ov, lay = id === "o2" || id === "storm" ? zone[id] : S.overlays[id];
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
    const P = S.m.profile, wb = S.m.walkback, lim = wb.eva_limit_h * 60 - (wb.airlock_min || 0);   // the suit limit on the walk clock (T+0 = first step outside)
    const Tmax = Math.max(Math.ceil(lim / 60) * 60, Math.ceil(P[P.length - 1].t / 60) * 60);   // whole hours; longer if the walk runs past the suit limit
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
    // the time the crew must be home by, and the suit limit if the walk runs past it
    const xb = X(m.walkback.budget_min);
    g += `<line x1="${xb}" x2="${xb}" y1="${TL.axisY}" y2="${H - 6}" stroke="#fbbf24" stroke-dasharray="3 3" opacity=".6"/>`;
    g += `<text x="${xb + 4}" y="${TL.stopY + 4}" fill="#fbbf24" font-size="10" font-family="Barlow Semi Condensed" letter-spacing="1">HOME BY T+${hm(m.walkback.budget_min)}</text>`;
    if (P[P.length - 1].t > lim) {
      const xl = X(lim);
      g += `<line x1="${xl}" x2="${xl}" y1="${TL.axisY}" y2="${H - 6}" stroke="#f87171" stroke-dasharray="3 3"/>`;
      g += `<text x="${xl + 4}" y="${TL.stopY + 16}" fill="#f87171" font-size="10" font-family="Barlow Semi Condensed" letter-spacing="1">SUIT LIMIT T+${hm(lim)}</text>`;
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
  const zone = { field: null, overlay: null, o2: null, storm: null, canvas: document.createElement("canvas"), img: null, url: null, busy: false, pending: null, active: false };
  const playBtn = $("#playBtn");
  playBtn.onclick = () => { closeGuide(); eva.playing ? pause() : play(); };
  function setPlayBtn(mode) {   // "play" | "pause" | "replay"
    const label = mode === "pause" ? "Pause" : mode === "replay" ? "Walk it again" : "Walk the plan";
    playBtn.innerHTML = `<span class="${mode === "pause" ? "sq" : "tri"}"></span><span class="pl">${label}</span><span class="gnum" aria-hidden="true">2</span>`;
    playBtn.setAttribute("aria-label", label);
    const ap = $("#aPlay");
    if (ap) ap.innerHTML = `<span class="${mode === "pause" ? "sq" : "tri"}"></span><span>${label}</span>`;
  }

  function setField(field) {
    zone.field = field;
    drawO2Line();
    if (zone.active) renderZone(eva.T);
  }

  // Fixed line: everywhere within 50 min of walking from base camp (suit failure, 1 h backup oxygen).
  // A dashed line where the walk home takes `limMin` minutes, read from the walk-home layer:
  // the 50-min backup-oxygen line (amber) and the 30-min storm-shelter line (violet, off by default).
  function drawLimitLine(key, limMin, rgb) {
    const g = S.m && S.m.grid, f = zone.field;
    if (!g || !f) return;
    const lim = limMin * 10;
    const c = document.createElement("canvas"); c.width = g.w; c.height = g.h;
    const ctx = c.getContext("2d"), img = ctx.createImageData(g.w, g.h), px = img.data, w = g.w, n = g.w * g.h;
    for (let i = 0; i < n; i++) {
      if (f[i] > lim) continue;
      const edge = (i % w < w - 1 && f[i + 1] > lim) || (i % w > 0 && f[i - 1] > lim) || (i + w < n && f[i + w] > lim) || (i >= w && f[i - w] > lim);
      const x = i % w, y = (i / w) | 0;
      if (edge && (x + y) % 6 < 4) { const o = i * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 240; }
    }
    ctx.putImageData(img, 0, 0);
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const on = OVERLAYS.find((o) => o.id === key).on;
      if (zone[key]) { zone[key].setUrl(url); } else { zone[key] = L.imageOverlay(url, S.m.overlay_bounds, { interactive: false }); }
      if (on && !map.hasLayer(zone[key])) zone[key].addTo(map);
      bringRouteToFront(); renderLegend();
    }, "image/png");
  }
  function drawO2Line() {
    drawLimitLine("o2", (S.m.walkback.suit && S.m.walkback.suit.limit_min) || 50, [251, 191, 36]);
    // the published advice counts the time to be inside, so the line sits where the walk home is 30 min less the time to get inside
    if (window.StormReplay) drawLimitLine("storm", window.StormReplay.published.shelter_min - GET_INSIDE_MIN, [192, 132, 252]);
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
    const thrBad = (((wb.bad ? wb.bad.budget_min : wb.budget_min) - T) / bf) * 10, thrN = (wb.budget_min - T) * 10;
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
    if (drill.type && drill.T != null && Math.abs(T - drill.T) > 0.01) closeDrill();   // the card belongs to one moment
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
    const mPlan = wb.budget_min - (Tm + back), mBad = (wb.bad ? wb.bad.budget_min : wb.budget_min) - (Tm + bf * back);
    const leg = st.gap ? st.q.leg : st.p.leg;
    const nextS = stopById(m.order[leg + 1] || "base");
    const here = st.gap ? stopById(m.order[st.q.leg]) : null;
    const dist = nextS ? map.distance(pos, [nextS.lat, nextS.lon]) * (R_MARS / 6378137) : 0;
    let whereLbl, whereVal, whereSub = "";
    if (st.after) { whereLbl = "Status"; whereVal = "BACK AT BASE CAMP"; whereSub = `Home at T+${hm(m.profile[m.profile.length - 1].t)}`; }
    else if (here) {
      const tl = (m.timeline || [])[st.q.leg];
      whereLbl = "On site"; whereVal = shortName(here).toUpperCase();
      if (tl) whereSub = `Leave by T+${hm(leaveBy(tl))}`;
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
      ${alarm ? '<div class="alarm-txt">TURN BACK</div>' : ""}
      ${st.after ? "" : `<div class="drills" role="group" aria-label="Bad-day drills: what if it goes wrong right here">${drillBtns()}</div>`}`;
    eva.nav = { T, back, mPlan, mBad, lim, st, here, nextS, dist, pos };
    renderAstro(eva.nav);
    document.dispatchEvent(new CustomEvent("redroute:time", { detail: eva.nav }));
  }

  function play() {
    const m = S.m;
    if (!m) return;
    const lastT = m.profile[m.profile.length - 1].t;
    const end = Math.min(tlScale().Tmax, lastT + 10);   // stop shortly after the crew is home
    const start = eva.T >= end - 0.5 ? 0 : eva.T;
    if (start === 0) { const b = stopById("base"); map.flyTo([b.lat, b.lon], Math.max(map.getZoom(), 15), { duration: 0.6 }); }
    closeDrill();
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

  /* ---------- bad-day drills: what if it goes wrong right here, right now ----------
     Each drill pauses the clock and reads the same numbers the three checks use, at the crew's position
     on the planned walk. Nothing in the plan is changed. The storm warning time is a what-if the user picks. */
  const DRILLS = [["hurt", "Crewmate hurt here"], ["suit", "Suit alarm here"], ["storm", "Storm warning now"], ["late", "Running late +10 min"]];
  const LATE_MAX = 120;   // the delay drill stops adding here
  const GET_INSIDE_MIN = 10;   // minutes to get inside once the crew is back at base camp: the allowance in the suit-failure rule (1 h of backup oxygen = 50 min of walking + this)
  const drillBtns = () => DRILLS.map(([k, t]) => `<button data-drill="${k}">${t}</button>`).join("");
  const drill = { type: null, warn: 30, late: 0, line: null, T: null };
  const drillEl = el("div", "pnl drill-card");
  drillEl.hidden = true; drillEl.setAttribute("role", "dialog"); drillEl.setAttribute("aria-label", "Bad-day drill");
  document.body.appendChild(drillEl);
  // The strip above the map is redrawn on every frame while the walk plays, so a mouse click (down, then up)
  // would be lost: open the drill on pointer-down, and keep "click" for the keyboard.
  let drillTap = 0;
  const liveDrill = (e) => {
    const b = e.target.closest("[data-drill]");
    if (!b) return;
    if (e.type === "pointerdown") { if (e.button) return; drillTap = performance.now(); }
    else if (performance.now() - drillTap < 800) return;
    openDrill(b.dataset.drill);
  };
  $("#live").addEventListener("pointerdown", liveDrill);
  $("#live").addEventListener("click", liveDrill);
  $("#aDrills").innerHTML = drillBtns();
  document.querySelectorAll(".stag-slot").forEach((e) => { const [k, how] = e.dataset.stag.split(":"); e.innerHTML = stag(k, how); });
  $("#aDrills").addEventListener("click", (e) => { const b = e.target.closest("[data-drill]"); if (b) openDrill(b.dataset.drill); });
  drillEl.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.classList.contains("stag")) return;
    if (b.dataset.warn) { drill.warn = b.dataset.warn === "real" ? "real" : +b.dataset.warn; renderDrill(); }
    else if (b.dataset.late === "more") { drill.late = Math.min(LATE_MAX, drill.late + 10); renderDrill(); }
    else if (b.dataset.late === "clear") closeDrill();
    else if (b.dataset.close != null) closeDrill();
  });

  // The way home from a point: walk downhill on the walk-home time layer until base camp.
  // The layer stores no path, so this follows the smallest walk-home time from cell to cell. Drawn only if it reaches base.
  function wayHome(pos) {
    const g = S.m && S.m.grid, f = zone.field;
    if (!g || !f) return null;
    const c0 = Math.floor((pos[1] - g.lon0) / g.dlon), r0 = Math.floor((g.lat1 - pos[0]) / g.dlat);
    if (r0 < 0 || r0 >= g.h || c0 < 0 || c0 >= g.w) return null;
    let i = r0 * g.w + c0;
    if (f[i] === 65535) {   // a stop can sit on a cell that is no-go on this coarser grid: start from the nearest cell that is not
      let best = -1, bd = Infinity;
      for (let dr = -8; dr <= 8; dr++) for (let dc = -8; dc <= 8; dc++) {
        const rr = r0 + dr, cc = c0 + dc;
        if (rr < 0 || rr >= g.h || cc < 0 || cc >= g.w) continue;
        const j = rr * g.w + cc, d2 = dr * dr + dc * dc;
        if (f[j] !== 65535 && d2 < bd) { bd = d2; best = j; }
      }
      if (best < 0) return null;
      i = best;
    }
    const pts = [pos], seen = new Set([i]);
    for (let n = 0; n < 40000 && f[i] > 0; n++) {
      const r = (i / g.w) | 0, c = i % g.w;
      let best = -1, bv = f[i], tie = -1;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= g.h || cc < 0 || cc >= g.w) continue;
        const j = rr * g.w + cc;
        if (f[j] < bv) { bv = f[j]; best = j; } else if (f[j] === f[i] && !seen.has(j) && tie < 0) tie = j;
      }
      if (best < 0) best = tie;   // the layer is stored in steps of 6 s, so neighbours can tie
      if (best < 0) break;
      i = best; seen.add(i);
      if (n % 2 === 0) pts.push([g.lat1 - (((i / g.w) | 0) + 0.5) * g.dlat, g.lon0 + ((i % g.w) + 0.5) * g.dlon]);
    }
    if (f[i] > 10) return null;   // did not come within a minute of base camp
    const bs = stopById("base"); pts.push([bs.lat, bs.lon]);
    return pts;
  }

  const stormDay = (SR) => new Date(`${SR.day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  function openDrill(type) {
    if (!S.m || !eva.nav || eva.nav.st.after) return;
    if (eva.playing) pause();
    if (type === "late") drill.late = drill.type === "late" ? Math.min(LATE_MAX, drill.late + 10) : 10; else drill.late = 0;
    drill.type = type; drill.T = eva.nav.T;
    if (drill.line) { map.removeLayer(drill.line); drill.line = null; }
    if (type !== "late") {
      const pts = wayHome(eva.nav.pos);
      if (pts) drill.line = L.polyline(pts, { color: "#f9a8d4", weight: 3.5, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(map);
    }
    renderLegend();
    renderDrill();
  }
  function closeDrill() {
    if (!drill.type && drillEl.hidden && !drill.line) return;
    drill.type = null; drill.late = 0; drill.T = null;
    drillEl.hidden = true;
    if (drill.line) { map.removeLayer(drill.line); drill.line = null; }
    renderLegend();
  }
  function renderDrill() {
    const n = eva.nav, m = S.m;
    if (!n || !drill.type) return;
    const wb = m.walkback, bf = wb.bad ? wb.bad.factor : 2, homeBy = wb.bad ? wb.bad.budget_min : wb.budget_min;
    const where = n.here ? `at ${shortName(n.here)}` : `on the way to ${shortName(n.nextS)}`;
    const row = (k, v) => `<div class="dr"><span>${k}</span><b>${v}</b></div>`;
    const verdict = (ok, txt, word) => `<div class="dv ${ok ? "ok" : "bad"}">${word || (ok ? "MAKES IT" : "DOES NOT MAKE IT")}<small>${txt}</small></div>`;
    const spareTxt = (x, unit = "to spare") => (x >= 0 ? `${fmtMin(x)} ${unit}` : `${fmtMin(x)} short`);
    // whole minutes, and the spare time is worked out from the whole minutes shown, so each card adds up
    const backR = Math.round(n.back);
    let title, body, note;
    if (drill.type === "hurt") {
      const left = Math.round(homeBy - n.T), half = Math.round(bf * n.back), spare = left - half;
      title = "Crewmate hurt (EV2)";
      body = row("Walk home at normal pace", fmtMin(backR)) + row("At half speed, EV1 helping the hurt EV2", fmtMin(half))
        + row(`Time left to be home by T+${hm(homeBy)}`, fmtMin(left)) + verdict(n.mBad >= 0, spareTxt(spare));
      note = 'Same rule as the "If something goes wrong" check. The reserve stays untouched.';
    } else if (drill.type === "suit") {
      title = "Suit alarm";
      body = row("Walk home from here", fmtMin(backR)) + row("Backup oxygen for the walk", `${n.lim} min`) + verdict(n.back <= n.lim, spareTxt(n.lim - backR, "of backup oxygen to spare"));
      note = `Same rule as the "Suit failure" check: 1 h of backup oxygen, about ${GET_INSIDE_MIN} min of it to get inside.`;
    } else if (drill.type === "storm") {
      // rounded toward the unsafe side: the walk home is rounded up, so a spare is rounded down and a shortfall up
      const SR = window.StormReplay, real = drill.warn === "real" && !!SR;
      const warn = real ? Math.floor(SR.alarmToPeakMin) : (drill.warn === "real" ? 30 : drill.warn);
      const backUp = Math.ceil(n.back - 1e-9), need = backUp + GET_INSIDE_MIN, spare = warn - need;
      const picks = [15, 30, 60].map((w) => `<button data-warn="${w}" class="${!real && w === warn ? "on" : ""}">${w} min</button>`).join("")
        + (SR ? `<button data-warn="real" class="${real ? "on" : ""}">Real storm</button>` : "");
      title = "Storm warning";
      body = row("Walk home from here", fmtMin(backUp)) + row("Get inside (same as the suit check)", `${GET_INSIDE_MIN} min`)
        + `<div class="dr dr-pick"><span>Warning time${real ? "" : " (what-if, you pick)"}${stag(real ? "d" : "a", "drillHow")}</span><span class="dpick">${picks}</span></div>`;
      if (real) {
        // the solar storm of 20 May 2024, as Curiosity's RAD measured it (extra/storm-replay.js)
        const w = SR.walkHome(need), rnd = (x) => (x >= 100 ? Math.round(x / 10) * 10 : Math.round(x));
        body += row("20 May 2024: alarm to strongest reading", `${warn} min`)
          + verdict(spare >= 0, spare >= 0 ? `inside ${fmtMin(spare)} before the strongest reading began` : `not inside until ${fmtMin(spare)} after the strongest reading began`, spare >= 0 ? "INSIDE BEFORE THE PEAK" : "STILL OUTSIDE AT THE PEAK")
          + row(`Radiation until inside (${fmtMin(w.minutes)}${w.cut ? ", where our readings end" : ""})`, `about ${rnd(w.ugy)} µGy <small>quiet day: about ${rnd(w.quiet_ugy)} µGy</small>`);
        note = `A replay, not a forecast: Curiosity's RAD readings for the solar storm of ${stormDay(SR)} in Gale Crater, from NASA's PDS archive (our reading). The alarm is the first reading above ${SR.alarmX} times the normal level, which is our choice; the published 25 % rule of the RAD team (${SR.published.cite}), applied by us, picks the same reading. Readings are 8 to 16 min long, so ${warn} min could be ${SR.range_min[0]} to ${SR.range_min[1]}. The rise is the storm itself arriving: this data holds no earlier warning. Measured on the rover's deck, not in a suit.`;
      } else {
        body += verdict(spare >= 0, spare >= 0 ? `inside with ${fmtMin(spare)} to spare` : `${fmtMin(spare)} short of shelter`);
        note = `${spare >= 0 ? "" : `With a ${warn}-min warning the crew would have to stay within ${warn - GET_INSIDE_MIN} min of walking from base. `}A what-if, not a forecast: real warning times depend on the storm.${SR ? ' "Real storm" replays the solar storm of 20 May 2024 from Curiosity\'s readings.' : ""}`;
      }
    } else {
      const D = drill.late, P = m.profile, tl = m.timeline || [], lastT = P[P.length - 1].t;
      let wPlan = Infinity, wBad = Infinity;   // the tightest moments from now on, with the delay added
      for (const pt of P) if (pt.t >= n.T - 1e-6) {
        wPlan = Math.min(wPlan, wb.budget_min - (pt.t + D + pt.back));
        wBad = Math.min(wBad, homeBy - (pt.t + D + bf * pt.back));
      }
      let rows = "", need = 0, stayAhead = 0, stayAtNeed = 0, lateStop = null, onSite = null;
      for (let i = 1; i < tl.length - 1; i++) {
        const tt = tl[i];
        if (tt.depart_min < n.T - 1e-6) continue;   // already left this stop
        const s = stopById(m.order[i]), dep = tt.depart_min + D, spare = leaveBy(tt) - dep;
        stayAhead += Math.max(0, tt.depart_min - Math.max(tt.arrive_min, n.T));   // stop time still ahead, up to this stop
        if (tt.arrive_min <= n.T + 1e-6) onSite = s;
        rows += row(`Leave ${esc(shortName(s))}`, `T+${hm(dep)} <small>leave by T+${hm(leaveBy(tt))} · ${spare >= 0 ? `${fmtMin(spare)} to spare` : `${fmtMin(spare)} late`}</small>`);
        if (-spare > need) { need = -spare; lateStop = s; stayAtNeed = stayAhead; }
      }
      // a minute saved at any stop still ahead moves every later departure, so the time to win back is the largest lateness
      const needMin = need > 0 ? Math.max(1, Math.round(need)) : 0;   // rounded like the rows above, so the card agrees with itself
      let fix = "";
      if (needMin > 0 && lateStop) {
        const nm = esc(shortName(lateStop));
        if (stayAtNeed >= needMin) fix = onSite === lateStop
          ? ` Leave ${nm} ${needMin} min earlier than planned.`
          : ` Win back ${needMin} min before leaving ${nm}: cut the stop time still ahead (${fmtMin(stayAtNeed)} is planned).`;
        else if (onSite === lateStop) fix = ` Leave ${nm} now. Even then the half-speed rule is ${fmtMin(needMin - Math.round(stayAtNeed))} short.`;
        else fix = ` The stop time still ahead (${fmtMin(stayAtNeed)}) cannot win back ${needMin} min. Skip a stop: untick it in Plan your EVA to see the new plan.`;
      }
      const suitEnd = wb.eva_limit_h * 60 - (wb.airlock_min || 0);
      title = `Running late +${D} min`;
      body = rows + row("Back at base camp", `T+${hm(lastT + D)} <small>plan T+${hm(lastT)}${lastT + D > suitEnd ? ` · past the suit limit T+${hm(suitEnd)}` : ""}</small>`)
        + (wPlan < 0 ? verdict(false, `Home ${fmtMin(wPlan)} after T+${hm(wb.budget_min)}, even at normal pace.${fix}`, "DOES NOT FIT")
          : wBad < 0 ? verdict(false, `At normal pace the crew is still home in time (${fmtMin(wPlan)} to spare). But if EV2 got hurt at the tightest moment, the half-speed walk home would be ${fmtMin(wBad)} late.${fix}`, "BAD-DAY RULE BROKEN")
            : verdict(true, `The tightest moment still has ${fmtMin(Math.min(wPlan, wBad))} to spare.`, "STILL FITS"))
        + `<div class="dbtns"><button data-late="more"${D >= LATE_MAX ? " disabled" : ""}>+10 min more</button><button data-late="clear">Clear the delay</button></div>`;
      note = "The delay is added to the rest of the plan. Leave-by times do not move: they come from the terrain and the suit time.";
    }
    drillEl.className = `pnl drill-card${astro.open ? " in-astro" : ""}`;
    drillEl.innerHTML = `<div class="dh"><span class="lbl">Drill · T+${hm(n.T)} · ${esc(where)}${stag("d", "drillHow")}</span><button class="x" data-close aria-label="Close the drill">&times;</button></div>
      <div class="dt">${title}</div>${body}<p class="dn">${note}</p><button class="ghost" data-close>Back to the walk</button>`;
    drillEl.hidden = false;
    // on a wide screen keep the card off the middle of the map: bottom left, above the clock
    if (!astro.open && !isMobile()) { drillEl.style.top = "auto"; drillEl.style.bottom = "164px"; drillEl.style.left = "348px"; drillEl.style.transform = "none"; }
    else { drillEl.style.top = drillEl.style.bottom = drillEl.style.left = drillEl.style.transform = ""; }
  }

  /* ---------- v2: Astronaut view, the crew's own screen ----------
     One status word, two big numbers and an arrow, readable at a glance; buttons sized for gloves.
     Driven by the same EVA clock as the map, so it shows exactly what the plan predicts. */
  const astro = { open: false, legEnd: [] };
  function astroEnd() { const tl = S.m.timeline || []; return tl.length ? tl[tl.length - 1].arrive_min : S.m.profile[S.m.profile.length - 1].t; }

  // The route between two distances along the walk (metres), for the "your way" line on the small map.
  function routeSlice(d0, d1) {
    const toRad = Math.PI / 180, out = [];
    let acc = 0, prev = null;
    for (const layer of S.routeLine.getLayers()) for (const ll of layer.getLatLngs()) {
      if (prev) {
        const dy = (ll.lat - prev.lat) * toRad * R_MARS, dx = (ll.lng - prev.lng) * toRad * R_MARS * Math.cos(ll.lat * toRad);
        const seg = Math.hypot(dx, dy), a = acc, b = acc + seg;
        if (seg > 0 && b >= d0 && a <= d1) {
          const f0 = Math.max(0, (d0 - a) / seg), f1 = Math.min(1, (d1 - a) / seg);
          if (!out.length) out.push([prev.lat + (ll.lat - prev.lat) * f0, prev.lng + (ll.lng - prev.lng) * f0]);
          out.push([prev.lat + (ll.lat - prev.lat) * f1, prev.lng + (ll.lng - prev.lng) * f1]);
        }
        acc = b;
        if (acc > d1) return out;
      }
      prev = ll;
    }
    return out;
  }

  /* small moving map in the astronaut view: follows the crew and turns so the walking direction is up
     (like car navigation; tap the N button for north up). Shows the route ahead and the steep ground. */
  const amap = { map: null, lastPan: 0, hdg: null, northUp: false };
  // The map element is a square as big as the frame's diagonal, so turning it never shows empty corners.
  function sizeAstroMap() {
    const wrap = $("#aMapWrap"), el = $("#aMap");
    const d = Math.ceil(Math.hypot(wrap.clientWidth, wrap.clientHeight));
    el.style.width = `${d}px`; el.style.height = `${d}px`;
    if (amap.map) amap.map.invalidateSize();
  }
  // Turn the map toward the walking direction. Smooth while the clock plays, jump when scrubbing.
  function steerAstroMap(target) {
    if (target == null || !isFinite(target)) target = amap.hdg ?? 0;
    if (amap.hdg == null || !eva.playing) amap.hdg = target;
    else { const diff = ((target - amap.hdg + 540) % 360) - 180; amap.hdg = (amap.hdg + diff * 0.12 + 360) % 360; }
    const rot = amap.northUp ? 0 : amap.hdg, el = $("#aMap");
    el.style.transform = `translate(-50%, -50%) rotate(${-rot}deg)`;
    el.style.setProperty("--hdg", `${rot}deg`);
    $("#aNorth").style.transform = `rotate(${-rot}deg)`;
    $("#aNorth").classList.toggle("fixed", amap.northUp);
    return rot;
  }
  $("#aNorth").onclick = () => { amap.northUp = !amap.northUp; steerAstroMap(amap.hdg); if (astro.open) setTime(eva.T); };
  window.addEventListener("resize", () => { if (astro.open) sizeAstroMap(); });
  function initAstroMap() {
    sizeAstroMap();
    if (amap.map) { amap.map.invalidateSize(); return; }
    amap.map = L.map("aMap", { crs: L.CRS.EPSG4326, zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0.5 });
    L.tileLayer(trekUrl("Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw", "jpg"), { maxNativeZoom: 8, maxZoom: 19, className: "ctx-relief" }).addTo(amap.map);
    L.tileLayer(trekUrl("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png"), { maxNativeZoom: 17, maxZoom: 19, bounds: JEZ_HIRISE }).addTo(amap.map);
    L.imageOverlay("data/slope.png", S.m.overlay_bounds, { interactive: false }).addTo(amap.map);
    const b = stopById("base");
    amap.map.setView([b.lat, b.lon], 15.5);
    amap.map.on("zoomend moveend", astroScale);
  }
  function drawAstroRoute() {
    if (!amap.map) return;
    for (const k of ["casing", "route"]) if (amap[k]) amap.map.removeLayer(amap[k]);
    (amap.stops || []).forEach((l) => amap.map.removeLayer(l));
    const gj = S.routeLine.toGeoJSON();
    amap.casing = L.geoJSON(gj, { style: { color: "#0b0b0b", weight: 11, opacity: 0.7 }, interactive: false }).addTo(amap.map);
    amap.route = L.geoJSON(gj, { style: { color: "#ff6a3d", weight: 5 }, interactive: false }).addTo(amap.map);
    amap.stops = S.m.order.slice(0, -1).map((id) => { const s = stopById(id); return L.marker([s.lat, s.lon], { icon: markerIcon(s), interactive: false, keyboard: false }).addTo(amap.map); });
    if (amap.ahead) amap.ahead.bringToFront();
    if (amap.crew) amap.crew.bringToFront();
  }
  function updateAstroMap(pos, aheadPts) {
    if (!amap.map) return;
    if (!amap.crew) {
      amap.ahead = L.polyline([], { color: "#ffffff", weight: 7, opacity: 0.95, lineCap: "round", interactive: false }).addTo(amap.map);
      amap.crew = L.circleMarker(pos, { radius: 10, color: "#fff", weight: 3, fillColor: "#38bdf8", fillOpacity: 1, interactive: false }).addTo(amap.map);
    }
    amap.ahead.setLatLngs(aheadPts && aheadPts.length > 1 ? aheadPts : []).bringToFront();
    amap.crew.setLatLng(pos).bringToFront();
    const now = performance.now();
    if (now - amap.lastPan > 100) { amap.map.setView(pos, amap.map.getZoom(), { animate: false }); amap.lastPan = now; }
  }
  function astroScale() {
    if (!amap.map) return;
    const c = amap.map.getCenter(), a = amap.map.latLngToContainerPoint(c), b = amap.map.latLngToContainerPoint([c.lat, c.lng + 0.01]);
    const mPerPx = (((Math.PI * R_MARS) / 180) * Math.cos((c.lat * Math.PI) / 180) * 0.01) / Math.max(1e-6, Math.abs(b.x - a.x));
    const len = [50, 100, 200, 500, 1000].find((x) => x / mPerPx >= 70) || 1000;
    $("#aScaleBar").style.width = `${Math.round(len / mPerPx)}px`;
    $("#aScaleTxt").textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
  }
  $("#aZin").onclick = () => amap.map && amap.map.setZoom(Math.min(18, amap.map.getZoom() + 0.5));
  $("#aZout").onclick = () => amap.map && amap.map.setZoom(Math.max(13, amap.map.getZoom() - 0.5));

  function renderAstroTrack() {
    astro.legEnd = [];
    for (const p of S.m.profile) astro.legEnd[p.leg] = p.d;   // distance along the walk where each leg ends
    const tl = S.m.timeline || [], end = astroEnd();
    const pct = (t) => Math.max(0, Math.min(100, (t / end) * 100));
    let h = '<div class="trk-line"></div><div class="trk-done" id="aDone"></div>';
    tl.forEach((t, i) => {
      const last = i === tl.length - 1;
      const name = i === 0 ? "1 BASE" : last ? `${tl.length} HOME` : `${i + 1} ${shortName(stopById(t.id)).toUpperCase()}`;
      h += `<div class="trk-stop" style="left:${pct(t.arrive_min)}%"><i></i><em>${esc(name)}</em></div>`;
    });
    $("#aTrack").innerHTML = `${h}<div class="trk-crew" id="aCrew"></div>`;
  }
  function openAstro() {
    if (!S.m) return;
    closeGuide();
    for (const id of ["layersPanel", "planPanel", "about"]) document.getElementById(id).hidden = true;
    syncNav();
    astro.open = true;
    $("#astro").hidden = false;
    document.body.classList.add("astro-on");
    renderAstroTrack();
    initAstroMap();
    drawAstroRoute();
    setTime(eva.T || 0);
    astroScale();
    $("#astro").scrollTop = 0;
    $("#aPlay").focus({ preventScroll: true });   // keep the status word in view on phones
  }
  function closeAstro() {
    closeDrill();
    astro.open = false;
    $("#astro").hidden = true;
    document.body.classList.remove("astro-on");
  }
  function renderAstro(n) {
    if (!astro.open) return;
    $("#aDrills").hidden = !!n.st.after;
    const { T, back, mPlan, mBad, lim, st, here, nextS, dist, pos } = n;
    const m = S.m;
    $("#aMet").textContent = `T+${hm(T)}`;
    let cls = "", word = "GO", spare = `${fmtMin(mPlan)} to spare`;
    if (st.after) { word = "HOME"; spare = `EVA complete at T+${hm(m.profile[m.profile.length - 1].t)}`; }
    else if (mPlan < 0 || mBad < 0 || back > lim) {
      cls = "bad"; word = "TURN BACK NOW";
      spare = back > lim ? `Walk home is ${Math.round(back)} min, more than the ${lim} min of backup oxygen`
        : mPlan < 0 ? `${fmtMin(mPlan)} past the plan's time limit` : "No time left if a crewmate gets hurt";
    } else if (mPlan < 30) { cls = "warn"; word = "HEAD HOME SOON"; spare = `Only ${fmtMin(mPlan)} to spare`; }
    $("#aStatus").className = `astro-status ${cls}`;
    $("#aWord").textContent = word;
    $("#aSpare").textContent = spare;
    $("#aBad").innerHTML = st.after ? "" : `If EV2 is hurt and EV1 helps: <b class="${mBad < 0 ? "bad" : ""}">${fmtMin(mBad)} ${mBad < 0 ? "short" : "to spare"}</b>${stag("d", "how-checks")}${stag("a", "how-numbers")}`;
    // walk home, measured against the 50 min of backup oxygen
    $("#aBack").textContent = `${Math.round(back)} MIN`;
    $("#aBack").className = back > lim ? "bad" : "";
    $("#aO2").style.width = `${Math.min(100, (back / lim) * 100)}%`;
    $("#aO2bar").className = `o2bar ${back > lim ? "bad" : back > lim * 0.8 ? "warn" : ""}`;
    $("#aO2txt").textContent = back > lim ? `Beyond the ${lim} min of backup oxygen` : `Inside the ${lim} min of backup oxygen`;
    // where to go next: along the planned route, never a straight line (a straight line can cross no-go slopes)
    const arrow = $("#aArrow");
    $("#aSite").textContent = "";
    let aheadPts = null;
    if (st.after) {
      $("#aNextLbl").textContent = "Status"; $("#aNext").textContent = "BASE CAMP"; $("#aNextSub").textContent = "Crew is back inside";
      arrow.style.display = "none";
      steerAstroMap(null);
    } else {
      const leg = st.gap ? st.q.leg : st.p.leg;
      if (here) {
        const tl = (m.timeline || [])[st.q.leg];
        if (tl) $("#aSite").textContent = `At ${shortName(here)}: leave by T+${hm(leaveBy(tl))}`;
      }
      const legEnd = astro.legEnd[leg] ?? st.d, along = Math.max(0, legEnd - st.d);
      aheadPts = routeSlice(st.d, Math.min(legEnd, st.d + 120));
      const tgt = along > 5 ? pointAtDistance(Math.min(legEnd, st.d + 60)) : [nextS.lat, nextS.lon];
      const brg = bearing(pos, tgt);
      // walking direction = the route over the next 25 m; the map turns so this points up
      const near = along > 5 ? pointAtDistance(Math.min(legEnd, st.d + 25)) : tgt;
      const rot = steerAstroMap(bearing(pos, near));
      $("#aNextLbl").textContent = nextS.id === "base" ? "Heading home" : "Next stop";
      $("#aNext").textContent = shortName(nextS).toUpperCase();
      $("#aNextSub").textContent = `${along >= 1000 ? `${(along / 1000).toFixed(2)} km` : `${Math.round(along)} m`} along the route · ${compass(brg)}`;
      arrow.style.display = "";
      arrow.style.transform = `rotate(${brg - rot}deg)`;   // relative to the map: up = straight ahead, leans before a bend
    }
    updateAstroMap(pos, aheadPts);
    const p = `${Math.max(0, Math.min(100, (T / astroEnd()) * 100))}%`;
    const crew = $("#aCrew"), done = $("#aDone");
    if (crew) crew.style.left = p;
    if (done) done.style.width = p;
  }
  $("#astroBtn").onclick = openAstro;
  $("#aExit").onclick = closeAstro;
  $("#aPlay").onclick = () => (eva.playing ? pause() : play());
  $("#aTrack").addEventListener("click", (e) => {
    if (!S.m) return;
    const r = e.currentTarget.getBoundingClientRect();
    pause();
    setTime(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * astroEnd());
  });

  /* ---------- live re-planning (web worker) ---------- */
  const DEFAULT_ORDER = ["base", "depot", "gap", "top", "base"];
  let worker = null, planId = 0, planTimer = 0;

  function renderPlanPanel(m) {
    const a = m.assumptions;
    const sl = (id, label, min, max, step, val, unit) => `<div class="sl"><label for="sl-${id}">${label}${stag("a", "how-numbers")}<output>${val}${unit}</output></label>
      <input type="range" id="sl-${id}" data-k="${id}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
    const box = $("#planPanel");
    box.innerHTML = `<button class="x" data-close="planPanel" aria-label="Close">&times;</button><div class="lbl-lg">Plan your EVA</div>
      ${sl("vFlat", "Suited walking speed", 0.3, 1.2, 0.02, a.v_flat_ms, " m/s")}
      ${sl("maxSlope", "No-go slope", 10, 25, 1, a.max_slope_deg, "°")}
      ${sl("roughPenalty", "Rough ground slows you", 1, 3, 0.1, a.rough_penalty, "×")}
      ${sl("evaH", "EVA time limit", 4, 10, 0.5, a.eva_limit_h, " h")}
      ${sl("reserve", "Reserve", 0, 50, 5, Math.round(a.reserve * 100), " %")}
      ${sl("airlock", "Airlock time (out and back in)", 0, 150, 5, a.airlock_min || 0, " min")}
      <div class="lbl-lg" style="margin-top:12px">Stops</div>
      ${m.stops.filter((s) => s.id !== "base").map((s) => `<label class="tog"><input type="checkbox" data-stop="${s.id}" ${m.order.includes(s.id) ? "checked" : ""}> ${esc(s.name)}${m.order.includes(s.id) ? "" : " (optional)"}</label>`).join("")}
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
      evaH: v("evaH"), reserve: v("reserve") / 100, airlockMin: v("airlock"), badFactor: a.bad_day_factor || 2, suitMin: a.suit_fail_min || 50 };
  }

  function initWorker(m) {
    if (!m.grid || !window.Worker) return;
    Promise.all(["grid_slope.u8", "grid_rough.u8", "grid_dem.i16"].map((f) => fetch(`data/${f}`, { cache: "no-cache" }).then((r) => r.arrayBuffer())))
      .then(([slope, rough, dem]) => {
        worker = new Worker("router.js?v=8");
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
    m.assumptions = Object.assign({}, m.assumptions, { v_flat_ms: p.vFlat, max_slope_deg: p.maxSlope, rough_penalty: p.roughPenalty, eva_limit_h: p.evaH, reserve: p.reserve, airlock_min: p.airlockMin });
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
    S.m = b; S.sel = "depot";
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
  // phones: the guide sits under the clock, so go back to the top first, where the map and the crew dot are
  $("#guideGo").onclick = () => { closeGuide(); if (isMobile()) window.scrollTo({ top: 0, behavior: "smooth" }); play(); };
  $("#guideClose").onclick = closeGuide;
  $("#helpBtn").onclick = () => ($("#guide").hidden ? openGuide() : closeGuide());

  /* ---------- photo gallery ---------- */
  const lb = { s: null, k: 0 };
  function openLightbox(s, k) { lb.s = s; lb.k = k; showPhoto(); $("#lightbox").hidden = false; }
  function showPhoto() {
    const p = lb.s.photos[lb.k];
    $("#lbImg").src = p.large || p.medium;
    $("#lbImg").alt = `${p.cam} image near ${lb.s.name}`;
    $("#lbCap").innerHTML = `${lb.k + 1} / ${lb.s.photos.length} · Perseverance ${esc(p.cam.replace(/_/g, " ").toLowerCase())} · sol ${p.sol} · ${esc(lb.s.name)} · ${esc(p.credit || "NASA/JPL-Caltech")}${p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">source</a>` : ""}`;
  }
  const step = (d) => { lb.k = (lb.k + d + lb.s.photos.length) % lb.s.photos.length; showPhoto(); };
  $("#lbPrev").onclick = () => step(-1);
  $("#lbNext").onclick = () => step(1);
  $("#lbClose").onclick = () => ($("#lightbox").hidden = true);
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (astro.open) { if (e.key === "Escape") closeAstro(); return; }
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

  // "What we checked, and what failed": every claim next to its limit. Numbers are read from the plan data
  // (rover_check, validation, walkback) or from the two constants above; nothing is typed in by hand twice.
  function checkedHtml(m) {
    const rc = m.rover_check, v = m.validation, wb = m.walkback, a = m.assumptions, bp = breakingPoints(m);
    const base = m.stops.find((s) => s.id === "base"), sc = base && base.site_check;
    const rows = [];
    if (rc && rc.pairs) {
      const flat = rc.pairs.reduce((s, [, tilt]) => s + Math.abs(3 - tilt), 0) / rc.pairs.length;
      const hi = rc.pairs.filter(([, tilt]) => tilt > 10), low = hi.length ? hi.reduce((s, [ours, tilt]) => s + (tilt - ours), 0) / hi.length : 0;
      rows.push(["Is the slope map right?",
        `Against Perseverance's tilt sensor at ${rc.n} waypoint records: ${rc.slope_mae_deg}° average difference. A flat 3° guess with no map: ${flat.toFixed(2)}°. The sensor never saw our map.`,
        `Where the rover tilted more than 10° (${hi.length} records) our map reads about ${low.toFixed(1)}° low. That is the unsafe side, so ${a.max_slope_deg}° is a planning line, not a guarantee.`]);
    }
    if (v && v.steep) rows.push(["Does our route follow the rover's?",
      `On the rover's climb to the delta top our route stays a median ${Math.round(v.median_m)} m from its track, and ${Math.round(v.within_50m_pct)} % of it is within 50 m.`,
      `It does not follow the rover, and we do not claim it does. What we claim: a straight line crosses ${v.steep.line.steep_m} m of ground over ${v.steep.limit_deg}°, the rover crossed ${v.steep.rover.steep_m} m, and our route ${v.steep.ours.steep_m || "none"} (a rule in the planner, not a test result).`]);
    if (bp) {
      const sp = (f) => (Math.ceil(f * bp.v * 100 - 1e-6) / 100).toFixed(2);
      rows.push(["Does the plan survive a slower crew?",
        `Every check has a breaking point. At a plan pace of ${bp.v} m/s the default walk passes; "Plan fits" holds down to ${sp(bp.plan)} m/s, the bad-day check to ${sp(bp.bad)} m/s and the suit check to ${sp(bp.suit)} m/s.`,
        `A crew slower than about ${sp(bp.bad)} m/s fails the bad-day check on this walk. The app then says to leave earlier, shorten a stop or drop one.`]);
    }
    rows.push(["Does the bad-day rule pay off?",
      `Three plans on the same stops, in the same ${BENEFIT.walks.toLocaleString("en-US")} simulated walks (each up to 20 % slower than planned, a crewmate hurt at a random moment). A plan made with the usual walk-back rule, using all the time that rule allows, needed its reserve ${BENEFIT.usual} times. A plan made with our rule, using all the time it allows: ${BENEFIT.maxed} times. Our own plan, which also keeps ${BENEFIT.plan_spare_min} min spare: ${BENEFIT.ours} times. Then the same walks with the slowdown taken from NASA's Apollo records instead of our own range (travel time against plan on 8 moonwalks, from 0.69 to 1.83 times the plan; <a href="${APOLLO_SRC}" target="_blank" rel="noopener">NASA/TP-2017-219457</a>): ${BENEFIT.usualApollo}, ${BENEFIT.maxedApollo} and ${BENEFIT.oursApollo} times.`,
      `The first two plans are our own constructions, and the 0 to 20 % range is our assumption (up to 30 % slower: ${BENEFIT.usual30}, ${BENEFIT.maxed30} and ${BENEFIT.ours30}). The Apollo spread is harsher: 3 of the 8 moonwalks took 1.4 to 1.8 times the planned travel time, and with it even our plan needs its reserve in about one walk in five. It is the Moon, mostly rover drives and only 8 moonwalks; the ratios are our sums of the report's tables. Our rule costs ${BENEFIT.rule_cost_min} min at the science stops, and our plan keeps ${BENEFIT.plan_spare_min} more as spare. Nobody went past the suit limit in any run.`]);
    if (window.StormReplay) {
      const SR = window.StormReplay, warn = Math.floor(SR.alarmToPeakMin), need = Math.ceil(wb.suit.worst.back - 1e-9) + GET_INSIDE_MIN, w = SR.walkHome(need);
      rows.push(["What would a real solar storm do to this walk?",
        `We replayed the storm of ${stormDay(SR)} from the readings of Curiosity's RAD. From the alarm to the strongest reading: ${warn} min. From the farthest point of this walk the crew needs ${need} min to be inside, so it is ${need > warn ? "still outside at the peak" : "inside before the peak"}, and takes about ${Math.round(w.ugy / 10) * 10} µGy on the way (the same minutes on a quiet day: about ${Math.round(w.quiet_ugy)}).`,
        `Readings are 8 to 16 min long, so ${warn} min could be ${SR.range_min[0]} to ${SR.range_min[1]}. The rise is the storm arriving: this data holds no earlier warning. Measured on the rover's deck in Gale Crater, not in a suit in Jezero. The alarm line, ${SR.alarmX} times normal, is our choice; the 25 % rule the RAD team published (<a href="${SR.published.doi}" target="_blank" rel="noopener">${SR.published.cite}</a>), applied by us to the same readings, picks the same reading.`]);
      const P = SR.published, back = need - GET_INSIDE_MIN, ok = need <= P.shelter_min;
      rows.push(["Does this walk follow the published storm-shelter advice?",
        `${ok ? "Yes" : "No"}. From the storms it has measured, the team behind Curiosity's RAD advises not going more than ${P.shelter_min} min from shelter (<a href="${P.doi}" target="_blank" rel="noopener">${P.cite}</a>, ${P.journal}). From the farthest point of this walk the crew needs ${need} min to be inside: ${back} min to walk and ${GET_INSIDE_MIN} to get inside. The map layer "Storm-shelter line" shows where ${P.shelter_min} min ends.`,
        `${ok ? "It holds for this walk." : "Failed, and we say so."} The advice is a research result from past storms at Gale Crater, not a NASA flight rule, and none of our three checks uses it: the suit rule allows ${wb.suit.limit_min} min of walking from base.`]);
    }
    rows.push(["Do the stored plan and the browser agree?",
      `The stored plan comes from a 2 m grid: +${wb.worst.margin_min} min, +${wb.bad.worst.margin_min} min and ${wb.suit.worst.back} min. The browser re-plans on a 4 m grid: +${ENGINE4.plan}, +${ENGINE4.bad} and ${ENGINE4.suit}.`,
      "After you move a stop or a slider, the numbers on screen are the 4 m ones. They can differ from the stored plan by up to about a minute."]);
    if (sc) rows.push(["Is base camp a landing site?",
      `No. Within ${sc.radius_m} m of it the ground reaches ${sc.slope_max}°. NASA's Artemis III EVA study draws a 100 m landing circle with slopes under 5°.`,
      "Failed, and we say so. Base camp was placed on top of the delta so that the loop fits the time rules."]);
    rows.push(["Are the numbers re-checked?",
      "90 automated tests re-run the default results, the leave-by times, the third-stop failure, the tilt test with its flat-guess baseline, the browser's route search, the Mars daylight method, the 1,000-walk simulation with its Apollo case and the storm replay (node --test).",
      "They test the numbers and the route engine, not the screens. The screens were checked in a browser by an AI reviewer, on a desktop size and a phone size."]);
    return `<h3 id="how-checked">What we checked, and what failed</h3>
      <table class="chk-tbl"><tr><th>We asked</th><th>We checked</th><th>Limit, or what failed</th></tr>
      ${rows.map(([q, c, l]) => `<tr><td>${q}</td><td>${c}</td><td>${l}</td></tr>`).join("")}</table>`;
  }

  function renderAbout(m) {
    const a = m.assumptions, rc = m.rover_check, v = m.validation;
    const base = m.stops.find((s) => s.id === "base"), sc = base.site_check;
    $("#aboutBody").innerHTML = `<h2>How Red Route works</h2>
      <p>Red Route plans a walking EVA in Jezero Crater and checks, at every minute of the walk, that the crew can still get home.</p>
      <p>Why the plan has to carry the answer: a radio signal takes 3 to 22 minutes each way between Earth and Mars (<a href="https://science.nasa.gov/blog/speaking-percys-language-how-to-talk-so-perseverance-will-listen/" target="_blank" rel="noopener">NASA</a>), so a question to Earth and its answer take 6 to 44 minutes. The turn-back call has to be made on Mars.</p>
      <p>The plan is for a crew of two, EV1 and EV2, who walk together and stay together.</p>
      <p id="how-tags"><b>Tags.</b> Small letters next to the numbers say where each one comes from. <b>N</b> = NASA data: measured by a NASA mission (terrain, photos, rover tilt, weather, space weather). <b>D</b> = derived: worked out by Red Route from that data and the planning numbers (walking times, margins, leave-by times, the get-home zone, breaking points, the dose). <b>A</b> = assumed: a planning number we set, listed below with its source (walking pace, no-go slope, rough-ground factor, suit limit, reserve, airlock time, backup oxygen, half speed).</p>
      <h3 id="how-checks">The get-home checks</h3>
      <table><tr><th>Check</th><th>Rule</th><th>Where the rule comes from</th></tr>
        <tr><td>Plan fits</td><td>Time so far + walk home at normal pace ≤ ${a.eva_limit_h} h minus ${Math.round(a.reserve * 100)} % reserve minus ${a.airlock_min || 0} min of airlock time (getting out and back in)</td><td>NASA plans about 6 h inside an 8 h suit (<a href="https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf" target="_blank" rel="noopener">EVA-EXP-0042</a>)</td></tr>
        <tr><td>If something goes wrong</td><td>EV2 is hurt and EV1 helps: time so far + walk home at half speed must fit the same time. The reserve stays untouched.</td><td>Our assumption, built on NASA's walk-back idea (<a href="https://ttu-ir.tdl.org/handle/2346/74208" target="_blank" rel="noopener">EVA walk-back limit study</a>) and rescue of a hurt crewmate (<a href="https://ntrs.nasa.gov/citations/20230005461" target="_blank" rel="noopener">NASA NTRS 20230005461</a>)</td></tr>
        <tr><td>Suit failure</td><td>Walk home ≤ ${a.suit_fail_min || 50} min from every point (1 h backup oxygen, ~10 min to get inside)</td><td>NASA sizes walking EVAs on the backup oxygen (<a href="https://ntrs.nasa.gov/api/citations/20210026296/downloads/Scoville%20Final%20presentation%20-%20compressed.pptx.pdf" target="_blank" rel="noopener">Artemis III EVA study</a>)</td></tr></table>
      <h3 id="how-route">How the route is found</h3>
      <ol><li>Slope and rough ground come from the 1 m HiRISE elevation model of Jezero (USGS, Mars 2020 landing products), corrected for the map projection.</li>
        <li>Each spot gets a walking time: ${a.v_flat_ms} m/s on flat ground, slower on slopes (Tobler's hiking curve), ${a.rough_penalty}× slower on rough ground.</li>
        <li>Ground steeper than ${a.max_slope_deg}° is no-go.</li>
        <li>A least-time path search links the stops. A second search from base camp gives the walk-home time from every spot, which drives all three checks and the green zone.</li></ol>
      <h3 id="how-numbers">Planning numbers</h3>
      <table><tr><th>Number</th><th>Value</th><th>Source</th></tr>
        <tr><td>Suited walking speed</td><td>${a.v_flat_ms} m/s (2 km/h)</td><td>NASA Artemis planning pace (<a href="https://www.nasa.gov/wp-content/uploads/2017/02/eva-exp-0042_xeva_system_con_ops_rev_b_final_dtd_10192020_ref_doc.pdf" target="_blank" rel="noopener">EVA-EXP-0042 Rev B</a>)</td></tr>
        <tr><td>No-go slope</td><td>${a.max_slope_deg}°</td><td>NASA suit requirement is 20°; Apollo crews walked on slopes under 15° (<a href="https://meetingorganizer.copernicus.org/EPSC2024/EPSC2024-196.html" target="_blank" rel="noopener">Iqbal et al. 2024</a>)</td></tr>
        <tr><td>Speed on slopes</td><td>× exp(−3.5 tan slope)</td><td>Tobler's hiking function, tested on analog missions (<a href="https://discovery.ucl.ac.uk/id/eprint/10201492/1/1-s2.0-S0094576524007501-main.pdf" target="_blank" rel="noopener">Goodwin et al. 2024</a>)</td></tr>
        <tr><td>Rough ground</td><td>&gt; ${a.rough_m} m relief, ${a.rough_penalty}× slower</td><td>Tobler's off-path factor; HiRISE misses rocks under about 1.5 m (<a href="https://marsoweb.nas.nasa.gov/landingsites/msl/workshops/4th_workshop/talks/Golombek_Rocks_4th_Wkshp.pdf" target="_blank" rel="noopener">Golombek</a>)</td></tr>
        <tr><td>Suit time limit</td><td>${a.eva_limit_h} h</td><td>NASA suit design limit (EVA-EXP-0042)</td></tr>
        <tr><td>Reserve</td><td>${Math.round(a.reserve * 100)} %</td><td>Our choice. NASA plans about 6 h inside an 8 h suit (EVA-EXP-0042); we keep a little more</td></tr>
        <tr><td>Airlock time</td><td>${a.airlock_min || 0} min</td><td>The <a href="https://ntrs.nasa.gov/api/citations/20210026296/downloads/Scoville%20Final%20presentation%20-%20compressed.pptx.pdf" target="_blank" rel="noopener">Artemis III EVA study</a> timeline has 45 min to get out, 30 min of dust removal and 45 min to get back in</td></tr>
        <tr><td>Radiation dose rate</td><td>${RAD.gale_mgy_day} mGy a day (quiet Sun, Gale Crater)</td><td>Curiosity's RAD, average over about 300 sols (<a href="${RAD.paper}" target="_blank" rel="noopener">Hassler et al. 2014</a>). For the solar storm of May 2024, <a href="${RAD.storm}" target="_blank" rel="noopener">NASA/JPL</a> reported ${RAD.storm_ugy.toLocaleString("en-US")} microgray for a person next to Curiosity. We quote that number and do not compute with it: the release does not say how it was worked out, and our own sum of RAD's archived readings (about 1,750 microgray in the plastic detector over the first 24 h) is not the same measure. For scale only: the app does not check a dose limit.</td></tr>
        <tr><td>Oxygen rate</td><td>${OXY.kg_per_h} kg per crew member per hour</td><td>NASA's planning value for a spacewalk at an average workload (295 W): <a href="${OXY.src}" target="_blank" rel="noopener">Life Support Baseline Values and Assumptions Document</a>, NASA/TP-2015-218570 Rev 2 (2022), Table 4-70. Multiplied by the time outside. It is not a walking measurement and not a Mars-gravity number, and it is oxygen breathed, not what the tank must hold. For scale only: the app does not check an oxygen limit, and it does not model oxygen per metre. Why not: NASA's suited walking tests in Mars gravity ran at ${OXY.mars_test_ms[0]} to ${OXY.mars_test_ms[1]} m/s (<a href="${OXY.walkback}" target="_blank" rel="noopener">EVA Walkback Test, NASA/TP-2009-214796</a>, six astronauts in one prototype suit on a treadmill), about twice our planning pace and faster; its slower suit tests stopped at 0.32 g. An oxygen number per metre at our pace would be our own stretch outside every tested range.</td></tr></table>
      <p style="font-size:12px;color:#6f7680">Half speed after an accident is our planning assumption, not a NASA flight rule. The clock (T+) starts at the first step outside; the airlock time is taken off the time the crew has.</p>
      <p id="bpHow"><b>Breaking point.</b> Under each check the app says how much slower the whole walk could be before that check fails. It is worked out from the same walking times: every walking time and every walk-home time grows as the crew slows down, and the time at the stops stays the same. Percentages are rounded down and speeds up. It is a derived number, not a measurement.</p>
      <p id="drillHow"><b>Drills.</b> While the clock is in use, four buttons ask what happens if it goes wrong right there: a crewmate is hurt, a suit alarm, a storm warning, or the crew is running late. Each one pauses the clock and uses the same numbers as the three checks, read at the crew's position on the planned walk. The dotted line is the way home, traced on the walk-home layer. The storm warning time is a what-if the user picks, not a forecast. The storm drill counts the walk home plus about ${GET_INSIDE_MIN} min to get inside, the same allowance as the suit check.</p>
      ${window.StormReplay ? `<p><b>Real storm.</b> The storm drill can also replay the solar storm of ${stormDay(window.StormReplay)} as Curiosity's Radiation Assessment Detector (RAD) measured it in Gale Crater. The readings are from NASA's Planetary Data System (<a href="${window.StormReplay.source}" target="_blank" rel="noopener">data set MSL-M-RAD-3-RDR-V1.0</a>, sol 4190, the plastic detector E, in micrograys an hour). The normal level before the storm was ${window.StormReplay.quiet} micrograys an hour. Our alarm is the first reading above ${window.StormReplay.alarmX} times that; it ended at ${window.StormReplay.alarm.atUtc} UTC. The strongest reading, ${Math.round(window.StormReplay.peak.e)} micrograys an hour (${Math.round(window.StormReplay.peak.timesQuiet)} times normal), began ${Math.floor(window.StormReplay.alarmToPeakMin)} min later. The dose on the way home holds each reading until the next one starts. What is ours, not NASA's: the alarm line and every sum. Limits: readings are 8 to 16 min long, so the ${Math.floor(window.StormReplay.alarmToPeakMin)} min could be ${window.StormReplay.range_min[0]} to ${window.StormReplay.range_min[1]}; the rise is the storm arriving, so this data holds no earlier warning; RAD sits on the rover's deck in Gale Crater, not in a suit in Jezero; and the detector gives a dose in plastic, not a dose to a person. In May 2024 the normal level (0.13 mGy a day) was lower than the 2012 to 2013 average used under Conditions (${RAD.gale_mgy_day} mGy a day).</p>
      <p><b>A published rule, for comparison.</b> The team behind RAD has published a warning rule (<a href="${window.StormReplay.published.doi}" target="_blank" rel="noopener">${window.StormReplay.published.cite}, ${window.StormReplay.published.journal}</a>): warn when detector E reads more than 25 % above its average of the five days before. Applied by us to the same archived readings (our file holds 3.5 of those days), it picks the same reading as our own line. The paper prints no clock times, so that match is our working, not the paper's. The paper counts 53 min from the start of that reading to the peak; we count ${Math.floor(window.StormReplay.alarmToPeakMin)} min from its end, when a crew could know. For the whole event the paper gives 1,731 micrograys above the normal level; counted the same way, our sum of the archived readings is within 3 % of that. The same paper advises not going more than ${window.StormReplay.published.shelter_min} min from shelter. This walk goes further, and "What we checked" says so; the optional map layer "Storm-shelter line" shows where ${window.StormReplay.published.shelter_min} min ends. It is a research result, not a NASA flight rule, and the three checks do not use it.</p>` : ""}
      <h3 id="tests">Real-world tests</h3>
      ${rc ? `<p><b>Slope map vs Perseverance's tilt sensor.</b> The rover logs how far it is tilted at every stop. Its sensor never sees our map. At ${rc.n} waypoint records inside our area (a few spots were logged more than once) our slope agrees with the measured tilt: ${rc.slope_mae_deg}° average difference, ${rc.within_3deg_pct} % within 3°, correlation ${rc.slope_r}.</p>${scatterSvg(rc.pairs)}
      <p><b>Height.</b> Our terrain height matches the rover's logged elevation to ${rc.elev_mae_m} m on average. The rover's positions are tied to the same orbital maps, so this mainly confirms the layers line up.</p>` : ""}
      ${v ? `<p><b>Same climb, different ramp.</b> Between the rover's start and end of its climb onto the delta (sols ${v.sols[0]}–${v.sols[1]}), our walking route stays a median ${Math.round(v.median_m)} m from the rover's track. The rover took a longer path for a one-tonne vehicle and stopped for science, so the two are not expected to match.${v.steep ? ` A straight line between the same two points would cross ${v.steep.line.steep_m} m of slopes steeper than ${v.steep.limit_deg}°, and the rover crossed ${v.steep.rover.steep_m} m; our walk crosses ${v.steep.ours.steep_m ? `${v.steep.ours.steep_m} m` : "none"}.` : ""}</p>
      <figure class="fig"><a href="img/rover_check.jpg" target="_blank" rel="noopener"><img src="img/rover_check.jpg" alt="Map of Perseverance's climb to the delta top: the rover's real path, Red Route's planned walk and a straight line, over slopes steeper than 15 degrees" loading="lazy"></a></figure>` : ""}
      ${checkedHtml(m)}
      <h3>Where it can be wrong</h3>
      <ul><li>Rocks smaller than about 1.5 m are not in the elevation model. Crews still need the photos to spot boulders.</li>
        <li>The walking curve is Earth-calibrated. Real suited speed depends on the suit, the load and fatigue.</li>
        <li>Solar-particle alerts come from sensors near Earth. Eruption (CME) alerts include Mars arrival times.</li>
        <li>The public MEDA weather summaries end in 2024, so the daylight check uses the latest available sols.</li>
        <li>The radiation number is a quiet-day average measured at Gale Crater, not at Jezero. It is shown for scale and is not checked against a limit.</li>
        <li>Base camp was placed on top of the delta so that the loop fits the time rules. It is not checked as a landing site${sc ? `: the ground is gentle within 50 m (up to ${(base.terrain || {}).slope_max}°), but within ${sc.radius_m} m it reaches ${sc.slope_max}°, and the <a href="https://ntrs.nasa.gov/api/citations/20210026296/downloads/Scoville%20Final%20presentation%20-%20compressed.pptx.pdf" target="_blank" rel="noopener">Artemis III EVA study</a> we cite draws a 100 m landing circle with slopes under 5°` : ""}. The rocket-plume distance from the sample depot is not checked either.</li></ul>
      <h3 id="how-data">Data</h3>
      <ul><li>HiRISE 1 m elevation model and 25 cm photo mosaic of Jezero: USGS Astrogeology (Mars 2020 landing products), tiles via NASA JPL Mars Trek.</li>
        <li>CTX and MOLA backgrounds: NASA JPL Mars Trek. ESA Mars Express HRSC + NASA MOLA blended relief (USGS).</li>
        <li>Night heat layer: Mars Odyssey THEMIS night-time infrared mosaic, 100 m pixels (NASA/JPL-Caltech/Arizona State University), tiles via NASA JPL Mars Trek. Context only: it is not used in the route.</li>
        <li>Perseverance waypoints, traverse and raw images: NASA/JPL-Caltech (Mastcam-Z: NASA/JPL-Caltech/ASU; SuperCam: NASA/JPL-Caltech/LANL/CNES/IRAP).</li>
        <li>Weather: the latest available Perseverance MEDA summaries (${medaLatest()}), NASA/JPL-Caltech/CAB. They are not live.</li>
        <li>Space weather: NASA DONKI notices, read live from NASA's CCMC service. If it does not answer, the app says NOT CHECKED and shows the date of its saved copy.</li>
        <li>Radiation: published values from Curiosity's Radiation Assessment Detector (RAD), NASA/JPL-Caltech/SwRI.</li>
        <li>Software: Leaflet map library (BSD 2-Clause licence); Barlow fonts (SIL Open Font License). The full list is in DATA.md in the repo.</li></ul>
      <h3>Use of AI tools</h3>
      <p>The code was written with help from an AI coding assistant (Claude by Anthropic), which also suggested the first version of the site, stops and route rules; the team reviewed and approved them and asked for later changes. The logo is drawn by our code from our own terrain map and the planned walk; until 14 Nov 2026 the site used an AI-generated badge (Higgsfield), which was replaced. All map and rover data are from NASA, USGS and ESA.</p>`;
  }
  // Hooks for add-on files in docs/extra/: read-only helpers, plus the events "redroute:render" (after every
  // redraw of the panels) and "redroute:time" (after every clock move, with the crew's numbers in event.detail).
  Object.assign(window.RedRoute, { api: { getChecks, breakingPoints, leaveBy, leaveSpare, stopById, shortName, nearestStopName,
    fmtMin, hm, sgn, esc, spaceWeather, openModal, eva, zone, stag } });
})();
