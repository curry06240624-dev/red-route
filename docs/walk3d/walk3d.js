/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
   Red Route add-on: the 3D walk (docs/walk3d/).
   A 3D view of the planned Marswalk in Jezero Crater: the real HiRISE elevation model as terrain, the HiRISE photo
   mosaic from NASA Mars Trek draped over it, the planner's route and stops, and an astronaut you can walk in third
   or first person or send along the route on auto-walk.
   It reads the same files as the 2D planner (data/mission.json, route.geojson, grid_*.u8 / .i16) and uses the same
   walking rules (pace by slope, rough-ground penalty, no-go slope, walk-back budget).
   three.js (MIT licence) is vendored in vendor/three. The astronaut is models/astronaut.glb, built by tools/build_astronaut.py. */
import * as THREE from "three";
import { OrbitControls } from "./vendor/three/OrbitControls.js";
import { GLTFLoader } from "./vendor/three/GLTFLoader.js";

const $ = (s) => document.querySelector(s);
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => ((a % TAU) + TAU) % TAU;
const angDiff = (a, b) => { let d = wrap(b - a); if (d > Math.PI) d -= TAU; return d; };   // shortest turn from a to b
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtClock = (min) => { const m = Math.max(0, Math.floor(min + 1e-6)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const fmtMin = (min) => { const m = Math.round(Math.abs(min)), h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const params = new URLSearchParams(location.search);
if (params.has("embed")) document.body.classList.add("embed");      // shown inside the 2D planner: no brand, no back link

const TREK = "https://trek.nasa.gov/tiles/Mars/EQ/";
const HIRISE = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd";   // same layer as the 2D planner
const ACCENT = 0xff6a3d, TINT = "#ffd0a4";
const ROOT = document.documentElement.dataset.root || "./";      // where the planner lives (its data/ and router.js)
const FOV = { map: 45, third: 55, first: 72 };
const HINT = {
  map: "Drag to move · right-drag or Ctrl+drag to rotate · scroll to zoom · double-click the ground to put the astronaut there",
  third: "W / S walk · A / D turn · drag to look around · scroll to zoom · Space for auto-walk",
  first: "W / S walk · A / D turn · drag to look around · Space for auto-walk",
};

/* ---------- state ---------- */
const S = {
  mode: "map", pickedMode: false, relief: 1, warp: 60, auto: false, done: false,
  met: 0,                                   // mission elapsed time, minutes
  pos: new THREE.Vector3(), heading: 0, moving: false, phase: 0, amp: 0, leftBase: false,
  camYaw: 0, camPitch: 20 * DEG, camDist: 9, lookPitch: 4 * DEG,
  keys: new Set(), target: 1, onSite: null, field: null, tiles: 0,
  layers: { photo: true, slope: false, hazard: false, returntime: false, traverse: true, rocks: true, bumps: true },
};
let M, G, A, DEM, SLOPE, ROUGH, zBase = 0, TL = null;      // mission, grid, assumptions, rasters, base elevation, timeline
let halfW = 0, halfH = 0;

/* ---------- grid helpers: world is metres, +X east, +Z south, +Y up ---------- */
const inBounds = (x, z) => Math.abs(x) <= halfW && Math.abs(z) <= halfH;
const worldOf = (lon, lat) => [((lon - G.lon0) / G.dlon - G.w / 2) * G.gx, ((G.lat1 - lat) / G.dlat - G.h / 2) * G.gy];
function elevXZ(x, z) {                     // bilinear elevation (m) from the HiRISE grid
  const cf = clamp(x / G.gx + G.w / 2 - 0.5, 0, G.w - 1.001), rf = clamp(z / G.gy + G.h / 2 - 0.5, 0, G.h - 1.001);
  const c = Math.floor(cf), r = Math.floor(rf), fx = cf - c, fy = rf - r, i = r * G.w + c;
  return G.z_offset + G.z_scale * (lerp(DEM[i], DEM[i + 1], fx) * (1 - fy) + lerp(DEM[i + G.w], DEM[i + G.w + 1], fx) * fy);
}
const heightAt = (x, z) => (elevXZ(x, z) - zBase + bumpAt(x, z)) * S.relief;      // ground under a point, small bumps included
function cellOf(x, z) {
  const c = Math.round(x / G.gx + G.w / 2 - 0.5), r = Math.round(z / G.gy + G.h / 2 - 0.5);
  return c < 0 || r < 0 || c >= G.w || r >= G.h ? -1 : r * G.w + c;
}
const slopeAt = (cell) => (cell < 0 ? 0 : SLOPE[cell] * G.slope_scale);
function speedAt(cell) {                    // suited walking pace in m/s: the planner's rule (router.js buildCost)
  if (cell < 0) return A.v_flat_ms;
  let v = A.v_flat_ms * Math.exp(-3.5 * Math.tan(slopeAt(cell) * DEG));
  if (ROUGH[cell] * G.rough_scale > A.rough_m) v /= A.rough_penalty;
  return v;
}
const stopById = (id) => M.stops.find((s) => s.id === id);
const stopAt = (orderIndex) => stopById(M.order[clamp(orderIndex, 0, M.order.length - 1)]);
const stopXZ = (s) => worldOf(s.lon, s.lat);

/* ---------- renderer, scene, sky ---------- */
const stage = $("#stage"), canvas = $("#gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xdcb690), SKYTOP = new THREE.Color(0x9b7355);
scene.background = HORIZON.clone();
scene.fog = new THREE.FogExp2(HORIZON.getHex(), 0.000018);
const camera = new THREE.PerspectiveCamera(FOV.map, 1, 5, 60000);

const SUN_AZ = 285 * DEG, SUN_EL = 38 * DEG;              // afternoon sun from the west, like the HiRISE photos
const SUN = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
scene.add(new THREE.HemisphereLight(0xfff1e0, 0x8a6a55, 1.55));
const sunLight = new THREE.DirectionalLight(0xfff4e6, 3.0);
sunLight.position.copy(SUN).multiplyScalar(150);
sunLight.castShadow = true;                                // the crew and the habitat cast shadows; the shadow box follows the crew
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 10, far: 320 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);

const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: SKYTOP }, horizon: { value: HORIZON }, sunDir: { value: SUN } },
  vertexShader: `varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 c = mix(top, horizon, pow(1.0 - max(d.y, 0.0), 3.0));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(0.80, 0.90, 1.0) * (pow(s, 900.0) * 2.0 + pow(s, 14.0) * 0.16);   // small sun with the cool glow seen from Mars
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material));
  env.add(new THREE.Mesh(new THREE.SphereGeometry(49, 32, 8, 0, TAU, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8a5f43, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
}

const controls = new OrbitControls(camera, canvas);        // map view: drag to move, right-drag / Ctrl+drag to rotate
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.screenSpacePanning = false;
controls.minDistance = 25; controls.maxDistance = 14000; controls.maxPolarAngle = 86 * DEG; controls.zoomToCursor = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

/* ---------- terrain texture: local terrain shading first, HiRISE photo tiles on top as they arrive ---------- */
const IMG = {};
let TW = 4096, TH = 1850, texCanvas, tctx, photoCanvas, pctx, terrainTex, ovRect = [0, 0, 1, 1], composeTimer = 0;
const loadImage = (src, cors) => new Promise((res) => { const im = new Image(); if (cors) im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });

function compose() {
  composeTimer = 0;
  const g = tctx, [ox, oy, ow, oh] = ovRect;
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  g.fillStyle = "#8f7058"; g.fillRect(0, 0, TW, TH);
  if (IMG.hillshade) g.drawImage(IMG.hillshade, ox, oy, ow, oh);
  g.globalCompositeOperation = "multiply"; g.fillStyle = TINT; g.fillRect(0, 0, TW, TH);
  g.globalCompositeOperation = "source-over";
  if (S.layers.photo && S.tiles > 0) g.drawImage(photoCanvas, 0, 0);
  for (const id of ["slope", "hazard", "returntime"]) {
    if (!S.layers[id] || !IMG[id]) continue;
    g.globalAlpha = id === "returntime" ? 0.6 : 0.78;
    g.drawImage(IMG[id], ox, oy, ow, oh);
  }
  g.globalAlpha = 1;
  terrainTex.needsUpdate = true;
  drawMinimapBase();
}
const scheduleCompose = (ms = 350) => { if (!composeTimer) composeTimer = setTimeout(compose, ms); };

function loadTiles(z) {                     // NASA Mars Trek WMTS tiles (geographic grid), drawn into the photo canvas
  return new Promise((resolve) => {
    const d = 180 / 2 ** z, lonA = G.lon0, lonB = G.lon0 + G.w * G.dlon, latA = G.lat1 - G.h * G.dlat, latB = G.lat1;
    const px = (lon) => Math.round((lon - lonA) / (lonB - lonA) * TW), py = (lat) => Math.round((latB - lat) / (latB - latA) * TH);
    const [bx, bz] = stopXZ(stopAt(0));
    const jobs = [];
    for (let y = Math.floor((90 - latB) / d); y <= Math.floor((90 - latA) / d); y++)
      for (let x = Math.floor((lonA + 180) / d); x <= Math.floor((lonB + 180) / d); x++) {
        const [wx, wz] = worldOf(-180 + (x + 0.5) * d, 90 - (y + 0.5) * d);
        jobs.push({ x, y, far: Math.hypot(wx - bx, wz - bz) });
      }
    jobs.sort((a, b) => a.far - b.far);     // nearest to base camp first
    let i = 0, active = 0, done = 0;
    const fin = () => { active--; done++; if (done === jobs.length) resolve(); else next(); };
    const next = () => {
      while (active < 8 && i < jobs.length) {
        const t = jobs[i++]; active++;
        loadImage(`${TREK}${HIRISE}/1.0.0/default/default028mm/${z}/${t.y}/${t.x}.png`, true).then((im) => {
          if (im) {
            const x0 = px(-180 + t.x * d), x1 = px(-180 + (t.x + 1) * d), y0 = py(90 - t.y * d), y1 = py(90 - (t.y + 1) * d);
            pctx.globalCompositeOperation = "source-over"; pctx.globalAlpha = 1; pctx.drawImage(im, x0, y0, x1 - x0, y1 - y0);
            pctx.globalCompositeOperation = "screen"; pctx.globalAlpha = 0.55; pctx.drawImage(im, x0, y0, x1 - x0, y1 - y0);   // lift the dark greys
            pctx.globalCompositeOperation = "multiply"; pctx.globalAlpha = 1; pctx.fillStyle = TINT; pctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            S.tiles++; scheduleCompose();
          }
          fin();
        });
      }
    };
    next();
  });
}

function makeDetailTexture() {              // tileable noise that breaks up the blurred photo close to the camera
  const n = 256, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d"), im = g.createImageData(n, n);
  let seed = 20261115; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const octave = (cells) => {
    const v = new Float32Array(cells * cells); for (let i = 0; i < v.length; i++) v[i] = rnd();
    const at = (i, j) => v[((j + cells) % cells) * cells + ((i + cells) % cells)];
    return (x, y) => {
      const fx = x / n * cells, fy = y / n * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return lerp(lerp(at(x0, y0), at(x0 + 1, y0), sx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy);
    };
  };
  const o = [8, 16, 32, 64, 128].map(octave);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fine = 0.1 * o[1](x, y) + 0.2 * o[2](x, y) + 0.3 * o[3](x, y) + 0.4 * o[4](x, y);
    const coarse = 0.5 * o[0](x, y) + 0.3 * o[1](x, y) + 0.2 * o[2](x, y);
    const k = (y * n + x) * 4; im.data[k] = fine * 255; im.data[k + 1] = coarse * 255; im.data[k + 2] = 0; im.data[k + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}

/* ---------- terrain mesh from the elevation grid ---------- */
let terrain, detailTex = null;
function groundMaterial(cut) {
  const mat = new THREE.MeshLambertMaterial({ map: terrainTex });
  if (!detailTex) detailTex = makeDetailTexture();
  if (!cut) { mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1; }
  mat.customProgramCacheKey = () => (cut ? "ground-with-hole" : "ground-patch");      // two shaders: without this three.js would reuse one for both
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detailTex };
    sh.uniforms.uCut = PATCH.cut;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uDetail;\nuniform vec3 uCut;\nvarying vec3 vWPos;")
      .replace("#include <map_fragment>", (cut ? "if (uCut.z > 0.0 && max(abs(vWPos.x - uCut.x), abs(vWPos.z - uCut.y)) < uCut.z) discard;\n" : "") + `#include <map_fragment>
        float nearK = 1.0 - smoothstep(30.0, 260.0, distance(cameraPosition, vWPos));
        float dFine = texture2D(uDetail, vWPos.xz * 0.31).r, dCoarse = texture2D(uDetail, vWPos.xz * 0.043).g;
        diffuseColor.rgb *= mix(1.0, 0.52 + 0.96 * mix(dCoarse, dFine, 0.6), nearK);`);
  };
  return mat;
}

/* ---------- small bumps close to the crew (illustrative) ----------
   The terrain grid has one height every 4 m, so it cannot show the small rises and hollows a walker sees. A finer
   patch of ground (1.5 m spacing, 192 m across) follows the crew and adds them. How high they are comes from the
   HiRISE roughness grid cell by cell; where they are is made up (fixed noise, the same on every visit). The walking
   line stays smooth, and the planner's slope and pace rules still read the measured 4 m grid, not the bumps. */
const PATCH = { n: 128, step: 1.5, half: 96, cx: 0, cz: 0, relief: 0, on: false, mesh: null, y: null, routeDist: null, cut: { value: new THREE.Vector3(0, 0, 0) } };
function gridBilinear(arr, x, z) {
  const cf = clamp(x / G.gx + G.w / 2 - 0.5, 0, G.w - 1.001), rf = clamp(z / G.gy + G.h / 2 - 0.5, 0, G.h - 1.001);
  const c = Math.floor(cf), r = Math.floor(rf), fx = cf - c, i = r * G.w + c;
  return lerp(lerp(arr[i], arr[i + 1], fx), lerp(arr[i + G.w], arr[i + G.w + 1], fx), rf - r);
}
function vnoise(x, z) {                     // smooth noise in -1..1 from a fixed hash of the lattice points
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const h = (a, b) => hash(Math.imul(a, 73856093) ^ Math.imul(b, 19349663));
  return lerp(lerp(h(x0, z0), h(x0 + 1, z0), sx), lerp(h(x0, z0 + 1), h(x0 + 1, z0 + 1), sx), sz) * 2 - 1;
}
function bumpAt(x, z) {                     // metres above or below the 4 m grid surface
  if (!PATCH.on) return 0;
  const d = Math.max(Math.abs(x - PATCH.cx), Math.abs(z - PATCH.cz)) / PATCH.half;
  if (d >= 1) return 0;
  const e = d < 0.8 ? 1 : (1 - d) / 0.2, edge = e * e * (3 - 2 * e);                                        // fades out at the rim of the patch
  const w = PATCH.routeDist ? clamp((gridBilinear(PATCH.routeDist, x, z) * 0.1 - 1.2) / 6, 0, 1) : 1;        // smooth along the walking line
  const amp = clamp(1.5 * gridBilinear(ROUGH, x, z) * G.rough_scale, 0.06, 1.2) * edge * w * w * (3 - 2 * w);
  return amp * (0.6 * vnoise(x / 9, z / 9) + 0.4 * vnoise(x / 3.7 + 31.7, z / 3.7 - 12.3));
}
function initPatch() {
  const n = PATCH.n, geo = new THREE.BufferGeometry(), idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  for (const [name, size] of [["position", 3], ["normal", 3], ["uv", 2]]) geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * n * size), size));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  PATCH.y = new Float32Array(n * n);
  PATCH.mesh = new THREE.Mesh(geo, groundMaterial(false));
  PATCH.mesh.frustumCulled = false; PATCH.mesh.receiveShadow = true; PATCH.mesh.visible = false;
  scene.add(PATCH.mesh);
  // how far each grid cell is from the planned route, in 0.1 m steps (255 = far)
  const rd = (PATCH.routeDist = new Uint8Array(G.w * G.h).fill(255));
  for (const s of TL.segs) if (s.kind === "walk") for (const p of s.pts) {
    const c0 = Math.round(p.x / G.gx + G.w / 2 - 0.5), r0 = Math.round(p.z / G.gy + G.h / 2 - 0.5);
    for (let r = Math.max(0, r0 - 3); r <= Math.min(G.h - 1, r0 + 3); r++) for (let c = Math.max(0, c0 - 3); c <= Math.min(G.w - 1, c0 + 3); c++) {
      const v = Math.min(254, Math.round(Math.hypot((c + 0.5 - G.w / 2) * G.gx - p.x, (r + 0.5 - G.h / 2) * G.gy - p.z) * 10)), i = r * G.w + c;
      if (v < rd[i]) rd[i] = v;
    }
  }
}
function updatePatch(force) {
  if (!PATCH.mesh) return;
  const ctr = S.mode === "map" ? controls.target : S.pos;
  const want = S.layers.bumps && (S.mode !== "map" || camera.position.distanceTo(controls.target) < 650);
  if (!want) {
    if (PATCH.on) { PATCH.on = false; PATCH.mesh.visible = false; PATCH.cut.value.z = 0; RK.cx = 1e9; placeObjects(); }
    return;
  }
  const cx = Math.round(ctr.x / 6) * 6, cz = Math.round(ctr.z / 6) * 6;       // steps of 6 m keep the vertices on one fixed lattice
  if (!force && PATCH.on && PATCH.relief === S.relief && Math.abs(cx - PATCH.cx) < 12 && Math.abs(cz - PATCH.cz) < 12) return;
  PATCH.on = true; PATCH.cx = cx; PATCH.cz = cz; PATCH.relief = S.relief;
  const n = PATCH.n, st = PATCH.step, y = PATCH.y, g = PATCH.mesh.geometry, pos = g.attributes.position.array, nor = g.attributes.normal.array, uv = g.attributes.uv.array;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cx + (i - n / 2) * st, z = cz + (j - n / 2) * st, k = j * n + i;
    y[k] = elevXZ(x, z) - zBase + bumpAt(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = y[k]; pos[k * 3 + 2] = z;
    uv[k * 2] = x / (2 * halfW) + 0.5; uv[k * 2 + 1] = 0.5 - z / (2 * halfH);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
    const dx = (y[j * n + i1] - y[j * n + i0]) / ((i1 - i0) * st), dz = (y[j1 * n + i] - y[j0 * n + i]) / ((j1 - j0) * st), inv = 1 / Math.hypot(dx, 1, dz);
    nor[k * 3] = -dx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -dz * inv;
  }
  for (const a of ["position", "normal", "uv"]) g.attributes[a].needsUpdate = true;
  PATCH.mesh.scale.y = S.relief; PATCH.mesh.visible = true;
  PATCH.cut.value.set(cx, cz, PATCH.half - 6);
  RK.cx = 1e9; placeObjects();                // rocks, beacons and the habitat sit on the new surface
}

function buildTerrain(q) {
  const W = Math.floor((G.w - 1) / q) + 1, H = Math.floor((G.h - 1) / q) + 1;
  const pos = new Float32Array(W * H * 3), nor = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = i * q, r = j * q, k = j * W + i, at = (rr, cc) => DEM[clamp(rr, 0, G.h - 1) * G.w + clamp(cc, 0, G.w - 1)] * G.z_scale;
    pos[k * 3] = (c + 0.5 - G.w / 2) * G.gx; pos[k * 3 + 1] = G.z_offset + at(r, c) - zBase; pos[k * 3 + 2] = (r + 0.5 - G.h / 2) * G.gy;
    uv[k * 2] = (c + 0.5) / G.w; uv[k * 2 + 1] = 1 - (r + 0.5) / G.h;
    const dx = (at(r, c + q) - at(r, c - q)) / (2 * q * G.gx), dz = (at(r + q, c) - at(r - q, c)) / (2 * q * G.gy), inv = 1 / Math.hypot(dx, 1, dz);
    nor[k * 3] = -dx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -dz * inv;
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let n = 0;
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  terrain = new THREE.Mesh(geo, groundMaterial(true));
  terrain.receiveShadow = true;
  terrain.frustumCulled = false;
  scene.add(terrain);
}

/* ---------- lines that keep a readable width at any distance (route, rover path) ---------- */
function ribbon(lines, color, minW, k, lift) {
  let nV = 0, nI = 0;
  for (const p of lines) if (p.length > 1) { nV += p.length * 2; nI += (p.length - 1) * 6; }
  const pos = new Float32Array(nV * 3), side = new Float32Array(nV * 3), idx = new Uint32Array(nI);
  let v = 0, n = 0;
  for (const p of lines) {
    if (p.length < 2) continue;
    const v0 = v;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
      const y = elevXZ(p[i].x, p[i].z) - zBase + lift;
      for (const s of [-1, 1]) { pos[v * 3] = p[i].x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = p[i].z; side[v * 3] = -tz * s; side[v * 3 + 2] = tx * s; v++; }
      if (i < p.length - 1) { const q = v0 + i * 2; idx[n++] = q; idx[n++] = q + 1; idx[n++] = q + 2; idx[n++] = q + 1; idx[n++] = q + 3; idx[n++] = q + 2; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("side", new THREE.BufferAttribute(side, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uColor: { value: new THREE.Color(color) }, uMinW: { value: minW }, uK: { value: k }, uOpacity: { value: 0.95 } },
    vertexShader: `attribute vec3 side; uniform float uMinW; uniform float uK; varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDist = distance(cameraPosition, wp.xyz);
        float w = max(uMinW, vDist * uK);
        wp.xyz += side * w; wp.y += w * 0.12;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vDist;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity * smoothstep(1.2, 7.0, vDist));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 4;
  scene.add(mesh);
  return mesh;
}
function smooth(pts, passes = 4) {          // take the staircase out of a grid path
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const o = p.map((q) => ({ x: q.x, z: q.z }));
    for (let i = 1; i < p.length - 1; i++) { o[i].x = (p[i - 1].x + 2 * p[i].x + p[i + 1].x) / 4; o[i].z = (p[i - 1].z + 2 * p[i].z + p[i + 1].z) / 4; }
    p = o;
  }
  return p;
}

