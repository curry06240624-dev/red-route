/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// The default plan stored in docs/data/mission.json (built on the 2 m grid by tools/build_layers.py):
// first the numbers the app shows, then the same results recomputed from the stored walk profile.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers.js");

const m = H.mission();
const wb = m.walkback;
const atStop = (id) => m.timeline.find((t) => t.id === id);
const leaveByShown = (t) => Math.min(t.leave_by_min, t.bad_leave_by_min);   // leaveBy() in docs/app.js

test.describe("stored default plan (mission.json)", () => {
  test("walk is base camp -> Three Forks -> Hawksbill Gap -> base camp; Tenby is optional, not on it", () => {
    assert.deepEqual(m.order, ["base", "depot", "gap", "base"]);
    assert.ok(m.stops.some((s) => s.id === "top"), "Tenby is in the stop list");
    assert.ok(!m.order.includes("top"), "Tenby is not on the default walk");
  });

  test("time budget is 8 h x (1 - 0.30) - 120 min = 216 min, so home by T+3:36", () => {
    assert.equal(wb.eva_limit_h, 8);
    assert.equal(wb.reserve, 0.3);
    assert.equal(wb.airlock_min, 120);
    H.near(H.timeBudget(wb.eva_limit_h, wb.reserve, wb.airlock_min), 216, 0, "8 h x (1 - 0.30) - 120 min");
    assert.equal(wb.usable_min, 336);
    assert.equal(wb.budget_min, 216);
    assert.equal(wb.bad.budget_min, 216, "the bad-day walk home must fit the same time");
    assert.equal(`T+${H.hm(wb.budget_min)}`, "T+3:36");
  });

  test("plan fits: +43.2 min spare", () => {
    assert.equal(wb.worst.margin_min, 43.2);
    assert.ok(H.passes(wb.worst.margin_min));
  });

  test("bad day (half speed): +13.8 min spare", () => {
    assert.equal(wb.bad.factor, 2);
    assert.equal(wb.bad.worst.margin_min, 13.8);
    assert.ok(H.passes(wb.bad.worst.margin_min));
  });

  test("suit failure: longest walk home 42.4 of 50 min", () => {
    assert.equal(wb.suit.limit_min, 50);
    assert.equal(wb.suit.worst.back, 42.4);
    assert.equal(wb.suit.worst.margin_min, 7.6);
    assert.ok(H.suitOk(wb.suit.worst.back, wb.suit.limit_min));
  });

  test("leave by: Three Forks T+2:11 and Hawksbill Gap T+2:37 (the smaller of leave_by_min and bad_leave_by_min)", () => {
    assert.equal(leaveByShown(atStop("depot")), 131.3);
    assert.equal(leaveByShown(atStop("gap")), 157.3);
    assert.equal(`T+${H.hm(leaveByShown(atStop("depot")))}`, "T+2:11");
    assert.equal(`T+${H.hm(leaveByShown(atStop("gap")))}`, "T+2:37");
  });

  test("walk: 2.35 km, +62 m, max slope 14.8 deg, 2.88 h outside (2 h 53 min; clock ends T+2:52; 4 h 53 min in the suit)", () => {
    const t = m.totals;
    assert.equal(t.dist_km, 2.35);
    assert.equal(t.gain_m, 62);
    assert.equal(t.max_slope, 14.8);
    assert.equal(t.eva_h, 2.88);
    assert.equal(t.dwell_min, 85, "40 min at Three Forks + 45 min at Hawksbill Gap");
    assert.equal(H.fmtMin(t.eva_h * 60), "2 h 53 min");
    assert.equal(`T+${H.hm(m.timeline[m.timeline.length - 1].arrive_min)}`, "T+2:52", "back at base camp");
    assert.equal(H.fmtMin(t.eva_h * 60 + wb.airlock_min), "4 h 53 min");
  });
});

