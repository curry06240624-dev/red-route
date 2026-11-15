/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// The time budget and the three get-home checks as small pure functions (tests/helpers.js, same formulas as
// docs/router.js and docs/app.js), with edge cases: exactly on the limit passes, one tenth of a minute over fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers.js");

test.describe("time budget: suit limit x (1 - reserve) - airlock time", () => {
  test("8 h, 30 % reserve, 120 min airlock = 216 min (T+3:36); 336 min before the airlock", () => {
    H.near(H.timeBudget(8, 0.3, 120), 216, 0, "budget");
    H.near(H.timeBudget(8, 0.3, 0), 336, 0, "usable suit time");
    assert.equal(`T+${H.hm(H.timeBudget(8, 0.3, 120))}`, "T+3:36");
  });

  test("no reserve and no airlock = the whole 8 h (480 min)", () => H.near(H.timeBudget(8, 0, 0), 480, 0, "budget"));

  test("slider extremes can leave less than nothing: 4 h, 50 % reserve, 150 min airlock = -30 min, and nothing fits", () => {
    const b = H.timeBudget(4, 0.5, 150);
    H.near(b, -30, 0, "budget");
    assert.ok(!H.passes(H.planFitsMargin(0, 0, b)), "even standing at the door fails");
  });
});

test.describe("check 1, plan fits: time so far + walk home <= budget", () => {
  test("exactly on the limit passes (186.7 + 29.3 = 216)", () => {
    H.near(H.planFitsMargin(186.7, 29.3, 216), 0, 0, "margin");
    assert.ok(H.passes(H.planFitsMargin(186.7, 29.3, 216)));
  });
  test("one tenth of a minute over fails (186.8 + 29.3 = 216.1)", () => {
    assert.equal(H.planFitsMargin(186.8, 29.3, 216), -0.1);
    assert.ok(!H.passes(H.planFitsMargin(186.8, 29.3, 216)));
  });
  test("floating-point noise does not flip a pass (0.1 + 0.2 on a 0.3 min budget)", () => {
    assert.notEqual(0.1 + 0.2, 0.3);
    assert.ok(H.passes(H.planFitsMargin(0.1, 0.2, 0.3)));
  });
  test("gives the stored +43.2 min back from the stored tightest point (T+143.5, 29.3 min home)", () => {
    assert.equal(H.planFitsMargin(143.5, 29.3, 216), 43.2);
  });
});

test.describe("check 2, bad day: time so far + 2 x walk home <= the same budget", () => {
  test("exactly on the limit passes (157.4 + 2 x 29.3 = 216)", () => {
    H.near(H.badDayMargin(157.4, 29.3, 216), 0, 0, "margin");
    assert.ok(H.passes(H.badDayMargin(157.4, 29.3, 216)));
  });
  test("one tenth of a minute over fails (157.5 + 2 x 29.3 = 216.1)", () => {
    assert.equal(H.badDayMargin(157.5, 29.3, 216), -0.1);
    assert.ok(!H.passes(H.badDayMargin(157.5, 29.3, 216)));
  });
  test("is stricter than plan fits whenever the walk home is longer than zero, and equal at base camp", () => {
    for (const back of [0.1, 1, 29.3, 42.4]) assert.ok(H.badDayMargin(100, back, 216) < H.planFitsMargin(100, back, 216), `back ${back}`);
    assert.equal(H.badDayMargin(172.8, 0, 216), H.planFitsMargin(172.8, 0, 216));
  });
  test("gives the stored +13.8 min back from the stored tightest point (T+143.5, half-speed walk home 58.7 min)", () => {
    assert.equal(H.badDayMargin(143.5, 58.7 / 2, 216), 13.8);
  });
});

test.describe("check 3, suit failure: walk home <= 50 min (1 h of backup oxygen)", () => {
  test("exactly 50 min passes", () => assert.ok(H.suitOk(50, 50)));
  test("50.1 min (one tenth over) fails", () => assert.ok(!H.suitOk(50.1, 50)));
  test("the stored longest walk home, 42.4 min, passes with 7.6 min to spare", () => {
    assert.ok(H.suitOk(42.4, 50));
    assert.equal(H.round1(50 - 42.4), 7.6);
  });
});

test.describe("leave-by time: the smaller of the two time checks' turn-back times", () => {
  test("away from base the half-speed rule sets it (Three Forks, 42.4 min home: T+2:11)", () => {
    H.near(H.leaveBy(216, 42.4), 216 - 2 * 42.4, 1e-9, "leave by");
    assert.equal(`T+${H.hm(H.leaveBy(216, 42.4))}`, "T+2:11");
  });
  test("at base camp both rules give the whole budget (T+3:36)", () => assert.equal(H.leaveBy(216, 0), 216));
  test("the app's clock format rounds down: 131.99 min is T+2:11, 132 min is T+2:12", () => {
    assert.equal(H.hm(131.99), "2:11");
    assert.equal(H.hm(132), "2:12");
  });
});
