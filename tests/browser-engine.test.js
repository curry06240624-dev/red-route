/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// The browser's route engine (docs/router.js, a web worker) run inside Node with the shipped 4 m grid
// (grid_slope.u8, grid_rough.u8, grid_dem.i16 and the "grid" block of mission.json). It gets the same "init" and
// "plan" messages docs/app.js sends. The stored plan comes from the 2 m grid, so the default walk is compared with
// tolerances that allow for the coarser grid: 5 % for distances and times, 3 min for spare times and leave-by times.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers.js");

const m = H.mission();
const router = H.loadRouter(m);
const stored = m;
const def = router.send(H.planMessage(m, ["depot", "gap"]));
const tenby = router.send(H.planMessage(m, ["depot", "gap", "top"], {}, 2));
const LIMIT = m.assumptions.max_slope_deg;
const g = m.grid;
const slopeGrid = new Uint8Array(require("fs").readFileSync(require("path").join(H.DATA, "grid_slope.u8")));
const tlAt = (r, id) => r.timeline.find((t) => t.id === id);
const leaveByShown = (t) => Math.min(t.leave_by_min, t.bad_leave_by_min);   // leaveBy() in docs/app.js

// every cell the engine's route passes through, read straight from grid_slope.u8 (not from the engine's own output)
function steepCells(res) {
  const bad = [];
  for (const leg of res.legs) for (const [lon, lat] of leg.coords) {
    const c = Math.round((lon - g.lon0) / g.dlon - 0.5), r = Math.round((g.lat1 - lat) / g.dlat - 0.5);
    const s8 = slopeGrid[r * g.w + c];
    if (s8 === 255 || s8 * g.slope_scale > LIMIT) bad.push({ leg: leg.frm + "->" + leg.to, lon, lat, slope: s8 * g.slope_scale });
  }
  return bad;
}

