/* Red Route 3D walk: a free walk on the Marswalk plan, with the app's get-home numbers in the helmet display.
   Two ways to move:
     "plan"  the crew is where the plan puts it at mission time T (same clock maths as the main app), so every number equals the app's;
     "free"  you walk anywhere. On the planned route the walk-home time is the plan's own; off the route it is read from the
             walk-home layer with the app's "What if here?" method. The clock runs only while you walk or work at a stop.
   Walking speed is the planner's: v_flat x exp(-3.5 tan slope), slower on rough ground (see router.js).
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";
import * as P from "./plan.js?v=14";
import { Ground, buildTerrain, buildFar, buildSky, buildLights, RouteLine, StopMarkers, buildHabitat, SKY_HORIZON, SUN_DIR } from "./world.js?v=14";
import { Astronaut, loadAstronautModel } from "./crew.js?v=14";
import { makeFx } from "./fx.js?v=14";
import { Rocks, Footprints, Dust } from "./props.js?v=14";
import { Sound } from "./sound.js?v=14";

const $ = (s) => document.querySelector(s);
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DEG = Math.PI / 180;
const ARRIVE_M = 15, LEAVE_M = 25, ON_ROUTE_M = 15;
const DWELL_RATE = 600;          // while the crew works at a stop, the clock runs this many times faster than real time
const SPEEDS = [1, 6, 10, 30, 60];
const DEFAULT_ORDER = ["base", "depot", "gap", "top", "base"];
const Q = new URLSearchParams(location.search);
const TOUCH = window.matchMedia("(pointer: coarse)").matches || Q.get("touch") === "1";

const S = {
  m: null, base: null, route: null, baseRoute: null, field: null, legEnd: [],
  mode: "free", playing: false, T: 0, speed: 30, view: "first",
  yaw: 0, pitch: -4, lookOff: 0, heading: 0,
  pos: { x: 0, z: 0 }, moving: 0,
  free: null, nav: null, drill: null, started: false, tenby: false, lastDrag: 0,
};
const freshFree = () => ({ leg: 0, hereIdx: -1, worked: {}, working: null, home: false, homeT: null });
let G, renderer, scene, camera, sky, lights, terrain, routeLine, markers, ev1, ev2, fx = null, worker = null, planId = 0, workerReady = false;
let rocks = null, prints = null, dust = null;
const sound = new Sound();
const HI_BOX = { c0: 373, c1: 577, r0: 129, r1: 444 };   // grid cells covered by the sharper picture along the route
const labels = [];

// heavy one-off work (a picture arrived, the plan was re-made): do not judge the device's speed for a while
const busy = (ms = 5000) => { S.quietUntil = Math.max(S.quietUntil || 0, performance.now() + ms); S.slow = 0; };

/* ---------- loading ---------- */
function prog(pct, msg) { $("#lBar").style.width = `${pct}%`; if (msg) $("#lMsg").textContent = msg; }
const getData = (f) => fetch(`../data/${f}`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r; });

async function boot() {
  prog(8, "Loading the plan…");
  const [mission, routeGj] = await Promise.all([getData("mission.json").then((r) => r.json()), getData("route.geojson").then((r) => r.json())]);
  prog(30, "Loading the terrain…");
  const [demB, slopeB, roughB] = await Promise.all(["grid_dem.i16", "grid_slope.u8", "grid_rough.u8"].map((f) => getData(f).then((r) => r.arrayBuffer())));
  S.m = mission; S.base = clone(mission);
  S.route = S.baseRoute = P.makeRoute(routeGj.features.map((f) => f.geometry.coordinates));
  setLegEnds();
  G = new Ground(mission.grid, new Int16Array(demB), new Uint8Array(slopeB), new Uint8Array(roughB));
  prog(55, "Building the ground…");
  await new Promise((r) => setTimeout(r, 30));
  initScene();
  prog(80, "Working out the way home…");
  initWorker(mission, slopeB.slice(0), roughB.slice(0), demB.slice(0));
  initHud();
  resetToStart();
  requestAnimationFrame(frame);
  prog(100, "Ready");
  $("#lStart").hidden = false;
  loadAstronautModel("assets/astronaut.glb?v=4").then((model) => {
    ev1.useModel(model); ev2.useModel(model); busy();
    $("#aiLabel").hidden = false; S.aiModel = true;
  }).catch((e) => { console.warn("The AI astronaut model did not load; using the code-made figure.", e); });
  const auto = Q.get("auto");
  if (auto) start(auto === "plan" ? "plan" : "free");
}

function setLegEnds() { S.legEnd = []; for (const p of S.m.profile) S.legEnd[p.leg] = p.d; }

/* ---------- scene ---------- */
function initScene() {
  const canvas = $("#view");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TOUCH ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY_HORIZON.getHex(), 0.00021);
  camera = new THREE.PerspectiveCamera(62, 1, 0.45, 32000);
  camera.rotation.order = "YXZ";
  sky = buildSky(scene);
  lights = buildLights(scene);
  const sh = lights.sun.shadow;
  lights.sun.castShadow = true; sh.mapSize.set(2048, 2048); sh.camera.near = 1; sh.camera.far = 160;
  sh.camera.left = -26; sh.camera.right = 26; sh.camera.top = 26; sh.camera.bottom = -26; sh.bias = -0.0006; sh.normalBias = 0.06;
  terrain = buildTerrain(scene, G, S.m.assumptions.max_slope_deg, 1);
  terrain.loadOrtho("assets/jezero_hirise_ortho.jpg?v=1", Math.min(TOUCH ? 2048 : 4096, renderer.capabilities.maxTextureSize))
    .then(() => { S.ortho = true; busy(); }).catch((e) => console.warn("The HiRISE ground picture did not load; using colours drawn by code.", e));
  routeLine = new RouteLine(scene, G);
  routeLine.set(S.route);
  markers = new StopMarkers(scene, G);
  const b = P.stopById(S.m, "base");
  buildHabitat(scene, G, b.lat, b.lon);
  ev1 = new Astronaut(scene, 0xff6a3d); ev2 = new Astronaut(scene, 0x38bdf8);
  rocks = new Rocks(scene, G, TOUCH); prints = new Footprints(scene, G); dust = new Dust(scene);
  clearPath();
  terrain.loadHi("assets/jezero_hirise_corridor.jpg?v=1", [HI_BOX.c0 / G.W, 1 - HI_BOX.r1 / G.H, HI_BOX.c1 / G.W, 1 - HI_BOX.r0 / G.H],
    TOUCH ? 1280 : 2560, renderer.capabilities.maxTextureSize).then(() => { S.hi = true; busy(); })
    .catch((e) => console.warn("The sharper ground picture along the route did not load.", e));
  terrain.loadLayers("assets/jezero_sun_shadow.png?v=1", "assets/jezero_relief_1m.jpg?v=1");
  // the far ground and the crater rim (CTX), drawn around the walk's own HiRISE ground
  const image = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(url)); im.src = url; });
  Promise.all([fetch("assets/jezero_far.json?v=1").then((r) => r.json()), fetch("assets/jezero_far_dem.i16?v=1").then((r) => r.arrayBuffer()), image("assets/jezero_ctx_far.jpg?v=1")])
    .then(([meta, buf, img]) => { S.far = buildFar(scene, G, meta, new Int16Array(buf), img, TOUCH ? 1024 : 2048); busy(); })
    .catch((e) => console.warn("The far ground did not load; the horizon stays flat.", e));
  refreshStops();
  // the film look needs a high-range drawing surface; without one the picture is drawn directly
  const hdrOk = renderer.capabilities.isWebGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
  if (Q.get("fx") !== "0" && hdrOk) { try { fx = makeFx(renderer, scene, camera); } catch (e) { console.warn("No film look on this device.", e); fx = null; } }
  resize();
  window.addEventListener("resize", resize);
}
// rocks keep off the planned path, the stops and the habitat
function clearPath() {
  const b = P.stopById(S.m, "base"), keep = S.m.stops.map((st) => ({ x: G.xOf(st.lon), z: G.zOf(st.lat), r: 6.5 }));
  keep.push({ x: G.xOf(b.lon) + 9, z: G.zOf(b.lat) - 7, r: 9 });
  rocks.setRoute(S.route, keep);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (fx) fx.setSize(w, h, renderer.getPixelRatio());
  camera.aspect = w / h; camera.updateProjectionMatrix();
  routeLine.setResolution(w, h);
}

