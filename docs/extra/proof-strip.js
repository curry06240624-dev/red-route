/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
   Red Route add-on: the proof strip "Checked against the real rover". It takes the place of the one-line
   tilt result at the end of the get-home checks and shows two results, each next to its comparison:
   1. our slope map vs Perseverance's tilt sensor, next to a flat 3° guess with no map;
   2. too-steep ground on the rover's climb to the delta top: a straight line, the rover, Red Route.
   The numbers belong to the default terrain. S.m.rover_check and S.m.validation are carried along when the
   user changes the plan, so nothing here depends on the user's plan.
   READ from the plan data: n, the average difference (slope_mae_deg), the steep metres, the 15° limit, the sols.
   DERIVED here from rover_check.pairs ([our slope, rover tilt] in degrees): the flat-guess difference, how far
   the map reads low where the rover tilted more than 10°, and a 95 % bootstrap interval for the average. */
(() => {
  "use strict";
  const FLAT_GUESS_DEG = 3;    // the no-map baseline: 3° everywhere (the middle value of the rover's tilts, see medTilt)
  const STEEP_TILT_DEG = 10;   // the team's split for steep spots: "where the rover tilted more than 10°"
  const RESAMPLES = 2000, SEED = 2026;   // bootstrap size and a fixed seed, so every visitor sees the same interval

  // mulberry32: a small seeded random number generator (the same numbers on every load)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // percentile of a sorted list, straight line between neighbours (the same rule as numpy's default)
  function percentile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.min(lo + 1, sorted.length - 1);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

  // pairs: [[our slope, rover tilt], ...] in degrees
  function proofStats(pairs) {
    const P = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const n = P.length;
    if (!n) return null;
    const err = P.map(([s, t]) => Math.abs(s - t));
    const hi = P.filter(([, t]) => t > STEEP_TILT_DEG);
    // percentile bootstrap: draw n records at random with repeats, take the average difference, 2,000 times
    const rnd = mulberry32(SEED), boot = new Float64Array(RESAMPLES);
    for (let b = 0; b < RESAMPLES; b++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += err[Math.floor(rnd() * n)];
      boot[b] = sum / n;
    }
    boot.sort();
    const tilts = Float64Array.from(P, ([, t]) => t).sort();
    return {
      n, mae: mean(err),
      flat: mean(P.map(([, t]) => Math.abs(FLAT_GUESS_DEG - t))),
      medTilt: percentile(tilts, 0.5),   // no flat guess has a smaller average difference than the median
      hiN: hi.length, hiBias: hi.length ? mean(hi.map(([s, t]) => s - t)) : null,
      ci: [percentile(boot, 0.025), percentile(boot, 0.975)],
    };
  }

  // Node (checks from the command line) gets the maths only; the browser builds the strip.
  if (typeof module === "object" && module.exports) module.exports = { proofStats, FLAT_GUESS_DEG, STEEP_TILT_DEG, RESAMPLES, SEED };
  if (typeof document === "undefined") return;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const width = (v, max) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0).toFixed(1);
  const deg = (d) => `${Number.isInteger(d) ? d : d.toFixed(1)}°`;
  const signed = (x) => (x < 0 ? `−${Math.abs(x).toFixed(1)}` : `+${x.toFixed(1)}`);

  let memo = { pairs: null, stats: null };   // the bootstrap runs once per data set, not on every redraw
  function statsFor(rc) {
    if (!rc) return null;
    if (memo.pairs !== rc.pairs) memo = { pairs: rc.pairs, stats: proofStats(rc.pairs) };
    return memo.stats;
  }

  function row(cls, label, value, w, tip) {
    return `<div class="ps-row ${cls}"${tip ? ` title="${esc(tip)}"` : ""}><span class="ps-k">${esc(label)}</span><b class="ps-v">${esc(value)}</b>`
      + `<span class="ps-bar" aria-hidden="true"><span class="ps-fill" style="width:${w}%"></span></span></div>`;
  }

  // say why 3°, but only when the data backs it: the median is the best flat guess for an average difference
  const bestFlat = (st) => (Math.abs(st.medTilt - FLAT_GUESS_DEG) < 0.05
    ? ` ${FLAT_GUESS_DEG}° is the middle value of the rover's tilts, so no other flat guess comes closer on average.` : "");

  function lowText(st) {
    if (!st || !st.hiN || st.hiBias == null || Math.abs(st.hiBias) < 0.05) return "";
    const d = Math.abs(st.hiBias).toFixed(1);
    return st.hiBias < 0 ? `Where the rover tilted more than ${STEEP_TILT_DEG}°, our map reads about ${d}° low (the unsafe side).`
      : `Where the rover tilted more than ${STEEP_TILT_DEG}°, our map reads about ${d}° high (the safe side).`;
  }

  function tiltCard(rc) {
    const mae = num(rc && rc.slope_mae_deg), st = statsFor(rc);
    if (mae == null || !st) return "";
    const max = Math.max(mae, st.flat), low = lowText(st), n = num(rc.n) ?? st.n;
    return `<div class="ps-card">
      <div class="ps-h" title="The rover logs how far it is tilted at each stop. Its sensor never sees our map.">Slope vs tilt sensor</div>
      <div class="ps-sub">Average difference, n&nbsp;=&nbsp;${n}</div>
      ${row("us", "Our map", `${mae.toFixed(2)}°`, width(mae, max), "Average difference between our slope map and the rover's measured tilt")}
      <div class="ps-ci" title="95 % interval from ${RESAMPLES.toLocaleString("en-US")} bootstrap resamples of the ${st.n} records (fixed seed)">95&nbsp;% interval ${st.ci[0].toFixed(1)}–${st.ci[1].toFixed(1)}°</div>
      ${row("base", `Flat ${FLAT_GUESS_DEG}° guess`, `${st.flat.toFixed(2)}°`, width(st.flat, max), `Guess ${FLAT_GUESS_DEG}° everywhere, with no map. Worked out from the same ${st.n} records.${bestFlat(st)}`)}
      ${low ? `<div class="ps-note" title="Average of our slope minus the rover's tilt over the ${st.hiN} records where the tilt was over ${STEEP_TILT_DEG}°: ${signed(st.hiBias)}°">${esc(low)}</div>` : ""}
    </div>`;
  }

  function steepCard(v) {
    const s = v && v.steep;
    if (!s || !s.line || !s.rover || !s.ours) return "";
    const L = num(s.line.steep_m), R = num(s.rover.steep_m), O = num(s.ours.steep_m), lim = num(s.limit_deg);
    if (L == null || R == null || O == null || lim == null) return "";
    const max = Math.max(L, R, O), sols = Array.isArray(v.sols) && v.sols.length === 2 ? `, sols ${v.sols[0]}–${v.sols[1]}` : "";
    return `<div class="ps-card">
      <div class="ps-h" title="Metres of ground steeper than ${deg(lim)} along each path, on our slope map">Too steep (over ${deg(lim)})</div>
      <div class="ps-sub" title="Perseverance's climb from the crater floor to the delta top${sols}. Same start and end for all three.">On the rover's climb to the delta top</div>
      ${row("base", "Straight line", `${L} m`, width(L, max))}
      ${row("rover", "The rover", `${R} m`, width(R, max))}
      ${row("us", "Red Route", `${O} m`, width(O, max), `Red Route's planner never uses ground steeper than ${deg(lim)}.`)}
      ${O === 0 ? '<div class="ps-note">A rule in the planner, not a test result.</div>' : ""}
    </div>`;
  }

  function openTests(e) {   // same as the app's own "See the test" link
    e.preventDefault();
    const api = window.RedRoute && window.RedRoute.api;
    if (api && api.openModal) api.openModal("about");
    else { const a = document.getElementById("about"); if (a) a.hidden = false; }
    setTimeout(() => { const t = document.getElementById("tests"); if (t) t.scrollIntoView(); }, 50);
  }

  // The left panel is re-written on every redraw, so the strip is put back each time.
  function mount() {
    const S = window.RedRoute && window.RedRoute.S, box = document.getElementById("checks");
    if (!S || !S.m || !box || box.querySelector(".proof-strip")) return;
    const cards = [tiltCard(S.m.rover_check), steepCard(S.m.validation)].filter(Boolean);
    if (!cards.length) return;   // no test data: leave the app's own line alone
    const strip = document.createElement("div");
    strip.className = "proof-strip";
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-labelledby", "psTitle");
    strip.innerHTML = `<div class="ps-top"><span class="lbl ps-title" id="psTitle">Checked against the real rover</span><a href="#tests" class="ps-link">See the test</a></div>
      <div class="ps-grid${cards.length === 1 ? " one" : ""}">${cards.join("")}</div>`;
    strip.querySelector(".ps-link").addEventListener("click", openTests);
    const old = box.querySelector(".proof");
    if (old) { old.hidden = true; old.after(strip); }
    else {
      const hr = box.querySelector(":scope > hr.r:last-of-type");
      if (hr) hr.before(strip); else box.appendChild(strip);
    }
  }

  // "How it works": say how the strip's derived numbers are worked out, under the tilt test.
  function mountHow() {
    const S = window.RedRoute && window.RedRoute.S, body = document.getElementById("aboutBody");
    if (!S || !S.m || !body || body.querySelector("#proofHow")) return;
    const rc = S.m.rover_check, st = statsFor(rc), tests = body.querySelector("#tests");
    if (!st || !tests) return;
    const p = document.createElement("p");
    p.id = "proofHow";
    const low = st.hiN && st.hiBias != null
      ? ` Where the rover tilted more than ${STEEP_TILT_DEG}° (${st.hiN} records), our slope minus the rover's tilt is ${signed(st.hiBias)}° on average${st.hiBias < 0 ? ": the map reads low there, which is the unsafe side" : ""}.` : "";
    p.innerHTML = `<b>The proof strip.</b> The strip under the get-home checks shows two of these tests. Its numbers are for the default terrain, so they stay the same when you change the plan.`
      + ` The flat guess says the ground is tilted ${FLAT_GUESS_DEG}° everywhere, with no map: against the same ${st.n} records it is off by ${st.flat.toFixed(2)}° on average.${bestFlat(st)}`
      + ` The 95 % interval of our average difference (${st.ci[0].toFixed(1)}–${st.ci[1].toFixed(1)}°) comes from ${RESAMPLES.toLocaleString("en-US")} bootstrap resamples: pick ${st.n} records at random, with repeats, work out the average difference, do it ${RESAMPLES.toLocaleString("en-US")} times (with a fixed seed) and keep the middle 95 %.`
      + ` Records close together on the drive are alike, so the true range may be a little wider.${esc(low)}`;
    (body.querySelector("#tests ~ svg") || tests).after(p);
  }

  function update() { mount(); mountHow(); }
  document.addEventListener("redroute:render", update);
  // "How it works" is written after the first redraw, and the checks could be re-written without the event:
  // watch both boxes too, so the strip and its note always come back
  if ("MutationObserver" in window) {
    const box = document.getElementById("checks"), about = document.getElementById("aboutBody");
    if (box) new MutationObserver(mount).observe(box, { childList: true });
    if (about) new MutationObserver(mountHow).observe(about, { childList: true });
  }
  update();   // in case the first redraw came before this file loaded
})();
