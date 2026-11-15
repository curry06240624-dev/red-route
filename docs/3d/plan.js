/* Red Route 3D walk: the plan maths.
   Every formula here is the main app's own (docs/app.js and docs/extra/ask-the-map.js), copied so the helmet
   display shows the same numbers as the judged app: the clock position on the planned walk (stateAt,
   pointAtDistance), the three get-home checks (getChecks), the status word of the Astronaut view (verdict),
   the "Crewmate hurt" and "Suit alarm" drills, and "What if here?" (readSpot) for ground off the route.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */

export const R_MARS = 3396190;
const RAD = Math.PI / 180;

/* ---------- text helpers (app.js) ---------- */
export const fmtMin = (m) => { m = Math.round(Math.abs(m)); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
export const hm = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
export const sgn = (m) => (m < 0 ? "−" : "+");
export const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
export const shortName = (s) => s.name.replace(/\s*\(.*\)$/, "").replace(/ sample depot$/i, "");
export function bearing(a, b) {   // a, b = [lat, lon]; degrees clockwise from north
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
// metres between two [lat, lon] points, the way the app measures along the drawn route
export function metres(a, b) {
  const dy = (b[0] - a[0]) * RAD * R_MARS, dx = (b[1] - a[1]) * RAD * R_MARS * Math.cos(b[0] * RAD);
  return Math.hypot(dx, dy);
}

// "Leave by" = the latest time to turn for home that keeps both time checks green (the half-speed rule is the stricter one)
export const leaveBy = (t) => (t.bad_leave_by_min != null ? Math.min(t.leave_by_min, t.bad_leave_by_min) : t.leave_by_min);
export const stopById = (m, id) => m.stops.find((s) => s.id === id);

/* ---------- the drawn route: one list of [lat, lon] with the distance walked so far ----------
   legs = array of arrays of [lon, lat] (route.geojson order). Distances add up exactly as app.js pointAtDistance(). */
export function makeRoute(legs) {
  const pts = [], cum = [], leg = [], legStart = [], legEnd = [];
  let acc = 0, prev = null;
  legs.forEach((coords, k) => {
    legStart[k] = pts.length;
    for (const c of coords) {
      const ll = [c[1], c[0]];
      if (prev) acc += metres(prev, ll);
      pts.push(ll); cum.push(acc); leg.push(k);
      prev = ll;
    }
    legEnd[k] = pts.length - 1;
  });
  return { pts, cum, leg, legStart, legEnd, length: acc };
}
export function pointAtDistance(route, d) {
  const { pts, cum } = route;
  if (!pts.length) return null;
  if (d <= 0) return pts[0].slice();
  let lo = 0, hi = pts.length - 1;
  if (d >= cum[hi]) return pts[hi].slice();
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo], f = seg > 0 ? (d - cum[lo]) / seg : 0;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

/* ---------- where the crew is at mission time T (app.js stateAt) ---------- */
export function stateAt(m, T) {
  const P = m.profile, last = P[P.length - 1];
  if (T >= last.t) return { p: last, q: last, f: 0, d: last.d, gap: false, after: true };
  let i = 0;
  while (i < P.length - 1 && P[i + 1].t <= T) i++;
  const p = P[i], q = P[Math.min(i + 1, P.length - 1)], gap = q.leg !== p.leg;
  const f = !gap && q.t > p.t ? (T - p.t) / (q.t - p.t) : 0;
  return { p, q, f, d: p.d + (q.d - p.d) * f, gap, after: false };
}

/* ---------- the numbers of the live strip at mission time T, on the planned walk (app.js setTime) ---------- */
export function navOnPlan(m, route, T) {
  const wb = m.walkback, bf = wb.bad ? wb.bad.factor : 2, lim = wb.suit ? wb.suit.limit_min : 50;
  const st = stateAt(m, T), baseS = stopById(m, "base");
  const pos = st.after ? [baseS.lat, baseS.lon] : pointAtDistance(route, st.d);
  const back = st.after ? 0 : st.p.back + ((st.q.back ?? st.p.back) - st.p.back) * st.f;
  const Tm = st.after ? m.profile[m.profile.length - 1].t : T;   // once home, the margins stay at their arrival values
  const mPlan = wb.budget_min - (Tm + back), mBad = (wb.bad ? wb.bad.budget_min : wb.budget_min) - (Tm + bf * back);
  const leg = st.gap ? st.q.leg : st.p.leg;
  const nextS = stopById(m, m.order[leg + 1] || "base");
  const here = st.gap ? stopById(m, m.order[st.q.leg]) : null;
  const dist = nextS ? metres(pos, [nextS.lat, nextS.lon]) : 0;
  return { T, back, mPlan, mBad, lim, after: st.after, here, nextS, dist, pos, leg, d: st.d, slope: st.p.s, z: st.p.z,
    hereIdx: st.gap ? st.q.leg : -1, src: "plan", off: 0 };
}

/* ---------- the status word (app.js renderAstro) ---------- */
export function verdict(m, n) {
  if (n.after) return { cls: "", word: "HOME", spare: `EVA complete at T+${hm(n.homeT != null ? n.homeT : m.profile[m.profile.length - 1].t)}` };
  if (n.src === "none") return { cls: "bad", word: "TURN BACK NOW", spare: "No way home on foot from here: the ground is too steep or cut off" };
  const { back, mPlan, mBad, lim } = n;
  if (mPlan < 0 || mBad < 0 || back > lim) {
    return { cls: "bad", word: "TURN BACK NOW",
      spare: back > lim ? `Walk home is ${Math.round(back)} min, more than the ${lim} min of backup oxygen`
        : mPlan < 0 ? `${fmtMin(mPlan)} past the plan's time limit` : "No time left if a crewmate gets hurt" };
  }
  if (mPlan < 30) return { cls: "warn", word: "HEAD HOME SOON", spare: `Only ${fmtMin(mPlan)} to spare` };
  return { cls: "", word: "GO", spare: `${fmtMin(mPlan)} to spare` };
}

/* ---------- the three get-home checks (app.js getChecks) ---------- */
export function nearestStopName(m, lat, lon) {
  let best = null, bd = Infinity;
  for (const id of m.order) {
    const s = stopById(m, id), d = (s.lat - lat) ** 2 + ((s.lon - lon) * Math.cos(lat * RAD)) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best ? best.name : "the route";
}
export function getChecks(m) {
  const wb = m.walkback, out = [];
  const w = wb.worst, air = wb.airlock_min || 0, homeBy = `T+${hm(wb.budget_min)}`;
  const how = `${wb.eva_limit_h} h suit limit minus ${Math.round(wb.reserve * 100)} % reserve${air ? ` minus ${air % 60 ? fmtMin(air) : `${air / 60} h`} to get out and back in` : ""}`;
  out.push({ key: "plan", name: "Plan fits", ok: w.margin_min >= 0,
    val: `${w.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(w.margin_min)}${fmtMin(w.margin_min)}`,
    sub: w.margin_min >= 0 ? `Home at normal pace by ${homeBy} (${how})`
      : `Over by ${fmtMin(w.margin_min)} near ${nearestStopName(m, w.lat, w.lon)} at T+${hm(w.t)}: the crew must be home by ${homeBy}.` });
  if (wb.bad) {
    const b = wb.bad.worst, badBy = `T+${hm(wb.bad.budget_min)}`;
    out.push({ key: "bad", name: "If something goes wrong", ok: b.margin_min >= 0,
      val: `${b.margin_min >= 0 ? "PASS" : "FAIL"} ${sgn(b.margin_min)}${fmtMin(b.margin_min)}`,
      sub: b.margin_min >= 0 ? `Home by ${badBy} even if EV2 is hurt and EV1 helps at half speed, from any point of the walk. Tightest: near ${shortName({ name: nearestStopName(m, b.lat, b.lon) })} at T+${hm(b.t)}.`
        : `At T+${hm(b.t)} near ${nearestStopName(m, b.lat, b.lon)} a half-speed walk home takes ${fmtMin(b.back)}: ${fmtMin(b.margin_min)} past ${badBy}.` });
  }
  if (wb.suit) {
    const s = wb.suit.worst, lim = wb.suit.limit_min, ok = s.back <= lim;
    out.push({ key: "suit", name: "Suit failure", ok,
      val: `${ok ? "PASS" : "FAIL"} ${Math.round(s.back)} / ${lim} min`,
      sub: ok ? `Longest walk home (near ${shortName({ name: nearestStopName(m, s.lat, s.lon) })}) stays inside the 1 h backup oxygen`
        : `Near ${nearestStopName(m, s.lat, s.lon)} the walk home is ${fmtMin(s.back)}, more than ${lim} min of backup oxygen.` });
  }
  return out;
}

/* ---------- bad-day drills (app.js renderDrill): whole minutes, and the spare time is worked out from them ---------- */
const spareTxt = (x, unit = "to spare") => (x >= 0 ? `${fmtMin(x)} ${unit}` : `${fmtMin(x)} short`);
export function hurtDrill(m, n) {
  const wb = m.walkback, bf = wb.bad ? wb.bad.factor : 2, homeBy = wb.bad ? wb.bad.budget_min : wb.budget_min;
  const backR = Math.round(n.back), left = Math.round(homeBy - n.T), half = Math.round(bf * n.back), spare = left - half, ok = n.mBad >= 0;
  return { title: "Crewmate hurt (EV2)", ok, word: ok ? "MAKES IT" : "DOES NOT MAKE IT", txt: spareTxt(spare),
    rows: [["Walk home at normal pace", fmtMin(backR)], ["At half speed, EV1 helping the hurt EV2", fmtMin(half)], [`Time left to be home by T+${hm(homeBy)}`, fmtMin(left)]],
    note: 'Same rule as the "If something goes wrong" check. The reserve stays untouched.' };
}
export function suitDrill(m, n) {
  const backR = Math.round(n.back), ok = n.back <= n.lim;
  return { title: "Suit alarm", ok, word: ok ? "MAKES IT" : "DOES NOT MAKE IT", txt: spareTxt(n.lim - backR, "of backup oxygen to spare"),
    rows: [["Walk home from here", fmtMin(backR)], ["Backup oxygen for the walk", `${n.lim} min`]],
    note: 'Same rule as the "Suit failure" check: 1 h of backup oxygen, about 10 min of it to get inside.' };
}

/* ---------- "What if here?" (extra/ask-the-map.js readSpot): the walk home from any spot ----------
   field = the walk-home layer from router.js: tenths of a minute per cell of the plan's grid, 65535 = no way back.
   If the cell under the point has no way home, the nearest cell that has one within 8 m is used. */
export const NO_WAY = 65535;
const SNAP_M = 8;
export function readSpot(m, field, lat, lon) {
  const g = m && m.grid;
  if (!g || !m.walkback) return { kind: "wait" };
  if (!field || field.length !== g.w * g.h) return { kind: "wait" };
  const fr = (g.lat1 - lat) / g.dlat, fc = (lon - g.lon0) / g.dlon;
  const r0 = Math.floor(fr), c0 = Math.floor(fc);
  if (r0 < 0 || r0 >= g.h || c0 < 0 || c0 >= g.w) return { kind: "out" };
  let i = r0 * g.w + c0, moved = 0;
  if (field[i] === NO_WAY) {
    const gx = g.gx || 4, gy = g.gy || 4, nr = Math.ceil(SNAP_M / gy) + 1, nc = Math.ceil(SNAP_M / gx) + 1;
    let best = -1, bd = Infinity;
    for (let r = r0 - nr; r <= r0 + nr; r++) for (let c = c0 - nc; c <= c0 + nc; c++) {
      if (r < 0 || r >= g.h || c < 0 || c >= g.w || field[r * g.w + c] === NO_WAY) continue;
      const dm = Math.hypot((r + 0.5 - fr) * gy, (c + 0.5 - fc) * gx);
      if (dm <= SNAP_M && dm < bd) { bd = dm; best = r * g.w + c; }
    }
    if (best < 0) return { kind: "none" };
    i = best; moved = bd;
  }
  const wb = m.walkback, B = wb.budget_min, Bb = wb.bad ? wb.bad.budget_min : B, k = wb.bad ? wb.bad.factor : 2;
  const lim = wb.suit ? wb.suit.limit_min : 50, back = field[i] / 10;
  return { kind: "ok", back, moved, B, Bb, k, lim, leaveBad: Bb - k * back, leaveN: B - back, o2in: field[i] <= lim * 10 };
}

/* ---------- the nearest point of the drawn route to a [lat, lon] point ----------
   Returns { off (m), d (m along the walk), leg, pt } for the nearest point; onlyLeg limits the search to one leg. */
export function nearestOnRoute(route, ll, onlyLeg = -1) {
  const { pts, cum, leg } = route, cosl = Math.cos(ll[0] * RAD), k = RAD * R_MARS;
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    if (leg[i] !== leg[i + 1]) continue;
    if (onlyLeg >= 0 && leg[i] !== onlyLeg) continue;
    const ax = (pts[i][1] - ll[1]) * k * cosl, ay = (pts[i][0] - ll[0]) * k;
    const bx = (pts[i + 1][1] - ll[1]) * k * cosl, by = (pts[i + 1][0] - ll[0]) * k;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const f = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const px = ax + dx * f, py = ay + dy * f, d2 = px * px + py * py;
    if (d2 < bd) { bd = d2; best = { i, f }; }
  }
  if (!best) return null;
  const { i, f } = best;
  return { off: Math.sqrt(bd), d: cum[i] + (cum[i + 1] - cum[i]) * f, leg: leg[i],
    pt: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f] };
}

/* the plan's own walk-home time, slope and height at a distance along one leg (straight-line between profile points) */
export function profileAt(m, leg, d) {
  const P = m.profile;
  let a = null, b = null;
  for (let i = 0; i < P.length; i++) {
    if (P[i].leg !== leg) continue;
    if (P[i].d <= d) a = P[i];
    if (P[i].d >= d) { b = P[i]; break; }
  }
  if (!a) a = b; if (!b) b = a;
  if (!a) return null;
  const f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { back: a.back + (b.back - a.back) * f, s: a.s, z: a.z + (b.z - a.z) * f, t: a.t + (b.t - a.t) * f };
}

/* ---------- the way home from a point (app.js wayHome): walk downhill on the walk-home layer until base camp ----------
   The layer stores no path, so this follows the smallest walk-home time from cell to cell. Returned only if it reaches base. */
export function wayHome(m, field, pos) {
  const g = m && m.grid, f = field;
  if (!g || !f) return null;
  const c0 = Math.floor((pos[1] - g.lon0) / g.dlon), r0 = Math.floor((g.lat1 - pos[0]) / g.dlat);
  if (r0 < 0 || r0 >= g.h || c0 < 0 || c0 >= g.w) return null;
  let i = r0 * g.w + c0;
  if (f[i] === NO_WAY) {
    let best = -1, bd = Infinity;
    for (let dr = -8; dr <= 8; dr++) for (let dc = -8; dc <= 8; dc++) {
      const rr = r0 + dr, cc = c0 + dc;
      if (rr < 0 || rr >= g.h || cc < 0 || cc >= g.w) continue;
      const j = rr * g.w + cc, d2 = dr * dr + dc * dc;
      if (f[j] !== NO_WAY && d2 < bd) { bd = d2; best = j; }
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
  const bs = stopById(m, "base"); pts.push([bs.lat, bs.lon]);
  return pts;
}