/* ---------- stops and their labels ---------- */
function refreshStops() {
  const m = S.m, tl = m.timeline || [];
  const list = m.stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, optional: !m.order.includes(s.id), color: s.id === "base" ? 0x38bdf8 : m.order.includes(s.id) ? 0xff6a3d : 0x8a8f96 }));
  markers.set(list);
  for (const l of labels.splice(0)) l.el.remove();
  for (const it of markers.items) {
    const s = P.stopById(m, it.id), i = m.order.indexOf(it.id), el = document.createElement("div");
    el.className = `slabel${it.id === "base" ? " base" : i < 0 ? " opt" : ""}`;
    const sub = it.id === "base" ? `Be home by T+${P.hm(m.walkback.budget_min)}` : i < 0 ? "Optional stop, not in this plan" : `Leave by T+${P.hm(P.leaveBy(tl[i]))}`;
    el.innerHTML = `${it.id === "base" ? "" : i >= 0 ? `${i + 1} · ` : ""}${esc(P.shortName(s))}<small>${sub}</small>`;
    $("#labels").appendChild(el);
    labels.push({ el, v: it.top, kind: "stop", shown: false });
  }
  for (const [a, txt, cls] of [[ev1, "EV1 · you", "crew"], [ev2, "EV2", "crew ev2"]]) {
    const el = document.createElement("div"); el.className = `slabel ${cls}`; el.textContent = txt;
    $("#labels").appendChild(el);
    labels.push({ el, v: new THREE.Vector3(), kind: "crew", who: a, shown: false });
  }
}
const _v = new THREE.Vector3();
function placeLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labels) {
    let show = true;
    if (l.kind === "crew") {
      l.v.set(l.who.x, l.who.root.position.y + 2.12, l.who.z);
      if (l.who === ev1 && S.view === "first") show = false;
      if (camera.position.distanceTo(l.v) > 45) show = false;
    }
    _v.copy(l.v).project(camera);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.15 || Math.abs(_v.y) > 1.2) show = false;
    if (l.kind === "stop" && S.view !== "cine" && (w > h ? Math.abs(_v.x) > 0.42 : _v.y > 0.12)) show = false;   // the helmet display's columns are there
    if (show !== l.shown) { l.el.style.display = show ? "" : "none"; l.shown = show; }
    if (show) l.el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-_v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

/* ---------- the walk-home layer and re-planning: the app's own router.js, as a web worker ---------- */
function params() {
  const a = S.base.assumptions;
  return { maxSlope: a.max_slope_deg, vFlat: a.v_flat_ms, roughPenalty: a.rough_penalty, roughM: a.rough_m, evaH: a.eva_limit_h, reserve: a.reserve,
    airlockMin: a.airlock_min || 0, badFactor: a.bad_day_factor || 2, suitMin: a.suit_fail_min || 50 };
}
function initWorker(m, slope, rough, dem) {
  if (!window.Worker) return;
  try {
    worker = new Worker("../router.js?v=8");
    worker.onmessage = onWorker;
    worker.postMessage({ type: "init", grid: m.grid, slope, rough, dem }, [slope, rough, dem]);
  } catch (e) { console.warn("No route worker", e); worker = null; }
}
function onWorker(e) {
  const r = e.data;
  if (r.type === "ready") {
    workerReady = true;
    worker.postMessage({ type: "field", id: ++planId, params: params(), stops: S.m.stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })) });
    $("#oTenby").disabled = false;
    if (Q.get("tenby") === "1") { $("#oTenby").checked = true; setTenby(true); }
    return;
  }
  if (r.type === "field") { S.field = r.field; S.baseField = r.field; return; }
  if (r.type !== "plan" || r.id !== planId) return;
  if (r.error) { toast(`${r.error}. Showing the last plan that worked.`); $("#oTenby").checked = false; $("#oTenbyNote").textContent = ""; return; }
  const m = clone(S.base);
  m.order = [...new Set(r.legs.map((l) => l.frm))].concat(["base"]);
  m.legs = r.legs.map(({ coords, ...l }) => l);
  m.totals = r.totals; m.walkback = r.walkback; m.profile = r.profile; m.timeline = r.timeline;
  for (const s of m.stops) { const c = r.stopCells[s.id]; if (c) { s.lon = c.lonlat[0]; s.lat = c.lonlat[1]; s.elev_m = c.z; } }
  S.m = m; S.route = P.makeRoute(r.legs.map((l) => l.coords)); S.field = r.field; S.tenby = true;
  $("#oTenbyNote").textContent = `· re-planned in the browser (${(r.ms / 1000).toFixed(1)} s, ${m.grid.gx.toFixed(1)} m grid)`;
  planChanged();
}
function setTenby(on) {
  if (!on) {
    S.m = clone(S.base); S.route = S.baseRoute; S.field = S.baseField; S.tenby = false; $("#oTenbyNote").textContent = "";
    planChanged(); return;
  }
  if (!worker || !workerReady) { $("#oTenby").checked = false; toast("Still loading the terrain for re-planning. Try again in a moment."); return; }
  $("#oTenbyNote").textContent = "· re-planning…";
  worker.postMessage({ type: "plan", id: ++planId, params: params(), order: DEFAULT_ORDER,
    stops: S.base.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dwell_min: s.dwell_min })) });
}
function planChanged() {
  setLegEnds(); routeLine.set(S.route); refreshStops(); closeDrill(); buildMini(); clearPath(); busy();
  const wasPlan = S.mode === "plan";
  resetToStart(); if (wasPlan) S.mode = "plan";
  renderMenu(); S.hudKey = "";
}

/* ---------- state changes ---------- */
function resetToStart() {
  const b = P.stopById(S.m, "base");
  S.T = 0; S.playing = false; S.free = freshFree(); S.ev2init = false; if (prints) prints.clear();
  S.pos.x = G.xOf(b.lon); S.pos.z = G.zOf(b.lat);
  const ahead = P.pointAtDistance(S.route, 12);
  S.heading = P.bearing([b.lat, b.lon], ahead); S.yaw = S.heading; S.lookOff = 0; S.pitch = -4;
}
function start(mode, flyIn = false) {
  S.started = true; busy(9000);
  sound.start();
  $("#loader").classList.add("done"); document.body.classList.remove("loading");
  $("#hud").hidden = false;
  if (TOUCH) document.body.classList.add("touch");
  if (Q.get("view") === "third") setView("third");
  if (Q.get("speed")) S.speed = +Q.get("speed") || 30;
  const hint = mode === "plan" ? "Following the plan. Walk any time to take over." : TOUCH ? "Use the stick to walk. Drag to look around." : "W A S D to walk. Drag the mouse to look around.";
  if (mode === "plan") { S.mode = "plan"; S.playing = true; } else S.mode = "free";
  setTimeout(() => toast(hint, 5500), flyIn ? 6800 : 0);   // after the fly-in, so it does not sit on the title
  if (Q.get("t") != null) jump(parseFloat(Q.get("t")), Q.get("play") === "1");
  if (Q.get("menu") === "1") toggleMenu(true);
  if (flyIn || Q.get("intro") === "1") { startIntro(); S.introFrom = camFrom.clone(); }
  if (Q.get("drill")) setTimeout(() => openDrill(Q.get("drill")), 400);
  syncButtons();
}
function jump(T, play = false) {
  closeDrill();
  S.mode = "plan"; S.T = Math.max(0, T); S.playing = play; S.lookOff = 0; S.free = freshFree(); S.ev2init = false; if (prints) prints.clear();
  const n = P.navOnPlan(S.m, S.route, S.T);
  S.pos.x = G.xOf(n.pos[1]); S.pos.z = G.zOf(n.pos[0]);
  S.heading = planHeading(n, S.heading, true); S.yaw = S.heading;
  syncButtons(); S.hudKey = "";
}
// take over by hand from wherever the plan has the crew
function enterFree() {
  if (S.mode === "free") return;
  const n = P.navOnPlan(S.m, S.route, S.T), F = freshFree(), tl = S.m.timeline || [];
  F.leg = Math.min(n.leg, S.m.order.length - 2);
  for (let i = 1; i <= F.leg; i++) F.worked[S.m.order[i]] = true;
  if (n.here) { F.hereIdx = n.hereIdx; F.worked[n.here.id] = S.T >= tl[n.hereIdx].depart_min - 0.05; }
  if (n.after) { F.home = true; F.homeT = S.m.profile[S.m.profile.length - 1].t; }
  S.free = F; S.mode = "free"; S.playing = false; S.yaw = S.heading + S.lookOff; S.lookOff = 0;
  syncButtons(); S.hudKey = "";
}
const VIEWS = ["first", "third", "cine"], VIEW_NAME = { first: "First person", third: "Third person", cine: "Cinema camera" };
function setView(v) {
  const was = S.view;
  S.view = v;
  document.body.classList.toggle("first", v === "first");
  document.body.classList.toggle("cine", v === "cine");
  $("#bView").textContent = VIEW_NAME[VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length]];
  if (v === "third" && S.pitch > -6) S.pitch = -12;
  if (v === "first" && S.pitch < -8) S.pitch = -4;
  if (v === "cine") {   // a film needs a calmer pace: slow the time speed while the cinema camera runs
    S.cine = { i: 0, t: 0, fixed: null };
    if (was !== "cine") { S.speedBefore = S.speed; S.speed = 6; }
  } else if (was === "cine" && S.speedBefore) { S.speed = S.speedBefore; S.speedBefore = 0; }
  S.camSnap = true;
  syncButtons();
}
function syncButtons() {
  const on = S.mode === "plan" && S.playing;
  $("#bPlan").innerHTML = `<span class="${on ? "sq" : "tri"}"></span><span>${on ? "Pause the plan" : S.mode === "plan" && S.T > 0 ? "Go on with the plan" : "Follow the plan"}</span>`;
  $("#bPlan").classList.toggle("on", on);
  $("#bSpeed").textContent = `× ${S.speed}`;
}
let toastTimer = 0;
function toast(msg, ms = 5000) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }

