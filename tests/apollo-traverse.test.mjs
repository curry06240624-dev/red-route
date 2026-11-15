/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
// The Apollo case of the 1,000-walk simulation draws its slowdown from NASA's Apollo records.
// This test re-does the sums: validation/apollo_traverse/appendixA_rows.csv holds the planned-against-performed rows
// of Appendix A (Tables A32 to A53) of NASA/TP-2017-219457, Miller et al. (2017), "Operational Assessment of Apollo
// Lunar Surface Extravehicular Activity", https://ntrs.nasa.gov/citations/20170007261, as read from the report's PDF
// by validation/apollo_traverse/extract_appendixA.py. Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// a small CSV reader (fields may be quoted and may hold commas)
function parseCsv(text) {
  const out = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
const table = parseCsv(read("../validation/apollo_traverse/appendixA_rows.csv"));
const head = table[0], col = (name) => head.indexOf(name);
const rows = table.slice(1).map((r) => ({ table: r[col("table")], grey: r[col("grey")], plan: r[col("plan_dur")], perf: r[col("perf_dur")], type: r[col("task_type")] }));

// the report's table numbers: one table per moonwalk and crew member (commander, lunar module pilot)
const MOONWALKS = [["Apollo 14 EVA 1", ["A32", "A33"]], ["Apollo 14 EVA 2", ["A34", "A35"]], ["Apollo 15 EVA 1", ["A36", "A37"]],
  ["Apollo 16 EVA 1", ["A42", "A43"]], ["Apollo 16 EVA 2", ["A44", "A45"]], ["Apollo 17 EVA 1", ["A48", "A49"]],
  ["Apollo 17 EVA 2", ["A50", "A51"]], ["Apollo 17 EVA 3", ["A52", "A53"]]];
const isNum = (x) => x !== "" && Number.isFinite(Number(x));
function travel(tables) {
  // "Traverse" rows that the report could compare (not greyed out) and that have both a planned and a performed length
  const legs = rows.filter((r) => tables.includes(r.table) && r.type.trim().toLowerCase() === "traverse" && r.grey === "0" && isNum(r.plan) && isNum(r.perf));
  const planned = legs.reduce((s, r) => s + Number(r.plan), 0), performed = legs.reduce((s, r) => s + Number(r.perf), 0);
  return { legs: legs.length, planned, performed, ratio: performed / planned };
}

test("travel time between stops, performed against planned, for the 8 Apollo moonwalks the report could line up", () => {
  const got = MOONWALKS.map(([name, tables]) => { const t = travel(tables); return [name, t.legs, t.planned, t.performed]; });
  assert.deepEqual(got, [["Apollo 14 EVA 1", 5, 36, 66], ["Apollo 14 EVA 2", 21, 110, 118], ["Apollo 15 EVA 1", 12, 208, 144],
    ["Apollo 16 EVA 1", 10, 76, 108], ["Apollo 16 EVA 2", 14, 146, 230], ["Apollo 17 EVA 1", 8, 92, 86],
    ["Apollo 17 EVA 2", 18, 280, 314], ["Apollo 17 EVA 3", 12, 198, 182]]);
});

test("the factors written in the simulation are those sums, and 3 of the 8 are 1.4 times the plan or more", () => {
  const src = read("../validation/bad_day_simulation.mjs");
  const m = /const APOLLO_WALK_FACTOR = \[([^\]]+)\]/.exec(src);
  assert.ok(m, "APOLLO_WALK_FACTOR not found in validation/bad_day_simulation.mjs");
  const written = m[1].split(",").map((x) => Number(x.trim()));
  const sums = MOONWALKS.map(([, tables]) => Number(travel(tables).ratio.toFixed(3)));
  assert.deepEqual(written, sums);
  assert.equal(sums.filter((x) => x >= 1.4).length, 3);
  const sorted = [...sums].sort((a, b) => a - b);
  assert.equal(((sorted[3] + sorted[4]) / 2).toFixed(2), "1.10");   // the middle value: about 10 % longer than planned
});
