// Red Route benefit test: what does the bad-day rule buy?
// Runs the app's own route engine (docs/router.js, unchanged) in Node on the app's own data, then:
//  (a) a crewmate gets hurt at every 0.1-minute moment of the walk (half-speed walk home from there);
//  (b) 1,000 simulated walks with hidden problems: the whole walk is 0-20 % slower than planned (seeded random)
//      AND a crewmate gets hurt at a random moment.
// It compares three plans on the same terrain and rules (8 h suit, 30 % reserve, 2 h airlock):
//  RED ROUTE = the default plan, made with the bad-day rule (half-speed walk home must fit, reserve untouched);
//  USUAL     = the same stops, made with the usual walk-back rule only (normal-pace walk home must fit),
//              with the spare minutes spent at the last stop, as a planner using that rule may do;
//  FIRST     = our own first plan (4 stops), made before the airlock time was counted.
//  RED ROUTE MAXED = the same stops, made with the bad-day rule, with ALL its spare minutes spent at the last stop.
//              This is the fair rule-against-rule comparison with USUAL: both plans spend everything their rule allows.
// "Touched the reserve" = got home after the reserve-free budget (T+216 min). "Over the suit limit" = after T+360 min
// (8 h minus the 2 h airlock). Usage: node bad_day_simulation.mjs <red-route/docs dir> [out.json]
// AI use: this script was written by an AI coding assistant (Claude, by Anthropic), directed by the team.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const docs = process.argv[2];
const outPath = process.argv[3];
if (!docs) throw new Error("usage: node bad_day_simulation.mjs <red-route/docs dir> [out.json]");
const m = JSON.parse(fs.readFileSync(path.join(docs, "data/mission.json"), "utf8"));
let src = fs.readFileSync(path.join(docs, "router.js"), "utf8");
// In this copy only: also return the full (not thinned) profile.
src = src.replace("profile: profile.filter(", "profileFull: profile, profile: profile.filter(");
if (!src.includes("profileFull")) throw new Error("router.js changed: the profile line was not found");
const ctx = vm.createContext({ self: {}, performance, console });
vm.runInContext(src, ctx);
let last = null;
ctx.self.postMessage = (msg) => { last = msg; };
const ab = (f) => { const b = fs.readFileSync(path.join(docs, "data", f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
ctx.self.onmessage({ data: { type: "init", grid: m.grid, slope: ab("grid_slope.u8"), rough: ab("grid_rough.u8"), dem: ab("grid_dem.i16") } });

const a = m.assumptions;
const P = { maxSlope: a.max_slope_deg, vFlat: a.v_flat_ms, roughPenalty: a.rough_penalty, roughM: a.rough_m,
  evaH: a.eva_limit_h, reserve: a.reserve, airlockMin: a.airlock_min, badFactor: a.bad_day_factor, suitMin: a.suit_fail_min };
const BUDGET = a.eva_limit_h * 60 * (1 - a.reserve) - a.airlock_min;   // 216 min outside, reserve untouched
const HARD = a.eva_limit_h * 60 - a.airlock_min;                        // 360 min outside = the whole suit, reserve used up
const BF = a.bad_day_factor;                                             // half speed = walk home takes 2x

function run(order, dwell = {}) {
  const stops = m.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dwell_min: dwell[s.id] ?? s.dwell_min }));
  ctx.self.onmessage({ data: { type: "plan", id: 1, params: P, order, stops } });
  if (last.error) throw new Error(last.error);
  return last;
}

// walk timeline: for every profile point, minutes of walking so far, minutes at stops so far, walk-home minutes
function series(res) {
  const tl = res.timeline, dwellBefore = [];
  let d = 0;
  for (let i = 0; i < tl.length - 1; i++) { d += tl[i].depart_min - tl[i].arrive_min; dwellBefore[i] = d; }
  return res.profileFull.map((q) => ({ dw: dwellBefore[q.leg] || 0, walk: q.t - (dwellBefore[q.leg] || 0), back: q.back }));
}
// position on the walk at time tau for a walk slowed by factor s: returns walk-home minutes (normal pace, slowed)
function backAt(S, s, tau) {
  const T = (q) => q.dw + s * q.walk;
  let lo = 0, hi = S.length - 1;
  if (tau <= T(S[0])) return s * S[0].back;
  if (tau >= T(S[hi])) return s * S[hi].back;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T(S[mid]) <= tau) lo = mid; else hi = mid; }
  const t0 = T(S[lo]), t1 = T(S[hi]), f = t1 > t0 ? (tau - t0) / (t1 - t0) : 0;
  return s * (S[lo].back + (S[hi].back - S[lo].back) * f);
}
const endTime = (S, s) => S[S.length - 1].dw + s * S[S.length - 1].walk;
function classify(arrive) { return arrive <= BUDGET ? "ok" : arrive <= HARD ? "reserve" : "over"; }