/* ---------- the plan as a timeline: where the crew is at each minute ---------- */
function buildTimeline(route) {
  const feats = [...route.features].sort((a, b) => ((a.properties && a.properties.leg) || 0) - ((b.properties && b.properties.leg) || 0));
  const segs = []; let t = 0;
  feats.forEach((f, k) => {
    const pts = smooth(f.geometry.coordinates.map(([lon, lat]) => { const [x, z] = worldOf(lon, lat); return { x, z }; }));
    const cost = [0], dd = [0];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      dd.push(dd[i - 1] + len);
      cost.push(cost[i - 1] + len * 0.5 * (1 / speedAt(cellOf(pts[i - 1].x, pts[i - 1].z)) + 1 / speedAt(cellOf(pts[i].x, pts[i].z))));
    }
    const leg = (M.legs && M.legs[k]) || {}, to = leg.to || M.order[k + 1];
    const walk = leg.walk_min != null ? leg.walk_min : cost[cost.length - 1] / 60;       // keep the planner's leg times
    const sc = walk / (cost[cost.length - 1] || 1);
    segs.push({ kind: "walk", leg: k, to, t0: t, t1: t + walk, pts, dd, tt: cost.map((c) => t + c * sc) });
    t += walk;
    const st = stopById(to), last = pts[pts.length - 1];
    if (st && k < feats.length - 1 && st.dwell_min > 0) { segs.push({ kind: "dwell", leg: k, stop: st, t0: t, t1: t + st.dwell_min, x: last.x, z: last.z }); t += st.dwell_min; }
  });
  let cur = 0;
  return {
    segs, total: t,
    at(T) {
      T = clamp(T, 0, t);
      let s = segs[cur];
      if (!(T >= s.t0 && T <= s.t1)) { cur = segs.findIndex((q) => T >= q.t0 && T <= q.t1); if (cur < 0) cur = segs.length - 1; s = segs[cur]; }
      if (s.kind === "dwell") return { x: s.x, z: s.z, moving: false, seg: s, heading: null };
      let lo = 0, hi = s.tt.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s.tt[mid] <= T) lo = mid; else hi = mid; }
      const f = clamp((T - s.tt[lo]) / ((s.tt[hi] - s.tt[lo]) || 1), 0, 1);
      const x = lerp(s.pts[lo].x, s.pts[hi].x, f), z = lerp(s.pts[lo].z, s.pts[hi].z, f);
      const dNow = lerp(s.dd[lo], s.dd[hi], f); let j = hi;
      while (j < s.pts.length - 1 && s.dd[j] < dNow + 9) j++;                              // look 9 m ahead for a steady heading
      const ax = s.pts[j].x - x, az = s.pts[j].z - z;
      return { x, z, moving: true, seg: s, heading: Math.abs(ax) + Math.abs(az) > 0.05 ? Math.atan2(ax, -az) : null };
    },
    nearest(x, z) {
      let best = { d: Infinity, t: 0 };
      for (const s of segs) if (s.kind === "walk") for (let i = 0; i < s.pts.length; i++) {
        const d = Math.hypot(s.pts[i].x - x, s.pts[i].z - z); if (d < best.d) best = { d, t: s.tt[i] };
      }
      return best;
    },
  };
}
function backFromProfile(T) {               // walk-back time along the planned route, from the planner's own profile
  const p = M.profile; if (!p || !p.length) return null;
  let lo = 0, hi = p.length - 1;
  if (T <= p[0].t) return p[0].back; if (T >= p[hi].t) return p[hi].back;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].t <= T) lo = mid; else hi = mid; }
  return lerp(p[lo].back, p[hi].back, clamp((T - p[lo].t) / ((p[hi].t - p[lo].t) || 1), 0, 1));
}

