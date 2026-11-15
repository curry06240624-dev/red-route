/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// No part of the planned walk is steeper than the 15 degree no-go limit, and the climb test numbers in mission.json.
// The slope layer docs/data/slope.png is painted red (220, 38, 38, alpha 165) exactly where the 2 m slope grid is
// over the limit, so it is an independent way to check the stored 2 m route (docs/data/route.geojson).
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers.js");

const m = H.mission();
const LIMIT = m.assumptions.max_slope_deg;
const png = H.readPngRGBA("slope.png");
const [[lat0, lon0], [lat1, lon1]] = m.overlay_bounds;
function isRed(lon, lat) {
  const x = Math.floor(((lon - lon0) / (lon1 - lon0)) * png.width), y = Math.floor(((lat1 - lat) / (lat1 - lat0)) * png.height);
  assert.ok(x >= 0 && x < png.width && y >= 0 && y < png.height, `point ${lon}, ${lat} is outside the slope layer`);
  const i = (y * png.width + x) * 4, p = png.px;
  return p[i] === 220 && p[i + 1] === 38 && p[i + 2] === 38 && p[i + 3] === 165;
}
// metres on the ground per degree (Mars sphere radius used by tools/build_layers.py, at the middle of the area)
const R = 3396190, latMid = ((m.aoi.lat0 + m.aoi.lat1) / 2) * (Math.PI / 180);
const kx = R * Math.cos(latMid) * (Math.PI / 180), ky = R * (Math.PI / 180);

test.describe("15 degree slope limit", () => {
  test("the no-go limit is 15 degrees", () => assert.equal(LIMIT, 15));

  test("stored walk: no point of the 975-point profile is steeper than 15 deg (steepest 14.8)", () => {
    const steep = m.profile.filter((q) => q.s > LIMIT);
    assert.equal(steep.length, 0, `points over ${LIMIT} deg: ${JSON.stringify(steep.slice(0, 5))}`);
    assert.equal(Math.max(...m.profile.map((q) => q.s)), 14.8);
    for (const l of m.legs) assert.ok(l.max_slope <= LIMIT, `leg ${l.frm} -> ${l.to}: ${l.max_slope} deg`);
  });

  test("the slope layer reader works: slope.png has the 2 m grid size and some red (over 15 deg) ground", () => {
    assert.ok(png.width > 2000 && png.height > 1000, `${png.width} x ${png.height}`);
    let red = 0;
    for (let i = 0; i < png.px.length; i += 4) if (png.px[i] === 220 && png.px[i + 1] === 38 && png.px[i + 2] === 38 && png.px[i + 3] === 165) red++;
    assert.ok(red > 1000, `red pixels: ${red}`);
  });

  test("stored 2 m route (route.geojson): none of its points is on ground the slope layer marks as over 15 deg", () => {
    const route = H.readJSON("route.geojson");
    assert.equal(route.features.length, 3, "three legs");
    let n = 0;
    for (const f of route.features) for (const [lon, lat] of f.geometry.coordinates) { n++; assert.ok(!isRed(lon, lat), `steep point on leg ${f.properties.leg}: ${lon}, ${lat}`); }
    assert.equal(n, 975);
  });
});

test.describe("climb test, Perseverance's climb to the delta top (sols 693-736)", () => {
  const v = m.validation, st = v.steep;

  test("stored numbers: ours 0 m, straight line 154 m, rover 28 m over 15 deg", () => {
    assert.deepEqual(v.sols, [693, 736]);
    assert.equal(st.limit_deg, 15);
    assert.deepEqual([st.ours.len_m, st.ours.steep_m], [1799, 0]);
    assert.deepEqual([st.line.len_m, st.line.steep_m, Math.round(st.line.max_deg)], [1693, 154, 32]);
    assert.deepEqual([st.rover.len_m, st.rover.steep_m, Math.round(st.rover.max_deg)], [2805, 28, 21]);
    assert.ok(st.ours.max_deg <= 15, `ours max ${st.ours.max_deg}`);
  });

  test("our planned climb (validation path): none of its points is on ground the slope layer marks as over 15 deg", () => {
    assert.ok(v.ours.length > 100);
    for (const [lon, lat] of v.ours) assert.ok(!isRed(lon, lat), `steep point on our climb: ${lon}, ${lat}`);
    // control: the same check does find steep points on the rover's real path (28 m over 15 deg)
    assert.ok(v.rover.filter(([lon, lat]) => isRed(lon, lat)).length > 0, "no steep point found on the rover's path");
  });

  test("straight line, re-measured on the slope layer every 1 m: about 154 m over 15 deg (within 10 m: its ends are the grid cells next to the rover's waypoints)", () => {
    const [a, b] = [v.ours[0], v.ours[v.ours.length - 1]];
    const len = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
    const n = Math.max(1, Math.floor(len));
    let steep = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (isRed(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))) steep += len / n;
    }
    H.near(len, st.line.len_m, 10, "straight-line length");
    H.near(steep, st.line.steep_m, 10, "metres over 15 deg on the straight line");
  });
});
