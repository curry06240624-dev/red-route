/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: the deciding check.
   Of the three get-home checks, it names the one with the fewest minutes to spare (when a check fails: the one
   that fails by the most), says where and when on the walk that moment is, and pins that spot on the map.
   DERIVED from the current plan only (S.m.walkback and S.m.timeline), no new numbers:
     Plan fits                = walkback.worst.margin_min
     If something goes wrong  = walkback.bad.worst.margin_min
     Suit failure             = walkback.suit.limit_min - walkback.suit.worst.back
   All three are minutes of spare time, so the deciding check is simply the smallest of the three. */
(() => {
  "use strict";
  const TOL = 0.2;   // minutes: how close the moment must be to a stop's arrive or leave time to say "arriving at" / "leaving"
  const FALLBACK = { plan: "Plan fits", bad: "If something goes wrong", suit: "Suit failure" };
  const R1 = (x) => Math.round(x * 10) / 10;
  let pin = null, pinKey = "", cur = null;

  // the three checks as minutes to spare at their tightest point, in the order of the checks panel
  function candidates(m) {
    const wb = m && m.walkback, out = [];
    if (!wb) return out;
    const add = (key, margin, p) => {
      if (p && Number.isFinite(margin) && Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lon))
        out.push({ key, margin: R1(margin), t: p.t, lat: p.lat, lon: p.lon });
    };
    if (wb.worst) add("plan", wb.worst.margin_min, wb.worst);
    if (wb.bad && wb.bad.worst) add("bad", wb.bad.worst.margin_min, wb.bad.worst);
    if (wb.suit && wb.suit.worst) add("suit", wb.suit.limit_min - wb.suit.worst.back, wb.suit.worst);
    return out;
  }

  // smallest margin wins; when checks fail, the most negative margin is the check that fails by the most
  function decide(m) {
    const c = candidates(m);
    return c.length ? c.reduce((a, b) => (b.margin < a.margin ? b : a)) : null;
  }

  // the check's name exactly as the checks panel shows it
  function checkName(api, m, key) {
    try {
      const c = api.getChecks(m).find((x) => x.key === key);
      if (c && c.name) return c.name;
    } catch (e) { /* fall back to the plain name */ }
    return FALLBACK[key];
  }

  const stopLabel = (api, id) => { const s = api.stopById(id); return s ? api.shortName(s) : String(id); };

  // "leaving Hawksbill Gap, T+2:23", "arriving at ...", "near ...", from the plan's own timeline
  function whereWhen(api, m, d) {
    const tl = m.timeline || [], last = tl.length - 1, T = (x) => `T+${api.hm(x)}`;
    for (let i = 0; i <= last; i++) {
      const e = tl[i], a = e.arrive_min, dep = e.depart_min, stay = dep - a > TOL, nm = stopLabel(api, e.id);
      // the walk home does not change while the crew stands at a stop, so for the suit check the whole stop is the tightest moment
      if (d.key === "suit" && stay && d.t >= a - TOL && d.t <= dep + TOL) return `at ${nm}, ${T(a)} to ${T(dep)}`;
      const atA = Math.abs(d.t - a) <= TOL, atD = Math.abs(d.t - dep) <= TOL;
      if (atD && i < last && (stay || i === 0)) return `leaving ${nm}, ${T(d.t)}`;
      if (atA && i > 0) return `${stay || i === last ? "arriving at" : "at"} ${nm}, ${T(d.t)}`;
    }
    const full = api.nearestStopName(d.lat, d.lon), s = (m.stops || []).find((x) => x.name === full);
    return `near ${s ? api.shortName(s) : full}, ${T(d.t)}`;
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function describe(api, m) {
    const d = decide(m);
    if (!d) return null;
    const fail = d.margin < 0;
    return Object.assign(d, {
      fail,
      limit: m.walkback.suit ? m.walkback.suit.limit_min : null,
      name: checkName(api, m, d.key),
      amount: fail ? `fails by ${api.fmtMin(d.margin)}` : `${api.fmtMin(d.margin)} to spare`,
      where: whereWhen(api, m, d),
    });
  }

  /* ---------- the line in the checks panel ---------- */
  function renderLine(api, d) {
    const box = document.getElementById("checks");
    if (!box) return;
    const old = document.getElementById("dchk");
    if (old) old.remove();
    if (!d) return;
    const esc = api.esc;
    const title = "Worked out from this plan: of the three checks, the one with the fewest minutes to spare"
      + (d.limit != null ? ` (for the suit check: ${d.limit} min of backup oxygen minus the longest walk home)` : "")
      + ". Click to show the spot on the map.";
    // the app's own "derived" source tag, if the app offers it to add-ons; it sits beside the button, never inside it
    const tag = typeof api.stag === "function" ? api.stag("d", "decidingHow") : "";
    const b = document.createElement("div");
    b.id = "dchk";
    b.className = `dchk${d.fail ? " fail" : ""}`;
    b.innerHTML = `<button type="button" class="dchk-go" title="${esc(title)}">`
      + '<svg class="dchk-ring" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">'
      + '<circle r="5.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.8 1.45"/></svg>'
      + `<span class="dchk-txt"><span class="dchk-k">Deciding check</span> <span class="dchk-n">${esc(d.name)}</span>: `
      + `<b class="dchk-v">${esc(d.amount)}</b>. <span class="dchk-w">${esc(cap(d.where))}.</span></span></button>${tag}`;
    b.querySelector(".dchk-go").addEventListener("click", showOnMap);
    // right after the three checks, before the mission totals line
    const rows = box.querySelectorAll(".chk"), after = rows[rows.length - 1];
    if (after) after.after(b);
    else box.insertBefore(b, box.querySelector(".mission"));
  }

  /* ---------- the pin on the map ----------
     The app draws its own "Tightest" label (amber ring, label above) for the plan-fits check while the clock is in use.
     This pin looks different (larger dashed ring, boxed label) and its label sits BELOW the ring, so the two do not
     overlap, also when both mark the same spot (then the top of the ring opens under the app's label). It sits under
     the stop markers and the app's label in the marker stack, and it takes no clicks, so the stops can still be
     clicked and dragged. */
  function renderPin(api, map, d) {
    const key = d ? [d.key, d.lat, d.lon, d.name, d.amount].join("|") : "";
    if (pin && key === pinKey && map.hasLayer(pin)) return;
    if (pin) { map.removeLayer(pin); pin = null; }
    pinKey = key;
    if (!d || typeof L === "undefined") return;
    const esc = api.esc;
    const html = `<div class="dc-pin${d.fail ? " fail" : ""}">`
      + '<svg class="dc-ring" width="46" height="46" viewBox="-23 -23 46 46" aria-hidden="true">'
      + '<circle r="19" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="4"/>'
      + '<circle r="19" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3.3"/></svg>'
      + `<div class="dc-lbl"><span class="dc-k">Deciding check</span><span class="dc-v">${esc(d.name)}: ${esc(d.amount)}</span></div></div>`;
    pin = L.marker([d.lat, d.lon], { icon: L.divIcon({ className: "dc-icon", iconSize: [0, 0], html }),
      interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(map);
    syncSameSpot();
    schedule();
  }

  // When the app's "Tightest" dot is shown on the same spot, open the top of the ring so it does not run through that label.
  function syncSameSpot() {
    const rr = window.RedRoute, map = rr && rr.map, api = rr && rr.api;
    const el = pin && pin.getElement && pin.getElement(), box = el && el.querySelector(".dc-pin");
    if (!box || !map || !api) return;
    const t = api.eva && api.eva.tight;
    let same = false;
    if (t && map.hasLayer(t)) same = map.latLngToLayerPoint(t.getLatLng()).distanceTo(map.latLngToLayerPoint(pin.getLatLng())) < 24;
    box.classList.toggle("same", same);
  }

  // Keep the pin's label in the open part of the map: it may slide sideways (always staying over the ring) or go
  // above the ring, whichever hides the least of it under panels and map buttons. Below the ring, centred, wins a tie.
  const COVERS = ["#left", "#right", "#legend", "#live", "#timeline", ".brand", ".topnav", ".leaflet-control-zoom",
    ".leaflet-control-attribution", ".tight-lbl", ".drawer", ".drill-card"];
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(placeLabel); };
  function placeLabel() {
    raf = 0;
    const rr = window.RedRoute, map = rr && rr.map;
    const el = pin && pin.getElement && pin.getElement(), lbl = el && el.querySelector(".dc-lbl");
    if (!lbl || !map) return;
    const mr = map.getContainer().getBoundingClientRect(), cp = map.latLngToContainerPoint(pin.getLatLng());
    const px = mr.left + cp.x, py = mr.top + cp.y, same = !!el.querySelector(".dc-pin.same");
    const covers = [];
    for (const sel of COVERS) for (const e of document.querySelectorAll(sel)) {
      const b = e.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) covers.push(b);
    }
    const ov = (l, t, w, h, b) => Math.max(0, Math.min(l + w, b.right) - Math.max(l, b.left)) * Math.max(0, Math.min(t + h, b.bottom) - Math.max(t, b.top));
    // how much of the label is hidden under covers, counting any part off the map twice (it would run off the screen)
    const hidden = (l, t, w, h) => covers.reduce((a, b) => a + ov(l, t, w, h, b), 2 * (w * h - ov(l, t, w, h, mr)));
    const size = lbl.getBoundingClientRect(), w = size.width, h = size.height, x0 = px - w / 2, lo = px + 10 - w, hi = px - 10;
    let best = null;
    for (const up of [false, true]) {
      const top = up ? py - (same ? 28 : 25) - h : py + 25;   // the same offsets as .dc-lbl, .dc-lbl.up and .same .dc-lbl.up in the CSS
      const xs = [x0, mr.left + 6, mr.right - 6 - w];
      for (const b of covers) xs.push(b.right + 6, b.left - 6 - w);
      for (const x of xs.map((v) => Math.min(Math.max(v, lo), hi))) {
        const cost = hidden(x, top, w, h) + Math.abs(x - x0) * 0.01 + (up ? 3 : 0);
        if (!best || cost < best.cost) best = { cost, up, dx: x - x0 };
      }
    }
    lbl.classList.toggle("up", best.up);
    lbl.style.transform = Math.abs(best.dx) > 0.5 ? `translateX(-50%) translateX(${Math.round(best.dx)}px)` : "";
  }

  // click on the line: move the map to the pin (nothing gets selected)
  function showOnMap() {
    const rr = window.RedRoute, map = rr && rr.map;
    if (!map || !cur) return;
    const ll = [cur.lat, cur.lon];
    if (map.getZoom() < 15) map.flyTo(ll, 15, { duration: 0.7 });
    else map.panTo(ll, { animate: true, duration: 0.6 });
    // on a phone the map sits above the panels: scroll back up to it
    const mp = document.getElementById("map"), r = mp && mp.getBoundingClientRect();
    if (r && r.bottom < 120) window.scrollTo({ top: 0, behavior: "smooth" });
    const el = pin && pin.getElement && pin.getElement(), ring = el && el.querySelector(".dc-pin");
    if (ring) { ring.classList.remove("flash"); void ring.offsetWidth; ring.classList.add("flash"); }
  }

  // "How it works": say how the deciding check is worked out, after the notes under the checks table
  function mountHow() {
    const rr = window.RedRoute, api = rr && rr.api, m = rr && rr.S && rr.S.m, body = document.getElementById("aboutBody");
    if (!api || !m || !body || body.querySelector("#decidingHow")) return;
    const after = body.querySelector("#drillHow") || body.querySelector("#bpHow");
    if (!after) return;
    const q = (key) => `"${api.esc(checkName(api, m, key))}"`;
    const p = document.createElement("p");
    p.id = "decidingHow";
    p.innerHTML = "<b>Deciding check.</b> Under the three checks, the app names the one with the fewest minutes to spare."
      + " It says where and when on the walk that is, and a dashed ring marks the spot on the map. All three checks count minutes."
      + ` ${q("plan")} and ${q("bad")} count the minutes left before the crew must be home.`
      + ` ${q("suit")} counts the minutes of backup oxygen left after the longest walk home.`
      + " When a check fails, it names the one that fails by the most. It is worked out from the plan, not measured.";
    after.after(p);
  }

  function update() {
    const rr = window.RedRoute, api = rr && rr.api, m = rr && rr.S && rr.S.m;
    if (!api || !m || !rr.map) return;
    cur = describe(api, m);
    renderLine(api, cur);
    renderPin(api, rr.map, cur);
    mountHow();
  }

  // the left panel is re-written on every redraw, so the line goes back in each time
  document.addEventListener("redroute:render", update);
  // "How it works" is written after the first redraw: watch it so the note goes in once it is there
  const about = document.getElementById("aboutBody");
  if (about && "MutationObserver" in window) new MutationObserver(mountHow).observe(about, { childList: true });
  // the app's "Tightest" dot and the crew panel appear with the clock; moving or zooming the map moves the label's room
  document.addEventListener("redroute:time", () => { syncSameSpot(); schedule(); });
  if (window.RedRoute && window.RedRoute.map) window.RedRoute.map.on("zoomend", syncSameSpot).on("move zoomend resize", schedule);
  window.addEventListener("resize", schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  if (window.RedRoute && window.RedRoute.api && window.RedRoute.S && window.RedRoute.S.m) update();
})();