/* ---------- astronaut, habitat and stop beacons (illustrative models) ---------- */
function makeAstronaut() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const mat = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const white = mat(0xf1eee8), grey = mat(0xb4b8bf), dark = mat(0x2a2e35, 0.6), red = mat(ACCENT, 0.7), gold = mat(0xe0a53a, 0.2, 0.85);
  const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  add(body, new THREE.CapsuleGeometry(0.25, 0.4, 6, 14), white, 0, 1.2, 0).scale.set(1.12, 1, 0.86);       // torso (front is -Z)
  add(body, new THREE.BoxGeometry(0.5, 0.7, 0.24), grey, 0, 1.3, 0.3);                                       // life-support pack
  add(body, new THREE.BoxGeometry(0.3, 0.2, 0.1), grey, 0, 1.24, -0.24);                                     // chest controls
  add(body, new THREE.SphereGeometry(0.235, 22, 16), white, 0, 1.74, 0);                                     // helmet
  add(body, new THREE.SphereGeometry(0.2, 22, 16), gold, 0, 1.74, -0.075).scale.set(0.95, 0.82, 0.9);        // visor
  const limb = (len, rad, x, y, tip, tipGeo, tipY, tipZ) => {
    const p = new THREE.Group(); p.position.set(x, y, 0); body.add(p);
    add(p, new THREE.CapsuleGeometry(rad, len - 2 * rad, 4, 10), white, 0, -len / 2, 0);
    add(p, new THREE.CylinderGeometry(rad * 1.06, rad * 1.06, 0.07, 12), red, 0, -len * 0.3, 0);             // red stripe
    add(p, tipGeo, tip, 0, tipY, tipZ);
    return p;
  };
  const armL = limb(0.62, 0.085, -0.37, 1.5, dark, new THREE.SphereGeometry(0.095, 12, 10), -0.62, 0);
  const armR = limb(0.62, 0.085, 0.37, 1.5, dark, new THREE.SphereGeometry(0.095, 12, 10), -0.62, 0);
  const legL = limb(0.88, 0.115, -0.15, 0.92, dark, new THREE.BoxGeometry(0.2, 0.13, 0.33), -0.86, -0.05);
  const legR = limb(0.88, 0.115, 0.15, 0.92, dark, new THREE.BoxGeometry(0.2, 0.13, 0.33), -0.86, -0.05);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.06; g.add(shadow);
  scene.add(g);
  return { g, body, armL, armR, legL, legR };
}
function loadAstronautModel() {            // models/astronaut.glb, built in Blender by tools/build_astronaut.py
  new GLTFLoader().load("models/astronaut.glb", (gltf) => {
    const J = {};
    gltf.scene.traverse((o) => {
      J[o.name] = o;
      if (o.isMesh && o.material) { o.castShadow = true; o.material.envMapIntensity = /VisorGold|Metal/.test(o.material.name) ? 1.2 : 0.3; }
    });
    if (!["Hips", "Torso", "Head", "ArmUpper_L", "ArmLower_L", "ArmUpper_R", "ArmLower_R", "LegUpper_L", "LegLower_L", "Foot_L", "LegUpper_R", "LegLower_R", "Foot_R"].every((n) => J[n])) return;
    gltf.scene.rotation.y = Math.PI;        // the model faces +Z, the walker faces -Z
    gltf.scene.scale.setScalar(1);
    astro.body.visible = false; astro.g.add(gltf.scene);
    astro.J = J; astro.hipsY = J.Hips.position.y;
  }, undefined, () => { /* keep the simple astronaut */ });
}
function poseModel(J, ph, a) {              // a stiff, suited walk: each joint is one object in the model
  const s = Math.sin(ph), c = Math.cos(ph), t = performance.now() / 1000, idle = 1 - a;
  const hipL = -0.46 * s * a, hipR = 0.46 * s * a, kneeL = (0.05 + 0.85 * Math.max(0, c)) * a, kneeR = (0.05 + 0.85 * Math.max(0, -c)) * a;
  J.Hips.position.y = astro.hipsY + (0.03 * Math.abs(c) - 0.022) * a;
  J.Hips.rotation.y = -0.06 * s * a;
  J.Torso.rotation.set(0.06 * a + 0.012 * Math.sin(t * 1.1) * idle, 0.11 * s * a, 0);
  J.Head.rotation.set(-0.03 * a, -0.05 * s * a + 0.06 * Math.sin(t * 0.45) * idle, 0);
  J.LegUpper_L.rotation.x = hipL; J.LegUpper_R.rotation.x = hipR;
  J.LegLower_L.rotation.x = kneeL; J.LegLower_R.rotation.x = kneeR;
  J.Foot_L.rotation.x = -0.6 * (hipL + kneeL); J.Foot_R.rotation.x = -0.6 * (hipR + kneeR);
  J.ArmUpper_L.rotation.set(0.38 * s * a, 0, 0.09); J.ArmUpper_R.rotation.set(-0.38 * s * a, 0, -0.09);
  J.ArmLower_L.rotation.x = -(0.2 + (0.25 + 0.3 * Math.max(0, -s)) * a); J.ArmLower_R.rotation.x = -(0.2 + (0.25 + 0.3 * Math.max(0, s)) * a);
}
function makeHabitat() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.9 }), d = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7 });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 2.6, 28), m); cyl.position.y = 1.3; g.add(cyl);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.3, 28, 12, 0, TAU, 0, Math.PI / 2), m); dome.position.y = 2.6; dome.scale.y = 0.55; g.add(dome);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 2.2), m); lock.position.set(0, 1.05, 4); g.add(lock);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.08), d); door.position.set(0, 0.9, 5.12); g.add(door);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(3.33, 3.33, 0.22, 28), new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.7 })); band.position.y = 2.2; g.add(band);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
  return g;
}
const beacons = [], labels = [];
function makeBeacon(stop, n) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 8, 48), new THREE.MeshBasicMaterial({ color: ACCENT })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.25; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 60, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 30; g.add(beam);
  scene.add(g); beacons.push({ g, stop, ring, beam });
}
function makeLabel(cls, html, getPos, onClick) {
  const el = document.createElement("div"); el.className = `lab ${cls}`; el.innerHTML = html;
  if (onClick) el.addEventListener("click", onClick);
  $("#labels").appendChild(el);
  const L = { el, getPos, pos: new THREE.Vector3() }; labels.push(L); return L;
}