/* ---------- input ---------- */
const keys = new Set(), stick = { x: 0, y: 0, id: null };
function initInput() {
  const MOVE = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if (!S.started || e.ctrlKey || e.metaKey || e.altKey) return;
    if (S.intro) S.intro.t = Math.max(S.intro.t, S.intro.dur - 0.8);
    sound.start();
    if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); }
    else if (e.code === "KeyV") setView(VIEWS[(VIEWS.indexOf(S.view) + 1) % VIEWS.length]);
    else if (e.code === "KeyC") setView(S.view === "cine" ? "third" : "cine");
    else if (e.code === "Space") { e.preventDefault(); $("#bPlan").click(); }
    else if (e.code === "Escape") { closeDrill(); toggleMenu(false); }
    else if (/^Digit[1-5]$/.test(e.code)) { S.speed = SPEEDS[+e.code.slice(5) - 1]; S.speedBefore = 0; syncButtons(); }
    else if (e.code === "KeyM") toggleMenu();
    else if (e.code === "KeyH") openDrill("hurt");
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  const cv = $("#view");
  let drag = null;
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch (err) { /* the pointer is already gone */ } };
  cv.addEventListener("pointerdown", (e) => { sound.start(); if (S.intro) S.intro.t = Math.max(S.intro.t, S.intro.dur - 0.8); drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; capture(cv, e.pointerId); cv.classList.add("drag"); });
  cv.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = e.pointerType === "touch" ? 0.28 : 0.2, dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
    drag.x = e.clientX; drag.y = e.clientY;
    if (S.mode === "plan") S.lookOff += dx; else S.yaw = (S.yaw + dx + 360) % 360;
    S.pitch = Math.max(-70, Math.min(55, S.pitch - dy));
    S.lastDrag = performance.now();
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; cv.classList.remove("drag"); } };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  // the walking stick (touch)
  const st = $("#stick"), knob = st.querySelector("i");
  const setStick = (e) => {
    const r = st.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - (r.left + R)) / (R * 0.8), y = (e.clientY - (r.top + R)) / (R * 0.8);
    const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
    stick.x = x; stick.y = y; knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
  };
  st.addEventListener("pointerdown", (e) => { stick.id = e.pointerId; capture(st, e.pointerId); setStick(e); e.preventDefault(); });
  st.addEventListener("pointermove", (e) => { if (e.pointerId === stick.id) setStick(e); });
  const sEnd = (e) => { if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ""; } };
  st.addEventListener("pointerup", sEnd); st.addEventListener("pointercancel", sEnd);
}
function moveInput() {
  let f = 0, r = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) r += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) r -= 1;
  if (stick.id !== null) { f -= stick.y; r += stick.x; }
  const len = Math.hypot(f, r);
  if (len > 1) { f /= len; r /= len; }
  return { f, r, len: Math.min(1, len) };
}

/* ---------- the walk ---------- */
const turn = (from, to, k) => from + ((((to - from) % 360) + 540) % 360 - 180) * k;
function planHeading(n, old, snap) {
  if (n.after) return old;
  // at a stop the crew faces the way the next leg leaves
  const end = S.legEnd[n.leg] ?? n.d, a = P.pointAtDistance(S.route, Math.min(end, n.d + 7));
  if (P.metres(n.pos, a) < 0.5) return old;
  return P.bearing(n.pos, a);
}
function walkSpeed(x, z) {   // m/s, the planner's model
  const a = S.m.assumptions, s = G.slopeAt(x, z);
  let v = a.v_flat_ms * Math.exp(-3.5 * Math.tan((s == null ? 30 : Math.min(s, 60)) * DEG));
  if (G.roughAt(x, z) > a.rough_m) v /= a.rough_penalty;
  return v;
}
function update(dt) {
  const m = S.m, inp = S.started && !S.menuOpen ? moveInput() : { f: 0, r: 0, len: 0 };
  let moving = 0;
  if (S.mode === "plan") {
    if (inp.len > 0.15) { enterFree(); }
    else {
      const lastT = m.profile[m.profile.length - 1].t;
      if (S.playing && !S.intro) {
        const st = P.stateAt(m, S.T);
        S.T = Math.min(lastT + 0.01, S.T + (dt * (st.gap ? Math.max(S.speed, DWELL_RATE) : S.speed)) / 60);
        if (S.T >= lastT) { S.playing = false; syncButtons(); }
      }
      const n = P.navOnPlan(m, S.route, S.T);
      S.pos.x = G.xOf(n.pos[1]); S.pos.z = G.zOf(n.pos[0]);
      S.heading = turn(S.heading, planHeading(n, S.heading), Math.min(1, dt * 6));
      moving = S.playing && !n.here && !n.after ? 1 : 0;
      if (S.playing && performance.now() - S.lastDrag > 3500) S.lookOff *= Math.max(0, 1 - dt * 1.5);   // look ahead again after a while
      S.yaw = S.heading + S.lookOff;
    }
  }
  if (S.mode === "free") {
    const F = S.free;
    if (F.working) {
      S.T += (dt * DWELL_RATE) / 60;
      if (S.T >= F.working.until || inp.len > 0.15) { if (S.T >= F.working.until) { S.T = F.working.until; F.worked[F.working.id] = true; } F.working = null; S.hudKey = ""; }
    } else if (inp.len > 0.05 && !F.home) {
      const dir = S.yaw * DEG, sim = dt * S.speed;
      const dx = Math.sin(dir) * inp.f + Math.cos(dir) * inp.r, dz = -Math.cos(dir) * inp.f + Math.sin(dir) * inp.r;
      const steps = Math.max(1, Math.ceil((sim * 0.6) / 1.5));
      for (let i = 0; i < steps; i++) {
        const d = walkSpeed(S.pos.x, S.pos.z) * (sim / steps), nx = S.pos.x + dx * d, nz = S.pos.z + dz * d;
        if (!G.inside(nx, nz, 10)) { if (!S.edgeToast || performance.now() - S.edgeToast > 6000) { toast("This is the edge of the mapped ground."); S.edgeToast = performance.now(); } break; }
        S.pos.x = nx; S.pos.z = nz;
      }
      S.T += sim / 60;
      S.heading = turn(S.heading, (Math.atan2(dx, -dz) / DEG + 360) % 360, Math.min(1, dt * 9));
      moving = inp.len;
      // arriving at the next stop, leaving the one we are at
      const next = P.stopById(m, m.order[F.leg + 1]), last = m.order.length - 1;
      const dn = Math.hypot(G.xOf(next.lon) - S.pos.x, G.zOf(next.lat) - S.pos.z);
      if (dn < ARRIVE_M) {
        if (F.leg + 1 === last) { F.home = true; F.homeT = S.T; F.hereIdx = -1; }
        else { F.hereIdx = F.leg + 1; F.leg += 1; }
        sound.alert("arrive"); stopTitle(F.home ? last : F.hereIdx);
        S.hudKey = "";
      } else if (F.hereIdx >= 0) {
        const h = P.stopById(m, m.order[F.hereIdx]);
        if (Math.hypot(G.xOf(h.lon) - S.pos.x, G.zOf(h.lat) - S.pos.z) > LEAVE_M) { F.hereIdx = -1; S.hudKey = ""; }
      }
    }
  }
  S.moving = moving;
  // crew
  const y = G.height(S.pos.x, S.pos.z), rate = Math.max(0.9, Math.min(1.9, 0.85 + S.speed / 45));
  ev1.place(S.pos.x, y, S.pos.z, S.heading); ev1.update(dt, moving > 0.05 ? 1 : 0, rate);
  const ev2moving = moveEv2(dt, moving > 0.05, rate);
  // rocks around the crew, footprints behind them, dust at their feet
  rocks.update(S.pos.x, S.pos.z);
  if (moving > 0.05 && prints.track(1, S.pos.x, S.pos.z, S.heading)) { dust.puff(prints.v.x, prints.v.y, prints.v.z); sound.step(); }
  if (ev2moving && prints.track(2, ev2.x, ev2.z, ev2.hdg)) dust.puff(prints.v.x, prints.v.y, prints.v.z);
  placeCamera(dt, y, moving);
  dust.update(dt, camera.position, y);
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value += dt;
  lights.sun.position.set(S.pos.x + SUN_DIR.x * 80, y + SUN_DIR.y * 80, S.pos.z + SUN_DIR.z * 80);
  lights.sun.target.position.set(S.pos.x, y, S.pos.z); lights.sun.target.updateMatrixWorld();
}

