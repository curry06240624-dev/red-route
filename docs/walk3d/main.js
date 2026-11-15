/* Red Route 3D walk: the planned Marswalk on the real terrain of Jezero, with the hurt-crewmate drill.
   A separate page next to the main app. It reads the same data (docs/data), uses the same route engine
   (docs/router.js, as a web worker) and the same rules (plan.js, copied from docs/app.js), so every number
   on screen is the number the main app shows.
   Views: third person (the lead), helmet view (first person), whole walk.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { buildTerrain } from "./terrain.js";
import { makeAstronaut, makeBaseCamp } from "./crew.js";
import * as P from "./plan.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const Q = new URLSearchParams(location.search);
const CAPTURE = Q.has("capture");   // for screen recordings and tests: no animation loop, frames are stepped by hand
const isPhone = () => window.matchMedia("(max-width: 900px)").matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const damp = (dt, k) => 1 - Math.exp(-dt * k);
const { fmtMin, hm, sgn, shortName, esc } = P;

/* The clock runs fast. Third person and whole walk: the default walk in about a minute.
   Helmet view: slower while walking, so the ground does not rush past. */
const RATE = 183 / 64, HELMET_RATE = 0.3, SPEEDS = [1, 2, 4, 0.5];
const COL = { route: 0xff6a3d, casing: 0x0b0b0b, crew: 0x38bdf8, home: 0xf9a8d4, bad: 0xf87171, warn: 0xfbbf24, ev1: 0xe5432f, ev2: 0x38bdf8 };
const SKY = { horizon: 0xdcbc9c, zenith: 0x8e6a55, glow: 0xf2dcc2, low: 0xbf9a7a, fog: 0xd6b594 };
// The sun: west-north-west, 32 degrees up. The orbital photo was taken with the sun on this side, so the shadows agree.
const SUN_DIR = new THREE.Vector3(-0.797, 0.530, -0.290).normalize();

const S = { base: null, m: null, T: 0, playing: false, speed: 1, mode: "follow", tenby: false, planning: false,
  drill: null, nav: null, time: 0, fieldReady: false, baseField: null, legEnd: [] };
const R = { pts: [], len: 0, k: 1 };   // the route in world metres
let terrain, renderer, scene, camera, sky, sun, worker, planId = 0, composer, bloom, film;
const lineMats = [], labels = [], planObjs = new THREE.Group(), drillObjs = new THREE.Group();
const crew = { ev1: null, ev2: null, h: 0, ph: 0, sep: 0.6, lat2: 0.6, along2: -0.5, c: new THREE.Vector3(), lab1: null, lab2: null, ring: null, hurtRing: null, snap: true };
const cam = { az: 0.9, el: 0.34, dist: 21, mul: 1, tgt: new THREE.Vector3(), auto: true, lastInput: -1e9, yaw: 0, pitch: -0.04,
  ov: { az: 0.35, el: 0.74, dist: 2700, tgt: new THREE.Vector3() }, trans: null, fov: 45, snap: true, sx: 0, sy: 0, sxT: 0, syT: 0, free: { l: 0, r: 1e5, t: 0, b: 1e5 } };
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), q4 = new THREE.Quaternion(), m4 = new THREE.Matrix4();

/* ---------- loading ---------- */
function progress(pct, txt) { $("#ldBar").style.width = `${pct}%`; if (txt) $("#ldTxt").textContent = txt; }
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