let astro, habitat, routeMesh, traverseMesh, meLabel;
function placeObjects() {                   // put everything on the ground (again after the relief slider moves)
  for (const b of beacons) { const [x, z] = stopXZ(b.stop); b.g.position.set(x, heightAt(x, z), z); }
  const [bx, bz] = stopXZ(stopAt(0)), hx = bx + 9, hz = bz - 13;
  habitat.position.set(hx, heightAt(hx, hz) - 0.15, hz); habitat.rotation.y = -0.6;
  terrain.scale.y = S.relief; routeMesh.scale.y = S.relief; if (traverseMesh) traverseMesh.scale.y = S.relief; if (PATCH.mesh) PATCH.mesh.scale.y = S.relief;
}

/* ---------- illustrative rocks: more and bigger where the HiRISE roughness grid says the ground is rough ----------
   Each rock comes from a fixed hash of its grid cell, so the same rocks are there every time. They are scenery:
   real rocks this small are below the 4 m grid, and the planner's rules do not use them. */
const hash = (n) => { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
const RK = { cx: 1e9, cz: 1e9, relief: 0, big: null, small: null, shadow: null, route: new Map(), keepOut: [] };
const SH = (() => { const l = Math.hypot(SUN.x, SUN.z); return { x: -SUN.x / l, z: -SUN.z / l, len: 1 / Math.tan(SUN_EL) }; })();   // shadows fall away from the sun
function rockGeometry(detail, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, col = new Float32Array(p.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.8 + 0.2 * Math.sin(3.1 * v.x + seed) * Math.sin(2.3 * v.y + 1.7 * seed) + 0.16 * Math.sin(5.3 * v.z + 2.1 * seed) * Math.sin(4.1 * v.x - seed)
      + 0.1 * Math.sin(8.7 * v.y + seed) * Math.sin(7.9 * v.z));
    v.y *= 0.68;
    p.setXYZ(i, v.x, v.y, v.z);
    const k = 0.045 + 0.13 * clamp(v.y * 0.9 + 0.5, 0, 1);           // dark basalt with dusty tops
    col[i * 3] = k; col[i * 3 + 1] = k * 0.7; col[i * 3 + 2] = k * 0.5;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();                                             // one normal per face: a chipped, angular look
  return g;
}
function initRocks() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  RK.big = new THREE.InstancedMesh(rockGeometry(2, 1.3), mat, 1600);
  RK.small = new THREE.InstancedMesh(rockGeometry(1, 4.7), mat, 7000);
  const disc = new THREE.CircleGeometry(1, 14); disc.rotateX(-Math.PI / 2);
  RK.shadow = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0x1a0f0a, transparent: true, opacity: 0.46, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 8600);
  RK.shadow.renderOrder = 2;
  for (const m of [RK.big, RK.small, RK.shadow]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
  RK.big.receiveShadow = RK.small.receiveShadow = true;
  for (const s of TL.segs) if (s.kind === "walk") for (const p of s.pts) {        // route points by cell, to keep the walking line clear
    const c = cellOf(p.x, p.z); if (c < 0) continue;
    let a = RK.route.get(c); if (!a) RK.route.set(c, (a = [])); a.push(p);
  }
  const [bx, bz] = stopXZ(stopAt(0));
  RK.keepOut = [[bx + 9, bz - 13, 8], [bx, bz, 3]].concat(M.order.slice(1, -1).map((id) => [...stopXZ(stopById(id)), 3.2]));
}
function rockBlocked(x, z, pad) {
  for (const k of RK.keepOut) if (Math.hypot(x - k[0], z - k[1]) < k[2] + pad) return true;
  const c = Math.round(x / G.gx + G.w / 2 - 0.5), r = Math.round(z / G.gy + G.h / 2 - 0.5);
  for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
    const a = RK.route.get(rr * G.w + cc);
    if (a) for (const p of a) if (Math.hypot(p.x - x, p.z - z) < pad) return true;
  }
  return false;
}
const _rm = new THREE.Matrix4(), _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rs = new THREE.Vector3(), _rp = new THREE.Vector3(),
  _rn = new THREE.Vector3(), _re = new THREE.Euler(), _rc = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