/* ---------- EV2, the crewmate ----------
   On the planned route EV2 walks a few steps ahead on the path (EV2 knows the plan). Off the route EV2 follows in EV1's tracks.
   EV2 turns before walking, walks only the way it faces (no sliding), stops when it has caught up, and waits facing EV1. */
const E2 = { x: 0, z: 0, hdg: 0, moving: false, trail: [], px: 0, pz: 0, v1: 0 };
function ev2Target() {
  const m = S.m;
  let d = null;   // how far along the whole walk EV1 is, when EV1 is on the planned route
  if (S.mode === "plan") { const n = P.navOnPlan(m, S.route, S.T); if (!n.after) d = n.d; }
  else if (S.nav && S.nav.src === "plan" && S.nav.d != null && !S.free.home) d = S.nav.d;
  if (d != null && d + 6.5 < S.route.length) {
    const a = P.pointAtDistance(S.route, d + 5.5), b = P.pointAtDistance(S.route, d + 6.5);
    const ax = G.xOf(a[1]), az = G.zOf(a[0]), fx = G.xOf(b[1]) - ax, fz = G.zOf(b[0]) - az, L = Math.hypot(fx, fz) || 1;
    return { x: ax - (fz / L) * 1.2, z: az + (fx / L) * 1.2 };   // 1.2 m to the right of the path, so EV1 can see past
  }
  if (d != null || (S.mode === "free" && S.free.home)) {   // the end of the walk: stand beside EV1
    const h = S.heading * DEG;
    return { x: S.pos.x + Math.cos(h) * 1.8 - Math.sin(h) * 0.4, z: S.pos.z + Math.sin(h) * 1.8 + Math.cos(h) * 0.4 };
  }
  // off the route: beside EV1 and a step behind, along EV1's own tracks (2 m to the side, so EV1's view stays clear)
  const T = E2.trail;
  let acc = 0;
  for (let i = T.length - 1; i > 0; i--) {
    const seg = Math.hypot(T[i].x - T[i - 1].x, T[i].z - T[i - 1].z);
    if (acc + seg >= 1.5) {
      const f = (1.5 - acc) / (seg || 1), x = T[i].x + (T[i - 1].x - T[i].x) * f, z = T[i].z + (T[i - 1].z - T[i].z) * f;
      const fx = (T[i].x - T[i - 1].x) / (seg || 1), fz = (T[i].z - T[i - 1].z) / (seg || 1);
      return { x: x - fz * 2.0, z: z + fx * 2.0 };
    }
    acc += seg;
  }
  const h = S.heading * DEG;
  return { x: S.pos.x - Math.sin(h) * 1.5 + Math.cos(h) * 2.0, z: S.pos.z + Math.cos(h) * 1.5 + Math.sin(h) * 2.0 };
}
function moveEv2(dt, ev1Moving, rate) {
  // EV1's tracks, and how fast EV1 is moving on screen
  const T = E2.trail, lastT = T[T.length - 1];
  if (!lastT || Math.hypot(S.pos.x - lastT.x, S.pos.z - lastT.z) > 0.35) { T.push({ x: S.pos.x, z: S.pos.z }); if (T.length > 70) T.shift(); }
  const jumped = Math.hypot(S.pos.x - E2.px, S.pos.z - E2.pz) > 12;
  E2.v1 += ((jumped ? 0 : Math.hypot(S.pos.x - E2.px, S.pos.z - E2.pz) / Math.max(dt, 1e-3)) - E2.v1) * Math.min(1, dt * 5);
  E2.px = S.pos.x; E2.pz = S.pos.z;
  if (jumped) T.length = 0;
  const t = ev2Target();
  if (!S.ev2init || jumped || Math.hypot(t.x - E2.x, t.z - E2.z) > 45) { E2.x = t.x; E2.z = t.z; E2.hdg = S.heading; E2.moving = false; S.ev2init = true; }
  const dx = t.x - E2.x, dz = t.z - E2.z, dist = Math.hypot(dx, dz);
  E2.moving = dist > (E2.moving ? 0.2 : 0.85);
  let want = E2.hdg, sp = 0;
  if (E2.moving) {
    want = (Math.atan2(dx, -dz) / DEG + 360) % 360;
    sp = Math.min(Math.max(E2.v1 * 1.3, 0.56 * S.speed * 0.8, 0.9), dist * 3.5 + 0.3);
  } else if (!ev1Moving && Math.hypot(S.pos.x - E2.x, S.pos.z - E2.z) > 0.6) want = (Math.atan2(S.pos.x - E2.x, -(S.pos.z - E2.z)) / DEG + 360) % 360;   // waiting: face the crewmate
  const diff = ((want - E2.hdg + 540) % 360) - 180, maxTurn = (E2.moving ? 280 : 110) * Math.max(1, S.speed / 12) * dt;
  E2.hdg = (E2.hdg + Math.sign(diff) * Math.min(Math.abs(diff), maxTurn) + 360) % 360;
  if (sp > 0) {
    const h = E2.hdg * DEG, step = Math.min(dist, sp * dt * Math.max(0, Math.cos(diff * DEG)));
    E2.x += Math.sin(h) * step; E2.z -= Math.cos(h) * step;
  }
  const walking = E2.moving && Math.abs(diff) < 75;
  ev2.place(E2.x, G.height(E2.x, E2.z), E2.z, E2.hdg);
  ev2.look = walking ? null : [S.pos.x, S.pos.z];
  ev2.update(dt, walking ? 1 : 0, rate);
  return walking;
}