async function boot() {
  progress(8, "Loading the plan…");
  const get = (f) => fetch(`../data/${f}`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r; });
  const [mission, route] = await Promise.all([get("mission.json").then((r) => r.json()), get("route.geojson").then((r) => r.json())]);
  progress(22, "Loading the real terrain of Jezero…");
  const [slope, rough, dem] = await Promise.all(["grid_slope.u8", "grid_rough.u8", "grid_dem.i16"].map((f) => get(f).then((r) => r.arrayBuffer())));
  mission.routeCoords = route.features.map((f) => f.geometry.coordinates);
  S.base = mission; S.m = P.clone(mission);
  progress(46, "Building the ground…");
  await nextFrame();
  const stride = Q.has("mesh") ? clamp(parseInt(Q.get("mesh"), 10) || 1, 1, 8) : (isPhone() ? 2 : 1);
  initRenderer();
  terrain = await buildTerrain(mission.grid, dem.slice(0), { stride, zRef: P.stopById(mission, "base").elev_m, small: isPhone(),
    maxTex: renderer.capabilities.maxTextureSize, aniso: Math.min(16, renderer.capabilities.getMaxAnisotropy()) });
  progress(78, "Setting up the walk…");
  await nextFrame();
  initScene();
  initWorker(mission, slope, rough, dem);
  buildPlanScene();
  initUI();
  setTime(0);
  renderLive();
  onResize();
  tick(0.016); tick(0.016);
  if (!CAPTURE && !Q.has("nointro")) startIntro();
  progress(100, "Ready");
  $("#loading").classList.add("gone");
  setTimeout(() => ($("#loading").hidden = true), 600);
  if (!CAPTURE) {
    let last = performance.now();
    const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; tick(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

/* ---------- scene ---------- */
/* The film look: the picture is drawn in high dynamic range, then a soft glow is added around the brightest parts,
   the tones are rolled off like film (ACES), and a light vignette and grain are laid on top. */
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.035 }, vig: { value: 0.5 }, bars: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vig; uniform float bars; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      c.rgb *= mix(1.0, smoothstep(0.92, 0.28, length(q * vec2(1.0, 0.84))), vig);
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.22);
      c.rgb += (hash(floor(vUv * vec2(1600.0, 900.0)) + fract(time) * 91.7) - 0.5) * grain;
      c.rgb *= 1.0 - clamp(step(vUv.y, bars) + step(1.0 - bars, vUv.y), 0.0, 1.0);
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: $("#view"), antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: CAPTURE });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone() ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
}
const skyMaterial = (disc) => new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR }, horizon: { value: new THREE.Color(SKY.horizon) }, zenith: { value: new THREE.Color(SKY.zenith) },
    glow: { value: new THREE.Color(SKY.glow) }, low: { value: new THREE.Color(SKY.low) }, disc: { value: disc } },
  vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 glow; uniform vec3 low; uniform float disc; varying vec3 vDir;
    void main(){ vec3 d = normalize(vDir);
      float h = max(d.y, 0.0);
      vec3 col = mix(horizon, zenith, pow(h, 0.45));
      col = mix(col, glow, exp(-h * 10.0) * 0.6);                       // the dusty band along the horizon
      float s = max(dot(d, sunDir), 0.0);
      col += vec3(0.62, 0.74, 0.95) * (pow(s, 10.0) * 0.16 + pow(s, 90.0) * 0.5 + pow(s, 900.0) * 1.6);   // on Mars the sky is cooler and brighter round the sun
      col += vec3(1.0, 0.95, 0.88) * smoothstep(0.99990, 0.99996, s) * disc;   // the sun, small as seen from Mars
      col = mix(col, low, smoothstep(0.0, -0.07, d.y));
      gl_FragColor = vec4(col, 1.0);
    }` });
function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(SKY.fog, 0.00013);
  camera = new THREE.PerspectiveCamera(45, 1, 0.5, 90000);

  // sky and sun, drawn by this code: butterscotch at the horizon, darker overhead, a small sun with a cool glow
  sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), skyMaterial(40));
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  // the same sky lights the scene and is what shiny things (the visors) reflect
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(6)));
  scene.environment = pm.fromScene(envScene, 0, 1, 1000).texture; scene.environmentIntensity = 0.85;
  pm.dispose();

  scene.add(new THREE.HemisphereLight(0xffe2c6, 0x5e4030, 0.5));
  sun = new THREE.DirectionalLight(0xfff0de, 3.5);
  sun.castShadow = true;
  const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 220; sc.updateProjectionMatrix();
  sun.shadow.mapSize.set(isPhone() ? 1024 : 4096, isPhone() ? 1024 : 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2.2;
  scene.add(sun, sun.target);

  // the film look
  const w = window.innerWidth, h = window.innerHeight, pr = renderer.getPixelRatio();
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: isPhone() ? 0 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.24, 0.75, 0.9);
  if (!isPhone()) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  film = new ShaderPass(FilmShader);
  composer.addPass(film);

  terrain.mesh.updateMatrix();
  scene.add(terrain.mesh, terrain.far, planObjs, drillObjs);

  // crew
  crew.ev1 = makeAstronaut(COL.ev1); crew.ev2 = makeAstronaut(COL.ev2);
  scene.add(crew.ev1.root, crew.ev2.root);
  const ringMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: false });
  crew.ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), ringMat(COL.crew)); crew.ring.rotation.x = -Math.PI / 2; crew.ring.renderOrder = 5;
  crew.hurtRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), ringMat(COL.bad)); crew.hurtRing.rotation.x = -Math.PI / 2; crew.hurtRing.renderOrder = 6; crew.hurtRing.visible = false;
  scene.add(crew.ring, crew.hurtRing);
  crew.lab1 = addLabel("ev e1", "<span>EV1</span>", new THREE.Vector3(), true);
  crew.lab2 = addLabel("ev e2", "<span>EV2</span>", new THREE.Vector3(), true);

  // base camp: a little north of the first step outside, airlock facing the route
  const b = baseWorld(), hab = makeBaseCamp();
  hab.position.set(b.x, terrain.heightAt(b.x, b.z - 13) - 0.05, b.z - 13);
  scene.add(hab);
}

const baseWorld = () => { const s = P.stopById(S.m, "base"); return terrain.toWorld(s.lon, s.lat); };
const ground = (x, z, up = 0) => terrain.heightAt(x, z) + up;

function makeLine(pts, color, width, opt = {}) {
  const geo = new LineGeometry(); geo.setPositions(pts);
  // every line is drawn in the transparent pass, so the order (casing, route, way home) is the order given here
  const mat = new LineMaterial({ color, linewidth: width, worldUnits: false, transparent: true, opacity: opt.opacity ?? 1,
    dashed: !!opt.dash, dashSize: opt.dash ? opt.dash[0] : 1, gapSize: opt.dash ? opt.dash[1] : 1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mat.resolution.set(window.innerWidth, window.innerHeight);
  lineMats.push(mat);
  const line = new Line2(geo, mat);
  if (opt.dash) line.computeLineDistances();
  line.renderOrder = opt.order ?? 2; line.frustumCulled = false;
  return line;
}
function clearGroup(g) {
  for (const o of [...g.children]) {
    g.remove(o);
    o.traverse?.((c) => { c.geometry?.dispose(); if (c.material) { const i = lineMats.indexOf(c.material); if (i >= 0) lineMats.splice(i, 1); c.material.dispose(); } });
  }
}

/* ---------- labels: HTML over the 3D view, so the text stays sharp ---------- */
function addLabel(cls, html, pos, keep = false) {
  const e = el("div", `l3 ${cls}`, html); $("#labels").appendChild(e);
  const L = { el: e, pos, show: true, vis: null, keep };
  labels.push(L);
  return L;
}
function clearLabels() { for (let i = labels.length - 1; i >= 0; i--) if (!labels[i].keep) { labels[i].el.remove(); labels.splice(i, 1); } }
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  // the "tightest" mark belongs to the map-like views: hidden when the camera is close to it, and in a drill
  if (S.tightLabel) S.tightLabel.show = !S.drill && S.mode !== "helmet" && camera.position.distanceTo(S.tightLabel.pos) > 110;
  for (const L of labels) {
    v3.copy(L.pos).project(camera);
    const px = (v3.x * 0.5 + 0.5) * w, py = (-v3.y * 0.5 + 0.5) * h, F = cam.free;
    const vis = L.show && v3.z < 1 && v3.z > -1 && px > F.l + 4 && px < F.r - 10 && py > F.t + 18 && py < F.b - 6;
    if (vis !== L.vis) { L.el.style.display = vis ? "" : "none"; L.vis = vis; }
    if (vis) L.el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;
  }
}

/* ---------- the plan in the scene: route line, stops, leave-by labels ---------- */
function pointAt(d) {   // d in world metres along the route
  const p = R.pts;
  if (d <= 0) return p[0];
  if (d >= R.len) return p[p.length - 1];
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].d <= d) lo = mid; else hi = mid; }
  const a = p[lo], b = p[hi], f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}
const mine = (profileD) => profileD * R.k;   // the plan's distance along the walk -> metres along the drawn line
function routeDir(d, legLo = 0, legHi = R.len) {
  const a = pointAt(Math.max(legLo, d - 4)), b = pointAt(Math.min(legHi, d + 4));
  return Math.hypot(b.x - a.x, b.z - a.z) > 0.01 ? Math.atan2(b.x - a.x, b.z - a.z) : null;
}

function buildPlanScene() {
  const m = S.m;
  clearGroup(planObjs); clearLabels();
  // route in world metres
  const pts = []; let acc = 0, prev = null;
  for (const leg of m.routeCoords) for (const [lon, lat] of leg) {
    const p = terrain.toWorld(lon, lat);
    if (prev) acc += Math.hypot(p.x - prev.x, p.z - prev.z);
    pts.push({ x: p.x, z: p.z, d: acc }); prev = p;
  }
  R.pts = pts; R.len = acc; R.k = acc / m.profile[m.profile.length - 1].d;
  S.legEnd = []; for (const q of m.profile) S.legEnd[q.leg] = q.d;
  const flat = []; for (const p of pts) flat.push(p.x, ground(p.x, p.z, 0.5), p.z);
  planObjs.add(makeLine(flat, COL.casing, 7.5, { opacity: 0.6, order: 1 }));
  planObjs.add(makeLine(flat, COL.route, 3.6, { order: 2 }));

  // stops
  const tl = m.timeline || [], poleMat = new THREE.MeshBasicMaterial({ color: COL.route }), offMat = new THREE.MeshBasicMaterial({ color: 0x70767e });
  for (const s of m.stops) {
    const i = m.order.indexOf(s.id), on = i >= 0, w = terrain.toWorld(s.lon, s.lat), y = ground(w.x, w.z), H = 8;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, H, 6), on ? poleMat : offMat); pole.position.set(w.x, y + H / 2, w.z); planObjs.add(pole);
    const ring = []; for (let a = 0; a <= 36; a++) { const t = (a / 36) * Math.PI * 2, x = w.x + Math.cos(t) * 6, z = w.z + Math.sin(t) * 6; ring.push(x, ground(x, z, 0.4), z); }
    planObjs.add(makeLine(ring, on ? COL.route : 0x8b9099, 2.2, { order: 2, opacity: 0.95 }));
    let sub = "";
    if (!on) sub = "<small>OPTIONAL · NOT ON THIS WALK</small>";
    else if (s.id === "base") sub = `<small>START T+0:00 · HOME T+${hm(tl[tl.length - 1].arrive_min)}</small>`;
    else { const t = tl[i], late = P.leaveSpare(t) < 0; sub = `<small class="${late ? "badtx" : ""}">${late ? "LATE · " : ""}LEAVE BY T+${hm(P.leaveBy(t))}</small>`; }
    addLabel("stop", `<div class="mk ${on ? "" : "off"}">${P.numberOf(m, s.id)}</div><div class="tx"><b>${esc(shortName(s).toUpperCase())}</b>${sub}</div>`, new THREE.Vector3(w.x, y + H, w.z));
  }
  // the tightest point of the plan ("plan fits"), as on the app's map
  const wr = m.walkback.worst;
  if (wr && wr.lat != null) {
    const w = terrain.toWorld(wr.lon, wr.lat);
    S.tightLabel = addLabel("tight", `<i></i><span>Tightest ${sgn(wr.margin_min)}${fmtMin(wr.margin_min)}</span>`, new THREE.Vector3(w.x, ground(w.x, w.z, 0.6), w.z));
  } else S.tightLabel = null;
  // the whole-walk view looks at the middle of the route
  const bb = pts.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
  cam.ov.tgt.set((bb.x0 + bb.x1) / 2, ground((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2), (bb.z0 + bb.z1) / 2);
  cam.ov.dist = clamp(Math.max(bb.x1 - bb.x0, (bb.z1 - bb.z0) * 1.5) * (isPhone() ? 2.4 : 1.25) + 500, 1500, 7000);
  renderChecks(); renderTrack();
}

/* ---------- the route engine (docs/router.js), the same worker the app uses ---------- */
function initWorker(m, slope, rough, dem) {
  worker = new Worker("../router.js?v=8");
  worker.onmessage = onWorker;
  worker.onerror = (e) => console.error("route engine:", e.message);
  worker.postMessage({ type: "init", grid: m.grid, slope, rough, dem }, [slope, rough, dem]);
}
const stopsMsg = () => S.base.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, dwell_min: s.dwell_min }));
function onWorker(e) {
  const r = e.data;
  if (r.type === "ready") { worker.postMessage({ type: "field", id: ++planId, params: P.appParams(S.base), stops: stopsMsg() }); return; }
  if (r.type === "field") { S.baseField = r.field; if (!S.tenby) useField(r.field); if (S.pendingTenby) { S.pendingTenby = false; requestTenby(); } return; }
  if (r.type !== "plan" || r.id !== planId) return;
  S.planning = false;
  if (r.error || !S.tenby) { if (r.error) console.error(r.error); S.tenby = false; renderChecks(); return; }
  closeDrill();
  S.m = P.applyPlan(S.base, r);
  useField(r.field);
  buildPlanScene();
  // show the moment the plan breaks: the first minute the crew is outside the green area
  const B = S.m.walkback.budget_min, first = S.m.profile.find((q) => B - (q.t + 2 * q.back) < 0 || B - (q.t + q.back) < 0);
  crew.snap = cam.snap = true;
  setTime(first ? first.t + 0.4 : 0);
}
function useField(f) { terrain.setField(f); terrain.uniforms.zoneOn.value = 1; S.fieldReady = true; }
function requestTenby() {
  if (!S.baseField) { S.pendingTenby = true; return; }
  S.planning = true; renderChecks();
  worker.postMessage({ type: "plan", id: ++planId, params: P.appParams(S.base), order: P.DEFAULT_ORDER, stops: stopsMsg() });
}
function setTenby(on) {
  on = !!on;
  if (on === S.tenby) return;
  pause(); closeDrill();
  S.tenby = on;
  if (on) requestTenby();
  else {   // back to the stored plan
    planId++; S.planning = false;
    S.m = P.clone(S.base);
    if (S.baseField) useField(S.baseField);
    buildPlanScene();
    crew.snap = cam.snap = true;
    setTime(Math.min(S.T, playEnd()));
  }
}

/* ---------- the clock ---------- */
const lastT = () => S.m.profile[S.m.profile.length - 1].t;
function tMax() { return Math.max(240, Math.ceil((lastT() + 10) / 60) * 60); }   // whole hours on the bar
function playEnd() { return Math.min(tMax(), lastT() + 10); }                      // stop shortly after the crew is home
function setTime(T, keepDrill = false) {
  if (S.drill && !keepDrill) closeDrill(false);
  S.T = clamp(T, 0, tMax());
  S.nav = P.liveAt(S.m, S.T);
  S.uiDirty = true;
}
function play() {
  if (S.drill) closeDrill();
  if (S.T >= playEnd() - 0.5) { crew.snap = cam.snap = true; setTime(0); }
  S.playing = true; cam.auto = true; setPlayBtn();
}
function pause() { S.playing = false; setPlayBtn(); }
function setPlayBtn() {
  const done = S.T >= lastT(), label = S.playing ? "Pause" : done ? "Walk it again" : "Walk the plan";
  $("#playBtn").innerHTML = `<span class="${S.playing ? "sq" : "tri"}"></span><span class="pl">${label}</span>`;
  $("#playBtn").setAttribute("aria-label", label);
}
// The tightest moment of the plan for a hurt crewmate. If it is the moment of leaving a stop, the clock is set to
// the last instant at that stop (0.05 min earlier), so the crew is still standing there.
function tightestT() {
  const m = S.m, t = m.walkback.bad.worst.t, tl = m.timeline;
  const atStop = tl.some((x, i) => i > 0 && i < tl.length - 1 && x.depart_min > x.arrive_min && Math.abs(x.depart_min - t) < 0.06);
  return atStop ? t - 0.05 : t;
}
function clockRate() {
  const n = S.nav, walking = n && !n.st.gap && !n.st.after;
  return (S.mode === "helmet" && walking ? HELMET_RATE : RATE) * S.speed;
}

/* ---------- the drill: crewmate hurt here ----------
   Reads the same numbers as the "If something goes wrong" check at the crew's position, like the app's drill card.
   Then it plays the walk home: EV2 goes down, EV1 helps them home at half speed, and the clock runs against the
   time left. The verdict at the end is the verdict the app's card gives. */
function homePath(n) {
  const m = S.m, Pf = m.profile, st = n.st, L = m.order.length - 2;
  const here = pointAt(mine(st.d)), pts = [{ x: here.x, z: here.z, tau: 0 }];
  if (!(n.back > 0)) return pts;
  const Tgo = st.gap ? st.q.t : n.T;   // where on the plan the walking starts again
  if (n.leg === L && Math.abs(n.lastT - Tgo - n.back) <= 0.7) {   // on the last leg the planned route is the way home
    for (const q of Pf) if (q.leg === L && q.t > Tgo) { const p = pointAt(mine(q.d)); pts.push({ x: p.x, z: p.z, tau: (q.t - Tgo) / (n.lastT - Tgo) }); }
    return pts;
  }
  const tBack = st.gap ? st.p.t : n.T;
  if (st.p.leg === 0 && Math.abs(tBack - n.back) <= 0.7) {       // on the first leg the way home is the way out, walked back
    for (let i = Pf.length - 1; i >= 0; i--) { const q = Pf[i]; if (q.leg === 0 && q.t < tBack) { const p = pointAt(mine(q.d)); pts.push({ x: p.x, z: p.z, tau: (tBack - q.t) / tBack }); } }
    return pts;
  }
  const way = terrain.wayHome(here.x, here.z);                    // anywhere else: downhill on the walk-home layer, like the app's dotted line
  if (way && way.length > 1 && way[0].back > 0) {
    for (let i = 1; i < way.length; i++) pts.push({ x: way[i].x, z: way[i].z, tau: clamp(1 - way[i].back / way[0].back, 0, 1) });
    const b = baseWorld(); pts.push({ x: b.x, z: b.z, tau: 1 });
    for (let i = 1; i < pts.length; i++) pts[i].tau = Math.max(pts[i].tau, pts[i - 1].tau);
    return pts;
  }
  const d0 = mine(st.d);                                           // no path on the layer: the rest of the planned route
  for (const p of R.pts) if (p.d > d0) pts.push({ x: p.x, z: p.z, tau: (p.d - d0) / Math.max(1, R.len - d0) });
  return pts;
}
function pathAt(path, u) {
  if (path.length < 2 || u <= 0) return path[0];
  let i = 1; while (i < path.length - 1 && path[i].tau < u) i++;
  const a = path[i - 1], b = path[i], f = b.tau > a.tau ? clamp((u - a.tau) / (b.tau - a.tau), 0, 1) : 1;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, i };
}
const FALL_S = 2.6, HELP_S = 2.8;   // seconds for EV2 going down, and for EV1 kneeling and getting them up
function startDrill() {
  const n = S.nav;
  if (!n || n.st.after || S.planning) return;
  if (S.drill) closeDrill();
  pause();
  const nums = P.hurtDrill(S.m, n), path = homePath(n), walkMin = n.bf * n.back;
  // if the walk home does not fit, the crew is stopped where the time runs out
  const uEnd = nums.ok || nums.half <= 0 ? 1 : clamp(nums.left / nums.half, 0, 1);
  S.drill = { phase: "fall", t: 0, n, T0: n.T, nums, path, walkMin, uEnd, u: 0, h0: crew.h,
    dur: Math.max(walkMin > 0 ? 3 : 0, clamp(walkMin * 0.36, 8, 24) * uEnd) };
  clearGroup(drillObjs);
  document.body.classList.add("cinema");
  if (path.length > 1) {
    const flat = []; for (const p of path) flat.push(p.x, ground(p.x, p.z, 0.75), p.z);
    drillObjs.add(makeLine(flat, COL.home, 4.6, { dash: [0.45, 0.75], order: 3 }));
  }
  renderDrill();
  S.uiDirty = true;
}
function closeDrill(restore = true) {
  if (!S.drill) return;
  const T0 = S.drill.T0;
  S.drill = null;
  document.body.classList.remove("cinema");
  clearGroup(drillObjs);
  $("#drill").hidden = true;
  crew.hurtRing.visible = false; crew.lab2.el.classList.remove("is-hurt"); crew.lab2.el.firstChild.textContent = "EV2";
  if (restore) { S.T = T0; S.nav = P.liveAt(S.m, T0); }
  crew.snap = true; S.uiDirty = true; measure();
}
function stepDrill(dt) {
  const D = S.drill;
  D.t += dt;
  if (D.phase === "fall" && D.t >= FALL_S) { D.phase = "help"; D.t = 0; }
  else if (D.phase === "help" && D.t >= HELP_S) { D.phase = D.dur > 0 ? "walk" : "done"; D.t = 0; if (D.phase === "done") renderDrill(); }
  else if (D.phase === "walk") {
    D.u = Math.min(D.uEnd, (D.t / D.dur) * D.uEnd);
    S.T = D.T0 + D.u * D.walkMin;   // the clock runs while they walk home, so the green area keeps closing
    if (D.t >= D.dur) { D.phase = "done"; D.t = 0; renderDrill(); }
  }
  S.uiDirty = true;
}
function renderDrill() {
  const D = S.drill, n = D.n, x = D.nums, done = D.phase === "done";
  const row = (k, v) => `<div class="dr"><span>${k}</span><b>${v}</b></div>`;
  const verdict = done ? `<div class="dv ${x.ok ? "ok" : "bad"}" id="rcVerdict">${x.word}<small>${x.spareTxt}</small></div>`
    : `<div class="dv wait" id="rcVerdict">EV1 IS HELPING EV2 HOME<small>Half speed, along the way home</small></div>`;
  $("#drill").innerHTML = `<div class="dh"><span class="lbl">Drill · T+${hm(n.T)} · ${esc(x.where)}</span><button class="x" data-close aria-label="Close the drill">&times;</button></div>
    <div class="dt">Crewmate hurt (EV2)</div>
    ${row("Walk home at normal pace", fmtMin(x.backR))}${row("At half speed, EV1 helping the hurt EV2", fmtMin(x.half))}${row(`Time left to be home by T+${hm(x.homeBy)}`, fmtMin(x.left))}
    <div class="race"><div class="rw"><span>Walk home still to go</span><b id="rcHome"></b><div class="bar home"><i id="rcHomeBar"></i></div></div>
      <div class="rw"><span>Time left</span><b id="rcLeft"></b><div class="bar left" id="rcLeftWrap"><i id="rcLeftBar"></i></div></div>
      <div class="met" id="rcMet"></div></div>
    ${verdict}
    <p class="dn">Same rule as the "If something goes wrong" check. The reserve stays untouched.${done && !x.ok ? " The crew is stopped where the time runs out: the rest of the walk home would use the reserve." : ""}</p>
    <button class="ghost" data-close>Back to the walk</button> ${done ? '<button class="ghost" data-again>Play it again</button>' : ""}`;
  $("#drill").classList.toggle("running", !done);
  $("#drill").hidden = false;
  updateDrillClock(); measure();
}
function updateDrillClock() {
  const D = S.drill; if (!D) return;
  const x = D.nums, scale = Math.max(1, x.left, x.half);
  const home = Math.max(0, x.half * (1 - D.u)), left = x.left - x.half * D.u;
  const a = $("#rcHome"); if (!a) return;
  a.textContent = fmtMin(home); $("#rcHomeBar").style.width = `${(home / scale) * 100}%`;
  $("#rcLeft").textContent = left >= 0 ? fmtMin(left) : `${fmtMin(left)} over`; $("#rcLeftBar").style.width = `${(Math.max(0, left) / scale) * 100}%`;
  $("#rcLeftWrap").classList.toggle("bad", !x.ok);
  $("#rcMet").textContent = `CLOCK T+${hm(S.T)} · HOME BY T+${hm(x.homeBy)}`;
}

/* ---------- the crew ---------- */
function placeCrew(dt) {
  const n = S.nav, D = S.drill, e1 = crew.ev1, e2 = crew.ev2;
  let c, ht = null, pose = "walk";
  if (D) {
    c = pathAt(D.path, D.u);
    if (D.phase === "fall" || D.phase === "help") { pose = D.phase; ht = D.h0; }
    else {
      pose = D.phase === "walk" ? "carry" : (D.nums.ok ? "home" : "stopped");
      const a = pathAt(D.path, Math.max(0, D.u - 0.004)), b = pathAt(D.path, Math.min(1, D.u + 0.012));
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.05) ht = Math.atan2(b.x - a.x, b.z - a.z);
    }
  } else if (n.st.after) { c = R.pts[R.pts.length - 1]; pose = "home"; }
  else {
    const d = mine(n.st.d); c = pointAt(d);
    if (n.st.gap) { pose = "site"; ht = routeDir(d - 4); } else ht = routeDir(d);
  }
  const snap = crew.snap || dt <= 0;
  if (ht != null) crew.h = snap ? ht : crew.h + angDiff(ht, crew.h) * damp(dt, 7);
  const close = pose === "carry" || pose === "stopped" || pose === "help";
  const helm = S.mode === "helmet";
  const site = pose === "site";
  const sepT = close ? 0.31 : site ? 0.9 : 0.6, alongT = D ? (helm && !close ? 2.4 : 0) : (helm ? 4.4 : site ? 0.9 : -0.5), lat2T = close ? 0.31 : helm ? 1.5 : site ? 1.3 : 0.6;
  crew.sep = snap ? sepT : crew.sep + (sepT - crew.sep) * damp(dt, 5);
  crew.lat2 = snap ? lat2T : crew.lat2 + (lat2T - crew.lat2) * damp(dt, 4);
  crew.along2 = snap ? alongT : crew.along2 + (alongT - crew.along2) * damp(dt, 3);
  crew.snap = false;
  const h = crew.h, fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
  const p1x = c.x + lx * crew.sep, p1z = c.z + lz * crew.sep, p2x = c.x - lx * crew.lat2 + fx * crew.along2, p2z = c.z - lz * crew.lat2 + fz * crew.along2;
  e1.root.position.set(p1x, ground(p1x, p1z), p1z); e2.root.position.set(p2x, ground(p2x, p2z), p2z);
  e1.root.rotation.y = h; e2.root.rotation.y = h;
  crew.c.set(c.x, ground(c.x, c.z), c.z);

  const t = S.time;
  if (pose === "walk") {
    if (S.playing) crew.ph += dt * 8.2; else crew.ph = mine(n.st.d) * 2.6;
    e1.walk(crew.ph); e2.walk(crew.ph + 1.4);
  } else if (pose === "site") { e1.idle(t, 0); e2.work(t); e2.root.rotation.y = h + 0.9; }
  else if (pose === "home") { e1.idle(t, 0); e2.idle(t, 2); }
  else if (pose === "fall") { const k = D.t / FALL_S; e2.fall(k); e1.idle(t, 0); e1.root.rotation.y = h - (Math.PI / 2) * ease(k * 1.4); }
  else if (pose === "help") {
    const k = D.t / HELP_S;
    e2.fall(1 - ease((k - 0.35) / 0.65)); e1.kneel(Math.sin(Math.PI * clamp(k, 0, 1)) ** 0.7);
    e1.root.rotation.y = h - (Math.PI / 2) * (1 - ease((k - 0.55) / 0.45));
  } else if (pose === "carry") { crew.ph += dt * 4.4; e2.supported(crew.ph, 1); e1.supporting(crew.ph, -1); }
  else { e2.fall(1); e1.kneel(0.75); e1.root.rotation.y = h - Math.PI / 2; }   // stopped: the time has run out

  const hurt = !!D && !(D.phase === "done" && D.nums.ok);
  crew.lab2.el.classList.toggle("is-hurt", hurt); crew.lab2.el.firstChild.textContent = hurt ? "EV2 HURT" : "EV2";
  e1.root.visible = S.mode !== "helmet" || !!cam.trans;
  crew.lab1.show = S.mode !== "helmet"; crew.lab1.pos.set(p1x, e1.root.position.y + 2.25, p1z); crew.lab2.pos.set(p2x, e2.root.position.y + (hurt && pose !== "carry" ? 1.7 : 2.25), p2z);

  // light and shadow follow the crew
  sun.target.position.copy(crew.c); sun.position.copy(crew.c).addScaledVector(SUN_DIR, 110);
  // "crew now" ring on the ground, sized so it can be seen from far away
  const camD = camera.position.distanceTo(crew.c), r = Math.max(1.7, camD * 0.02);
  crew.ring.visible = S.mode !== "helmet";
  crew.ring.position.set(c.x, crew.c.y + 0.12 + r * 0.02, c.z); crew.ring.scale.setScalar(r);
  if (hurt && pose !== "carry") {
    const rr = 1.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 5));
    crew.hurtRing.visible = true; crew.hurtRing.position.set(p2x, e2.root.position.y + 0.14, p2z); crew.hurtRing.scale.setScalar(rr); crew.hurtRing.material.opacity = 0.9 - 0.4 * (0.5 + 0.5 * Math.sin(t * 5));
  } else crew.hurtRing.visible = false;
}

/* ---------- camera ---------- */
function desiredCamera(dt, outPos, outQuat) {
  const D = S.drill;
  if (S.mode === "overview") {
    const o = cam.ov;
    outPos.set(o.tgt.x + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.tgt.y + Math.sin(o.el) * o.dist, o.tgt.z + Math.cos(o.az) * Math.cos(o.el) * o.dist);
    m4.lookAt(outPos, o.tgt, camera.up); outQuat.setFromRotationMatrix(m4);
    return { fov: tallFov(40), near: 20 };
  }
  if (S.mode === "helmet") {
    const e1 = crew.ev1, h = crew.h + cam.yaw, p = clamp(cam.pitch, -1.2, 1.2);
    outPos.set(e1.root.position.x, e1.root.position.y + 1.66 + e1.body.position.y, e1.root.position.z);
    v3.set(outPos.x + Math.sin(h) * Math.cos(p), outPos.y + Math.sin(p), outPos.z + Math.cos(h) * Math.cos(p));
    m4.lookAt(outPos, v3, camera.up); outQuat.setFromRotationMatrix(m4);
    return { fov: isPhone() ? 80 : 68, near: 0.15 };
  }
  // third person: orbit the crew. While the clock plays the camera pulls back; in the drill it moves in.
  v3.copy(crew.c); v3.y += 1.15;
  if (cam.snap) cam.tgt.copy(v3); else cam.tgt.lerp(v3, damp(dt, 22));
  const mulT = D ? (D.phase === "walk" ? 0.75 : D.phase === "done" ? 0.7 : 0.3) : S.playing ? 2.4 + 0.5 * Math.min(3, S.speed) : 1;
  cam.mul = cam.snap ? mulT : cam.mul + (mulT - cam.mul) * damp(dt, 1.7);
  if (S.playing && S.time - cam.lastInput > 4) cam.auto = true;
  const idle = S.time - cam.lastInput > 4;
  if (D && (D.phase === "walk" || D.phase === "done")) {
    // the walk home: first seen from the front, with the green edge closing in behind the crew; then from behind,
    // as base camp comes up; at the end from the south, with base camp behind them
    if (idle) {
      const k = ease((D.u / Math.max(0.001, D.uEnd) - 0.45) / 0.4);
      const azT = D.phase === "done" && D.nums.ok ? 0.5 : crew.h + 0.8 + (Math.PI - 0.18) * k;
      cam.az += angDiff(azT, cam.az) * damp(dt, D.phase === "done" ? 1.6 : 1.2);
    }
  } else if (cam.auto && !D) {
    const azT = crew.h + Math.PI + 0.62;   // behind the crew, a little to one side
    cam.az = cam.snap ? azT : cam.az + angDiff(azT, cam.az) * damp(dt, 1.1);
  }
  const dist = cam.dist * cam.mul;
  outPos.set(cam.tgt.x + Math.sin(cam.az) * Math.cos(cam.el) * dist, cam.tgt.y + Math.sin(cam.el) * dist, cam.tgt.z + Math.cos(cam.az) * Math.cos(cam.el) * dist);
  const gy = ground(outPos.x, outPos.z, 1.0); if (outPos.y < gy) outPos.y = gy;
  m4.lookAt(outPos, cam.tgt, camera.up); outQuat.setFromRotationMatrix(m4);
  return { fov: tallFov(45), near: clamp(dist * 0.03, 0.3, 30) };
}
// On a screen taller than wide, open the view up so that it is never narrower than 36 degrees across.
function tallFov(fov) {
  const a = window.innerWidth / window.innerHeight;
  return a >= 1 ? fov : Math.max(fov, (2 * Math.atan(Math.tan((18 * Math.PI) / 180) / a) * 180) / Math.PI);
}
function updateCamera(dt) {
  const want = desiredCamera(dt, v3b, q4);
  if (cam.trans) {
    cam.trans.t += dt / (cam.trans.dur || 1.3);
    const k = ease(cam.trans.t);
    camera.position.lerpVectors(cam.trans.pos, v3b, k); camera.quaternion.slerpQuaternions(cam.trans.quat, q4, k);
    cam.fov = cam.trans.fov + (want.fov - cam.trans.fov) * k;
    if (cam.trans.t >= 1) cam.trans = null;
  } else { camera.position.copy(v3b); camera.quaternion.copy(q4); cam.fov = want.fov; }
  cam.sx = cam.snap ? cam.sxT : cam.sx + (cam.sxT - cam.sx) * damp(dt, 3); cam.sy = cam.snap ? cam.syT : cam.sy + (cam.syT - cam.sy) * damp(dt, 3);
  cam.snap = false;
  camera.fov = cam.fov; camera.near = want.near;
  camera.setViewOffset(window.innerWidth, window.innerHeight, -cam.sx, -cam.sy, window.innerWidth, window.innerHeight);   // also updates the projection
  sky.position.copy(camera.position);
}
// Where the middle of the free screen area is (between the checks panel, the drill card, the strip on top and the
// clock bar), as a shift from the middle of the window. Measured when the layout changes, not on every frame.
function measure() {
  const Wd = window.innerWidth, H = window.innerHeight, rect = (id) => { const e = $(id), r = e && !e.hidden ? e.getBoundingClientRect() : null; return r && r.width > 0 && r.height > 0 ? r : null; };
  const side = rect("#checks"), card = rect("#drill"), live = rect("#live"), clock = rect("#clock"), modes = rect(".modes"), phone = isPhone();
  if (S.mode === "helmet") { cam.sxT = cam.syT = 0; cam.free = { l: 0, r: Wd, t: modes ? modes.bottom : 0, b: clock ? clock.top : H }; return; }
  const left = !phone && side ? side.right : 0, right = !phone && card ? card.left : Wd;
  const top = Math.max(live ? live.bottom : 0, modes ? modes.bottom : 0), bottom = phone && card ? card.top : clock ? clock.top : H;
  cam.free = { l: left, r: right, t: top, b: bottom };
  cam.sxT = (left + right) / 2 - Wd / 2; cam.syT = (top + bottom) / 2 - H / 2;
}
// Real seconds for things that must end on time even when the picture is slow (stepped by hand in tests).
const clockS = () => (CAPTURE ? S.time : performance.now() / 1000);
/* The opening: wide-screen bars, the title, and the camera coming down from high over the crater to the crew.
   Any click, key or touch skips it. */
function startIntro() {
  const c = crew.c, az = cam.az + 1.1, el = 0.42, d = 1500;
  camera.position.set(c.x + Math.sin(az) * Math.cos(el) * d, c.y + Math.sin(el) * d, c.z + Math.cos(az) * Math.cos(el) * d);
  camera.lookAt(c.x, c.y + 20, c.z);
  cam.trans = { t: 0, dur: 7, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: 38, intro: true };
  document.body.classList.add("cinema", "intro");
  $("#title").hidden = false;
  S.introEnd = clockS() + 7.2;
  const skip = (e) => { if (e && e.target && e.target.closest && e.target.closest("#title")) return; endIntro(true); };   // the title's own buttons handle themselves
  S.introSkip = skip;
  window.addEventListener("pointerdown", skip); window.addEventListener("keydown", skip);
}
function endIntro(skipped) {
  if (!document.body.classList.contains("intro")) return;
  document.body.classList.remove("cinema", "intro");
  $("#title").classList.add("out"); setTimeout(() => ($("#title").hidden = true), 700);
  window.removeEventListener("pointerdown", S.introSkip); window.removeEventListener("keydown", S.introSkip);
  if (skipped && cam.trans && cam.trans.intro) cam.trans.t = Math.max(cam.trans.t, 0.82);   // finish the move quickly
  S.introEnd = null; measure();
}
// One click to the lead scene: the tightest moment of the plan, then the crewmate gets hurt.
function playDrill() {
  endIntro(true);
  if (S.mode === "overview") setMode("follow");
  pause(); if (S.drill) closeDrill();
  crew.snap = cam.snap = true; cam.auto = true; setTime(tightestT());
  S.pendingDrill = clockS() + 1.1;
}
function setMode(mode) {
  if (mode === S.mode) return;
  endIntro(true);
  cam.trans = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
  S.mode = mode; cam.yaw = 0; cam.pitch = -0.04; cam.auto = true;
  if (mode === "follow") cam.snap = true;
  document.body.classList.toggle("mode-helmet", mode === "helmet");
  document.querySelectorAll(".modes button[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("#helmet").hidden = mode !== "helmet";
  $("#hHint").classList.remove("off"); setTimeout(() => $("#hHint").classList.add("off"), 5000);
  S.uiDirty = true; measure();
}

/* ---------- input: drag to look or orbit, wheel or pinch to zoom ---------- */
function initInput() {
  const cv = $("#view"), ptr = new Map();
  let pinch = 0;
  const touched = () => { cam.lastInput = S.time; cam.auto = false; };
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); cv.classList.add("drag"); pinch = 0; });
  cv.addEventListener("pointermove", (e) => {
    const p = ptr.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoom(pinch / d);
      pinch = d; touched(); return;
    }
    touched();
    if (S.mode === "helmet") { cam.yaw += dx * 0.0042; cam.pitch = clamp(cam.pitch + dy * 0.0042, -1.2, 1.2); $("#hHint").classList.add("off"); }
    else { const o = S.mode === "overview" ? cam.ov : cam; o.az -= dx * 0.0058; o.el = clamp(o.el + dy * 0.0048, 0.05, 1.45); }
  });
  const up = (e) => { ptr.delete(e.pointerId); pinch = 0; if (!ptr.size) cv.classList.remove("drag"); };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  function zoom(f) {
    if (S.mode === "overview") cam.ov.dist = clamp(cam.ov.dist * f, 250, 9000);
    else if (S.mode === "follow") cam.dist = clamp(cam.dist * f, 5, 900);
  }
  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(clamp(e.deltaY, -300, 300) * 0.0014)); cam.lastInput = S.time; }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") { if (e.key !== "Escape") return; }
    const o = S.mode === "overview" ? cam.ov : cam;
    if (e.key === " ") { e.preventDefault(); S.playing ? pause() : play(); }
    else if (e.key === "Escape") { if (!$("#film").hidden) { $("#filmVideo").pause(); $("#film").hidden = true; } else if (!$("#credits").hidden) $("#credits").hidden = true; else closeDrill(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const s = e.key === "ArrowLeft" ? 1 : -1; touched(); if (S.mode === "helmet") cam.yaw += s * 0.09; else o.az -= s * 0.09; }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") { const s = e.key === "ArrowUp" ? 1 : -1; touched(); if (S.mode === "helmet") cam.pitch = clamp(cam.pitch + s * 0.07, -1.2, 1.2); else o.el = clamp(o.el + s * 0.06, 0.05, 1.45); }
  });
}

/* ---------- panels ---------- */
const signed1 = (x) => `${sgn(x)}${Math.abs(x).toFixed(1)} min`;
function renderChecks() {
  const m = S.m, t = m.totals, wb = m.walkback, air = wb.airlock_min || 0, tl = m.timeline, checks = P.getChecks(m);
  const plan = checks[0], b = wb.bad.worst, s = wb.suit.worst;
  const at = tl.find((x, i) => i > 0 && i < tl.length - 1 && Math.abs(x.depart_min - b.t) < 0.06);
  const tight = at ? `leaving ${shortName(P.stopById(m, at.id))}` : `near ${shortName({ name: P.nearestStopName(m, b.lat, b.lon) })}`;
  const home = tl[tl.length - 1].arrive_min;
  const rows = checks.map((c) => `<div class="chk" data-check="${c.key}"><span class="k">${c.name}</span><span class="v ${c.ok ? "ok" : "bad"}">${esc(c.val)}</span><span class="s">${esc(c.sub)}</span></div>`).join("");
  $("#checks").innerHTML = `${plan.ok ? "" : `<div class="planfail" id="planFail">PLAN FAILS BY ${fmtMin(plan.margin).toUpperCase()}<small>With Tenby the crew is home at T+${hm(home)}, ${fmtMin(plan.margin)} after T+${hm(wb.budget_min)}. The green area closes before the crew is back.</small></div>`}
    <div class="lbl-lg">Get-home checks</div>${rows}`;
  $("#hChecks").innerHTML = checks.map((c) => `<div><span class="lbl">${c.name}</span><b class="${c.ok ? "ok" : "bad"}">${esc(c.val)}</b></div>`).join("");
  $("#checks").innerHTML += `
    <div class="exact" id="exact"><div class="lbl">Exact numbers · ${S.tenby ? "re-planned, 4 m grid" : "the stored plan"}</div>
      <div>Plan fits <b>${signed1(wb.worst.margin_min)}</b> · hurt crewmate <b>${signed1(b.margin_min)}</b></div>
      <div>Tightest moment: <b>${esc(tight)} at T+${hm(b.t)}</b></div>
      <div>Suit failure: <b>${s.back.toFixed(1)} of ${wb.suit.limit_min} min</b>, at ${esc(shortName({ name: P.nearestStopName(m, s.lat, s.lon) }))}</div>
      <div>Home at <b>T+${hm(home)}</b> · must be home by <b>T+${hm(wb.budget_min)}</b></div>
      <div>Walk length: <b>${t.dist_km.toFixed(2)} km</b></div></div>
    <div class="mission">${t.dist_km.toFixed(1)} KM · +${t.gain_m} M · MAX ${t.max_slope.toFixed(1)}°<br>${fmtMin(t.eva_h * 60).toUpperCase()} OUTSIDE${air ? ` · ${fmtMin(t.eva_h * 60 + air).toUpperCase()} IN THE SUIT` : ""}<br>CREW OF TWO · EV1 AND EV2 WALK TOGETHER</div>
    <div class="whatif"><label class="tog"><input type="checkbox" id="tenby" ${S.tenby ? "checked" : ""}${S.planning ? " disabled" : ""}> <span>What if: add a third stop, Tenby</span></label>
      <small id="planStatus">${S.planning ? "Re-planning with the app's route engine…" : S.tenby ? "Untick to go back to the plan that fits." : "The plan is re-made by the app's own route engine."}</small></div>
    <div class="legend"><div><i style="height:3px;background:var(--route)"></i>Planned Marswalk</div>
      <div><i style="background:rgba(74,222,128,.45);border:1px solid #bbf7d0"></i>Can still get home if EV2 is hurt</div>
      <div><i style="height:2px;background:rgba(255,255,255,.7)"></i>Normal-pace limit</div>
      <div><i style="height:0;border-top:2px dashed var(--warn)"></i>50 min of backup oxygen from base</div>
      <div><i style="background:rgba(220,38,38,.65)"></i>No-go slope, steeper than ${m.assumptions.max_slope_deg}°</div></div>`;
}

function renderTrack() {
  const m = S.m, tl = m.timeline, Tm = tMax(), pct = (t) => `${clamp((t / Tm) * 100, 0, 100)}%`, narrow = isPhone();
  let hours = "";
  for (let h = 0; h <= Tm / 60; h++) hours += `<i style="left:${pct(h * 60)}"></i>${narrow && h % 2 ? "" : `<span class="${h === 0 ? "first" : h === Tm / 60 ? "last" : ""}" style="left:${pct(h * 60)}">T+${h}:00</span>`}`;
  $("#trkHours").innerHTML = hours;
  let h = `<div class="trk-homeby ${narrow && m.walkback.budget_min / Tm > 0.72 ? "lft" : ""}" style="left:${pct(m.walkback.budget_min)}"><em>HOME BY T+${hm(m.walkback.budget_min)}</em></div>`;
  tl.forEach((t, i) => {
    const last = i === tl.length - 1;
    if (t.depart_min > t.arrive_min) h += `<div class="trk-dwell" style="left:${pct(t.arrive_min)};width:${((t.depart_min - t.arrive_min) / Tm) * 100}%"></div>`;
    const name = narrow ? `${i + 1}` : i === 0 ? "1 BASE" : last ? `${tl.length} HOME` : `${i + 1} ${shortName(P.stopById(m, t.id)).toUpperCase()}`;
    h += `<div class="trk-stop" style="left:${pct(t.arrive_min)}"><i></i><em>${esc(name)}</em></div>`;
  });
  $("#trkStops").innerHTML = h;
  $("#track").setAttribute("aria-valuemax", Tm);
}

const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
let lastLive = "", lastBanner = "";
function renderLive() {
  const m = S.m, n = S.nav, D = S.drill, st = n.st;
  let html;
  if (D) {
    const x = D.nums, home = Math.max(0, x.half * (1 - D.u)), left = x.left - x.half * D.u;
    html = `<div><span class="lbl">MET</span><b>T+${hm(S.T)}</b></div>
      <div class="where"><span class="lbl">Drill</span><b>CREWMATE HURT (EV2)</b><small>${esc(x.where)}</small></div>
      <div><span class="lbl">Walk home, half speed</span><b>${fmtMin(home)}</b></div>
      <div><span class="lbl">Time left</span><b class="${left < 0 ? "bad" : "ok"}">${left >= 0 ? fmtMin(left) : `${fmtMin(left)} over`}</b></div>
      <div><span class="lbl">Home by</span><b>T+${hm(x.homeBy)}</b></div>`;
  } else {
    let whereLbl, whereVal, whereSub = "";
    if (st.after) { whereLbl = "Status"; whereVal = "BACK AT BASE CAMP"; whereSub = `Home at T+${hm(n.lastT)}`; }
    else if (n.here) { const tl = m.timeline[st.q.leg]; whereLbl = "On site"; whereVal = shortName(n.here).toUpperCase(); if (tl) whereSub = `Leave by T+${hm(P.leaveBy(tl))}`; }
    else {
      const w = terrain.toWorld(n.nextS.lon, n.nextS.lat), dx = w.x - crew.c.x, dz = w.z - crew.c.z;
      whereLbl = "Next stop";
      whereVal = `${shortName(n.nextS).toUpperCase()} · ${(Math.hypot(dx, dz) / 1000).toFixed(2)} KM ${compass(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360)}`;
      whereSub = `Slope ${Math.round(st.p.s)}° · ${Math.round(st.p.z)} m`;
    }
    html = `<div><span class="lbl">MET</span><b>T+${hm(S.T)}</b></div>
      <div class="where"><span class="lbl">${whereLbl}</span><b>${esc(whereVal)}</b>${whereSub ? `<small>${esc(whereSub)}</small>` : ""}</div>
      <div><span class="lbl">Walk home</span><b class="${n.suitBad ? "bad" : ""}">${fmtMin(n.back)}</b></div>
      <div><span class="lbl">If something goes wrong</span><b class="${n.mBad < 0 ? "bad" : "ok"}">${sgn(n.mBad)}${fmtMin(n.mBad)}</b></div>
      <div><span class="lbl">Plan fits</span><b class="${n.mPlan < 0 ? "bad" : n.mPlan < 30 ? "warn" : "ok"}">${sgn(n.mPlan)}${fmtMin(n.mPlan)}</b></div>`;
  }
  if (html !== lastLive) { $("#live").innerHTML = html; lastLive = html; }
  $("#live").classList.toggle("alarm", !D && n.alarm);
  // TURN BACK: the same condition as the app (a time check is broken here, or the walk home is longer than the backup oxygen)
  let ban = "";
  if (!D && n.alarm && S.mode !== "helmet") {
    const w = P.statusWord(m, n), pf = m.walkback.worst.margin_min < 0 ? `Plan fails by ${fmtMin(m.walkback.worst.margin_min)} · ` : "";
    ban = `TURN BACK<small>${pf}${esc(w.spare)}</small>`;
  }
  if (ban !== lastBanner) { $("#banner").innerHTML = ban; $("#banner").hidden = !ban; lastBanner = ban; }
  $("#hurtBtn").disabled = st.after || S.planning;
}

/* helmet view: status word, time to spare, hurt-crewmate margin, leave-by, walk home against the backup oxygen */
function renderHelmet() {
  if (S.mode !== "helmet") return;
  const m = S.m, n = S.nav, D = S.drill, st = n.st, w = P.statusWord(m, n);
  $("#hMet").textContent = `T+${hm(S.T)}`;
  const top = $(".h-top");
  if (D) {
    const x = D.nums, done = D.phase === "done", left = x.left - x.half * D.u;
    top.className = `h-top ${done ? (x.ok ? "" : "bad") : "warn"}`;
    $("#hWord").textContent = done ? x.word : "EV2 IS HURT";
    $("#hSpare").textContent = done ? x.spareTxt : `Helping EV2 home at half speed · ${left >= 0 ? `${fmtMin(left)} left` : `${fmtMin(left)} over`}`;
  } else { top.className = `h-top ${w.cls}`; $("#hWord").textContent = w.word; $("#hSpare").textContent = w.spare; }
  $("#hBad").textContent = st.after ? "—" : `${fmtMin(n.mBad)} ${n.mBad < 0 ? "short" : "to spare"}`;
  $("#hBad").className = !st.after && n.mBad < 0 ? "bad" : "";
  const tl = m.timeline, at = n.here ? tl[st.q.leg] : (!st.after && n.nextS.id !== "base" ? tl[n.leg + 1] : null);
  $("#hLeave").textContent = at ? `T+${hm(P.leaveBy(at))}` : "—";
  $("#hLeave").className = at && P.leaveSpare(at) < 0 ? "bad" : "";
  $("#hLeaveSub").textContent = st.after ? "Back at base camp" : n.here ? `At ${shortName(n.here)}` : at ? `${shortName(n.nextS)}, the next stop` : "Heading home";
  const wb = m.walkback;
  $("#hHomeBy").textContent = `T+${hm(wb.budget_min)}`;
  $("#hHomeBySub").textContent = `${wb.eva_limit_h} h suit limit, less ${Math.round(wb.reserve * 100)} % reserve and ${(wb.airlock_min || 0) % 60 ? fmtMin(wb.airlock_min) : `${(wb.airlock_min || 0) / 60} h`} of airlock time`;
  $("#hOut").textContent = fmtMin(Math.min(S.T, n.lastT)); $("#hOutSub").textContent = `Plan: home at T+${hm(n.lastT)}`;
  $("#hHere").textContent = st.after ? "Base camp" : `${Math.round(st.p.z)} m · slope ${Math.round(st.p.s)}°`;
  const back = D ? Math.max(0, n.back * (1 - D.u)) : n.back;
  $("#hBack").textContent = `${Math.round(back)} MIN`; $("#hBack").className = back > n.lim ? "bad" : "";
  $("#hO2").style.width = `${Math.min(100, (back / n.lim) * 100)}%`;
  $("#hO2bar").className = `o2bar ${back > n.lim ? "bad" : back > n.lim * 0.8 ? "warn" : ""}`;
  $("#hO2txt").textContent = back > n.lim ? `Beyond the ${n.lim} min of backup oxygen` : `Inside the ${n.lim} min of backup oxygen`;
  if (st.after) { $("#hNextLbl").textContent = "Status"; $("#hNext").textContent = "BASE CAMP"; $("#hNextSub").textContent = "Crew is back inside"; }
  else if (D) { $("#hNextLbl").textContent = "Drill"; $("#hNext").textContent = "BASE CAMP"; $("#hNextSub").textContent = `${fmtMin(Math.max(0, D.nums.half * (1 - D.u)))} to walk at half speed`; }
  else {
    const along = Math.max(0, (S.legEnd[n.leg] ?? st.d) - st.d);
    $("#hNextLbl").textContent = n.nextS.id === "base" ? "Heading home" : "Next stop";
    $("#hNext").textContent = shortName(n.nextS).toUpperCase();
    $("#hNextSub").textContent = `${along >= 1000 ? `${(along / 1000).toFixed(2)} km` : `${Math.round(along)} m`} along the route`;
  }
}

function initUI() {
  initInput();
  document.querySelectorAll(".modes button[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("#playBtn").onclick = () => (S.playing ? pause() : play());
  $("#speedBtn").onclick = () => { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; S.uiDirty = true; };
  $("#hurtBtn").onclick = startDrill;
  $("#titleDrill").onclick = (e) => { e.stopPropagation(); playDrill(); };
  $("#titleFilm").onclick = (e) => { e.stopPropagation(); endIntro(true); $("#filmBtn").click(); };
  $("#tightBtn").onclick = () => { pause(); crew.snap = cam.snap = true; cam.auto = true; setTime(tightestT()); };
  $("#creditsBtn").onclick = () => { $("#credits").hidden = !$("#credits").hidden; };
  // the drill film (a Blender animation on the same terrain). The button is hidden in index.html until the film file is in film/.
  const closeFilm = () => { $("#filmVideo").pause(); $("#film").hidden = true; };
  $("#filmBtn").onclick = () => { pause(); $("#film").hidden = false; $("#filmVideo").currentTime = 0; $("#filmVideo").play().catch(() => {}); };
  $("#filmClose").onclick = closeFilm;
  $("#film").addEventListener("click", (e) => { if (e.target.id === "film") closeFilm(); });
  $("#creditsClose").onclick = () => ($("#credits").hidden = true);
  $("#checksBtn").onclick = () => { const on = document.body.classList.toggle("checks-open"); $("#checksBtn").classList.toggle("on", on); measure(); };
  $("#checks").addEventListener("change", (e) => { if (e.target.id === "tenby") setTenby(e.target.checked); });
  $("#drill").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.close != null) closeDrill();
    else if (b.dataset.again != null) { const T0 = S.drill.T0; closeDrill(); setTime(T0); startDrill(); }
  });
  // the clock bar: click or drag to move through the walk
  const trk = $("#track"); let drag = false;
  const tAt = (e) => { const r = trk.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * tMax(); };
  const scrub = (e) => { pause(); const far = Math.abs(tAt(e) - S.T) > 4; if (far) crew.snap = cam.snap = true; setTime(tAt(e)); };
  trk.addEventListener("pointerdown", (e) => { drag = true; trk.setPointerCapture(e.pointerId); scrub(e); });
  trk.addEventListener("pointermove", (e) => { if (drag) scrub(e); });
  trk.addEventListener("pointerup", () => (drag = false)); trk.addEventListener("pointercancel", () => (drag = false));
  trk.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.stopPropagation(); pause(); setTime(S.T + (e.key === "ArrowLeft" ? -1 : 1)); } });
  window.addEventListener("resize", onResize);
  setPlayBtn();
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const m of lineMats) m.resolution.set(w, h);
  if (S.m) renderTrack();
  S.uiDirty = true; measure();
}

/* ---------- one frame ---------- */
function tick(dt) {
  S.time += dt;
  if (S.introEnd != null && clockS() >= S.introEnd) endIntro(false);
  if (S.pendingDrill != null && clockS() >= S.pendingDrill) { S.pendingDrill = null; startDrill(); }
  if (S.drill) stepDrill(dt);
  else if (S.playing) {
    const end = playEnd(), T = S.T + dt * clockRate();
    if (T >= end) { setTime(end); pause(); } else setTime(T);
  }
  placeCrew(dt);
  updateCamera(dt);
  // the green area: where a hurt crewmate can still be helped home at half speed in the time left
  const wb = S.m.walkback, bf = wb.bad ? wb.bad.factor : 2, U = terrain.uniforms;
  U.thrBad.value = ((wb.bad ? wb.bad.budget_min : wb.budget_min) - S.T) / bf; U.thrN.value = wb.budget_min - S.T; U.o2Lim.value = wb.suit ? wb.suit.limit_min : 50;
  // more haze when down among the crew, less when looking at the whole walk from above
  const fogT = S.mode === "overview" ? 0.00005 : S.mode === "helmet" ? 0.00016 : 0.00012;
  scene.fog.density += (fogT - scene.fog.density) * damp(dt, 2);
  film.uniforms.time.value = S.time;
  composer.render(dt);
  updateLabels();
  if (S.uiDirty || S.drill) {
    renderLive(); renderHelmet(); updateDrillClock();
    const p = `${clamp((S.T / tMax()) * 100, 0, 100)}%`;
    $("#trkHead").style.left = p; $("#trkDone").style.width = p; $("#track").setAttribute("aria-valuenow", Math.round(S.T));
    $("#speedBtn").textContent = `×${Math.round(clockRate() * 60)}`;
    $("#speedBtn").title = `The clock runs ${Math.round(clockRate() * 60)} times faster than real time. Click to change.`;
    S.uiDirty = false;
  }
}

/* hooks for tests and screen recordings */
window.walk3d = { S, cam, crew, R, P, playDrill, startIntro, endIntro, get film() { return film; }, get bloom() { return bloom; }, get scene() { return scene; }, get sun() { return sun; }, setTime: (T) => { crew.snap = cam.snap = true; setTime(T); }, play, pause, hurt: startDrill, closeDrill, setMode, setTenby,
  step: (dt = 1 / 30, n = 1) => { for (let i = 0; i < n; i++) tick(dt); }, get terrain() { return terrain; }, get camera() { return camera; }, get renderer() { return renderer; } };

boot().then(() => { window.walk3d.ready = true; }).catch((e) => {
  console.error(e);
  const t = $("#ldTxt"); t.textContent = `Could not load the 3D walk: ${e.message}`; t.classList.add("bad");
});
