/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
// Tests for docs/extra/storm-replay.js: the solar storm of 20 May 2024 as Curiosity's RAD measured it.
// Every number the app shows is re-derived here from validation/rad_storm_2024-05/rad_dose_2024-05-16_to_23.csv,
// the 692 readings that validation/rad_storm_2024-05/read_rad_dose.py pulled from NASA's PDS archive
// (data set MSL-M-RAD-3-RDR-V1.0, detector E, micrograys per hour). Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(read("../docs/extra/storm-replay.js"), sandbox, { filename: "docs/extra/storm-replay.js" });
const SR = sandbox.StormReplay;

const csv = read("../validation/rad_storm_2024-05/rad_dose_2024-05-16_to_23.csv").trim().split(/\r?\n/).slice(1).map((l) => {
  const c = l.split(",");
  return { utc: c[2], t: Date.parse(c[2]) / 1000, len: Number(c[3]), e: Number(c[6]) };
});
const at = (hms) => Date.parse(`2024-05-20T${hms}Z`) / 1000;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
// the same rule as the add-on, written again here on the full file
function dose(t0, t1) {
  let sum = 0;
  csv.forEach((r, i) => {
    let end = i + 1 < csv.length ? csv[i + 1].t : r.t + r.len;
    if (end - r.t > 2 * r.len) end = r.t + r.len;
    const lo = Math.max(r.t, t0), hi = Math.min(end, t1);
    if (hi > lo) sum += r.e * (hi - lo) / 3600;
  });
  return sum;
}
const RISE = at("05:21:50");

test("the readings in the add-on are the archive's readings, one for one", () => {
  const want = csv.filter((r) => r.t >= at("05:04:45") && r.t <= at("10:02:58"));
  assert.equal(SR.readings.length, want.length);
  SR.readings.forEach((r, i) => {
    assert.equal(`2024-05-20T${r.utc}Z`, want[i].utc);
    assert.equal(r.len, want[i].len);
    assert.equal(r.e, want[i].e);
  });
});

test("normal level: median of the 85 readings in the 24 h before the rise is 5.54 micrograys per hour", () => {
  const before = csv.filter((r) => r.t >= RISE - 86400 && r.t < RISE);
  assert.equal(before.length, 85);
  assert.equal(median(before.map((r) => r.e)).toFixed(2), "5.54");
  assert.equal(SR.quiet, 5.54);
});

test("no false alarm: none of the 301 readings before the rise passes even 1.25 times normal", () => {
  const before = csv.filter((r) => r.t < RISE);
  assert.equal(before.length, 301);
  assert.equal(before.filter((r) => r.e > 1.25 * SR.quiet).length, 0);
});

test("alarm: the first reading above 1.5 times normal runs 05:21:50 to 05:37:51 UTC", () => {
  const first = csv.find((r) => r.e > SR.alarmX * SR.quiet);
  assert.equal(first.utc, "2024-05-20T05:21:50Z");
  assert.equal(SR.alarm.from, "05:21:50");
  assert.equal(SR.alarm.atUtc, "05:37");
  assert.equal(SR.alarm.e.toFixed(2), "9.97");
});

test("peak: the strongest reading of the whole file starts 06:15:19 UTC at 351.4 micrograys per hour, 63 times normal", () => {
  const top = csv.reduce((a, b) => (b.e > a.e ? b : a));
  assert.equal(top.utc, "2024-05-20T06:15:19Z");
  assert.equal(SR.peak.from, "06:15:19");
  assert.equal(SR.peak.e.toFixed(1), "351.4");
  assert.equal(Math.round(SR.peak.timesQuiet), 63);
});

test("alarm to peak: 37.5 minutes, inside the 28 to 54 minute range we state", () => {
  assert.equal(SR.alarmToPeakMin.toFixed(1), "37.5");
  // stricter alarm (2 times normal), end of that reading to the start of the peak: the low end of the range
  const two = csv.find((r) => r.e > 2 * SR.quiet);
  assert.equal(((at("06:15:19") - (two.t + two.len)) / 60).toFixed(1), "28.4");
  // start of the alarm reading to the start of the peak: the high end
  assert.equal(((at("06:15:19") - RISE) / 60).toFixed(1), "53.5");
});

test("a 42-minute walk home that starts at the alarm takes 172 micrograys; a quiet day gives 3.9", () => {
  const w = SR.walkHome(42);
  assert.equal(Math.round(w.ugy), 172);
  assert.equal(w.quiet_ugy.toFixed(1), "3.9");
  assert.equal(w.cut, false);
  assert.ok(Math.abs(w.ugy - dose(SR.alarm.at + Date.parse("2024-05-20T00:00:00Z") / 1000, SR.alarm.at + Date.parse("2024-05-20T00:00:00Z") / 1000 + 42 * 60)) < 1e-6);
});

test("the add-on's sum equals the same sum on the full file, for every whole minute it covers", () => {
  const day0 = Date.parse("2024-05-20T00:00:00Z") / 1000;
  for (let m = 1; m <= SR.maxMin; m++) {
    const w = SR.walkHome(m);
    assert.ok(Math.abs(w.ugy - dose(day0 + SR.alarm.at, day0 + SR.alarm.at + m * 60)) < 1e-6, `at ${m} min`);
  }
  assert.equal(SR.walkHome(SR.maxMin + 30).cut, true);
});

test("first 24 h of the storm: about 1,750 micrograys in detector E (NASA's news release says 8,100; we do not compute with it)", () => {
  assert.equal(Math.round(dose(RISE, RISE + 86400)), 1752);
});
