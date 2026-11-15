/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// The rover tilt test: our slope map against Perseverance's own tilt sensor at its waypoints (rover_check in
// mission.json). Each stored pair is [our slope, rover tilt] in degrees, rounded to 0.1 deg by tools/build_layers.py,
// which computed the stored statistics before rounding. Recounts from the pairs therefore carry that rounding.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers.js");

const rc = H.mission().rover_check;
const pairs = rc.pairs;
const n = pairs.length;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const diff = pairs.map(([ours, rover]) => ours - rover);
const count = (pred) => pairs.filter(pred).length;
const EPS = 1e-9;   // for 0.1-deg values compared in floating point

test.describe("rover tilt test (189 Perseverance waypoints)", () => {
  test("n = 189 pairs", () => {
    assert.equal(rc.n, 189);
    assert.equal(n, 189);
  });

  test("average difference 1.33 deg, recomputed from the pairs (within 0.05 deg: pairs are rounded to 0.1 deg)", () => {
    assert.equal(rc.slope_mae_deg, 1.33);
    H.near(mean(diff.map(Math.abs)), 1.33, 0.05, "mean |our slope - rover tilt|");
  });

  test("92.6 % within 3 deg (175 of 189) fits the pairs: before rounding, at least |d| <= 2.9 and at most |d| <= 3.1 count", () => {
    assert.equal(rc.within_3deg_pct, 92.6);
    assert.equal(H.round1((175 / n) * 100), 92.6);
    const surely = count(([a, b]) => Math.abs(a - b) <= 2.9 + EPS), maybe = count(([a, b]) => Math.abs(a - b) <= 3.1 + EPS);
    assert.ok(surely <= 175 && 175 <= maybe, `pairs within 2.9: ${surely}, within 3.1: ${maybe}`);
  });

  test("a plain recount of the rounded pairs gives 177 of 189 (93.7 %) because 2 pairs sit exactly on 3.0 deg", () => {
    const plain = count(([a, b]) => Math.abs(a - b) <= 3 + EPS);
    const onLine = count(([a, b]) => Math.abs(Math.abs(a - b) - 3) < EPS);
    assert.equal(plain, 177);
    assert.equal(onLine, 2);
    assert.equal(plain - onLine, 175, "without the 2 boundary pairs the count is the stored 175");
  });

  test("flat 3-deg guess, recomputed from the same pairs: 3.57 deg average difference and 67 % within 3 deg", () => {
    const flatMae = mean(pairs.map(([, rover]) => Math.abs(3 - rover)));
    H.near(flatMae, 3.57, 0.005, "mean |3 - rover tilt|");
    const flatPct = (count(([, rover]) => Math.abs(3 - rover) <= 3 + EPS) / n) * 100;
    assert.equal(Math.round(flatPct), 67, `flat guess within 3 deg: ${flatPct.toFixed(2)} %`);
  });

  test("our slope map beats the flat guess on both measures", () => {
    assert.ok(mean(diff.map(Math.abs)) < mean(pairs.map(([, rover]) => Math.abs(3 - rover))));
    assert.ok(count(([a, b]) => Math.abs(a - b) <= 3 + EPS) > count(([, rover]) => Math.abs(3 - rover) <= 3 + EPS));
  });

  test("correlation r 0.898 and bias +0.15 deg, recomputed from the pairs (within 0.002 and 0.01: rounded pairs)", () => {
    const ma = mean(pairs.map((p) => p[0])), mb = mean(pairs.map((p) => p[1]));
    let sab = 0, saa = 0, sbb = 0;
    for (const [a, b] of pairs) { sab += (a - ma) * (b - mb); saa += (a - ma) ** 2; sbb += (b - mb) ** 2; }
    assert.equal(rc.slope_r, 0.898);
    H.near(sab / Math.sqrt(saa * sbb), 0.898, 0.002, "correlation");
    assert.equal(rc.slope_bias_deg, 0.15);
    H.near(mean(diff), 0.15, 0.01, "mean (our slope - rover tilt)");
  });
});
