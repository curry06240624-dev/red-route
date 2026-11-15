/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: "What if here?" (ask the map: what if it goes wrong here?)
   A toggle by the zoom buttons. While it is on, a click on the map shows, for that spot: the walk home at
   normal pace, the latest time to leave under the half-speed rule, whether the spot is inside the 50-minute
   backup-oxygen line and, while the EVA clock is in use, whether a hurt crewmate would make it home from
   there at that time.
   Every number is DERIVED from the walk-home layer (window.RedRoute.api.zone.field: the walk-home time of
   each cell of the plan's grid in tenths of a minute, 65535 = no way back; see toField() in router.js) and
   the plan's own time rules (S.m.walkback). Nothing in the plan is changed. */
(() => {
  "use strict";
  const NO_WAY = 65535;   // router.js toField(): no way back from this cell
  const SNAP_M = 8;       // a click is not exact: if the spot itself is too steep, use walkable ground this close, and say so
  let started = false;

  function start() {
    const RR = window.RedRoute;
    if (started || !RR || !RR.api || !RR.map || !window.L) return;
    started = true;
    const { map, S, api } = RR;
    const phone = window.matchMedia("(max-width: 900px)");   // the app's own phone layout (style.css)
    const st = { on: false, ll: null, d: null, popup: null, pin: null, html: "", now: null, poll: 0, resetField: undefined, resetAt: 0 };
    const T = (min) => `T+${api.hm(min)}`;

    /* ---------- the toggle: a Leaflet control next to the zoom buttons ---------- */
    let box = null, btn = null, hint = null;
    const Ctl = L.Control.extend({
      options: { position: "bottomright" },
      onAdd() {
        if (box) return box;   // setPosition() adds the same control again
        box = L.DomUtil.create("div", "leaflet-bar rr-ask-ctl");
        btn = L.DomUtil.create("button", "rr-ask-btn", box);
        btn.type = "button";
        btn.setAttribute("aria-pressed", "false");
        btn.title = "What if it goes wrong here? Turn this on, then click any spot on the map.";
        btn.innerHTML = '<span class="rr-ask-ic" aria-hidden="true"></span><span>What if here?</span>';
        hint = L.DomUtil.create("div", "rr-ask-hint", box);
        hint.setAttribute("aria-live", "polite");
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
        L.DomEvent.on(btn, "click", (e) => { L.DomEvent.preventDefault(e); setMode(!st.on); });
        return box;
      },
    });
    const ctl = new Ctl().addTo(map);

    function setMode(on) {
      st.on = on;
      box.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      hint.textContent = on ? `${phone.matches ? "Tap" : "Click"} any spot on the map` : "";
      map.getContainer().classList.toggle("rr-ask-on", on);
      if (on) { map.on("click", onMapClick); showHint(); }
      else { map.off("click", onMapClick); closeResult(); }
    }
    // phones have no room for the hint next to the button: say it in the card until the first tap
    function showHint() {
      if (!phone.matches || st.ll) return;
      card.innerHTML = '<div class="rr-ask"><div class="rr-ask-h"><span>What if here?</span><button type="button" class="rr-ask-x" data-ask-close aria-label="Close">&times;</button></div>'
        + '<p class="rr-ask-msg">Tap any spot on the map to see the walk home from there.</p></div>';
      card.hidden = false;
    }
    // Leaflet fires the map's click only for clicks on the map itself: not after a pan or a stop drag, not on a stop marker
    function onMapClick(e) { if (st.on && e.latlng) openAt(e.latlng); }

    // a stop marker keeps doing what it does (select the stop); while the mode is on it also opens the popup at the stop
    const hooked = new WeakSet();
    function hookMarkers() {
      for (const mk of Object.values(S.markers || {})) {
        if (hooked.has(mk)) continue;
        hooked.add(mk);
        mk.on("click", () => { if (st.on) openAt(mk.getLatLng()); });
      }
    }

    /* ---------- reading the walk-home layer ---------- */
    // The layer is null for a moment after the page loads, and out of date while the plan is being re-planned.
    function pending() {
      const ps = document.getElementById("planStatus");
      if (ps && /^(Re-planning|Loading the terrain)/.test(ps.textContent)) return true;
      if (st.resetField !== undefined) {   // after Reset the app asks for a new layer; wait until it arrives
        if (api.zone.field === st.resetField && Date.now() - st.resetAt < 12000) return true;
        st.resetField = undefined;
      }
      return false;
    }

    // The cell under a point: column from the west edge, row 0 = the north edge (as wayHome() in app.js).
    // If that cell has no way home, take the nearest cell that has one within SNAP_M metres of the point.
    function readSpot(ll) {
      const m = S.m, g = m && m.grid, f = api.zone.field;
      if (!m || !g || !m.walkback) return { kind: "wait" };
      if (!f || f.length !== g.w * g.h || pending()) return { kind: "wait" };
      const fr = (g.lat1 - ll.lat) / g.dlat, fc = (ll.lng - g.lon0) / g.dlon;
      const r0 = Math.floor(fr), c0 = Math.floor(fc);
      if (r0 < 0 || r0 >= g.h || c0 < 0 || c0 >= g.w) return { kind: "out" };
      let i = r0 * g.w + c0, moved = 0;
      if (f[i] === NO_WAY) {
        const gx = g.gx || 4, gy = g.gy || 4, nr = Math.ceil(SNAP_M / gy) + 1, nc = Math.ceil(SNAP_M / gx) + 1;
        let best = -1, bd = Infinity;
        for (let r = r0 - nr; r <= r0 + nr; r++) for (let c = c0 - nc; c <= c0 + nc; c++) {
          if (r < 0 || r >= g.h || c < 0 || c >= g.w || f[r * g.w + c] === NO_WAY) continue;
          const dm = Math.hypot((r + 0.5 - fr) * gy, (c + 0.5 - fc) * gx);   // metres from the point to the cell's centre
          if (dm <= SNAP_M && dm < bd) { bd = dm; best = r * g.w + c; }
        }
        if (best < 0) return { kind: "none" };
        i = best; moved = bd;
      }
      const wb = m.walkback, B = wb.budget_min, Bb = wb.bad ? wb.bad.budget_min : B, k = wb.bad ? wb.bad.factor : 2;
      const lim = wb.suit ? wb.suit.limit_min : 50, back = f[i] / 10;
      return { kind: "ok", back, moved, B, Bb, k, lim, leaveBad: Bb - k * back, leaveN: B - back, o2in: f[i] <= lim * 10 };
    }

    /* ---------- the popup ---------- */
    const tag = (k, how) => k === "d"
      ? `<button type="button" class="stag d" data-how="${how}" title="Derived: worked out by Red Route from NASA data and the planning numbers. Click for how." aria-label="Derived. Open how it is worked out."><b>D</b><span>erived</span></button>`
      : `<button type="button" class="stag a" data-how="${how}" title="Assumed: a planning number we set. Click for its source." aria-label="Assumed. Open the source."><b>A</b><span>ssumed</span></button>`;
    const row = (k, v, cls = "") => `<div class="rr-ask-r"><span>${k}</span><b class="${cls}">${v}</b></div>`;

    function bodyHTML(d) {
      if (d.kind === "wait") return '<p class="rr-ask-msg">Still working out the way home…</p>';
      if (d.kind === "out") return '<p class="rr-ask-msg">Outside the mapped ground: the walk-home layer has no times here.</p>';
      if (d.kind === "none") return '<p class="rr-ask-msg bad">No way home on foot from here: the ground is too steep or cut off.</p>';
      const { fmtMin } = api;
      let h = "";
      if (d.moved) h += `<p class="rr-ask-snap">This exact spot is too steep or cut off on the ${gridM()} m grid. The times are for the nearest walkable ground, ${Math.max(1, Math.round(d.moved))} m away.</p>`;
      h += row('Walk home from here <i>normal pace</i>', fmtMin(d.back));
      const normal = d.leaveN >= 0 ? `${T(d.leaveN)} at normal pace` : "too far even at normal pace";
      h += row(`Leave here by<small>half speed, for a hurt crewmate${tag("a", "how-numbers")}</small>`,
        d.leaveBad >= 0 ? `${T(d.leaveBad)}<small>${normal}</small>` : `too far<small>${normal}</small>`, d.leaveBad >= 0 ? "" : "bad");
      h += `<div class="rr-ask-r"><span>Backup oxygen: <b class="${d.o2in ? "ok" : "bad"}">${d.o2in ? "inside" : "outside"} the ${d.lim}-minute line</b></span></div>`;
      return h;
    }
    // "At T+h:mm now": a hurt crewmate at half speed from this spot, against the same time limit as the bad-day check
    function nowHTML(d) {
      const ev = api.eva, z = api.zone;
      if (!d || d.kind !== "ok" || !(ev.T > 0) || !z.active) return "";
      const spare = d.Bb - (ev.T + d.k * d.back), ok = spare >= 0, { fmtMin } = api;
      return `<div class="rr-ask-v ${ok ? "ok" : "bad"}">At ${T(ev.T)} now: ${ok ? `MAKES IT with ${fmtMin(spare)} to spare` : `DOES NOT MAKE IT, ${fmtMin(spare)} short`}</div>`
        + `<small>Hurt crewmate (EV2) at half speed from here, home by ${T(d.Bb)}</small>`;
    }
    const gridM = () => { const g = S.m.grid; return Math.round(Math.max(g.gx || 4, g.gy || 4)); };
    // The default plan comes from the 2 m build; after a re-plan, the plan's numbers come from the same grid as the layer.
    function footHTML(d) {
      if (d.kind !== "ok" && d.kind !== "none") return "";
      let txt = `DERIVED from the walk-home layer (${gridM()} m grid).`;
      if (d.kind === "ok") {
        const same = S.base && JSON.stringify(S.m.timeline) === JSON.stringify(S.base.timeline);
        txt += same || !S.base
          ? ` Times at a stop can differ by about a minute from the plan's own numbers, which come from a ${S.m.grid_m ? Math.round(S.m.grid_m) : 2} m grid.`
          : ` The plan was re-planned in the browser on this same grid, so times at a stop match the plan's own numbers.`;
      }
      return `<p class="rr-ask-src">${txt}${tag("d", "askHow")}</p>`;
    }

    function draw() {
      if (!st.ll) return;
      const d = readSpot(st.ll);
      st.d = d;
      const head = `<div class="rr-ask" role="group" aria-label="What if it goes wrong here?">
        <div class="rr-ask-h"><span>What if here?</span>${phone.matches ? '<button type="button" class="rr-ask-x" data-ask-close aria-label="Close">&times;</button>' : ""}</div>
        ${bodyHTML(d)}`, foot = `${footHTML(d)}</div>`;
      if (head + foot !== st.html) {
        st.html = head + foot;
        st.now = nowHTML(d);   // in the first layout, so the popup is measured (and the map panned) with it
        const html = `${head}<div class="rr-ask-now"${st.now ? "" : " hidden"}>${st.now}</div>${foot}`;
        if (phone.matches) showCard(html); else showPopup(html);
      } else tick();
      clearTimeout(st.poll);
      if (d.kind === "wait") st.poll = setTimeout(draw, 300);   // no event says when the layer arrives
    }
    // only the clock line changes while the clock runs: update it in place (no re-layout, so the map never jumps)
    function tick() {
      const root = phone.matches ? card : st.popup && st.popup.getElement();
      const el = root && root.querySelector(".rr-ask-now");
      if (!el) return;
      const h = nowHTML(st.d);
      if (h === st.now) return;
      st.now = h;
      el.innerHTML = h;
      el.hidden = !h;
    }

    // Keep the popup clear of the panels that sit over the map on wide screens. The live strip (top), the legend and this
    // toggle (bottom) only count if they are in the popup's column, so the popup keeps as much room as it can.
    function panPad() {
      const W = window.innerWidth, H = window.innerHeight;
      const rect = (e) => { if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
      const $ = (id) => rect(document.getElementById(id));
      const left = $("left"), right = $("right"), x0 = left ? left.right + 10 : 10, x1 = right ? right.left - 10 : W - 10;
      const half = 165, cx = Math.min(Math.max(map.latLngToContainerPoint(st.ll).x, x0 + half), x1 - half);
      const inCol = (r) => r && r.right > cx - half && r.left < cx + half;
      const live = $("live"), tl = $("timeline");
      const bottom = Math.min(H, tl ? tl.top : H, ...[$("legend"), rect(box)].filter(inCol).map((r) => r.top));
      return [[x0, Math.max(72, inCol(live) ? live.bottom + 10 : 0)], [W - x1, H - bottom + 10]];
    }
    function showPopup(html) {
      card.hidden = true;
      if (!st.popup) {
        st.popup = L.popup({ className: "rr-ask-pop", minWidth: 288, maxWidth: 288, closeOnClick: false, closeOnEscapeKey: false, autoPan: true });
        st.popup.on("remove", () => { if (st.ll && !phone.matches) closeResult(); });   // its own close button
      }
      const [tlp, brp] = panPad();
      Object.assign(st.popup.options, { autoPanPaddingTopLeft: tlp, autoPanPaddingBottomRight: brp });
      st.popup.setLatLng(st.ll).setContent(html);
      if (!map.hasLayer(st.popup)) st.popup.openOn(map);
    }
    // phones: the map is short and the live strip covers its lower part, so the answer goes in a card at the bottom of the screen
    const card = document.createElement("div");
    card.className = "rr-ask-card";
    card.hidden = true;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "What if it goes wrong here?");
    document.body.appendChild(card);
    card.addEventListener("click", (e) => { if (e.target.closest("[data-ask-close]")) closeResult(); });
    function showCard(html) {
      if (st.popup && map.hasLayer(st.popup)) map.removeLayer(st.popup);
      card.innerHTML = html;
      card.hidden = false;
    }

    function openAt(ll) {
      st.ll = L.latLng(ll.lat, ll.lng);
      if (!st.pin) st.pin = L.marker(st.ll, { icon: L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="rr-ask-pin"></div>' }), interactive: false, keyboard: false, zIndexOffset: -1000 });
      st.pin.setLatLng(st.ll).addTo(map);
      st.html = "";
      draw();
    }
    function closeResult() {
      st.ll = null; st.d = null; st.html = ""; st.now = null;
      clearTimeout(st.poll);
      if (st.popup && map.hasLayer(st.popup)) map.removeLayer(st.popup);
      card.hidden = true;
      if (st.pin && map.hasLayer(st.pin)) map.removeLayer(st.pin);
    }

    /* ---------- "How it works" line, so the D tag has a place to open ---------- */
    function addHowTo() {
      const body = document.getElementById("aboutBody");
      if (!body || !body.firstChild || document.getElementById("askHow")) return;
      const p = document.createElement("p");
      p.id = "askHow";
      p.innerHTML = "<b>What if here?</b> The button by the zoom buttons turns on a click mode. Click any spot on the map and Red Route reads the walk-home time layer there (the same layer that draws the green zone). It shows the walk home at normal pace; the latest time to leave that spot so that EV1 can still bring a hurt EV2 home at half speed (the time limit minus twice the walk home); whether the spot is inside the 50-minute backup-oxygen line; and, while the clock is in use, whether a hurt crewmate would make it home from there at that time. The layer is on the browser's 4 m grid, so times at a stop can differ by about a minute from the default plan's numbers, which come from a 2 m grid. If the exact spot is too steep or cut off, the nearest walkable ground within 8 m is used and the popup says how far away it is. Nothing in the plan changes.";
      const after = document.getElementById("drillHow");
      if (after) after.after(p); else body.appendChild(p);
    }

    /* ---------- wiring ---------- */
    function place() {   // phones: the corner by the zoom buttons is only 52 px wide (the live strip uses the rest)
      const want = phone.matches ? "topright" : "bottomright";
      if (ctl.getPosition() !== want) ctl.setPosition(want);
    }
    const onPhoneChange = () => {
      const ll = st.ll;
      closeResult(); place();
      if (st.on) hint.textContent = `${phone.matches ? "Tap" : "Click"} any spot on the map`;
      if (ll) openAt(ll); else if (st.on) showHint();
    };
    if (phone.addEventListener) phone.addEventListener("change", onPhoneChange); else phone.addListener(onPhoneChange);
    document.addEventListener("click", (e) => {   // Reset asks the worker for a fresh layer: wait for it
      if (e.target.closest && e.target.closest("#resetPlan")) { st.resetField = api.zone.field; st.resetAt = Date.now(); }
    }, true);
    document.addEventListener("redroute:render", () => { hookMarkers(); setTimeout(addHowTo, 0); if (st.ll) draw(); });
    // a re-plan starts and ends with a new plan status line ("Re-planning…", then the result or an error): redraw an open popup
    const planPanel = document.getElementById("planPanel");
    let statusTimer = 0;
    if (planPanel) new MutationObserver(() => { clearTimeout(statusTimer); statusTimer = setTimeout(() => { if (st.ll) draw(); }, 0); })
      .observe(planPanel, { childList: true, subtree: true, characterData: true });
    document.addEventListener("redroute:time", () => { if (st.ll) tick(); });
    // the Astronaut view covers the map: switch the mode off when it opens
    new MutationObserver(() => { if (st.on && document.body.classList.contains("astro-on")) setMode(false); })
      .observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !st.on || document.body.classList.contains("astro-on")) return;
      if (st.ll) closeResult(); else setMode(false);
    });
    place(); hookMarkers(); setTimeout(addHowTo, 0);
    // hooks for tests: read the numbers at a point (changes nothing), or turn the mode on and open the popup there
    RR.ask = { read: (lat, lon) => readSpot(L.latLng(lat, lon)), open: (lat, lon) => { if (!st.on) setMode(true); openAt(L.latLng(lat, lon)); },
      isOn: () => st.on };
  }

  if (window.RedRoute && window.RedRoute.api) start();
  document.addEventListener("redroute:render", start);   // in case the app's hooks were not ready yet
})();
