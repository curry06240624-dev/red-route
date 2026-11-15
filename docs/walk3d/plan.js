/* Red Route 3D walk: the plan maths.
   The same formulas as docs/app.js (stateAt, the live numbers in setTime, getChecks, leaveBy, the "crewmate hurt"
   drill, the status word of the Astronaut view), copied here as small pure functions so the 3D page shows the same
   numbers as the main app. Nothing in this file draws anything.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */

/* ---------- the app's time formats (copied from docs/app.js) ---------- */
export const fmtMin = (m) => { m = Math.round(Math.abs(m)); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
export const hm = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
export const sgn = (m) => (m < 0 ? "−" : "+");
export const shortName = (s) => s.name.replace(/\s*\(.*\)$/, "").replace(/ sample depot$/i, "");
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const clone = (o) => JSON.parse(JSON.stringify(o));

export const stopById = (m, id) => m.stops.find((s) => s.id === id);
export const numberOf = (m, id) => { const i = m.order.indexOf(id); return i < 0 ? "–" : String(i + 1); };

// "Leave by" = the latest time to turn for home that keeps both time checks green (the half-speed rule is the stricter one)
export const leaveBy = (t) => (t.bad_leave_by_min != null ? Math.min(t.leave_by_min, t.bad_leave_by_min) : t.leave_by_min);
export const leaveSpare = (t) => (t.bad_spare_min != null ? Math.min(t.spare_min, t.bad_spare_min) : t.spare_min);

/* ---------- where the crew is at mission time T (stateAt in docs/app.js) ---------- */
export function stateAt(m, T) {
  const P = m.profile, last = P[P.length - 1];
  if (T >= last.t) return { p: last, q: last, f: 0, d: last.d, gap: false, after: true };
  let i = 0;
  while (i < P.length - 1 && P[i + 1].t <= T) i++;
  const p = P[i], q = P[Math.min(i + 1, P.length - 1)], gap = q.leg !== p.leg;
  const f = !gap && q.t > p.t ? (T - p.t) / (q.t - p.t) : 0;
  return { p, q, f, d: p.d + (q.d - p.d) * f, gap, after: false, i };
}

/* ---------- the crew's numbers at time T (the same lines as setTime in docs/app.js) ---------- */
export function liveAt(m, T) {
  const wb = m.walkback, bf = wb.bad ? wb.bad.factor : 2, lim = wb.suit ? wb.suit.limit_min : 50;
  const st = stateAt(m, T);
  const back = st.after ? 0 : st.p.back + ((st.q.back ?? st.p.back) - st.p.back) * st.f;
  const lastT = m.profile[m.profile.length - 1].t;
  const Tm = st.after ? lastT : T;   // once home, the margins stay at their arrival values
  const homeBy = wb.bad ? wb.bad.budget_min : wb.budget_min;
  const mPlan = wb.budget_min - (Tm + back), mBad = homeBy - (Tm + bf * back);
  const leg = st.gap ? st.q.leg : st.p.leg;
  const nextS = stopById(m, m.order[leg + 1] || "base");
  const here = st.gap ? stopById(m, m.order[st.q.leg]) : null;
  const worstNow = Math.min(mPlan, mBad), suitBad = back > lim, alarm = !st.after && (worstNow < 0 || suitBad);
  return { T, back, mPlan, mBad, lim, bf, homeBy, st, here, nextS, leg, suitBad, alarm, lastT };
}

/* ---------- the three get-home checks (getChecks in docs/app.js, without the breaking-point lines) ---------- */
export function nearestStopName(m, lat, lon) {
  let best = null, bd = Infinity;
  for (const id of m.order) {
    const s = stopById(m, id), d = (s.lat - lat) ** 2 + ((s.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best ? best.name : "the route";
}
export function getChecks(m) {
  const wb = m.walkback, out = [];
  const w = wb.worst, air = wb.airlock_min || 0, homeBy = `T+${hm(wb.budget_min)}`;
  const how = `${wb.eva_limit_h} h suit limit minus ${Math.round(wb.reserve * 100)} % reserve${air ? ` minus ${air % 60 ? fmtMin(air) : `${air / 60} h`} to get out and back in` : ""}`;
  out.push({ key: "plan", name: "Plan fits", ok: w.margin_min >= 0, margin: w.margin_min, at: w,
    val: `${w.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(w.margin_min)}${fmtMin(w.margin_min)}`,
    sub: w.margin_min >= 0 ? `Home at normal pace by ${homeBy} (${how})`
      : `Over by ${fmtMin(w.margin_min)} near ${nearestStopName(m, w.lat, w.lon)} at T+${hm(w.t)}: the crew must be home by ${homeBy} (${how}). Leave earlier, shorten a stop or drop one.` });
  if (wb.bad) {
    const b = wb.bad.worst, badBy = `T+${hm(wb.bad.budget_min)}`;
    out.push({ key: "bad", name: "If something goes wrong", ok: b.margin_min >= 0, margin: b.margin_min, at: b,
      val: `${b.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(b.margin_min)}${fmtMin(b.margin_min)}`,
      sub: b.margin_min >= 0 ? `Home by ${badBy} even if EV2 is hurt and EV1 helps at half speed, from any point of the walk. The reserve stays untouched.`
        : `At T+${hm(b.t)} near ${nearestStopName(m, b.lat, b.lon)} a half-speed walk home takes ${fmtMin(b.back)}: ${fmtMin(b.margin_min)} past ${badBy}. Leave that stop earlier, shorten a stop or drop one.` });
  }
  if (wb.suit) {
    const s = wb.suit.worst, lim = wb.suit.limit_min, ok = s.back <= lim;
    out.push({ key: "suit", name: "Suit failure", ok, margin: lim - s.back, at: s,
      val: `${ok ? "PASS" : "FAIL"} ${Math.round(s.back)} / ${lim} min`,
      sub: ok ? "Longest walk home stays inside the 1 h backup oxygen"
        : `Near ${nearestStopName(m, s.lat, s.lon)} the walk home is ${fmtMin(s.back)}, more than ${lim} min of backup oxygen. Move base camp closer or drop the far stop.` });
  }
  return out;
}

/* ---------- drill "crewmate hurt" (the "hurt" branch of renderDrill in docs/app.js) ----------
   Whole minutes, and the spare time is worked out from the whole minutes shown, so the card adds up. */
export function hurtDrill(m, n) {
  const left = Math.round(n.homeBy - n.T), half = Math.round(n.bf * n.back), backR = Math.round(n.back), spare = left - half;
  const where = n.here ? `at ${shortName(n.here)}` : `on the way to ${shortName(n.nextS)}`;
  const ok = n.mBad >= 0;
  return { where, backR, half, left, spare, ok, homeBy: n.homeBy,
    word: ok ? "MAKES IT" : "DOES NOT MAKE IT",
    spareTxt: spare >= 0 ? `${fmtMin(spare)} to spare` : `${fmtMin(spare)} short` };
}

/* ---------- the status word of the Astronaut view (renderAstro in docs/app.js) ---------- */
export function statusWord(m, n) {
  const { back, mPlan, mBad, lim, st } = n;
  if (st.after) return { cls: "", word: "HOME", spare: `EVA complete at T+${hm(n.lastT)}` };
  if (mPlan < 0 || mBad < 0 || back > lim) {
    return { cls: "bad", word: "TURN BACK NOW",
      spare: back > lim ? `Walk home is ${Math.round(back)} min, more than the ${lim} min of backup oxygen`
        : mPlan < 0 ? `${fmtMin(mPlan)} past the plan's time limit` : "No time left if a crewmate gets hurt" };
  }
  if (mPlan < 30) return { cls: "warn", word: "HEAD HOME SOON", spare: `Only ${fmtMin(mPlan)} to spare` };
  return { cls: "", word: "GO", spare: `${fmtMin(mPlan)} to spare` };
}

/* ---------- the plan the app starts with, and the message its re-planner gets ---------- */
export const DEFAULT_ORDER = ["base", "depot", "gap", "top", "base"];
// params() in docs/app.js with every slider at its starting value
export function appParams(m) {
  const a = m.assumptions;
  return { maxSlope: a.max_slope_deg, vFlat: a.v_flat_ms, roughPenalty: a.rough_penalty, roughM: a.rough_m,
    evaH: a.eva_limit_h, reserve: Math.round(a.reserve * 100) / 100, airlockMin: a.airlock_min || 0,
    badFactor: a.bad_day_factor || 2, suitMin: a.suit_fail_min || 50 };
}
// What onWorker() in docs/app.js does with a "plan" reply: a new mission object built on the stored one.
export function applyPlan(base, r) {
  const m = clone(base);
  m.order = [...new Set(r.legs.map((l) => l.frm))].concat(["base"]);
  m.legs = r.legs.map(({ coords, ...l }) => l);
  m.totals = r.totals; m.walkback = r.walkback; m.profile = r.profile; m.timeline = r.timeline;
  for (const s of m.stops) {
    const c = r.stopCells[s.id];
    if (c) { s.lon = c.lonlat[0]; s.lat = c.lonlat[1]; s.elev_m = c.z; }
  }
  m.routeCoords = r.legs.map((l) => l.coords);
  return m;
}