test.describe("browser route engine (docs/router.js, 4 m grid), default walk", () => {
  test("answers \"init\" with \"ready\" and plans the default walk without an error", () => {
    assert.equal(router.ready.type, "ready");
    assert.equal(def.type, "plan");
    assert.equal(def.error, undefined);
    assert.deepEqual(def.legs.map((l) => [l.frm, l.to]), [["base", "depot"], ["depot", "gap"], ["gap", "base"]]);
  });

  test("distance within 5 % of the stored 2.35 km", () => H.within(def.totals.dist_km, stored.totals.dist_km, 0.05, "km"));

  test("each leg's walking time within 5 % of the stored 2 m plan (42.4, 16.1, 29.3 min)", () => {
    def.legs.forEach((l, i) => H.within(l.walk_min, stored.legs[i].walk_min, 0.05, `${l.frm} -> ${l.to} walk min`));
  });

  test("time outside within 5 % of the stored 2.88 h, with the same 85 min of stops", () => {
    H.within(def.totals.eva_h, stored.totals.eva_h, 0.05, "h outside");
    assert.equal(def.totals.dwell_min, 85);
  });

  test("same time budget: 216 min, home by T+3:36", () => {
    assert.equal(def.walkback.budget_min, 216);
    assert.equal(def.walkback.bad.budget_min, 216);
  });

  test("plan fits PASSES, spare within 3 min of the stored +43.2 min", () => {
    assert.ok(H.passes(def.walkback.worst.margin_min), `margin ${def.walkback.worst.margin_min}`);
    H.near(def.walkback.worst.margin_min, 43.2, 3, "plan-fits spare");
  });

  test("bad-day check PASSES, spare within 3 min of the stored +13.8 min", () => {
    assert.ok(H.passes(def.walkback.bad.worst.margin_min), `margin ${def.walkback.bad.worst.margin_min}`);
    H.near(def.walkback.bad.worst.margin_min, 13.8, 3, "bad-day spare");
  });

  test("suit failure PASSES, longest walk home within 3 min of the stored 42.4 of 50 min", () => {
    assert.ok(H.suitOk(def.walkback.suit.worst.back, 50), `longest walk home ${def.walkback.suit.worst.back}`);
    H.near(def.walkback.suit.worst.back, 42.4, 3, "longest walk home");
  });

  test("leave-by times within 3 min of the stored T+2:11 (Three Forks) and T+2:37 (Hawksbill Gap)", () => {
    H.near(leaveByShown(tlAt(def, "depot")), 131.3, 3, "leave by Three Forks");
    H.near(leaveByShown(tlAt(def, "gap")), 157.3, 3, "leave by Hawksbill Gap");
  });

  test("no cell of the route is steeper than 15 deg (read from grid_slope.u8)", () => {
    assert.deepEqual(steepCells(def), []);
    assert.ok(def.totals.max_slope <= LIMIT, `max ${def.totals.max_slope}`);
  });

  test("the engine's margins are the pure rules (tests/helpers.js) applied at its own tightest points", () => {
    const w = def.walkback;
    assert.equal(w.worst.margin_min, H.planFitsMargin(w.worst.t, w.worst.back, w.budget_min));
    assert.equal(w.bad.worst.margin_min, H.badDayMargin(w.bad.worst.t, w.bad.worst.back / 2, w.bad.budget_min));
    assert.equal(w.suit.worst.margin_min, H.round1(50 - w.suit.worst.back));
  });

  test("edge: a budget exactly equal to the tightest (t + back) passes; 0.1 min less fails (both time checks)", () => {
    const usable = H.timeBudget(8, 0.3, 0);   // 336 min; the airlock time sets the budget
    const tb = Math.max(...def.profile.map((q) => H.round1(q.t + q.back)));
    const tb2 = Math.max(...def.profile.map((q) => H.round1(q.t + 2 * q.back)));
    const run = (airlockMin) => router.send(H.planMessage(m, ["depot", "gap"], { airlockMin }, 3)).walkback;
    assert.ok(H.passes(run(usable - tb).worst.margin_min), "plan fits exactly on the limit should pass");
    assert.equal(run(usable - tb + 0.1).worst.margin_min, -0.1, "plan fits 0.1 min over should fail by 0.1");
    assert.ok(H.passes(run(usable - tb2).bad.worst.margin_min), "bad day exactly on the limit should pass");
    assert.equal(run(usable - tb2 + 0.1).bad.worst.margin_min, -0.1, "bad day 0.1 min over should fail by 0.1");
  });
});

test.describe("browser route engine (docs/router.js, 4 m grid), optional third stop Tenby ticked on", () => {
  test("walk is base camp -> Three Forks -> Hawksbill Gap -> Tenby -> base camp", () => {
    assert.equal(tenby.error, undefined);
    assert.deepEqual(tenby.legs.map((l) => l.frm).concat("base"), ["base", "depot", "gap", "top", "base"]);
  });

  test("plan fits FAILS by 57 min (the app rounds to whole minutes: \"57 min\")", () => {
    const mg = tenby.walkback.worst.margin_min;
    assert.ok(!H.passes(mg), `margin ${mg}`);
    assert.equal(Math.round(-mg), 57, `margin ${mg}`);
    assert.equal(H.fmtMin(mg), "57 min");
  });

  test("bad-day check FAILS by 95 min (the app rounds to whole minutes: \"1 h 35 min\")", () => {
    const mg = tenby.walkback.bad.worst.margin_min;
    assert.ok(!H.passes(mg), `margin ${mg}`);
    assert.equal(Math.round(-mg), 95, `margin ${mg}`);
    assert.equal(H.fmtMin(mg), "1 h 35 min");
  });

  test("suit failure still passes: the farthest point is still Three Forks, under 50 min", () => {
    assert.ok(H.suitOk(tenby.walkback.suit.worst.back, 50), `longest walk home ${tenby.walkback.suit.worst.back}`);
    assert.equal(tenby.walkback.suit.worst.leg, 0);
  });

  test("no cell of the longer route is steeper than 15 deg (read from grid_slope.u8)", () => {
    assert.deepEqual(steepCells(tenby), []);
  });
});
