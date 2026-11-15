/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// Re-runs validation/bad_day_simulation.mjs (1,000 seeded walks on the app's own route engine and data) and checks
// that the numbers the app and the README quote are the numbers the simulation gives.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function runSimulation() {
  const out = path.join(os.tmpdir(), `red_route_bad_day_${process.pid}.json`);
  execFileSync(process.execPath, [path.join(ROOT, "validation", "bad_day_simulation.mjs"), path.join(ROOT, "docs"), out], { stdio: "ignore" });
  const d = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.unlinkSync(out);
  return d;
}

const sim = runSimulation();
const row = (label) => sim.sensitivity_reserve_used_per_1000.find((x) => x.slowdown === label);

test("1,000 walks up to 20 % slower: usual rule 320, our rule with all spare spent 111, our plan 18", () => {
  const s = row("0-20 %");
  assert.deepStrictEqual([s.usual_rule, s.red_route_maxed, s.red_route], [320, 111, 18]);
});

test("1,000 walks up to 30 % slower: usual rule 347, our rule with all spare spent 160, our plan 59", () => {
  const s = row("0-30 %");
  assert.deepStrictEqual([s.usual_rule, s.red_route_maxed, s.red_route], [347, 160, 59]);
});

test("no simulated walk goes past the suit limit, in any plan or slowdown range", () => {
  for (const s of sim.sensitivity_reserve_used_per_1000) assert.ok(s.over_suit.every((n) => n === 0), `over the suit limit at ${s.slowdown}`);
});

test("stop minutes: our plan 85, our rule with all spare spent 99, usual rule 128 (so the rule costs 29 min)", () => {
  const stops = (name) => sim.plans.find((p) => p.plan.startsWith(name)).stop_minutes;
  assert.deepStrictEqual([stops("RED ROUTE (bad-day rule)"), stops("RED ROUTE MAXED"), stops("USUAL")], [85, 99, 128]);
});

test("the numbers written in docs/app.js are the simulation's numbers", () => {
  const src = fs.readFileSync(path.join(ROOT, "docs", "app.js"), "utf8");
  const m = /const BENEFIT = \{([^}]*)\}/.exec(src);
  assert.ok(m, "BENEFIT constant not found in docs/app.js");
  const got = Object.fromEntries(m[1].split(",").map((kv) => kv.split(":").map((x) => x.trim())).map(([k, v]) => [k, Number(v)]));
  const a = row("0-20 %"), b = row("0-30 %");
  assert.deepStrictEqual(got, { walks: 1000, usual: a.usual_rule, maxed: a.red_route_maxed, ours: a.red_route, usual30: b.usual_rule, maxed30: b.red_route_maxed, ours30: b.red_route, rule_cost_min: 29, plan_spare_min: 14 });
});