test.describe("stored default plan, recomputed from its own walk profile", () => {
  const P = m.profile;
  const B = wb.budget_min;
  // The engine's rule: the tightest point is the earliest one; a later point replaces it only if it is more than
  // 0.15 min tighter (docs/router.js and tools/build_layers.py). Values in the profile are stored to 0.1 min.
  function tightest(marginOf) {
    let worst = { margin: 1e9 };
    for (const q of P) { const mg = marginOf(q); if (mg < worst.margin - 0.15) worst = { margin: mg, q }; }
    return worst;
  }

  test("the profile is the whole walk: 975 points, starts and ends at base camp at T+0 and T+2:52.8", () => {
    assert.equal(P.length, 975);
    assert.deepEqual([P[0].t, P[0].back], [0, 0]);
    assert.deepEqual([P[P.length - 1].t, P[P.length - 1].back], [172.8, 0]);
  });

  test("plan fits: budget - (t + back) over every point gives +43.2 min at T+143.5 (within 0.1 min: t and back are stored to 0.1 min)", () => {
    const w = tightest((q) => B - (q.t + q.back));
    H.near(w.margin, 43.2, 0.1, "tightest plan-fits margin");
    assert.equal(w.q.t, wb.worst.t, "same tightest point as stored");
    const plainMin = Math.min(...P.map((q) => B - (q.t + q.back)));
    H.near(plainMin, 43.2, 0.15, "smallest margin at any point (near-ties within 0.15 min keep the earliest)");
  });

  test("bad day: budget - (t + 2 x back) over every point gives +13.8 min at T+143.5 (within 0.15 min: 2 x a back stored to 0.1 min)", () => {
    const w = tightest((q) => B - (q.t + 2 * q.back));
    H.near(w.margin, 13.8, 0.15, "tightest bad-day margin");
    assert.equal(w.q.t, wb.bad.worst.t, "same tightest point as stored");
    const plainMin = Math.min(...P.map((q) => B - (q.t + 2 * q.back)));
    H.near(plainMin, 13.8, 0.15, "smallest bad-day margin at any point");
  });

  test("suit failure: the largest back in the profile is 42.4 min, at Three Forks (T+42.4)", () => {
    const maxBack = Math.max(...P.map((q) => q.back));
    assert.equal(maxBack, 42.4);
    assert.equal(maxBack, wb.suit.worst.back);
    assert.equal(P.find((q) => q.back === maxBack).t, 42.4);
  });

  test("all three checks hold at every one of the 975 points", () => {
    for (const q of P) {
      assert.ok(H.passes(H.planFitsMargin(q.t, q.back, B)), `plan fits at T+${q.t}`);
      assert.ok(H.passes(H.badDayMargin(q.t, q.back, B)), `bad day at T+${q.t}`);
      assert.ok(H.suitOk(q.back), `suit at T+${q.t}`);
    }
  });

  test("leave-by times recomputed from each stop's walk home: T+2:11 and T+2:37 (within 0.1 min)", () => {
    for (const [id, shown, text] of [["depot", 131.3, "T+2:11"], ["gap", 157.3, "T+2:37"]]) {
      const lb = H.leaveBy(B, atStop(id).back_min);
      H.near(lb, shown, 0.1, `leave by ${id}`);
      assert.equal(`T+${H.hm(lb)}`, text);
    }
  });

  test("stop times agree with the legs: arrive = previous departure + walk, depart = arrive + stop time", () => {
    let t = 0;
    m.order.forEach((id, i) => {
      if (i > 0) t += m.legs[i - 1].walk_min;
      H.near(m.timeline[i].arrive_min, t, 0.1, `arrive ${id}`);
      const dwell = i > 0 && i < m.order.length - 1 ? m.stops.find((s) => s.id === id).dwell_min : 0;
      H.near(m.timeline[i].depart_min, t + dwell, 0.1, `depart ${id}`);
      t += dwell;
    });
  });
});
