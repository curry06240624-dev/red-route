/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// Shared helpers for the tests (not a test file itself): file paths, the check rules as small pure functions,
// the app's time formats, the browser route engine (docs/router.js) run inside Node, and a small PNG reader.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const DATA = path.join(DOCS, "data");

const readJSON = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
const mission = () => readJSON("mission.json");

/* ---------- the rules (the same formulas as plan() in docs/router.js and getChecks() in docs/app.js) ---------- */
const round1 = (x) => Math.round(x * 10) / 10;
// time for walking and stops: suit limit x (1 - reserve) - airlock time. T+0 is the first step outside.
const timeBudget = (evaH, reserve, airlockMin) => evaH * 60 * (1 - reserve) - airlockMin;
// The engine rounds every margin to 0.1 min; the app shows PASS when the rounded margin is >= 0.
const planFitsMargin = (t, back, budget) => round1(budget - (t + back));
const badDayMargin = (t, back, budget, factor = 2) => round1(budget - (t + factor * back));
const passes = (margin) => margin >= 0;
// suit failure: the walk home must fit the backup oxygen (50 min)
const suitOk = (back, limitMin = 50) => back <= limitMin;
// "Leave by": the latest time to turn for home that keeps both time checks green (leaveBy in docs/app.js)
const leaveBy = (budget, back, factor = 2) => Math.min(budget - back, budget - factor * back);

/* ---------- the app's time formats (copied from docs/app.js) ---------- */
const hm = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
const fmtMin = (m) => { m = Math.round(Math.abs(m)); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };

/* ---------- comparing numbers ---------- */
function near(actual, expected, tol, what) {
  assert.ok(Number.isFinite(actual), `${what}: got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tol + 1e-9, `${what}: got ${actual}, expected ${expected} ± ${tol}`);
}
const within = (actual, expected, frac, what) => near(actual, expected, Math.abs(expected) * frac, what);

/* ---------- the browser route engine (docs/router.js is a web-worker script), run in Node ---------- */
function arrayBufferOf(name) {
  const b = fs.readFileSync(path.join(DATA, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);   // a fresh ArrayBuffer, like fetch().arrayBuffer()
}

// Loads docs/router.js in its own context with a fake worker "self" and sends it the same "init" message as
// initWorker() in docs/app.js. send(msg) delivers one message and returns the worker's reply.
function loadRouter(m) {
  const replies = [];
  // a browser copies every worker message (structured clone); this also turns the worker's objects into plain ones here
  const self = { postMessage: (msg) => replies.push(structuredClone(msg)) };
  const code = fs.readFileSync(path.join(DOCS, "router.js"), "utf8");
  vm.runInContext(code, vm.createContext({ self, performance: globalThis.performance }), { filename: "router.js" });
  const send = (data) => {
    replies.length = 0;
    self.onmessage({ data });
    assert.equal(replies.length, 1, `the worker should answer "${data.type}" with one message`);
    return replies[0];
  };
  const ready = send({ type: "init", grid: m.grid, slope: arrayBufferOf("grid_slope.u8"), rough: arrayBufferOf("grid_rough.u8"),
    dem: arrayBufferOf("grid_dem.i16") });
  return { ready, send };
}

// params() in docs/app.js with every slider at its starting value (the "assumptions" block of mission.json)
function appParams(m, change = {}) {
  const a = m.assumptions;
  return Object.assign({ maxSlope: a.max_slope_deg, vFlat: a.v_flat_ms, roughPenalty: a.rough_penalty, roughM: a.rough_m,
    evaH: a.eva_limit_h, reserve: Math.round(a.reserve * 100) / 100, airlockMin: a.airlock_min || 0,
    badFactor: a.bad_day_factor || 2, suitMin: a.suit_fail_min || 50 }, change);
}

const DEFAULT_ORDER = ["base", "depot", "gap", "top", "base"];   // docs/app.js

// The "plan" message replan() in docs/app.js sends when the stops in `ticked` are ticked on.
function planMessage(m, ticked, change = {}, id = 1) {
  return { type: "plan", id, params: appParams(m, change), order: DEFAULT_ORDER.filter((s) => s === "base" || ticked.includes(s)),
    stops: m.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dwell_min: s.dwell_min })) };
}

/* ---------- a small PNG reader (8-bit RGBA, not interlaced), for the slope layer docs/data/slope.png ---------- */
function readPngRGBA(name) {
  const buf = fs.readFileSync(path.join(DATA, name));
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${name} is not a PNG`);
  let pos = 8, width = 0, height = 0, ok = false;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); ok = data[8] === 8 && data[9] === 6 && data[12] === 0; }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  assert.ok(ok, `${name}: this reader only handles 8-bit RGBA PNGs without interlacing`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[up + x] : 0, c = x >= bpp && y ? px[up + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { width, height, px };
}

module.exports = {
  ROOT, DATA, readJSON, mission, round1, timeBudget, planFitsMargin, badDayMargin, passes, suitOk, leaveBy, hm, fmtMin,
  near, within, loadRouter, appParams, planMessage, DEFAULT_ORDER, readPngRGBA,
};
