/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: "Take it with you", a small block at the bottom of the left panel.
   - Print cuff card: one black-on-white page made from the current plan (window.RedRoute.S.m), so it follows every
     change: our own sketch of the walk (drawn from the route data, not a map image), the stops with arrive and
     leave-by times, the three get-home checks, the turn-back rules and the planning numbers with their sources.
   - Download route (GeoJSON): the route line and the stops of the current plan, made in the browser (no network).
   This file only reads the plan through the add-on hooks of app.js and never changes it. */
(() => {
  "use strict";
  const R_MARS = 3396190;                       // m: the same Mars sphere app.js and router.js use
  const M_PER_DEG = (R_MARS * Math.PI) / 180;   // metres per degree of latitude (about 59,275 m)
  const FILE = "red-route-plan.geojson";
  const RR = () => window.RedRoute || {};
  const ready = () => { const r = RR(); return !!(r.api && r.S && r.S.m); };
  let opener = null, oldTitle = null;

  /* ---------- the planning numbers, and whose number each one is ----------
     The split follows the app's "How it works" panel and the project page: the walking pace, the 8 h suit limit,
     the airlock time and the backup oxygen are NASA numbers; the 15° slope limit (NASA's suit requirement is 20°),
     the 30 % reserve and half speed for a hurt crewmate are our own choices. A value changed under
     "Plan your EVA" is shown as "Your setting", with the default next to it. */
  const hours = (min) => (min % 60 ? RR().api.fmtMin(min) : `${min / 60} h`);
  const NUMBERS = [
    { name: "Walking pace, flat ground", get: (m) => m.assumptions.v_flat_ms, fmt: (v) => `${(+v).toFixed(2)} m/s`, nasa: true,
      src: "NASA Artemis planning pace, 2 km/h (EVA-EXP-0042 Rev B)" },
    { name: "No-go slope", get: (m) => m.assumptions.max_slope_deg, fmt: (v) => `${v}°`, nasa: false,
      src: "Stricter than NASA's 20° suit requirement" },
    { name: "Suit time limit", get: (m) => m.walkback.eva_limit_h, fmt: (v) => `${v} h`, nasa: true,
      src: "NASA suit design limit (EVA-EXP-0042)" },
    { name: "Reserve", get: (m) => m.walkback.reserve, fmt: (v) => `${Math.round(v * 100)} %`, nasa: false,
      src: "Kept back: never used, even by the bad-day check" },
    { name: "Airlock time, out and in", get: (m) => m.walkback.airlock_min || 0, fmt: hours, nasa: true,
      src: "NASA Artemis III EVA study: 45 min out, 30 min dust removal, 45 min in" },
    { name: "Longest walk home", get: (m) => m.walkback.suit && m.walkback.suit.limit_min, fmt: (v) => `${v} min`, nasa: true,
      src: "1 h of backup oxygen, less about 10 min to get inside. NASA sizes walking EVAs on the backup oxygen (Artemis III EVA study)" },
    { name: "Pace with a hurt crewmate", get: (m) => m.walkback.bad && m.walkback.bad.factor, fmt: (v) => (v === 2 ? "half speed" : `1/${v} speed`), nasa: false,
      src: "Our planning assumption, not a NASA flight rule" },
  ];

  /* ---------- small helpers ---------- */
  const appAddress = () => (/^https?:$/.test(location.protocol) ? location.origin + location.pathname : "");
  const r1 = (v) => Math.round(v * 10) / 10;
  function stamp(d = new Date()) {   // e.g. "15 Nov 2026, 20:41 (UTC+08:00)"
    const p = (n) => String(n).padStart(2, "0"), off = -d.getTimezoneOffset();
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    return `${d.getDate()} ${mon} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())} (UTC${off < 0 ? "−" : "+"}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)})`;
  }

  // The route as it is drawn on the map now (the default walk, or the last re-plan), one line per leg, in walking order.
  // S.route keeps the default walk only, so the map's own line comes first.
  function routeLines() {
    const { S } = RR();
    let fc = null;
    try { if (S.routeLine && S.routeLine.toGeoJSON) fc = S.routeLine.toGeoJSON(false); } catch (e) { fc = null; }
    if (!fc || !fc.features || !fc.features.length) fc = S.route;
    const out = [];
    ((fc && fc.features) || []).forEach((f, i) => {
      const g = f && f.geometry, p = (f && f.properties) || {}, leg = typeof p.leg === "number" ? p.leg : i;
      if (!g) return;
      if (g.type === "LineString") out.push({ leg, coords: g.coordinates });
      else if (g.type === "MultiLineString") g.coordinates.forEach((c) => out.push({ leg, coords: c }));
    });
    return out.sort((a, b) => a.leg - b.leg);
  }

  /* ---------- the sketch: our own drawing of the walk from the route data ----------
     Local flat projection around the walk (east to the right, north up), metres from the Mars radius above. */
  function sketchSvg(m, lines) {
    const { api } = RR(), esc = api.esc;
    const stops = [];   // each stop once, numbered as on the map (base camp is 1)
    m.order.forEach((id, i) => {
      const s = api.stopById(id);
      if (s && !stops.some((q) => q.id === id)) stops.push({ id, n: i + 1, name: api.shortName(s), lat: s.lat, lon: s.lon });
    });
    const all = [];
    for (const l of lines) for (const c of l.coords) all.push(c);
    for (const s of stops) all.push([s.lon, s.lat]);
    if (!all.length) return "";
    let lat0 = 0;
    for (const c of all) lat0 += c[1];
    lat0 /= all.length;
    const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG, ky = M_PER_DEG;   // metres per degree east and north
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [lon, lat] of all) {
      const x = lon * kx, y = -lat * ky;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const W = 240, H = 240, pl = 24, pr = 24, pt = 38, pb = 36;   // room for the north arrow (top) and the scale bar (bottom)
    const k = Math.min((W - pl - pr) / Math.max(x1 - x0, 50), (H - pt - pb) / Math.max(y1 - y0, 50));   // drawing units per metre
    const ox = pl + (W - pl - pr - (x1 - x0) * k) / 2, oy = pt + (H - pt - pb - (y1 - y0) * k) / 2;
    const P = (lon, lat) => [ox + (lon * kx - x0) * k, oy + (-lat * ky - y0) * k];
    const f = (v) => v.toFixed(1);
    let g = `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="#fff" stroke="#000" stroke-width=".8"/>`;
    for (const l of lines) {
      const pts = l.coords.map(([lon, lat]) => P(lon, lat));
      g += `<polyline points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(" ")}" fill="none" stroke="#000" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (pts.length > 6) {   // an arrow half-way along each leg shows the walking direction
        const i = Math.floor(pts.length / 2), a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)];
        const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        g += `<path d="M7 0 L-5 -5.5 L-2 0 L-5 5.5 Z" transform="translate(${f(pts[i][0])} ${f(pts[i][1])}) rotate(${ang.toFixed(0)})" fill="#000"/>`;
      }
    }
    for (const s of stops) {
      const [x, y] = P(s.lon, s.lat), est = s.name.length * 6.4;   // rough label width at this font size
      const left = x + 13 + est > W - 4 && x - 13 - est >= 4;     // put the label left of the stop when it would run off the right edge
      g += `<circle cx="${f(x)}" cy="${f(y)}" r="9" fill="#fff" stroke="#000" stroke-width="1.6"/>`;
      g += `<text x="${f(x)}" y="${f(y + 3.7)}" text-anchor="middle" font-size="10.5" font-weight="700">${s.n}</text>`;
      g += `<text class="halo" x="${f(x + (left ? -13 : 13))}" y="${f(y + 3.9)}" text-anchor="${left ? "end" : "start"}" font-size="11.5" font-weight="600">${esc(s.name)}</text>`;
    }
    g += `<g transform="translate(${W - 18} 8)"><path d="M0 0 L7 17 L0 12.5 L-7 17 Z" fill="#000"/><text x="0" y="29" text-anchor="middle" font-size="11" font-weight="700">N</text></g>`;
    const want = ((W - pl - pr) * 0.3) / k;   // a scale bar about a third of the drawing wide, rounded down to a plain length
    let L = 10;
    for (const n of [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]) if (n <= want) L = n;
    const bx = 10, by = H - 12, bw = L * k;
    g += `<path d="M${bx} ${by - 6} V${by} H${f(bx + bw)} V${by - 6}" fill="none" stroke="#000" stroke-width="1.6"/>`;
    g += `<text x="${f(bx + bw + 6)}" y="${by + 1}" font-size="11">${L >= 1000 ? `${L / 1000} km` : `${L} m`}</text>`;
    return `<svg class="c-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sketch of the planned walk: numbered stops, north arrow and scale bar" font-family="Barlow, Arial, sans-serif">${g}</svg>`;
  }

  /* ---------- the card ---------- */
  function stopsTable(m) {
    const { api } = RR(), { esc, hm, fmtMin } = api, tl = m.timeline || [], n = m.order.length;
    const bf = (m.walkback.bad && m.walkback.bad.factor) || 2, hurt = bf === 2 ? "half speed" : "hurt crewmate";
    const rows = m.order.map((id, i) => {
      const s = api.stopById(id) || { name: id }, t = tl[i] || {}, moved = s.moved ? " (moved)" : "";
      if (i === 0) return `<tr><td class="c-n">1</td><td>${esc(s.name)}${moved}</td><td colspan="2">Start <b>T+0:00</b></td><td>–</td><td>–</td></tr>`;
      if (i === n - 1) return `<tr><td class="c-n">${n}</td><td>${id === "base" ? "Back at base camp" : esc(s.name)}</td><td><b>T+${hm(t.arrive_min)}</b></td><td colspan="3">End of the walk</td></tr>`;
      const spare = api.leaveSpare(t);
      return `<tr><td class="c-n">${i + 1}</td><td>${esc(s.name)}${moved}</td><td>T+${hm(t.arrive_min)}</td>
        <td><b>T+${hm(api.leaveBy(t))}</b>${spare < 0 ? `<small class="c-late">LATE by ${fmtMin(spare)}</small>` : ""}</td>
        <td>${fmtMin(t.depart_min - t.arrive_min)}</td><td>${Math.round(t.back_min)} / ${Math.round(t.back_min * bf)} min</td></tr>`;
    }).join("");
    return `<table class="c-tbl c-stp"><thead><tr><th>#</th><th>Stop</th><th>Arrive</th><th>Leave by</th><th>On site</th><th>Walk home<br>normal / ${hurt}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="c-note">T+ is the time since the first step outside. Leave by: the latest time to start for home and still pass both time checks (turn-back rules 1 and 2).</p>`;
  }

  function checksHtml(m) {
    const { api } = RR(), esc = api.esc, wb = m.walkback;
    const spare = { plan: wb.worst ? wb.worst.margin_min : null, bad: wb.bad && wb.bad.worst ? wb.bad.worst.margin_min : null,
      suit: wb.suit && wb.suit.worst ? (wb.suit.worst.margin_min != null ? wb.suit.worst.margin_min : wb.suit.limit_min - wb.suit.worst.back) : null };
    return api.getChecks(m).map((c) => {
      const sp = spare[c.key];
      const spTxt = sp == null ? "" : sp >= 0 ? `${sp.toFixed(1)} min spare` : `over by ${Math.abs(sp).toFixed(1)} min`;
      return `<div class="c-chk${c.ok ? "" : " fail"}"><div class="c-chk-h"><b>${esc(c.name)}</b><span class="c-res">${esc(c.val)}</span>${spTxt ? ` <span class="c-sp">· ${spTxt}</span>` : ""}</div>
        <div class="c-chk-t"><p>${esc(c.sub)}</p>${c.bp ? `<p class="c-bp">${esc(c.bp)}</p>` : ""}</div></div>`;
    }).join("");
  }

  function turnBackHtml(m) {
    const { api } = RR(), hm = api.hm, wb = m.walkback;
    const homeBy = `T+${hm(wb.budget_min)}`, badBy = wb.bad ? `T+${hm(wb.bad.budget_min)}` : homeBy;
    const bf = (wb.bad && wb.bad.factor) || 2, pace = bf === 2 ? "half speed" : `${Math.round(100 / bf)} % of normal pace`;
    return `<ol class="c-rules">
        <li>You can no longer be home by <b>${homeBy}</b> at normal pace.</li>
        ${wb.bad ? `<li>You can no longer be home by <b>${badBy}</b> at ${pace}, helping a hurt crewmate.</li>` : ""}
        ${wb.suit ? `<li>The walk back to base would take more than <b>${wb.suit.limit_min} min</b> (backup oxygen).</li>` : ""}
      </ol>`;
  }

  function numbersHtml(m) {
    const { S, api } = RR(), esc = api.esc, base = S.base || m;
    const rows = NUMBERS.map((n) => {
      let v, d;
      try { v = n.get(m); d = n.get(base); } catch (e) { return ""; }
      if (v == null) return "";
      const whose = n.nasa ? "NASA number" : "Our choice";
      const mine = d != null && Math.abs(v - d) > 1e-9;
      return `<tr><td>${esc(n.name)}</td><td class="c-val">${esc(n.fmt(v))}</td><td class="c-who">${mine ? "Your setting" : whose}</td>
        <td>${mine ? `Changed under Plan your EVA. Default ${esc(n.fmt(d))}, ${n.nasa ? "a NASA number" : "our choice"}: ` : ""}${esc(n.src)}</td></tr>`;
    }).join("");
    return `<table class="c-tbl c-num"><thead><tr><th>Number</th><th>Value</th><th>Whose</th><th>Where it comes from</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function cardHtml() {
    const { S, api } = RR(), { esc, fmtMin } = api, m = S.m, t = m.totals, air = m.walkback.airlock_min || 0;
    const walk = m.order.map((id) => api.shortName(api.stopById(id) || { name: id })).join(" → ");
    const name = m.name || m.title || "", addr = appAddress();
    return `<header class="c-head">
        <div class="c-h1row"><h1 id="cuffTitle">Red Route · EVA cuff card</h1><p class="c-proto">Planning prototype. Not a flight document.</p></div>
        ${name ? `<div class="c-name">${esc(name)}</div>` : ""}
        <p class="c-story">Each Apollo 11 moonwalker wore a checklist page on the left glove. This card is the same idea for a Marswalk.</p>
        <p class="c-meta">${esc(walk)} · ${t.dist_km.toFixed(2)} km · +${t.gain_m} m climb · ${fmtMin(t.eva_h * 60)} outside · ${fmtMin(t.eva_h * 60 + air)} in the suit</p>
      </header>
      <div class="c-top">
        <figure class="c-fig">${sketchSvg(m, routeLines())}<figcaption class="c-cap">Our own sketch, drawn from the route data (not a map image). North is up; arrows show the walking direction.</figcaption></figure>
        <section class="c-sec"><h2>Stops</h2>${stopsTable(m)}</section>
      </div>
      <section class="c-sec"><h2>Get-home checks</h2>${checksHtml(m)}</section>
      <section class="c-sec"><h2>Turn back if</h2>${turnBackHtml(m)}</section>
      <section class="c-sec"><h2>Planning numbers and where they come from</h2>${numbersHtml(m)}</section>
      <footer class="c-foot">
        <div>${addr ? `Live app: <b>${esc(addr)}</b> · ` : ""}Card made ${esc(stamp())}. It shows the plan at that moment: change the plan, print a new card.</div>
        <div>Terrain: USGS / NASA HiRISE. Rover data: NASA/JPL-Caltech. Apollo 11 glove checklist: NASA Apollo Lunar Surface Journal.</div>
      </footer>`;
  }

  /* ---------- the overlay: preview on screen, the only thing printed while it is open ---------- */
  function overlay() {
    let ov = document.getElementById("cuffOv");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "cuffOv"; ov.className = "cuff-ov"; ov.hidden = true;
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "cuffTitle");
    ov.innerHTML = `<div class="cuff-bar"><span class="lbl-lg">EVA cuff card</span>
        <small>Made from the plan as it is now. One page, black on white, A4 or Letter.</small>
        <button type="button" class="cta" data-cuff="print">Print</button>
        <button type="button" class="ghost" data-cuff="close">Close</button></div>
      <article class="cuff-sheet" id="cuffSheet"></article>`;
    ov.querySelector('[data-cuff="print"]').onclick = printCard;
    ov.querySelector('[data-cuff="close"]').onclick = closeCard;
    document.body.appendChild(ov);
    return ov;
  }
  const isOpen = () => { const ov = document.getElementById("cuffOv"); return !!ov && !ov.hidden; };
  function render() { const sheet = document.getElementById("cuffSheet"); if (sheet && ready()) sheet.innerHTML = cardHtml(); }

  function openCard(from) {
    if (!ready()) return;
    const ov = overlay();
    opener = from || null;
    render();
    ov.hidden = false;
    document.documentElement.classList.add("cuff-open");
    ov.scrollTop = 0;
    ov.querySelector('[data-cuff="print"]').focus();
  }
  function closeCard() {
    const ov = document.getElementById("cuffOv");
    if (!ov || ov.hidden) return;
    ov.hidden = true;
    document.documentElement.classList.remove("cuff-open");
    restoreTitle();
    if (opener && document.contains(opener)) opener.focus();
  }
  function restoreTitle() { if (oldTitle != null) { document.title = oldTitle; oldTitle = null; } }
  function printCard() {
    render();   // the newest plan and the time it was printed
    if (oldTitle == null) oldTitle = document.title;
    document.title = "Red Route EVA cuff card";   // the file name a "Save as PDF" suggests
    window.print();
  }
  window.addEventListener("afterprint", restoreTitle);

  /* ---------- Download route (GeoJSON): built here, saved with a Blob, no network request ---------- */
  function planGeoJSON() {
    const { S, api } = RR(), m = S.m, tl = m.timeline || [], n = m.order.length;
    const nameOf = (id) => (api.stopById(id) || { name: id }).name;
    const features = routeLines().map((l) => {
      const leg = m.legs && m.legs[l.leg];
      return { type: "Feature",
        properties: Object.assign({ kind: "route", leg: l.leg + 1 },
          leg ? { from: nameOf(leg.frm), to: nameOf(leg.to), dist_m: leg.dist_m, walk_min: leg.walk_min, max_slope_deg: leg.max_slope } : {}),
        geometry: { type: "LineString", coordinates: l.coords } };
    });
    m.order.forEach((id, i) => {
      const s = api.stopById(id);
      if (!s) return;
      const t = tl[i] || {}, first = i === 0, last = i === n - 1, lb = first || last ? null : r1(api.leaveBy(t));
      features.push({ type: "Feature",
        properties: { kind: "stop", number: i + 1, name: s.name, id, role: first ? "start" : last ? "finish" : "stop",
          arrive_min: first ? 0 : r1(t.arrive_min), leave_by_min: lb,
          arrive: `T+${api.hm(first ? 0 : t.arrive_min)}`, leave_by: lb == null ? null : `T+${api.hm(lb)}`,
          on_site_min: first || last ? 0 : r1(t.depart_min - t.arrive_min), walk_home_min: r1(t.back_min || 0) },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] } });
    });
    const addr = appAddress();
    return Object.assign({ type: "FeatureCollection", name: "Red Route plan",
      note: "Planning prototype. Not a flight document. Coordinates are longitude and latitude in degrees on Mars (east, north), as on the app's map. Times are minutes after the first step outside (T+0).",
      made: new Date().toISOString() }, addr ? { app: addr } : {}, { features });
  }
  function downloadGeo() {
    if (!ready()) return;
    const gj = planGeoJSON();
    const url = URL.createObjectURL(new Blob([JSON.stringify(gj)], { type: "application/geo+json" }));
    const a = document.createElement("a");
    a.href = url; a.download = FILE; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const legs = gj.features.filter((x) => x.properties.kind === "route").length, pts = gj.features.length - legs;
    const msg = document.querySelector("#takeAway .tk-msg");
    if (msg) msg.textContent = `Saved ${FILE}: ${legs} route ${legs === 1 ? "leg" : "legs"} and ${pts} stop points.`;
  }

  /* ---------- the block at the bottom of the left panel ---------- */
  function ensureBlock() {
    const left = document.getElementById("left");
    if (!left) return;
    let sec = document.getElementById("takeAway");
    if (!sec) {
      sec = document.createElement("section");
      sec.id = "takeAway"; sec.className = "tk";
      sec.innerHTML = `<hr class="r"><div class="lbl-lg">Take it with you</div>
        <div class="tk-row"><button type="button" class="ghost" data-tk="card">Print cuff card</button><button type="button" class="ghost" data-tk="geo">Download route (GeoJSON)</button></div>
        <div class="tk-s">A one-page card of this plan to carry, and the route for map apps. Both follow your changes.</div>
        <div class="tk-msg" role="status" aria-live="polite"></div>`;
      const card = sec.querySelector('[data-tk="card"]');
      card.onclick = () => openCard(card);
      sec.querySelector('[data-tk="geo"]').onclick = downloadGeo;
    }
    if (!left.contains(sec)) {   // first time, or the panel was rebuilt: put it back after the Conditions section
      const cond = document.getElementById("conditions");
      if (cond && cond.parentNode === left) cond.after(sec); else left.appendChild(sec);
    }
  }

  document.addEventListener("redroute:render", () => { ensureBlock(); if (isOpen()) render(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) closeCard(); });
  if (ready()) ensureBlock();
})();