function updateRocks(force) {
  if (!RK.big) return;
  const ctr = S.mode === "map" ? controls.target : S.pos;
  const on = S.layers.rocks && (S.mode !== "map" || camera.position.distanceTo(controls.target) < 650);
  RK.big.visible = RK.small.visible = RK.shadow.visible = on;
  if (!on) return;
  if (!force && RK.relief === S.relief && Math.hypot(ctr.x - RK.cx, ctr.z - RK.cz) < 12) return;
  RK.cx = ctr.x; RK.cz = ctr.z; RK.relief = S.relief;
  const R_BIG = 170, R_SMALL = 75, c0 = Math.round(ctr.x / G.gx + G.w / 2 - 0.5), r0 = Math.round(ctr.z / G.gy + G.h / 2 - 0.5);
  const dc = Math.ceil(R_BIG / G.gx), dr = Math.ceil(R_BIG / G.gy), shadowYaw = Math.atan2(-SH.z, SH.x);
  let nb = 0, ns = 0, nsh = 0;
  const put = (mesh, idx, x, z, rad, squash, seed) => {
    const y = heightAt(x, z), sx = rad * (0.8 + 0.5 * hash(seed + 14)), sz = rad * (0.8 + 0.5 * hash(seed + 15)), sy = rad * squash;
    _re.set((hash(seed + 11) - 0.5) * 0.5, hash(seed + 12) * TAU, (hash(seed + 13) - 0.5) * 0.5); _rq.setFromEuler(_re);
    mesh.setMatrixAt(idx, _rm.compose(_rp.set(x, y + sy * 0.22, z), _rq, _rs.set(sx, sy, sz)));
    const k = 0.8 + 0.45 * hash(seed + 16);
    mesh.setColorAt(idx, _rc.setRGB(k, k * (0.94 + 0.1 * hash(seed + 17)), k * (0.9 + 0.12 * hash(seed + 18))));
    if (nsh >= 8600) return;                                            // shadow on the ground, lying along the slope
    const e = 2, top = sy * 0.9, off = top * SH.len * 0.5, px = x + SH.x * off, pz = z + SH.z * off;
    _rn.set(-(heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), 1, -(heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)).normalize();
    _rq.setFromUnitVectors(_up, _rn).multiply(_rq2.setFromAxisAngle(_up, shadowYaw));
    RK.shadow.setMatrixAt(nsh++, _rm.compose(_rp.set(px, heightAt(px, pz) + 0.03, pz), _rq, _rs.set(Math.max(sx, sz) * 0.9 + off, 1, Math.min(sx, sz) * 0.95)));
  };
  for (let r = Math.max(0, r0 - dr); r <= Math.min(G.h - 1, r0 + dr); r++) for (let c = Math.max(0, c0 - dc); c <= Math.min(G.w - 1, c0 + dc); c++) {
    const i = r * G.w + c, x0 = (c + 0.5 - G.w / 2) * G.gx, z0 = (r + 0.5 - G.h / 2) * G.gy, d = Math.hypot(x0 - ctr.x, z0 - ctr.z);
    if (d > R_BIG) continue;
    const rough = ROUGH[i] * G.rough_scale, s = i * 31;
    if (rough > 0.13 && nb < 1600 && hash(s + 1) < clamp((rough - 0.1) / 0.45, 0, 0.8)) {           // boulders on rough ground
      const rad = 0.3 + 0.9 * hash(s + 2) * clamp(rough / 0.8, 0.3, 1), x = x0 + (hash(s + 3) - 0.5) * G.gx * 0.8, z = z0 + (hash(s + 4) - 0.5) * G.gy * 0.8;
      if (!rockBlocked(x, z, rad + 1.1)) put(RK.big, nb++, x, z, rad, 0.55 + 0.35 * hash(s + 5), s + 40);
    }
    if (d > R_SMALL) continue;
    const n = Math.floor(hash(s + 6) * (3.6 + 5 * clamp(rough / 0.35, 0, 1)));                      // loose stones, a few everywhere
    for (let j = 0; j < n && ns < 7000; j++) {
      const q = s + 100 + j * 20, rad = 0.07 + 0.26 * hash(q + 1) ** 2, x = x0 + (hash(q + 2) - 0.5) * G.gx, z = z0 + (hash(q + 3) - 0.5) * G.gy;
      if (!rockBlocked(x, z, rad + 0.45)) put(RK.small, ns++, x, z, rad, 0.5 + 0.4 * hash(q + 4), q + 5);
    }
  }
  RK.big.count = nb; RK.small.count = ns; RK.shadow.count = nsh;
  for (const m of [RK.big, RK.small, RK.shadow]) m.instanceMatrix.needsUpdate = true;
  for (const m of [RK.big, RK.small]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

/* ---------- walking ---------- */
let toastTimer = 0;
function toast(msg, ms = 3200) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }
function setAuto(on, why) {
  S.auto = on;
  $("#auto .ico").className = `ico ${on ? "sq" : "tri"}`;
  $("#auto .lbl").textContent = on ? "Pause" : S.done ? "Replay auto-walk" : S.met > 0 ? "Resume auto-walk" : "Auto-walk";
  if (why) toast(why);
}
function resetEva(quiet) {
  const [bx, bz] = stopXZ(stopAt(0)), p = TL.at(0.4);
  S.met = 0; S.done = false; S.target = 1; S.onSite = null; S.leftBase = false; S.camYaw = 0;
  S.pos.set(bx, heightAt(bx, bz), bz); S.heading = p.heading != null ? wrap(p.heading) : 0;
  const first = TL.at(0); S.pos.x = first.x; S.pos.z = first.z;
  setAuto(false, quiet ? null : "Back at base camp. Clock reset to 0:00.");
}
function jumpTo(T) {                        // put the crew where the plan has them at mission time T (minutes)
  S.met = clamp(T, 0, TL.total); S.done = false;
  const p = TL.at(S.met);
  S.pos.set(p.x, heightAt(p.x, p.z), p.z);
  if (p.heading != null) S.heading = wrap(p.heading);
  S.target = Math.min(M.order.length - 1, p.seg.leg + (p.seg.kind === "dwell" ? 2 : 1));
  setAuto(false);
}
function startAuto() {
  if (S.done || S.met >= TL.total - 1e-6) resetEva(true);
  const planned = TL.at(S.met);
  if (Math.hypot(planned.x - S.pos.x, planned.z - S.pos.z) > 25) {
    const n = TL.nearest(S.pos.x, S.pos.z); S.met = n.t;
    toast(`Joining the planned route at ${fmtClock(S.met)} (${fmtDist(n.d)} away)`);
  }
  if (S.mode === "map" && !S.pickedMode) setMode("third");
  setAuto(true);
}
function teleport(x, z) {
  if (!inBounds(x, z)) return;
  if (S.auto) setAuto(false);
  S.pos.set(x, heightAt(x, z), z); S.onSite = null; S.done = false;
  toast("Astronaut moved. The clock keeps its time; press R to restart at base.");
}
function arrive(orderIndex) {
  const st = stopAt(orderIndex), last = orderIndex === M.order.length - 1;
  if (last) {
    S.done = true; S.target = orderIndex;
    toast(`Back at base camp. EVA time ${fmtMin(S.met)}.`, 6000);
  } else {
    S.met += st.dwell_min || 0; S.target = orderIndex + 1;
    S.onSite = { stop: st, until: performance.now() + 12000 };
    toast(`Arrived at ${st.name}. Science work: +${st.dwell_min || 0} min on the clock.`, 5000);
  }
  setAuto(false);
}
let lastBlock = 0;
function updateWalk(dt) {
  const k = S.keys;
  const fwd = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
  const turn = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
  if (S.auto && (fwd || turn)) setAuto(false, "You have control. Press Space to rejoin the route.");
  S.moving = false;
  if (S.auto) {
    S.met = Math.min(TL.total, S.met + dt * S.warp / 60);
    const p = TL.at(S.met);
    S.pos.x = p.x; S.pos.z = p.z; S.moving = p.moving;
    if (p.heading != null) S.heading = wrap(S.heading + clamp(angDiff(S.heading, p.heading), -4 * dt, 4 * dt) * (S.warp > 60 ? 3 : 1));
    S.target = Math.min(M.order.length - 1, p.seg.leg + (p.seg.kind === "dwell" ? 2 : 1));
    S.onSite = p.seg.kind === "dwell" ? { stop: p.seg.stop, left: p.seg.t1 - S.met } : null;
    if (S.met >= TL.total - 1e-6) { S.done = true; setAuto(false, `EVA complete: back at base camp after ${fmtMin(TL.total)}.`); }
  } else {
    S.heading = wrap(S.heading + turn * 110 * DEG * dt);
    if (fwd && Math.abs(S.camYaw) > 1e-3) {             // walk where the camera looks: the body turns, the view holds still
      const t = clamp(S.camYaw, -200 * DEG * dt, 200 * DEG * dt); S.heading = wrap(S.heading + t); S.camYaw -= t;
    }
    if (fwd && !S.done) {
      const here = cellOf(S.pos.x, S.pos.z), v = speedAt(here), dir = Math.sign(fwd);
      const dx = Math.sin(S.heading) * dir, dz = -Math.cos(S.heading) * dir;
      let left = v * S.warp * dt * (dir > 0 ? 1 : 0.5), walked = 0, block = null;
      while (left > 1e-4) {
        const st = Math.min(left, 1.5), nx = S.pos.x + dx * st, nz = S.pos.z + dz * st, c2 = cellOf(nx, nz);
        if (c2 < 0) { block = "The elevation model ends here."; break; }
        if (slopeAt(c2) > A.max_slope_deg && slopeAt(cellOf(S.pos.x, S.pos.z)) <= A.max_slope_deg) {
          block = `Too steep ahead: ${slopeAt(c2).toFixed(0)}°. The suit limit is ${A.max_slope_deg}°. Go around.`; break;
        }
        S.pos.x = nx; S.pos.z = nz; left -= st; walked += st;
      }
      if (walked > 0) { S.moving = true; S.met += walked / v / 60; }
      if (block && performance.now() - lastBlock > 2500) { lastBlock = performance.now(); toast(block); }
      // stops reached on foot
      const [bx, bz] = stopXZ(stopAt(0));
      if (Math.hypot(S.pos.x - bx, S.pos.z - bz) > 40) S.leftBase = true;
      for (let j = S.target; j < M.order.length; j++) {
        const lastStop = j === M.order.length - 1; if (lastStop && !S.leftBase) break;
        const [sx, sz] = stopXZ(stopAt(j));
        if (Math.hypot(S.pos.x - sx, S.pos.z - sz) < 12) { arrive(j); break; }
      }
    }
    if (S.onSite && S.onSite.until && performance.now() > S.onSite.until) S.onSite = null;
  }
  S.pos.y = heightAt(S.pos.x, S.pos.z);
  // pose
  S.amp = lerp(S.amp, S.moving ? 1 : 0, 1 - Math.exp(-dt * 8));
  if (S.moving) S.phase += dt * 5.3;
  if (astro.J) poseModel(astro.J, S.phase, S.amp);
  else {
    const sw = Math.sin(S.phase) * S.amp;
    astro.legL.rotation.x = sw * 0.55; astro.legR.rotation.x = -sw * 0.55;
    astro.armL.rotation.x = -sw * 0.45; astro.armR.rotation.x = sw * 0.45;
    astro.body.position.y = Math.abs(Math.cos(S.phase)) * 0.035 * S.amp; astro.body.rotation.x = -0.07 * S.amp;
  }
  astro.g.position.copy(S.pos); astro.g.rotation.y = -S.heading;
  astro.g.visible = S.mode !== "first";
  for (const b of beacons) {
    const d = Math.hypot(b.g.position.x - S.pos.x, b.g.position.z - S.pos.z);
    b.ring.visible = !(S.mode === "first" && d < 9); b.beam.visible = S.mode === "map" || d > 18;
  }
}

/* ---------- cameras ---------- */
let tween = null, mapPose = null;
const _p1 = new THREE.Vector3(), _t1 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
function walkPose() {
  const b = S.heading + S.camYaw;
  if (S.mode === "third") {
    const p = S.camPitch, d = S.camDist;
    _t1.set(S.pos.x, S.pos.y + 1.45, S.pos.z);
    _p1.set(_t1.x - Math.sin(b) * Math.cos(p) * d, _t1.y + Math.sin(p) * d, _t1.z + Math.cos(b) * Math.cos(p) * d);
    if (inBounds(_p1.x, _p1.z)) _p1.y = Math.max(_p1.y, heightAt(_p1.x, _p1.z) + 0.5);
  } else {
    const p = S.lookPitch, bob = Math.sin(S.phase * 2) * 0.025 * S.amp;
    _p1.set(S.pos.x + Math.sin(S.heading) * 0.12, S.pos.y + 1.68 + bob, S.pos.z - Math.cos(S.heading) * 0.12);
    _t1.set(_p1.x + Math.sin(b) * Math.cos(p), _p1.y - Math.sin(p), _p1.z - Math.cos(b) * Math.cos(p));
  }
  _m.lookAt(_p1, _t1, UP); _q1.setFromRotationMatrix(_m);
}
function setMode(mode, picked) {
  if (picked) S.pickedMode = true;
  if (mode === S.mode) return;
  if (S.mode === "map") mapPose = { p: camera.position.clone(), t: controls.target.clone() };
  else if (mode === "map" && mapPose) { const off = mapPose.p.clone().sub(mapPose.t); mapPose.t.copy(S.pos); mapPose.p.copy(S.pos).add(off); }
  tween = { t: 0, dur: 1.2, p0: camera.position.clone(), q0: camera.quaternion.clone(), f0: camera.fov };
  S.mode = mode; controls.enabled = false;
  camera.near = mode === "map" ? 5 : 0.25; camera.updateProjectionMatrix();
  scene.fog.density = mode === "map" ? 0.000018 : 0.00009;
  for (const m of [routeMesh, traverseMesh]) if (m) m.material.depthTest = mode !== "map";
  document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("#visor").hidden = mode !== "first"; $("#compass").hidden = mode === "map"; stage.dataset.mode = mode;
  $("#hint").textContent = HINT[mode];
  $("#pad").hidden = mode === "map" || !matchMedia("(pointer: coarse)").matches;
  $("#hud").hidden = false;
}
function updateCamera(dt) {
  if (S.mode === "map" && !tween) {
    controls.update();
    const t = controls.target; t.x = clamp(t.x, -halfW, halfW); t.z = clamp(t.z, -halfH, halfH); t.y = lerp(t.y, heightAt(t.x, t.z), 0.15);
    const c = camera.position; if (inBounds(c.x, c.z)) c.y = Math.max(c.y, heightAt(c.x, c.z) + 4);
  } else {
    if (S.mode === "map") { _p1.copy(mapPose.p); _m.lookAt(mapPose.p, mapPose.t, UP); _q1.setFromRotationMatrix(_m); } else walkPose();
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const e = tween.t * tween.t * (3 - 2 * tween.t);
      camera.position.lerpVectors(tween.p0, _p1, e); camera.quaternion.slerpQuaternions(tween.q0, _q1, e);
      camera.fov = lerp(tween.f0, FOV[S.mode], e); camera.updateProjectionMatrix();
      if (tween.t >= 1) {
        tween = null;
        if (S.mode === "map") { camera.position.copy(mapPose.p); controls.target.copy(mapPose.t); controls.enabled = true; controls.update(); }
      }
    } else { camera.position.copy(_p1); camera.quaternion.copy(_q1); }
  }
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  sunLight.target.position.copy(S.pos); sunLight.position.copy(S.pos).addScaledVector(SUN, 150);
}