/* ---------- camera: first person, third person, the cinema camera, and the fly-in at the start ---------- */
const camWant = new THREE.Vector3(), camFocus = new THREE.Vector3(), camFrom = new THREE.Vector3();
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const CINE = [   // the cinema camera's shots, one after the other
  { name: "lead", dur: 7.5, fov: 40 }, { name: "drone", dur: 7, fov: 50 }, { name: "side", dur: 7, fov: 34 },
  { name: "low", dur: 6.5, fov: 46 }, { name: "orbit", dur: 8, fov: 38 }, { name: "shoulder", dur: 6.5, fov: 58 },
];
function startIntro() {
  const h = S.heading * DEG, y = G.height(S.pos.x, S.pos.z);
  camFrom.set(S.pos.x - Math.sin(h) * 330 + Math.cos(h) * 150, y + 210, S.pos.z + Math.cos(h) * 330 + Math.sin(h) * 150);
  S.intro = { t: 0, dur: 6.5 };
  showTitle("JEZERO CRATER · MARS", `The planned Marswalk · ${S.m.totals.dist_km.toFixed(2)} km · home by T+${P.hm(S.m.walkback.budget_min)}`, 5600);
  document.body.classList.add("intro");
}
function endIntro() { if (!S.intro) return; S.intro = null; document.body.classList.remove("intro"); }
function placeCamera(dt, y, moving) {
  const yaw = S.yaw * DEG, pit = S.pitch * DEG, port = camera.aspect < 1;
  const fwdX = Math.sin(yaw) * Math.cos(pit), fwdY = Math.sin(pit), fwdZ = -Math.cos(yaw) * Math.cos(pit);
  S.bob = (S.bob || 0) + dt * 7.5 * (moving > 0.05 ? 1 : 0);
  let fov = port ? 74 : 62, hideEv1 = S.view === "first";
  // where the camera sits in the first- and third-person views
  if (S.view === "third") {
    const back = 5.6;
    camWant.set(S.pos.x - fwdX * back, y + 1.8 - fwdY * back, S.pos.z - fwdZ * back);
    camWant.y = Math.max(camWant.y, G.height(camWant.x, camWant.z) + 0.6);
    fov = port ? 68 : 54;
  } else camWant.set(S.pos.x, y + 1.62 + (moving > 0.05 ? Math.sin(S.bob) * 0.022 : 0), S.pos.z);
  if (S.intro) {   // fly in from high above the route to where the walk starts
    const I = S.intro; I.t += dt;
    const k = ease(Math.min(1, I.t / I.dur));
    camera.position.lerpVectors(camFrom, camWant, k);
    camera.position.y = Math.max(camera.position.y, G.height(camera.position.x, camera.position.z) + 1.2);
    camFocus.set(S.pos.x + Math.sin(S.heading * DEG) * 60 * (1 - k), y + 1.2, S.pos.z - Math.cos(S.heading * DEG) * 60 * (1 - k));
    camFocus.lerp(camFrom.set(camWant.x + fwdX * 40, camWant.y + fwdY * 40, camWant.z + fwdZ * 40), k * k);
    camFrom.copy(S.introFrom);
    camera.lookAt(camFocus);
    hideEv1 = S.view === "first" && k > 0.9;
    fov = 50 + (fov - 50) * k;
    if (I.t >= I.dur) endIntro();
  } else if (S.view === "cine") {
    const C = S.cine, shot = CINE[C.i], h = S.heading * DEG, fx_ = Math.sin(h), fz_ = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    C.t += dt;
    if (C.t >= shot.dur) { C.i = (C.i + 1) % CINE.length; C.t = 0; C.fixed = null; }
    const u = Math.min(1, C.t / shot.dur), mx = (S.pos.x + ev2.x) / 2, mz = (S.pos.z + ev2.z) / 2;
    let px, pz, ph, lx = mx, lz = mz, lh = 1.15;
    if (shot.name === "lead") { const dd = 11 - 4 * u; px = mx + fx_ * dd + rx * 1.6; pz = mz + fz_ * dd + rz * 1.6; ph = 1.0; }
    else if (shot.name === "drone") { px = mx - fx_ * (46 - 10 * u) + rx * 14; pz = mz - fz_ * (46 - 10 * u) + rz * 14; ph = 30 - 8 * u; lx = mx + fx_ * 30; lz = mz + fz_ * 30; lh = 0; }
    else if (shot.name === "side") { px = mx + rx * 13 + fx_ * (4 - 8 * u); pz = mz + rz * 13 + fz_ * (4 - 8 * u); ph = 1.5; lx = mx + fx_ * 1.5; lz = mz + fz_ * 1.5; }
    else if (shot.name === "low") {   // a still camera near the ground; the crew walks past it
      if (!C.fixed) C.fixed = { x: mx + fx_ * 15 - rx * 5, z: mz + fz_ * 15 - rz * 5 };
      px = C.fixed.x; pz = C.fixed.z; ph = 0.4; lh = 1.0;
    }
    else if (shot.name === "orbit") { const a = h + Math.PI * (0.75 + 0.9 * u); px = mx + Math.sin(a) * 8.5; pz = mz - Math.cos(a) * 8.5; ph = 2.4 - 0.8 * u; }
    else { px = S.pos.x - fx_ * 2.7 + rx * 0.75; pz = S.pos.z - fz_ * 2.7 + rz * 0.75; ph = 1.78; lx = S.pos.x + fx_ * 30; lz = S.pos.z + fz_ * 30; lh = 0.6; }
    const gy = G.height(px, pz);
    camera.position.set(px, Math.max(gy + 0.3, (shot.name === "drone" ? y : gy) + ph), pz);
    camFocus.set(lx, G.height(lx, lz) + lh, lz);
    camera.lookAt(camFocus);
    fov = port ? shot.fov + 16 : shot.fov; hideEv1 = false;
    C.cut = C.t < dt * 1.5;
  } else {
    if (S.view === "third" && camera.position.distanceToSquared(camWant) < 3600 && !S.camSnap) camera.position.lerp(camWant, 1 - Math.exp(-dt * 12));
    else camera.position.copy(camWant);
    S.camSnap = false;
    camera.rotation.set(pit, -yaw, 0);
  }
  ev1.root.visible = !hideEv1;
  const snapFov = S.view === "cine" && S.cine && S.cine.cut;
  const nf = snapFov ? fov : camera.fov + (fov - camera.fov) * Math.min(1, dt * 5);
  if (Math.abs(nf - camera.fov) > 0.01) { camera.fov = nf; camera.updateProjectionMatrix(); }
}

/* ---------- the numbers where you stand ---------- */
function navNow() {
  const m = S.m;
  if (S.mode === "plan") {
    const n = P.navOnPlan(m, S.route, S.T);
    n.along = n.after ? 0 : Math.max(0, (S.legEnd[n.leg] ?? n.d) - n.d);
    return n;
  }
  const F = S.free, wb = m.walkback, bf = wb.bad ? wb.bad.factor : 2, lim = wb.suit ? wb.suit.limit_min : 50, Bb = wb.bad ? wb.bad.budget_min : wb.budget_min;
  const ll = [G.latOf(S.pos.z), G.lonOf(S.pos.x)], baseS = P.stopById(m, "base");
  if (F.home) return { T: S.T, back: 0, mPlan: wb.budget_min - F.homeT, mBad: Bb - F.homeT, lim, after: true, homeT: F.homeT, here: null, hereIdx: -1, nextS: baseS, dist: 0, pos: ll, leg: m.order.length - 2, src: "plan", off: 0, along: 0 };
  let any = P.nearestOnRoute(S.route, ll, F.leg), on = any && any.off <= ON_ROUTE_M ? any : null;
  if (!on) { any = P.nearestOnRoute(S.route, ll); on = any && any.off <= ON_ROUTE_M ? any : null; }
  let back = 0, src, moved = 0;
  if (on) { back = P.profileAt(m, on.leg, on.d).back; src = "plan"; }
  else {
    const sp = P.readSpot(m, S.field, ll[0], ll[1]);
    if (sp.kind === "ok") { back = sp.back; src = "layer"; moved = sp.moved; } else src = sp.kind === "wait" ? "wait" : "none";
  }
  const nextS = P.stopById(m, m.order[F.leg + 1]) || baseS, here = F.hereIdx >= 0 ? P.stopById(m, m.order[F.hereIdx]) : null;
  return { T: S.T, back, mPlan: wb.budget_min - (S.T + back), mBad: Bb - (S.T + bf * back), lim, after: false, here, hereIdx: F.hereIdx, nextS,
    dist: P.metres(ll, [nextS.lat, nextS.lon]), pos: ll, leg: F.leg, d: on ? on.d : null, onLeg: on ? on.leg : -1, src, moved,
    off: any ? any.off : 0, nearPt: any ? any.pt : null, along: on && on.leg === F.leg ? Math.max(0, (S.legEnd[F.leg] ?? on.d) - on.d) : null };
}