// seeded random numbers (mulberry32), so every run gives the same 1,000 walks
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function test(name, res) {
  const S = series(res), wb = res.walkback;
  // (a) hurt at every 0.1-minute moment, planned pace
  const end = endTime(S, 1), cnt = { ok: 0, reserve: 0, over: 0 };
  let worstArrive = 0;
  for (let tau = 0; tau <= end + 1e-9; tau += 0.1) {
    const arrive = tau + BF * backAt(S, 1, tau);
    cnt[classify(arrive)]++;
    worstArrive = Math.max(worstArrive, arrive);
  }
  const n = cnt.ok + cnt.reserve + cnt.over;
  // (b) 1,000 walks with hidden problems
  const r = rng(20261115), N = 1000, w = { ok: 0, reserve: 0, over: 0 };
  for (let i = 0; i < N; i++) {
    const s = 1 + 0.2 * r();
    const tau = r() * endTime(S, s);
    w[classify(tau + BF * backAt(S, s, tau))]++;
  }
  // good day: no one hurt, planned pace
  const goodDay = classify(end);
  return {
    plan: name, order: res.timeline.map((x) => x.id).join(" > "), dist_km: res.totals.dist_km,
    time_outside_min: Math.round(end * 10) / 10, stop_minutes: res.totals.dwell_min,
    usual_rule_margin_min: wb.worst.margin_min, bad_day_margin_min: wb.bad.worst.margin_min, suit_worst_walk_home_min: wb.suit.worst.back,
    good_day: goodDay,
    hurt_every_moment: { moments: n, reserve_untouched_pct: +(100 * cnt.ok / n).toFixed(1), reserve_used_pct: +(100 * cnt.reserve / n).toFixed(1),
      over_suit_limit_pct: +(100 * cnt.over / n).toFixed(1), latest_home_min: Math.round(worstArrive * 10) / 10 },
    hidden_problems_1000_walks: { reserve_untouched: w.ok, reserve_used: w.reserve, over_suit_limit: w.over },
  };
}

const red = run(m.order);
// check: the engine must reproduce the app's published numbers before anything else is reported.
// The published numbers come from the 2 m Python build; this browser engine runs on the 4 m copy of the grid,
// which the project page says agrees "to within about one minute". So the tolerance is 1.0 min.
const got = [red.walkback.worst.margin_min, red.walkback.bad.worst.margin_min, red.walkback.suit.worst.back];
const want = [m.walkback.worst.margin_min, m.walkback.bad.worst.margin_min, m.walkback.suit.worst.back];
if (got.some((g, i) => Math.abs(g - want[i]) > 1.0)) throw new Error(`engine does not reproduce the app: got ${got}, want ${want}`);

// USUAL: same stops, spare minutes (normal-pace margin, rounded down) spent at the last stop
const lastStop = m.order[m.order.length - 2];
const extra = Math.floor(red.walkback.worst.margin_min);
const usual = run(m.order, { [lastStop]: (m.stops.find((s) => s.id === lastStop).dwell_min || 0) + extra });
if (usual.walkback.worst.margin_min < 0) throw new Error("usual-rule plan does not pass the usual rule");
const first = run(["base", "depot", "gap", "top", "base"]);
const spareBad = Math.floor(red.walkback.bad.worst.margin_min);
const redMax = run(m.order, { [lastStop]: (m.stops.find((s) => s.id === lastStop).dwell_min || 0) + spareBad });

const result = {
  generated: new Date().toISOString(), engine: "red-route/docs/router.js (unchanged), app data in docs/data",
  rules: { budget_min: BUDGET, suit_limit_outside_min: HARD, half_speed_factor: BF, slowdown_range: "0-20 % (assumed)", seed: 20261115,
    usual_plan: `same stops, +${extra} min at ${lastStop}` },
  reproduced_app_numbers: { engine_4m: { plan_fits: got[0], bad_day: got[1], suit_worst: got[2] },
    published_2m: { plan_fits: want[0], bad_day: want[1], suit_worst: want[2] } },
  plans: [test("RED ROUTE (bad-day rule)", red), test("USUAL (normal-pace walk-back rule only)", usual), test("FIRST (our first plan, 4 stops)", first), test("RED ROUTE MAXED (bad-day spare spent at last stop)", redMax)],
};
// sensitivity: the same 1,000 hidden-problem walks with other slowdown ranges (same seed)
function hidden(res, maxSlow) {
  const S = series(res), r = rng(20261115), w = { ok: 0, reserve: 0, over: 0 };
  for (let i = 0; i < 1000; i++) { const s = 1 + maxSlow * r(); const tau = r() * endTime(S, s); w[classify(tau + BF * backAt(S, s, tau))]++; }
  return w.reserve + w.over;
}
result.sensitivity_reserve_used_per_1000 = [0, 0.1, 0.2, 0.3].map((x) => ({
  slowdown: x ? `0-${x * 100} %` : "none", red_route: hidden(red, x), red_route_maxed: hidden(redMax, x), usual_rule: hidden(usual, x), over_suit: [red, redMax, usual].map((p) => overOnly(p, x)) }));
function overOnly(res, maxSlow) { const S = series(res), r = rng(20261115); let o = 0; for (let i = 0; i < 1000; i++) { const s = 1 + maxSlow * r(); const tau = r() * endTime(S, s); if (classify(tau + BF * backAt(S, s, tau)) === "over") o++; } return o; }
const text = JSON.stringify(result, null, 1);
if (outPath) fs.writeFileSync(outPath, text);
console.log(text);