/* ---------- readouts: HUD, stop card, labels, compass, mini-map ---------- */
let hudClock = 0, cardKey = "";
function readout() {
  const cell = cellOf(S.pos.x, S.pos.z);
  const back = S.auto || S.done ? backFromProfile(S.met) : S.field && cell >= 0 ? S.field[cell] : null;
  const ok = back != null && isFinite(back);
  const next = stopAt(S.target), [nx, nz] = stopXZ(next);
  return { cell, slope: slopeAt(cell), pace: speedAt(cell), back: ok ? back : null, margin: ok ? Math.min(M.walkback.budget_min - (S.met + back), M.walkback.bad ? M.walkback.bad.budget_min - (S.met + M.walkback.bad.factor * back) : Infinity) : null,
    next, dist: Math.hypot(nx - S.pos.x, nz - S.pos.z), brg: wrap(Math.atan2(nx - S.pos.x, -(nz - S.pos.z))) };
}
function photoFor(stop) {                   // a real Perseverance photo for the stop: colour Mastcam-Z first, never a sun-finding frame
  const ok = (stop.photos || []).filter((p) => !/SAPP/.test(p.small || "") && new RegExp(`_0*${p.sol}_`).test(p.small || ""));
  return ok.find((p) => /^MCZ/.test(p.cam)) || ok.find((p) => /^NAVCAM/.test(p.cam)) || ok[0] || null;
}
function updateHud(dt) {
  hudClock -= dt; if (hudClock > 0) return; hudClock = 0.15;
  const r = readout(), n = M.order.indexOf(r.next.id), isBase = S.target === M.order.length - 1;
  const mc = r.margin == null ? "" : r.margin < 0 ? "badc" : r.margin < 30 ? "warnc" : "okc";
  const state = S.done ? "EVA COMPLETE" : S.onSite ? "ON SITE" : S.auto ? `AUTO-WALK ×${S.warp}` : `MANUAL ×${S.warp}`;
  const wb = M.walkback, lim = wb.suit && wb.suit.limit_min, far = lim && r.back != null && r.back > lim;
  const hud = $("#hud");
  hud.className = "pnl" + (r.margin != null && r.margin < 0 || far ? " alarm" : r.margin != null && r.margin < 30 ? " caution" : "");
  hud.innerHTML = `
    <div class="hud-row"><span>MISSION TIME</span><span class="hud-state">${state}</span></div>
    <div class="hud-row"><b class="big">T+${fmtClock(S.met)}</b><span>home by T+${fmtClock(wb.budget_min)}</span></div>
    <div class="hud-next"><span>${isBase ? "HEADING HOME" : "NEXT STOP"}</span>${isBase ? "" : `${n + 1} · `}${esc(r.next.name)}<small>${fmtDist(r.dist)} · bearing ${Math.round(r.brg / DEG) % 360}° ${COMPASS[Math.round(r.brg / DEG / 45) % 8]}</small></div>
    <div class="hud-grid">
      <div><span>SLOPE</span><b class="${r.slope > A.max_slope_deg ? "badc" : r.slope > 8 ? "warnc" : ""}">${r.slope.toFixed(1)}°</b></div>
      <div><span>PACE</span><b>${S.moving ? r.pace.toFixed(2) : "0.00"} m/s</b></div>
      <div><span>WALK HOME</span><b class="${far ? "badc" : ""}">${r.back == null ? "…" : fmtMin(r.back)}</b></div>
      <div><span>SPARE</span><b class="${mc}">${r.margin == null ? "…" : (r.margin < 0 ? "−" : "+") + fmtMin(r.margin)}</b></div>
    </div>
    ${r.margin != null && r.margin < 0 ? '<div class="hud-alarm">Turn back: not enough time to get home</div>' : far ? `<div class="hud-alarm">Beyond the ${lim} min of backup oxygen</div>` : ""}
    ${wb.bad ? `<div class="hud-note">Spare counts a walk home at 1/${wb.bad.factor} of normal pace, as in "If something goes wrong".</div>` : ""}`;
  // stop card with the rover's own view
  const card = $("#stopcard"), st = S.onSite && S.onSite.stop;
  if (!st) { if (cardKey) { card.hidden = true; cardKey = ""; } }
  else {
    if (cardKey !== st.id) {
      cardKey = st.id; const p = photoFor(st), num = M.order.indexOf(st.id) + 1;
      card.innerHTML = `<div class="on" id="cardState"></div><h3>${num} · ${esc(st.name)}</h3><p>${esc(st.role || "")}</p>` +
        (p ? `<figure><a href="${esc(p.link || p.large || p.medium)}" target="_blank" rel="noopener"><img src="${esc(p.medium || p.small)}" alt="Perseverance rover photo taken near this stop"></a>
          <figcaption>What Perseverance saw here on sol ${p.sol} · ${/^MCZ/.test(p.cam) ? "Mastcam-Z · NASA/JPL-Caltech/ASU" : "NASA/JPL-Caltech"}</figcaption></figure>` : "");
      card.hidden = false;
    }
    $("#cardState").textContent = S.onSite.left != null ? `ON SITE · science work · ${Math.ceil(S.onSite.left)} min left` : `ON SITE · science work ${st.dwell_min || 0} min`;
  }
  // labels
  for (const L of labels) if (L.stopIndex != null) {
    L.el.classList.toggle("done", L.stopIndex < S.target && L.stopIndex > 0);
    L.el.classList.toggle("next", L.stopIndex === S.target && !S.done);
    const [sx, sz] = stopXZ(stopAt(L.stopIndex));
    L.dist.textContent = S.mode === "map" ? "" : fmtDist(Math.hypot(sx - S.pos.x, sz - S.pos.z));
  }
}
const _v = new THREE.Vector3();
function updateLabels() {
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const L of labels) {
    L.getPos(L.pos); _v.copy(L.pos).project(camera);
    const vis = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.25 && (L !== meLabel || S.mode === "map");
    L.el.style.display = vis ? "" : "none";
    if (vis) L.el.style.transform = `translate(-50%, -100%) translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h - 7).toFixed(1)}px)`;
  }
}
const cctx = $("#compass").getContext("2d");
function drawCompass() {
  if (S.mode === "map") return;
  const g = cctx, W = 1120, H = 92, span = 120, pxd = W / span, view = wrap(S.heading + S.camYaw) / DEG;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "rgba(9,10,12,.74)"; g.beginPath(); g.roundRect(0, 0, W, H, 4); g.fill();
  g.strokeStyle = "rgba(255,255,255,.2)"; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, W - 2, H - 2, 4); g.stroke();
  g.textAlign = "center"; g.textBaseline = "middle";
  for (let d = Math.ceil((view - span / 2) / 5) * 5; d <= view + span / 2; d += 5) {
    const x = (d - view + span / 2) * pxd, dd = ((d % 360) + 360) % 360, major = dd % 45 === 0, mid = dd % 15 === 0;
    g.strokeStyle = major ? "#f1f2f3" : "rgba(241,242,243,.45)"; g.lineWidth = major ? 3 : 2;
    g.beginPath(); g.moveTo(x, H - 8); g.lineTo(x, H - (major ? 34 : mid ? 26 : 18)); g.stroke();
    if (major) { g.fillStyle = dd === 0 ? "#ff6a3d" : "#f1f2f3"; g.font = "700 30px 'Barlow Semi Condensed', 'Barlow', sans-serif"; g.fillText(COMPASS[dd / 45], x, 30); }
    else if (mid) { g.fillStyle = "rgba(163,169,177,.95)"; g.font = "500 20px 'Barlow Semi Condensed', 'Barlow', sans-serif"; g.fillText(String(dd), x, 32); }
  }
  const mark = (bearing, color, text) => {
    const off = clamp(angDiff(view * DEG, bearing) / DEG, -span / 2 + 3, span / 2 - 3), x = (off + span / 2) * pxd;
    g.fillStyle = color; g.beginPath(); g.arc(x, 62, 17, 0, TAU); g.fill();
    g.fillStyle = color === "#ffffff" ? "#111" : "#fff"; g.font = "700 22px 'Barlow Semi Condensed', 'Barlow', sans-serif"; g.fillText(text, x, 63);
  };
  const [bx, bz] = stopXZ(stopAt(0)), last = M.order.length - 1;
  if (S.target !== last) mark(Math.atan2(bx - S.pos.x, -(bz - S.pos.z)), "#ffffff", "H");
  const [nx, nz] = stopXZ(stopAt(S.target));
  mark(Math.atan2(nx - S.pos.x, -(nz - S.pos.z)), "#ff6a3d", S.target === last ? "H" : String(S.target + 1));
  g.fillStyle = "#f1f2f3"; g.beginPath(); g.moveTo(W / 2 - 10, 0); g.lineTo(W / 2 + 10, 0); g.lineTo(W / 2, 14); g.fill();
}
const mini = $("#minimap"), mctx = mini.getContext("2d"), miniBase = document.createElement("canvas");
miniBase.width = mini.width; miniBase.height = mini.height;
const miniXY = (x, z) => [(x / (2 * halfW) + 0.5) * mini.width, (z / (2 * halfH) + 0.5) * mini.height];
function drawMinimapBase() {
  const g = miniBase.getContext("2d"), W = mini.width, H = mini.height;
  g.drawImage(texCanvas, 0, 0, W, H);
  g.fillStyle = "rgba(10,13,20,.18)"; g.fillRect(0, 0, W, H);
  if (!TL) return;
  g.lineJoin = "round"; g.lineCap = "round";
  for (const [color, width] of [["rgba(0,0,0,.55)", 8], ["#ff6a3d", 4.5]]) {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    for (const s of TL.segs) if (s.kind === "walk") s.pts.forEach((p, i) => { const [x, y] = miniXY(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }
  g.textAlign = "center"; g.textBaseline = "middle"; g.font = "700 19px 'Barlow Semi Condensed', 'Barlow', sans-serif";
  M.order.slice(0, -1).forEach((id, i) => {
    const [x, y] = miniXY(...stopXZ(stopById(id)));
    g.fillStyle = i ? "#ff6a3d" : "#f1f2f3"; g.strokeStyle = "#fff"; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, 15, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = i ? "#fff" : "#111"; g.fillText(String(i + 1), x, y + 1);
  });
}
function drawMinimap() {
  const g = mctx; g.drawImage(miniBase, 0, 0);
  const [x, y] = miniXY(S.pos.x, S.pos.z);
  g.save(); g.translate(x, y); g.rotate(S.heading + (S.mode === "map" ? 0 : S.camYaw));
  g.fillStyle = "#fff"; g.strokeStyle = "#0a0d14"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -17); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

/* ---------- picking the ground under the pointer (ray-march over the elevation grid) ---------- */
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
function groundHit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  let t = 0, prev = 0;
  for (let i = 0; i < 6000 && t < 40000; i++) {
    prev = t; t += Math.max(2, t * 0.01);
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (!inBounds(x, z) || o.y + d.y * t > heightAt(x, z)) continue;
    let a = prev, b = t;
    for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (o.y + d.y * m <= heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
    return { x: o.x + d.x * b, z: o.z + d.z * b };
  }
  return null;
}

/* ---------- input ---------- */
function bindInput() {
  document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.mode, true); b.blur(); }));
  $("#auto").addEventListener("click", (e) => { if (S.auto) setAuto(false); else startAuto(); e.currentTarget.blur(); });
  $("#reset").addEventListener("click", (e) => { resetEva(); e.currentTarget.blur(); });
  $("#warp").addEventListener("change", (e) => { S.warp = +e.target.value; e.target.blur(); });
  const pop = (btn, id, other) => $(btn).addEventListener("click", (e) => { $(other).hidden = true; $(id).hidden = !$(id).hidden; e.currentTarget.blur(); });
  pop("#layersBtn", "#layers", "#help"); pop("#helpBtn", "#help", "#layers");
  canvas.addEventListener("pointerdown", () => { $("#layers").hidden = true; $("#help").hidden = true; });
  document.querySelectorAll("#layers input[data-layer]").forEach((inp) => inp.addEventListener("change", () => {
    S.layers[inp.dataset.layer] = inp.checked;
    if (inp.dataset.layer === "traverse") { if (traverseMesh) traverseMesh.visible = inp.checked; } else if (inp.dataset.layer === "rocks") updateRocks(true); else if (inp.dataset.layer === "bumps") updatePatch(true); else compose();
  }));
  $("#relief").addEventListener("input", (e) => {
    S.relief = +e.target.value; $("#reliefOut").textContent = `×${S.relief.toFixed(1)}${S.relief === 1 ? " true scale" : ""}`; placeObjects();
  });
  const setWarp = (v) => { S.warp = v; $("#warp").value = String(v); toast(`Time ×${v}`, 1200); };
  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      if (S.mode === "map" && !e.repeat) setMode("third");
      S.keys.add(k); e.preventDefault();
    } else if (k === " ") { if (S.auto) setAuto(false); else startAuto(); e.preventDefault(); }
    else if (k === "v") setMode(S.mode === "third" ? "first" : "third", true);
    else if (k === "m") setMode("map", true);
    else if (k === "r") resetEva();
    else if (k === "c") S.camYaw = 0;
    else if ("1234".includes(k) && k.length === 1) setWarp([1, 10, 60, 300][+k - 1]);
  });
  addEventListener("keyup", (e) => S.keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => S.keys.clear());
  document.querySelectorAll("#pad button").forEach((b) => {
    const on = (e) => { S.keys.add(b.dataset.key); e.preventDefault(); }, off = () => S.keys.delete(b.dataset.key);
    b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
  });
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (S.mode === "map") return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (S.mode === "third") { S.camYaw += dx * 0.006; S.camPitch = clamp(S.camPitch + dy * 0.005, -4 * DEG, 85 * DEG); }
    else { S.camYaw -= dx * 0.004; S.lookPitch = clamp(S.lookPitch - dy * 0.004, -70 * DEG, 70 * DEG); }
    S.camYaw = angDiff(0, S.camYaw);
  });
  const endDrag = () => { drag = null; canvas.classList.remove("dragging"); };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (e) => {
    if (S.mode !== "third") return;
    S.camDist = clamp(S.camDist * Math.exp(e.deltaY * 0.0012), 3, 80); e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { if (S.mode !== "map") return; const hit = groundHit(e.clientX, e.clientY); if (hit) teleport(hit.x, hit.z); });
  mini.addEventListener("click", (e) => {
    const r = mini.getBoundingClientRect();
    teleport(((e.clientX - r.left) / r.width - 0.5) * 2 * halfW, ((e.clientY - r.top) / r.height - 0.5) * 2 * halfH);
  });
  new ResizeObserver(resize).observe(stage);
}
function resize() {
  const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}