/* ---------- helmet display ---------- */
const cache = new Map();
function put(id, html, cls) {
  const el = document.getElementById(id), key = `${html}|${cls ?? ""}`;
  if (cache.get(id) === key) return;
  cache.set(id, key); el.innerHTML = html; if (cls != null) el.className = cls;
}
const km = (d) => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);
function renderHud() {
  const m = S.m, n = navNow(), tl = m.timeline || [], wb = m.walkback;
  S.nav = n;
  const v = P.verdict(m, n), known = n.src !== "none" && n.src !== "wait";
  put("hMode", S.mode === "plan" ? (S.playing ? "Following the plan" : "On the plan · paused") : S.free.working ? "Working at the stop" : "Free walk");
  put("hMet", `T+${P.hm(S.T)}`);
  put("hWord", n.src === "wait" ? "…" : v.word);
  put("hSpare", n.src === "wait" ? "Working out the way home…" : esc(v.spare));
  $("#hStatus").className = `pnl status ${n.src === "wait" ? "" : v.cls}`;
  // alert tones: once when the word changes, a few more while it says TURN BACK NOW; two notes on reaching a stop
  if (v.cls !== S.lastCls) { S.lastCls = v.cls; S.badBeeps = 0; if (v.cls === "warn") sound.alert("warn"); }
  if (v.cls === "bad" && (S.badBeeps || 0) < 4 && n.src !== "wait") { const before = sound.lastAlarm; sound.alert("bad"); if (sound.lastAlarm !== before) S.badBeeps = (S.badBeeps || 0) + 1; }
  const hereId = n.here ? n.here.id : "";
  if (S.mode === "plan" && hereId && hereId !== S.lastHere && S.playing) { sound.alert("arrive"); stopTitle(n.hereIdx); }
  if (S.mode === "plan" && n.after && !S.lastAfter && S.playing) stopTitle(m.order.length - 1);
  S.lastAfter = n.after;
  S.lastHere = hereId;
  put("hHurt", n.after || !known ? "" : `If EV2 is hurt and EV1 helps: <b class="${n.mBad < 0 ? "bad" : ""}">${P.fmtMin(n.mBad)} ${n.mBad < 0 ? "short" : "to spare"}</b>`);
  // walk home against the backup oxygen
  put("hBack", known ? `${Math.round(n.back)} MIN` : "–", known && n.back > n.lim ? "bad" : "");
  $("#hO2").style.width = `${known ? Math.min(100, (n.back / n.lim) * 100) : 0}%`;
  $("#hO2bar").className = `o2bar ${known && n.back > n.lim ? "bad" : known && n.back > n.lim * 0.8 ? "warn" : ""}`;
  put("hO2txt", !known ? (n.src === "none" ? "No way home on foot from here" : "") : n.back > n.lim ? `Beyond the ${n.lim} min of backup oxygen` : `Inside the ${n.lim} min of backup oxygen`, known && n.back > n.lim ? "bad" : "");
  // next stop
  const camYaw = S.yaw;
  let brg = null;
  if (n.after) { put("hNextLbl", "Status"); put("hNext", "BASE CAMP"); put("hNextSub", "Crew is back inside"); }
  else {
    const onLeg = n.along != null;
    let tgt = [n.nextS.lat, n.nextS.lon];
    if (onLeg && n.along > 5) tgt = P.pointAtDistance(S.route, Math.min(S.legEnd[n.leg], n.d + 60));
    else if (!onLeg && n.nearPt && n.off > ON_ROUTE_M) tgt = [n.nextS.lat, n.nextS.lon];
    brg = P.bearing(n.pos, tgt);
    put("hNextLbl", n.here ? `On site · next` : n.nextS.id === "base" ? "Heading home" : "Next stop");
    put("hNext", esc(P.shortName(n.nextS).toUpperCase()));
    put("hNextSub", onLeg ? `${km(n.along)} along the route · ${P.compass(brg)}` : `${km(n.dist)} in a straight line · ${P.compass(brg)}`);
  }
  S.hudBrg = brg;
  $("#hArrow").style.display = brg == null ? "none" : "";
  if (brg != null) $("#hArrow").style.transform = `rotate(${(brg - camYaw).toFixed(1)}deg)`;
  // leave-by
  if (n.after) { put("hLeaveLbl", "Home"); put("hLeave", `T+${P.hm(n.homeT ?? m.profile[m.profile.length - 1].t)}`); put("hLeaveSub", `Had to be home by T+${P.hm(wb.budget_min)}`, ""); }
  else {
    const i = n.here ? n.hereIdx : n.leg + 1, s = n.here || n.nextS;
    if (s.id === "base") { put("hLeaveLbl", "Be home by"); put("hLeave", `T+${P.hm(wb.budget_min)}`); put("hLeaveSub", `The plan is home at T+${P.hm(tl[tl.length - 1].arrive_min)}`, ""); }
    else {
      const lb = P.leaveBy(tl[i]), left = lb - S.T;
      put("hLeaveLbl", `Leave ${esc(P.shortName(s))} by`); put("hLeave", `T+${P.hm(lb)}`, left < 0 ? "bad" : "");
      put("hLeaveSub", left < 0 ? `${P.fmtMin(left)} past the leave-by time` : n.here ? `${P.fmtMin(left)} from now` : `The plan leaves at T+${P.hm(tl[i].depart_min)}`, left < 0 ? "bad" : "");
    }
  }
  // slope ahead and the route
  const hd = (S.mode === "plan" ? S.heading : S.yaw) * DEG, sA = G.slopeAt(S.pos.x + Math.sin(hd) * 6, S.pos.z - Math.cos(hd) * 6), lim = m.assumptions.max_slope_deg;
  put("hSlope", sA == null ? "–" : `${Math.round(sA)}°${sA > lim ? " · NO-GO" : ""}`, sA != null && sA > lim ? "bad" : "");
  if (n.after) put("hRoute", "", "");
  else if (S.mode === "plan" || n.src === "plan") put("hRoute", "On the planned route", "");
  else put("hRoute", `OFF ROUTE · ${km(n.off)} from the route${n.nearPt ? ` (${P.compass(P.bearing(n.pos, n.nearPt))})` : ""}`, "warn");
  // at a stop
  const site = $("#hSite");
  let sh = "";
  if (S.mode === "free" && S.free.home) sh = `<span>Back at base camp. EVA complete at T+${P.hm(S.free.homeT)}.</span><button data-act="again">Walk again</button>`;
  else if (S.mode === "free" && S.free.working) sh = `<span>Working at ${esc(P.shortName(n.here || n.nextS))}: ${P.fmtMin(S.free.working.until - S.T)} left</span><button data-act="stopwork">Stop</button>`;
  else if (S.mode === "free" && n.here && n.here.dwell_min > 0 && !S.free.worked[n.here.id]) sh = `<span>At ${esc(P.shortName(n.here))}. The plan works here for ${n.here.dwell_min} min.</span><button data-act="work">Do the stop work</button>`;
  else if (S.mode === "plan" && n.here) sh = `<span>On site at ${esc(P.shortName(n.here))}. The plan leaves at T+${P.hm(tl[n.hereIdx].depart_min)}.</span>`;
  if (cache.get("site") !== sh) { cache.set("site", sh); site.innerHTML = sh; site.hidden = !sh; }
  drawMini(n);
  renderHelm(n, v);
  if (S.drill && Math.abs(S.T - S.drill.T) > 0.02) closeDrill();
}

/* ---------- the helmet display: the same numbers, floating on the visor ---------- */
const txt = (id) => document.getElementById(id).textContent;
function setBar(id, frac, cls) {
  const el = document.getElementById(id), w = `${Math.max(0, Math.min(1, frac)) * 100}%`, key = `${w}|${cls}`;
  if (cache.get(id) === key) return;
  cache.set(id, key); el.style.width = w; el.parentNode.className = `h-bar ${cls}${id === "xSlopeBar" ? " slope" : ""}`;
}
function renderHelm(n, v) {
  const m = S.m, wb = m.walkback, tl = m.timeline || [], a = m.assumptions, last = m.order.length - 1;
  const known = n.src !== "none" && n.src !== "wait", Bb = wb.bad ? wb.bad.budget_min : wb.budget_min;
  put("xMet", `T+${P.hm(S.T)}`);
  put("xHomeBy", `T+${P.hm(wb.budget_min)}`);
  put("xSpare", known ? `${n.mPlan < 0 ? "−" : ""}${P.fmtMin(n.mPlan)}` : "–", `big ${!known ? "" : n.mPlan < 0 ? "bad" : n.mPlan < 30 ? "warn" : "ok"}`);
  setBar("xSpareBar", known ? n.mPlan / wb.budget_min : 0, n.mPlan < 0 ? "bad" : n.mPlan < 30 ? "warn" : "");
  put("xBad", known ? `${P.fmtMin(n.mBad)} ${n.mBad < 0 ? "short" : "to spare"}` : "–", known && n.mBad < 0 ? "bad" : "");
  setBar("xBadBar", known ? n.mBad / Bb : 0, n.mBad < 0 ? "bad" : n.mBad < 15 ? "warn" : "");
  put("xBack", known ? `${Math.round(n.back)} min` : "–", known && n.back > n.lim ? "bad" : "");
  setBar("xBackBar", known ? n.back / n.lim : 0, known && n.back > n.lim ? "bad" : known && n.back > n.lim * 0.8 ? "warn" : "");
  put("xBackNote", n.src === "none" ? "no way home on foot from here" : known && n.back > n.lim ? `beyond the ${n.lim} min of backup oxygen` : `of ${n.lim} min of backup oxygen`, known && n.back > n.lim ? "bad" : "");
  put("xMode", `${S.mode === "plan" ? (S.playing ? "Following the plan" : "On the plan · paused") : S.free.working ? "Working at the stop" : "Free walk"} · ×${S.speed}`.toUpperCase());
  // next stop
  const idx = n.after ? last : n.here ? Math.min(last, n.hereIdx + 1) : n.leg + 1, onLeg = n.along != null, brg = S.hudBrg;
  put("xNextLbl", n.after ? "Status" : `${txt("hNextLbl")} · ${idx === last ? "H" : idx + 1}`);
  put("xNext", esc(txt("hNext")));
  put("xDist", n.after ? "HOME" : km(onLeg ? n.along : n.dist));
  let eta = null;
  if (!n.after && onLeg && tl[n.leg + 1]) {
    const at = S.mode === "plan" ? S.T : n.d != null ? P.profileAt(m, n.leg, n.d).t : null;
    if (at != null) eta = Math.max(0, tl[n.leg + 1].arrive_min - Math.max(at, tl[n.leg] ? tl[n.leg].depart_min : 0));
  }
  put("xNextSub", n.after ? "Crew is back inside" : `${onLeg ? "along the route" : "in a straight line"}${brg != null ? ` · ${P.compass(brg)}` : ""}${eta != null ? ` · ${P.fmtMin(eta)} at plan pace` : ""}`);
  const ar = $("#xArrow"); ar.style.display = brg == null ? "none" : ""; if (brg != null) ar.style.transform = `rotate(${(brg - S.yaw).toFixed(1)}deg)`;
  put("xLeaveLbl", esc(txt("hLeaveLbl"))); put("xLeave", esc(txt("hLeave")), $("#hLeave").className); put("xLeaveSub", esc(txt("hLeaveSub")), $("#hLeaveSub").className);
  // the ground
  // On the planned route the slope is the plan's own (its 2 m grid, where the route never crosses no-go ground). The page's
  // 4 m grid can read the same spot a little steeper, so it is only used off the route and for the way you face in a free walk.
  const lim = a.max_slope_deg, onPlan = !n.after && (S.mode === "plan" || n.src === "plan");
  const hd = S.yaw * DEG, legNow = S.mode === "plan" ? n.leg : n.onLeg;
  let sA = G.slopeAt(S.pos.x + Math.sin(hd) * 6, S.pos.z - Math.cos(hd) * 6);
  if (S.mode === "plan" && !n.after) { const pr = P.profileAt(m, n.leg, Math.min(S.legEnd[n.leg] ?? n.d, n.d + 6)); if (pr) sA = pr.s; }
  put("xSlope", sA == null ? "–" : `${sA.toFixed(1)}°${sA > lim ? " · NO-GO" : ""}`, sA != null && sA > lim ? "bad" : "");
  setBar("xSlopeBar", sA == null ? 0 : sA / (lim / 0.6), sA != null && sA > lim ? "bad" : sA != null && sA > lim - 3 ? "warn" : "");
  put("xPace", `${(S.moving > 0.05 && !n.after ? walkSpeed(S.pos.x, S.pos.z) * Math.min(1, S.moving) : 0).toFixed(2)} m/s`);
  put("xElev", `${Math.round(G.height(S.pos.x, S.pos.z) + G.Y0).toLocaleString("en-US").replace("-", "−")} m`);
  let here = G.slopeAt(S.pos.x, S.pos.z);
  if (onPlan && n.d != null && legNow >= 0) { const pr = P.profileAt(m, legNow, n.d); if (pr) here = pr.s; }
  const rough = G.roughAt(S.pos.x, S.pos.z) > a.rough_m, noGo = here != null && here > lim, steep = here != null && here > lim - 3;
  put("xGround", noGo ? "NO-GO SLOPE" : rough ? (S.mode === "plan" ? "ROUGH GROUND" : `ROUGH · ${a.rough_penalty}× SLOWER`) : steep ? `STEEP · ${Math.round(here)}° OF ${lim}°` : "FIRM", noGo ? "sm bad" : rough || steep ? "sm warn" : "sm");
  put("xRoute", esc(txt("hRoute")), $("#hRoute").className);
  // the word
  $("#xStatus").className = `h-status ${n.src === "wait" ? "" : v.cls}`;
  put("xWord", n.src === "wait" ? "…" : v.word);
  put("xLine", n.src === "wait" ? "Working out the way home…" : n.after || !known ? esc(v.spare) : `${esc(v.spare)} · if EV2 is hurt: ${P.fmtMin(n.mBad)} ${n.mBad < 0 ? "short" : "to spare"}`);
  // the stops in order, with the plan's arrival times
  let sh = "";
  m.order.forEach((id, i) => {
    const st = P.stopById(m, id), nm = i === last ? "Home" : P.shortName(st), done = n.after || i < (n.here ? n.hereIdx : n.leg + 1), on = !n.after && i === (n.here ? n.hereIdx : n.leg + 1);
    sh += `<span class="${on ? "on" : done ? "done" : ""}"><i>${i === last ? "H" : i + 1}</i>${esc(nm)}${i > 0 && tl[i] ? `<em>T+${P.hm(tl[i].arrive_min)}</em>` : ""}</span>`;
  });
  put("xStops", sh);
}

