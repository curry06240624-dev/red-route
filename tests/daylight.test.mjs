/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
// Tests for docs/extra/daylight.js, the NASA GISS Mars24 method. Run with: node --test tests/
// Reference: NASA GISS, Mars24 Sunclock, "Algorithm and Worked Examples", part II (page updated 2025-01-07):
//   https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
// The page prints every value rounded to a fixed number of decimals. exact() means our value, rounded the same way,
// prints the same digits. Where the page's own numbers do not follow from its own formulas, the test says so and
// checks that we follow the formulas (see "the page's own numbers" below).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(read("../docs/extra/daylight.js"), sandbox, { filename: "docs/extra/daylight.js" });
const M24 = sandbox.Mars24;

const places = (s) => (s.split(".")[1] || "").length;
function exact(got, page, what) {
  assert.equal(got.toFixed(places(page)), page, `${what}: ours ${got}, page ${page}`);
}
// within `units` of the page's last printed digit
function near(got, page, units, what) {
  const unit = 10 ** -places(page), off = Math.abs(got - Number(page)) / unit;
  assert.ok(off <= units + 1e-6, `${what}: ours ${got}, page ${page}: off by ${off.toFixed(2)} in the last digit (allowed ${units})`);
}
// "hh:mm:ss", rounded to the nearest second; the page writes the equation of time with a sign (-00:20:45)
function hms(h) {
  const s = Math.round(Math.abs(h) * 3600);
  return `${h < 0 ? "-" : ""}${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
const mod = (x, n) => ((x % n) + n) % n;

test("GISS worked example 1: 2000-01-06 00:00:00 UTC at 0°W 0°N, every published value", () => {
  const ms = Date.UTC(2000, 0, 6, 0, 0, 0);
  assert.equal(ms, 947116800000, "A-1 millis");
  const r = M24.at(ms, 0, 0);
  exact(r.jdUT, "2451549.5", "A-2 JD_UT");
  exact(r.ttUtc, "64.184", "A-4 TT - UTC (s)");
  exact(r.jdTT, "2451549.50074", "A-5 JD_TT");
  exact(r.dt, "4.50074", "A-6 days since J2000");
  exact(r.M, "21.74558", "B-1 M");
  exact(r.aFMS, "272.74566", "B-2 alpha FMS");
  exact(r.pbs, "0.00142", "B-3 PBS");
  exact(r.nuM, "4.44193", "B-4 nu - M");
  // The three below differ from the page by 1 in the 5th decimal (at most 0.00001°). Our values equal the page's
  // formulas worked in 50-digit arithmetic: Ls 277.1875894, EOT -5.1877459, declination -25.2282436.
  near(r.ls, "277.18758", 1, "B-5 Ls");
  near(r.eot, "-5.18774", 1, "C-1 EOT (deg)");
  exact(r.eot / 15, "-0.34585", "C-1 EOT (h)");
  assert.equal(hms(r.eot / 15), "-00:20:45", "C-1 EOT (h:m:s)");
  exact(24 * r.msd, "1075103.99425", "C-2 24 h x Mars Sol Date, before mod 24");
  exact(r.mtc, "23.99425", "C-2 MST = Coordinated Mars Time (h)");
  assert.equal(hms(r.mtc), "23:59:39", "C-2 MST (h:m:s)");
  exact(r.lmst, "23.99425", "C-3 LMST (h)");
  assert.equal(hms(r.lmst), "23:59:39", "C-3 LMST (h:m:s)");
  exact(r.ltst, "23.64840", "C-4 LTST (h)");
  assert.equal(hms(r.ltst), "23:38:54", "C-4 LTST (h:m:s)");
  exact(r.subLon, "174.72600", "C-5 subsolar longitude");
  near(r.dec, "-25.22825", 1, "D-1 solar declination");
  exact(r.rM, "1.39358", "D-2 heliocentric distance (AU)");
  exact(r.lM, "2.26352", "D-3 heliocentric longitude");
  exact(r.bM, "-1.35957", "D-4 heliocentric latitude");
  // D-5: the page prints 154.26182, but its own formula fed its own declination and subsolar longitude gives 154.26175
  // (see the test of the page's own numbers). Ours is 154.26176: 0.00006° from the page, not used for sunset times.
  near(r.Z, "154.26182", 10, "D-5 zenith angle");
  exact(r.A, "191.03905", "D-6 azimuth");
});

test("GISS worked example 2: Spirit landing, 2004-01-03 13:46:31 UTC at 184.702°W -14.640°N", () => {
  const ms = Date.UTC(2004, 0, 3, 13, 46, 31);
  assert.equal(ms, 1073137591000, "A-1 millis");
  const r = M24.at(ms, 184.702, -14.640);
  exact(r.jdUT, "2453008.07397", "A-2 JD_UT");
  exact(r.ttUtc, "64.184", "A-4 TT - UTC (s)");
  exact(r.jdTT, "2453008.07471", "A-5 JD_TT");
  exact(r.dt, "1463.07471", "A-6 days since J2000");
  exact(r.M, "786.06858", "B-1 M"); exact(mod(r.M, 360), "66.06858", "B-1 M, 0-360");
  exact(r.aFMS, "1037.09457", "B-2 alpha FMS"); exact(mod(r.aFMS, 360), "317.09457", "B-2 alpha FMS, 0-360");
  exact(r.pbs, "0.01614", "B-3 PBS");
  exact(r.nuM, "10.22959", "B-4 nu - M");
  exact(r.lsRaw, "1047.32416", "B-5 Ls"); exact(r.ls, "327.32416", "B-5 Ls, 0-360");
  exact(r.eot, "-12.77553", "C-1 EOT (deg)");
  exact(r.eot / 15, "-0.85170", "C-1 EOT (h)");
  assert.equal(hms(r.eot / 15), "-00:51:06", "C-1 EOT (h:m:s)");
  exact(24 * r.msd, "1109173.16537", "C-2 24 h x Mars Sol Date, before mod 24");
  exact(r.mtc, "13.16537", "C-2 MST (h)");
  assert.equal(hms(r.mtc), "13:09:55", "C-2 MST (h:m:s)");
  exact(r.lmst, "0.85190", "C-3 LMST (h)");
  assert.equal(hms(r.lmst), "00:51:07", "C-3 LMST (h:m:s)");
  // C-4: the page prints 0.00025 h, but its own LMST (0.85190 h) plus its own EOT (-0.85170 h) is 0.00020 h, which is ours.
  // The page's stated expectation is local true midnight, LTST = 00:00:00: ours is 0.7 s after it.
  near(r.ltst, "0.00025", 6, "C-4 LTST (h)");
  assert.ok(Math.min(r.ltst, 24 - r.ltst) * 3600 < 1, `C-4 LTST within 1 s of 00:00:00 (ours ${(r.ltst * 3600).toFixed(2)} s)`);
  exact(r.subLon, "4.70500", "C-5 subsolar longitude");
  // D-1, D-5, D-6: the page's printed values do not follow from its own formulas here (next test). Ours do.
  // Gaps: declination 0.00025°, zenith angle 0.00065°, azimuth 0.00004°; under 0.1 s on a sunset time.
  near(r.dec, "-13.42065", 30, "D-1 solar declination");
  exact(r.rM, "1.47767", "D-2 heliocentric distance (AU)");
  exact(r.lM, "52.37564", "D-3 heliocentric longitude");
  exact(r.bM, "0.08965", "D-4 heliocentric latitude");
  near(r.Z, "151.93895", 70, "D-5 zenith angle");
  near(r.A, "179.99383", 5, "D-6 azimuth");
});

test("the page's own numbers: its D-1 and D-5 values do not follow from its own inputs; ours follow the formulas", () => {
  // Example 1. D-1 fed the page's Ls gives -25.22824 (page prints -25.22825).
  exact(M24.declination(277.18758), "-25.22824", "D-1 from the page's Ls (ex. 1)");
  // D-5 fed the page's declination and subsolar longitude gives 154.26175 (page prints 154.26182); ours is 154.26176.
  exact(M24.zenith(-25.22825, 0, 0 - 174.72600), "154.26175", "D-5 from the page's inputs (ex. 1)");
  // Example 2. D-1 fed the page's Ls gives -13.42040 (page prints -13.42065); ours is -13.42040.
  exact(M24.declination(327.32416), "-13.42040", "D-1 from the page's Ls (ex. 2)");
  exact(M24.at(Date.UTC(2004, 0, 3, 13, 46, 31), 184.702, -14.640).dec, "-13.42040", "our D-1 (ex. 2)");
  // D-5 fed the page's own declination and subsolar longitude gives 151.93935, not the 151.93895 it prints.
  exact(M24.zenith(-13.42065, -14.640, 184.702 - 4.70500), "151.93935", "D-5 from the page's inputs (ex. 2)");
});

test("planetographic latitude for D-5 (NASA Mars Fact Sheet radii, 3396.2 and 3376.2 km)", () => {
  assert.equal(M24.planetographic(0), 0);
  assert.ok(Math.abs(M24.planetographic(90) - 90) < 1e-9);
  // base camp: planetocentric 18.468622° N on the map is 18.6729° N planetographic
  exact(M24.planetographic(18.468622), "18.6729", "base camp latitude");
});

test("a Mars hour is 1/24 of a sol of 88,775.244 s; the plan's T+ minutes are SI minutes", () => {
  assert.equal(M24.SOL_S, 88775.244);
  exact(M24.MARS_HOUR_MS / 1000, "3698.9685", "one Mars hour in SI seconds");
  exact(M24.siToMarsMin(60), "58.3947", "60 SI minutes in Mars minutes");
  assert.ok(Math.abs(M24.marsToSiMin(M24.siToMarsMin(173)) - 173) < 1e-9);
  // the mean-rate conversion against the full true-solar-time calculation, through a Mars year, over the 216-min budget
  let worstS = 0;
  for (let k = 0; k < 140; k++) {
    const date = new Date(Date.UTC(2026, 0, 1) + k * 5 * 864e5).toISOString().slice(0, 10);
    const d = M24.walkDay({ date, startH: 9, lonE: 77.399878, latC: 18.468622, backMin: 0, stops: [] });
    for (let min = 0; min <= 216; min += 6) {
      const full = M24.at(d.startMs + min * 60000, d.lonW).ltst, mean = 9 + M24.siToMarsMin(min) / 60;
      worstS = Math.max(worstS, Math.abs(full - mean) * 3600);
    }
  }
  assert.ok(worstS < 10, `mean-rate clock within 10 s of true solar time (worst ${worstS.toFixed(1)} s)`);
});

test("sunset is the moment the Sun's centre is on a flat horizon (D-5 gives 90°)", () => {
  for (const date of ["2024-04-27", "2026-11-15", "2027-06-01", "2028-01-15"]) {
    const d = M24.walkDay({ date, startH: 9, lonE: 77.399878, latC: 18.468622, backMin: 172.8, stops: [] });
    const r = M24.at(d.sunsetMs, d.lonW, d.lat);
    assert.ok(Math.abs(r.Z - 90) < 1e-6, `${date}: zenith angle at sunset ${r.Z}`);
    assert.ok(Math.abs(r.ltst - d.sunset) * 3600 < 0.5, `${date}: clock at that moment ${r.ltst} vs ${d.sunset}`);
    assert.ok(d.sunrise < 12 && d.sunset > 12 && d.sunrise < d.startH);
  }
});

test("Perseverance MEDA sols 1130-1133 (docs/data/meda.json): Ls, sunset and sunrise", () => {
  // MEDA lists times on the Mars 2020 mission clock: local MEAN solar time for 77.43° E, sol 0 = landing sol
  // (GISS technical notes, https://www.giss.nasa.gov/tools/mars24/help/notes.html). Landing was at about 15:53 mean
  // time on local Mars Sol Date 52304, so sol N runs from local MSD 52304 + N to 52305 + N at 77.43° E.
  const meda = JSON.parse(read("../docs/data/meda.json"));
  const trav = JSON.parse(read("../docs/data/m20_traverse.json"));
  const MISSION_E = 77.43, SOL0 = 52304;
  const msdToMs = (msd) => {   // C-2 run backwards; TT - UTC is 69.184 s in 2024
    const jdTT = (msd - 44796.0 + 0.0009626) * 1.0274912517 + 2451549.5;
    return (jdTT - 69.184 / 86400 - 2440587.5) * 8.64e7;
  };
  const clockS = (h) => mod(h, 24) * 3600, readS = (t) => t.split(":").reduce((a, v) => a * 60 + Number(v), 0);
  for (const w of meda.sols) {
    const sol = Number(w.sol);
    // where the rover was: the end of its last drive on or before that sol
    let pos = null;
    for (const f of trav.features) if (f.properties.sol <= sol) pos = f.geometry.coordinates[f.geometry.coordinates.length - 1];
    const lonW = 360 - pos[0], lat = M24.planetographic(pos[1]);
    const solStart = msdToMs(SOL0 + sol - MISSION_E / 360);
    assert.ok(Math.abs(M24.at(solStart).ls - Number(w.ls)) < 0.01, `sol ${sol}: Ls at the start of the sol ${M24.at(solStart).ls} vs MEDA ${w.ls}`);
    const noon = M24.momentAtLtst(12, msdToMs(SOL0 + sol + 0.5 - MISSION_E / 360), lonW);
    const set = M24.sunEvent(noon, lonW, lat, +1), rise = M24.sunEvent(noon, lonW, lat, -1);
    const missionClock = (ms) => M24.at(ms).mtc + MISSION_E / 15;
    const dSet = clockS(missionClock(set.ms)) - readS(w.sunset), dRise = clockS(missionClock(rise.ms)) - readS(w.sunrise);
    // sunset agrees within 10 s on all four sols. MEDA's sunrise is about 1 min earlier than a flat-horizon sunrise
    // on all four (its rule is not stated in the data), so sunrise is held to 75 s.
    assert.ok(Math.abs(dSet) <= 10, `sol ${sol}: sunset ${dSet.toFixed(0)} s from MEDA ${w.sunset}`);
    assert.ok(Math.abs(dRise) <= 75, `sol ${sol}: sunrise ${dRise.toFixed(0)} s from MEDA ${w.sunrise}`);
    // our block shows true solar time; MEDA mean solar time. The gap is the equation of time (about 14 min here).
    assert.ok(Math.abs((set.ltst - missionClock(set.ms)) * 60 - M24.at(set.ms).eot * 4 - (pos[0] - MISSION_E) * 4) < 0.01);
  }
});

test("default plan: with a 09:00 start daylight is not the limit, and never is for any start in the menu, in any season", () => {
  const m = JSON.parse(read("../docs/data/mission.json")), tl = m.timeline;
  const base = m.stops.find((s) => s.id === m.order[0]);
  const leaveBy = (t) => Math.min(t.leave_by_min, t.bad_leave_by_min);   // the app's leaveBy()
  const stops = m.order.map((id, i) => [id, i]).filter(([, i]) => i > 0 && i < m.order.length - 1)
    .map(([id, i]) => ({ id, name: id, leaveByMin: leaveBy(tl[i]), homeMin: tl[i].back_min }));
  const day = (date, startH) => M24.walkDay({ date, startH, lonE: base.lon, latC: base.lat, backMin: tl[tl.length - 1].arrive_min, stops });
  // the plan the app shows today: T+2:52.8 back at base, leave-by T+2:11 and T+2:37
  assert.deepEqual(stops.map((s) => [s.id, s.leaveByMin, s.homeMin]), [["depot", 131.3, 42.4], ["gap", 157.3, 29.3]]);
  const d = day("2026-11-15", 9), ct = M24.clockText;
  assert.equal(d.ls.toFixed(1), "22.4");
  assert.equal(ct(d.back, true), "11:49");   // 172.8 SI min = 168.2 Mars min after 09:00
  assert.equal(ct(d.sunset), "18:12");
  assert.equal(Math.floor(d.spareMin), 395);  // 6 h 35 min of daylight to spare (SI)
  assert.deepEqual(d.stops.map((s) => [s.id, ct(s.oxygen), ct(s.daylight), s.first]),
    [["depot", "11:07", "17:31", "oxygen"], ["gap", "11:33", "17:44", "oxygen"]]);
  for (let k = 0; k < 140; k++) {   // every 5 days for 700 days (a Mars year is 687 days), every start time offered
    const date = new Date(Date.UTC(2026, 0, 1) + k * 5 * 864e5).toISOString().slice(0, 10);
    for (let h = 7; h <= 13; h += 0.5) {
      const x = day(date, h);
      assert.ok(x.spareMin > 60 && !x.beforeSunrise && x.stops.every((s) => s.first === "oxygen"), `${date} start ${h}`);
    }
  }
});