/* ---------- start ---------- */
async function init() {
  const json = (r) => { if (!r.ok) throw new Error(`${r.url}: ${r.status}`); return r.json(); };
  const bin = (f) => fetch(`${ROOT}data/${f}`).then((r) => { if (!r.ok) throw new Error(`data/${f}: ${r.status}`); return r.arrayBuffer(); });
  let handoff = null;                       // the plan as edited in the 2D planner, if we came from there
  try { handoff = JSON.parse(sessionStorage.getItem("redroute.plan") || "null"); } catch (e) { /* no stored plan */ }
  const [m0, r0, slope, rough, dem, traverse] = await Promise.all([
    fetch(`${ROOT}data/mission.json`).then(json), fetch(`${ROOT}data/route.geojson`).then(json), bin("grid_slope.u8"), bin("grid_rough.u8"), bin("grid_dem.i16"),
    fetch(`${ROOT}data/m20_traverse.json`).then(json).catch(() => null),
  ]);
  const useHandoff = !params.has("default") && handoff && handoff.mission && handoff.route && handoff.route.features && handoff.route.features.length;
  M = useHandoff ? handoff.mission : m0;
  const route = useHandoff ? handoff.route : r0;
  G = M.grid || m0.grid; A = M.assumptions;
  SLOPE = new Uint8Array(slope); ROUGH = new Uint8Array(rough); DEM = new Int16Array(dem);
  halfW = G.w * G.gx / 2; halfH = G.h * G.gy / 2;
  const [bx, bz] = stopXZ(stopAt(0));
  zBase = elevXZ(bx, bz);

  // texture canvases
  $("#loadMsg").textContent = "Terrain shading and map layers";
  TW = Math.min(4096, renderer.capabilities.maxTextureSize); TH = Math.round(TW * halfH / halfW);
  texCanvas = document.createElement("canvas"); texCanvas.width = TW; texCanvas.height = TH; tctx = texCanvas.getContext("2d");
  photoCanvas = document.createElement("canvas"); photoCanvas.width = TW; photoCanvas.height = TH; pctx = photoCanvas.getContext("2d");
  terrainTex = new THREE.CanvasTexture(texCanvas); terrainTex.colorSpace = THREE.SRGBColorSpace;
  terrainTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ob = M.overlay_bounds || m0.overlay_bounds, lonB = G.lon0 + G.w * G.dlon, latA = G.lat1 - G.h * G.dlat;
  const ox = (ob[0][1] - G.lon0) / (lonB - G.lon0) * TW, oy = (G.lat1 - ob[1][0]) / (G.lat1 - latA) * TH;
  ovRect = [ox, oy, (ob[1][1] - G.lon0) / (lonB - G.lon0) * TW - ox, (G.lat1 - ob[0][0]) / (G.lat1 - latA) * TH - oy];
  const names = ["hillshade", "slope", "hazard", "returntime"];
  (await Promise.all(names.map((n) => loadImage(`${ROOT}data/${n}.png`)))).forEach((im, i) => (IMG[names[i]] = im));

  $("#loadMsg").textContent = "Building the 3D terrain";
  const q = +params.get("q") || (matchMedia("(pointer: coarse)").matches || (navigator.deviceMemory && navigator.deviceMemory < 4) ? 2 : 1);
  buildTerrain(clamp(Math.round(q), 1, 4));

  // route, rover path, stops
  TL = buildTimeline(route);
  routeMesh = ribbon(TL.segs.filter((s) => s.kind === "walk").map((s) => s.pts), ACCENT, 0.2, 0.0036, 0.3);
  if (traverse && traverse.features) {
    const lines = [];
    for (const f of traverse.features) {
      let cur = [];
      for (const [lon, lat] of f.geometry.coordinates) {
        const [x, z] = worldOf(lon, lat);
        if (inBounds(x, z)) cur.push({ x, z }); else { if (cur.length > 1) lines.push(cur); cur = []; }
      }
      if (cur.length > 1) lines.push(cur);
    }
    if (lines.length) { traverseMesh = ribbon(lines, 0x38bdf8, 0.11, 0.0017, 0.4); traverseMesh.renderOrder = 3; traverseMesh.material.uniforms.uOpacity.value = 0.85; }
  }
  for (const m of [routeMesh, traverseMesh]) if (m) m.material.depthTest = false;
  astro = makeAstronaut(); loadAstronautModel(); habitat = makeHabitat(); initRocks(); initPatch();
  M.order.slice(0, -1).forEach((id, i) => {
    const st = stopById(id);
    if (i) makeBeacon(st, i);
    const L = makeLabel(i ? "" : "base", `<span class="n">${i + 1}</span><span class="nm">${esc(st.name)}</span><small></small>`,
      (v) => { const [x, z] = stopXZ(st); v.set(x, heightAt(x, z) + (S.mode === "map" ? 8 : 5), z); },
      () => { if (S.mode !== "map" || tween) return; const [x, z] = stopXZ(st), off = camera.position.clone().sub(controls.target).setLength(520);
        controls.target.set(x, heightAt(x, z), z); camera.position.copy(controls.target).add(off); });
    L.stopIndex = i; L.dist = L.el.querySelector("small");
  });
  meLabel = makeLabel("me", "<i></i>", (v) => v.set(S.pos.x, S.pos.y + 2, S.pos.z));
  placeObjects();
  resetEva(true);
  if (useHandoff && handoff.t > 0) jumpTo(handoff.t);

  // opening map view: the whole route from the south
  let cx = 0, cz = 0, n = 0;
  for (const s of TL.segs) if (s.kind === "walk") for (const p of s.pts) { cx += p.x; cz += p.z; n++; }
  cx /= n; cz /= n;
  controls.target.set(cx, heightAt(cx, cz), cz);
  camera.position.set(cx, controls.target.y + 2500, cz + 2500);
  controls.update();
  $("#hint").textContent = HINT.map;

  if (params.has("embed")) {                // inside the planner: "Map", the logo and Esc close the 3D walk
    const close = (e) => { if (e) e.preventDefault(); parent.postMessage({ type: "redroute:3d-close" }, location.origin); };
    $("#closeBtn").hidden = false; $("#closeBtn").addEventListener("click", close); $("#brandLink").addEventListener("click", close);
    addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    addEventListener("message", (e) => { if (e.origin === location.origin && e.data && e.data.type === "redroute:3d-time") jumpTo(e.data.t); });
  }
  bindInput(); resize(); compose();
  $("#loading").remove();
  requestAnimationFrame(frame);

  // HiRISE photo: a coarse pass first, then full detail
  loadTiles(13).then(() => loadTiles(15));

  // walk-back time from every cell, computed by the planner's own router
  try {
    const worker = new Worker("walk3d-worker.js?root=" + encodeURIComponent(ROOT));
    worker.onerror = () => { S.field = null; };
    worker.onmessage = (e) => {
      if (e.data.type === "ready") {
        const b = stopAt(0);
        worker.postMessage({ type: "field", grid: G, lon: b.lon, lat: b.lat,
          params: { maxSlope: A.max_slope_deg, vFlat: A.v_flat_ms, roughPenalty: A.rough_penalty, roughM: A.rough_m } });
      } else if (e.data.type === "field") { if (e.data.minutes) S.field = e.data.minutes; worker.terminate(); }
    };
    const copy = (a) => a.buffer.slice(0);
    const s = copy(SLOPE), r = copy(ROUGH), d = copy(DEM);
    worker.postMessage({ type: "init", grid: G, slope: s, rough: r, dem: d }, [s, r, d]);
  } catch (e) { /* walk-back readout stays empty when walking freely */ }
}

let last = 0;
function tick(dt) { updateWalk(dt); updateCamera(dt); updatePatch(false); updateRocks(false); updateHud(dt); updateLabels(); drawCompass(); drawMinimap(); }
function frame(now) {
  const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
  tick(dt); renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.Walk3D = { S, RK, PATCH, tick, jumpTo, setMode, startAuto, setAuto, resetEva, teleport, render: () => renderer.render(scene, camera), get timeline() { return TL; }, get mission() { return M; }, camera, renderer, scene };
init().catch((err) => {
  console.error(err);
  const l = $("#loading"); if (l) { l.classList.add("err"); l.innerHTML = `<b>Could not load the 3D view</b><span>${esc(err.message || err)}</span><span><a href="${ROOT}">Back to the planner</a></span>`; }
});