// the compass tape at the top: where the camera looks, with the stops at their bearings
const CARD = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
function drawTape() {
  const cv = $("#hTape");
  if (!S.started || S.view === "cine" || !cv.offsetParent) return;
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, span = 112, ppd = W / span, yaw = ((S.yaw % 360) + 360) % 360, bend = 46 / ((W / 2) * (W / 2));
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 6;
  const yAt = (dx) => 46 + bend * dx * dx;
  for (let a = Math.ceil((yaw - span / 2) / 5) * 5; a <= yaw + span / 2; a += 5) {
    const dx = (a - yaw) * ppd, x = W / 2 + dx, y = yAt(dx), deg = ((a % 360) + 360) % 360, fade = 1 - Math.pow(Math.abs(dx) / (W / 2), 3);
    const card = CARD[deg], mid = deg % 15 === 0;
    ctx.globalAlpha = Math.max(0, fade) * (card ? 1 : mid ? 0.8 : 0.5);
    ctx.fillStyle = "#fff"; ctx.fillRect(x - (card ? 1.5 : 1), y + 16, card ? 3 : 2, card ? 22 : mid ? 14 : 8);
    if (card) { ctx.font = "600 34px 'Barlow Semi Condensed', Barlow, sans-serif"; ctx.fillText(card, x, y - 6); }
    else if (mid) { ctx.font = "500 20px 'Barlow Semi Condensed', Barlow, sans-serif"; ctx.fillStyle = "rgba(255,244,232,.85)"; ctx.fillText(String(deg), x, y - 2); }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.moveTo(W / 2 - 11, 4); ctx.lineTo(W / 2 + 11, 4); ctx.lineTo(W / 2, 20); ctx.closePath(); ctx.fill();
  // the stops
  const m = S.m, ll = [G.latOf(S.pos.z), G.lonOf(S.pos.x)], n = S.nav, nextId = n && !n.after ? (n.here ? n.here.id : n.nextS.id) : "";
  const seen = new Set();
  m.order.forEach((id, i) => {
    if (seen.has(id)) return; seen.add(id);
    const st = P.stopById(m, id);
    if (P.metres(ll, [st.lat, st.lon]) < 4) return;
    let rel = ((P.bearing(ll, [st.lat, st.lon]) - yaw + 540) % 360) - 180;
    const out = Math.abs(rel) > span / 2 - 4; rel = Math.max(-span / 2 + 4, Math.min(span / 2 - 4, rel));
    const dx = rel * ppd, x = W / 2 + dx, y = yAt(dx) + 62, big = id === nextId, r = big ? 19 : 15;
    ctx.globalAlpha = out ? 0.45 : 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fillStyle = id === "base" ? "#fff" : "#ff6a3d"; ctx.fill();
    if (big) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    ctx.fillStyle = id === "base" ? "#101214" : "#fff"; ctx.shadowBlur = 0; ctx.font = `700 ${big ? 22 : 18}px 'Barlow Semi Condensed', Barlow, sans-serif`;
    ctx.fillText(id === "base" ? "H" : String(i + 1), x, y + 1); ctx.shadowBlur = 6;
  });
  ctx.globalAlpha = 1;
}

/* ---------- small map ---------- */
const mini = { bg: document.createElement("canvas"), img: null };
function buildMini() {
  const c = mini.bg, cv = $("#miniMap"); c.width = cv.width; c.height = cv.height;
  const ctx = c.getContext("2d"), W = c.width, H = c.height;
  ctx.fillStyle = "#2a1c15"; ctx.fillRect(0, 0, W, H);
  if (mini.img) { ctx.globalAlpha = 0.85; ctx.drawImage(mini.img, 0, 0, W, H); ctx.globalAlpha = 1; ctx.fillStyle = "rgba(60, 28, 12, .35)"; ctx.fillRect(0, 0, W, H); }
  const X = (lon) => (G.xOf(lon) / G.sizeX) * W, Y = (lat) => (G.zOf(lat) / G.sizeZ) * H;
  ctx.lineJoin = ctx.lineCap = "round";
  for (const [w, col] of [[7, "rgba(11,11,11,.7)"], [3.5, "#ff6a3d"]]) {
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
    S.route.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[1]), Y(p[0])) : ctx.moveTo(X(p[1]), Y(p[0])))); ctx.stroke();
  }
  for (const id of new Set(S.m.order)) {
    const s = P.stopById(S.m, id);
    ctx.beginPath(); ctx.arc(X(s.lon), Y(s.lat), 6, 0, 7); ctx.fillStyle = id === "base" ? "#38bdf8" : "#ff6a3d"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
}
function drawMini() {
  const cv = $("#miniMap"); if (!cv.offsetParent) return;
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  ctx.drawImage(mini.bg, 0, 0);
  const x = (S.pos.x / G.sizeX) * W, y = (S.pos.z / G.sizeZ) * H, a = S.yaw * DEG;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = "#0b0b0b"; ctx.stroke(); ctx.restore();
}

/* ---------- drills ---------- */
function openDrill(type) {
  if (S.mode === "plan" && S.playing) { S.playing = false; syncButtons(); }   // the card belongs to one moment: stop the clock first
  if (S.free && S.free.working) S.free.working = null;
  const n = navNow();
  if (!n || n.after) return;
  S.nav = n;
  const where = n.here ? `at ${P.shortName(n.here)}` : S.mode === "plan" || n.src === "plan" ? `on the way to ${P.shortName(n.nextS)}` : "off the route";
  let h;
  if (n.src === "none" || n.src === "wait") {
    h = `<div class="dt">${type === "suit" ? "Suit alarm" : "Crewmate hurt (EV2)"}</div><div class="dv bad">${n.src === "wait" ? "ONE MOMENT" : "NO WAY HOME ON FOOT"}<small>${n.src === "wait" ? "Still working out the way home." : "The ground here is too steep or cut off."}</small></div>`;
  } else {
    const d = type === "suit" ? P.suitDrill(S.m, n) : P.hurtDrill(S.m, n);
    h = `<div class="dt">${d.title}</div>${d.rows.map(([k, v]) => `<div class="dr"><span>${k}</span><b>${v}</b></div>`).join("")}
      <div class="dv ${d.ok ? "ok" : "bad"}">${d.word}<small>${d.txt}</small></div><p class="dn">${d.note}${n.src === "layer" ? " Off the route, the walk home is read from the walk-home layer (4 m grid), like the app's “What if here?”." : ""}</p>`;
  }
  $("#drill").innerHTML = `<div class="dh"><span class="lbl">Drill · T+${P.hm(n.T)} · ${esc(where)}</span><button class="x" data-close aria-label="Close the drill">&times;</button></div>${h}<button class="ghost" data-close>Back to the walk</button>`;
  $("#drill").hidden = false;
  S.drill = { type, T: n.T };
  routeLine.setHome(P.wayHome(S.m, S.field, n.pos));
}
function closeDrill() { if (!S.drill && $("#drill").hidden) return; S.drill = null; $("#drill").hidden = true; routeLine.setHome(null); }

