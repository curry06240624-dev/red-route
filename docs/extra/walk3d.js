/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
   Red Route add-on: the 3D walk. It adds a "3D walk" button next to "Astronaut view". The button opens docs/walk3d/
   over the whole page: the same plan on the HiRISE elevation model in 3D, with an astronaut the user can walk in
   third or first person, or send along the route on auto-walk.
   READ from the page: the plan on screen (window.RedRoute.S.m), the drawn route (S.routeLine) and the clock time
   (api.eva.T). They are handed to the 3D page, so it walks the same plan from the same moment. Nothing is written
   back: closing the 3D walk returns to the planner as it was.
   Opening walk3d/ directly shows the default plan from data/mission.json. */
(() => {
  "use strict";
  const RR = () => window.RedRoute || {};
  let frame = null, shown = "";

  function plan() {
    const S = RR().S, eva = RR().api && RR().api.eva;
    if (!S || !S.m || !S.routeLine) return null;
    return { mission: S.m, route: S.routeLine.toGeoJSON(), t: eva && eva.T > 0 ? eva.T : 0, savedAt: Date.now() };
  }
  // what makes two plans the same walk: the stop order, where the stops are, how long they take and the walking rules
  const signature = (p) => (p ? JSON.stringify([p.mission.order, p.mission.totals, p.mission.assumptions, p.mission.stops.map((s) => [s.lat, s.lon, s.dwell_min])]) : "");

  function open() {
    const eva = RR().api && RR().api.eva, play = document.getElementById("playBtn");
    if (eva && eva.playing && play) play.click();            // pause the 2D walk; the 3D walk takes over from its clock time
    const p = plan(), sig = signature(p);
    try { if (p) sessionStorage.setItem("redroute.plan", JSON.stringify(p)); else sessionStorage.removeItem("redroute.plan"); } catch (e) { /* the 3D page falls back to the default plan */ }
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "walk3d-frame"; frame.title = "Red Route 3D walk"; frame.src = "walk3d/?embed=1";
      document.body.appendChild(frame);
    } else if (sig !== shown) frame.contentWindow.location.reload();          // the plan changed: build the 3D walk again
    else if (p) frame.contentWindow.postMessage({ type: "redroute:3d-time", t: p.t }, location.origin);   // same plan: just move the clock
    shown = sig; frame.hidden = false;
    setTimeout(() => { try { frame.contentWindow.focus(); } catch (e) { /* still loading */ } }, 300);
  }
  function close() {
    if (!frame || frame.hidden) return;
    frame.hidden = true;
    const btn = document.getElementById("walk3dBtn"); if (btn) btn.focus();
  }

  function start() {
    const astro = document.getElementById("astroBtn");
    if (!astro || document.getElementById("walk3dBtn")) return;
    const btn = document.createElement("button");
    btn.className = "astro-open walk3d-open"; btn.id = "walk3dBtn"; btn.setAttribute("aria-label", "Open the 3D walk");
    btn.innerHTML = '<svg viewBox="0 0 30 22" width="30" height="22" aria-hidden="true"><path d="M1 20 L9.5 7 L14.5 13.5 L19.5 4 L29 20 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="15" cy="17.5" r="2.6" fill="#ff6a3d"/></svg><span>3D walk</span>';
    btn.addEventListener("click", open);
    astro.after(btn);
    addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.type === "redroute:3d-close") close(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