/* ---------- menu ---------- */
function toggleMenu(on) { S.menuOpen = on ?? $("#menu").hidden; $("#menu").hidden = !S.menuOpen; $("#bMenu").setAttribute("aria-expanded", String(S.menuOpen)); $("#bMenu").classList.toggle("on", S.menuOpen); if (S.menuOpen) renderMenu(); }
function renderMenu() {
  const m = S.m, tl = m.timeline || [];
  $("#mChecks").innerHTML = P.getChecks(m).map((c) => `<div class="chk"><span class="k">${c.name}</span><span class="v ${c.ok ? "ok" : "bad"}">${esc(c.val)}</span><span class="s">${esc(c.sub)}</span></div>`).join("")
    + `<div class="chk"><span class="k">The walk</span><span class="v">${m.totals.dist_km.toFixed(2)} km</span><span class="s">Home at T+${P.hm(tl[tl.length - 1].arrive_min)}; the crew must be home by T+${P.hm(m.walkback.budget_min)}. Crew of two: EV1 and EV2 walk together.</span></div>`;
  let j = "";
  tl.forEach((t, i) => {
    const s = P.stopById(m, t.id), nm = P.shortName(s);
    if (i === 0) j += `<button data-t="0"><b>T+0:00</b>Start at base camp</button>`;
    else if (i === tl.length - 1) j += `<button data-t="${t.arrive_min}"><b>T+${P.hm(t.arrive_min)}</b>Home at base camp</button>`;
    else j += `<button data-t="${t.arrive_min}"><b>T+${P.hm(t.arrive_min)}</b>Arrive at ${esc(nm)}</button><button data-t="${t.depart_min}"><b>T+${P.hm(t.depart_min)}</b>Leave ${esc(nm)}</button>`;
  });
  $("#mJumps").innerHTML = j;
  $("#oSlope").textContent = m.assumptions.max_slope_deg;
}

function initHud() {
  initInput();
  $("#sFree").onclick = () => start("free", true);
  $("#sPlan").onclick = () => start("plan", true);
  $("#bPlan").onclick = () => {
    closeDrill();
    if (S.mode === "plan") { const lastT = S.m.profile[S.m.profile.length - 1].t; if (!S.playing && S.T >= lastT) jump(0, true); else S.playing = !S.playing; }
    else { jump(0, true); toast("Back to base camp: following the plan from T+0:00."); }
    syncButtons(); S.hudKey = "";
  };
  $("#bView").onclick = () => setView(VIEWS[(VIEWS.indexOf(S.view) + 1) % VIEWS.length]);
  $("#bSpeed").onclick = () => { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length] || SPEEDS[0]; S.speedBefore = 0; syncButtons(); };
  $("#bHurt").onclick = () => openDrill("hurt");
  $("#bSuit").onclick = () => openDrill("suit");
  $("#bSound").onclick = () => { sound.start(); sound.setOn(!sound.on); $("#bSound").textContent = sound.on ? "Sound on" : "Sound off"; $("#bSound").classList.toggle("off", !sound.on); };
  if (Q.get("sound") === "0") { sound.setOn(false); $("#bSound").textContent = "Sound off"; $("#bSound").classList.add("off"); }
  $("#bMenu").onclick = () => toggleMenu();
  $("#menuX").onclick = () => toggleMenu(false);
  $("#drill").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeDrill(); });
  $("#mJumps").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; jump(parseFloat(b.dataset.t)); toggleMenu(false); });
  $("#oTint").onchange = (e) => terrain.setTint(e.target.checked);
  $("#oTenby").disabled = true;
  $("#oTenby").onchange = (e) => setTenby(e.target.checked);
  $("#hSite").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const F = S.free, n = S.nav;
    if (b.dataset.act === "work" && n && n.here) F.working = { id: n.here.id, until: S.T + n.here.dwell_min };
    else if (b.dataset.act === "stopwork") F.working = null;
    else if (b.dataset.act === "again") { resetToStart(); S.mode = "free"; }
    S.hudKey = "";
  });
  const img = new Image();
  img.onload = () => { mini.img = img; buildMini(); };
  img.src = "../data/hillshade.png";
  buildMini(); renderMenu(); syncButtons();
}

// is the sun in the picture, and is ground (near or far) in front of it? Feeds the lens flare.
function sunOnLens(dt) {
  const c = camera.position, u = fx.grade.uniforms;
  _v.copy(c).addScaledVector(SUN_DIR, 20000).project(camera);
  let vis = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2 ? 1 : 0;
  for (let d = 12; vis && d < 16000; d *= 1.2) {
    const x = c.x + SUN_DIR.x * d, z = c.z + SUN_DIR.z * d, y = c.y + SUN_DIR.y * d;
    const gh = G.inside(x, z, 0) ? G.height(x, z) : S.far ? S.far.heightAt(x, z) : -1e9;
    if (gh > y) vis = 0;
  }
  S.sunVis = (S.sunVis || 0) + (vis - (S.sunVis || 0)) * Math.min(1, dt * 7);
  u.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5); u.uSunVis.value = S.sunVis; u.uAspect.value = camera.aspect;
}

/* ---------- title cards: a few words on the picture at the start and when the crew reaches a stop ---------- */
let titleTimer = 0;
function showTitle(main, sub, ms = 3800) {
  const t = $("#title"); t.querySelector("b").textContent = main; t.querySelector("span").textContent = sub || "";
  t.classList.add("on"); clearTimeout(titleTimer); titleTimer = setTimeout(() => t.classList.remove("on"), ms);
}
function stopTitle(idx) {
  const m = S.m, tl = m.timeline || [], s = P.stopById(m, m.order[idx]);
  if (!s || !tl[idx]) return;
  if (idx === m.order.length - 1) showTitle("BASE CAMP", `Home · the crew had to be back by T+${P.hm(m.walkback.budget_min)}`, 4500);
  else showTitle(P.shortName(s).toUpperCase(), `Leave by T+${P.hm(P.leaveBy(tl[idx]))}`);
}

/* ---------- frame loop ---------- */
let lastT = 0, hudT = 0, frames = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
  lastT = now;
  update(dt);
  if (fx && !S.lite) { sunOnLens(dt); fx.render(dt); } else renderer.render(scene, camera);
  placeLabels();
  drawTape();
  if (now - hudT > 90 || S.hudKey === "") { hudT = now; S.hudKey = "ok"; if (S.started) renderHud(); }
  frames++;
  if (now - fpsT > 1000) {
    S.fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now;
    // slow device: after three slow seconds in a row, draw fewer pixels and drop the shadows
    // (not while pictures are still being prepared: that work, not the device, makes those seconds slow)
    if (S.started && document.visibilityState === "visible" && now > (S.quietUntil || 0)) {
      S.slow = S.fps < 24 ? (S.slow || 0) + 1 : 0;
      if (S.slow >= 3 && !S.lite) {
        if (fx && !S.noFx) { S.noFx = true; fx = null; S.slow = 0; }   // first drop the film look, then (if still slow) the shadows and the sharpness
        else { S.lite = true; renderer.setPixelRatio(1); renderer.shadowMap.enabled = false; lights.sun.castShadow = false; }
        resize();
      }
    }
  }
}

// hooks for tests: read the helmet numbers, jump to a moment, change the view (nothing here changes the plan)
window.RR3D = { S, P, nav: () => navNow(), jump, setView, start, enterFree, setTenby, openDrill, closeDrill, info: () => ({ far: !!S.far, sunVis: +(S.sunVis || 0).toFixed(2), hi: !!S.hi, rocks: rocks ? rocks.counts : null, prints: prints ? prints.used : 0, fx: !!fx, view: S.view, intro: !!S.intro, ortho: !!S.ortho, fps: S.fps, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, ai: !!S.aiModel, field: !!S.field }) };

boot().catch((e) => { console.error(e); $("#lMsg").textContent = "Could not load the 3D walk. Please reload the page."; });
