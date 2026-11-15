/* Red Route 3D walk: the world.
   Jezero terrain as a true-scale mesh from the app's own elevation grid (docs/data/grid_dem.i16, resampled from the
   USGS Mars 2020 HiRISE DTM), ground steeper than the no-go slope tinted as in the app, sky, sun, the planned
   route as a red line and the stops. The ground picture is the HiRISE orthomosaic of Jezero (assets/jezero_hirise_ortho.jpg,
   see assets/GROUND_PICTURE.md), given Mars colours by this code; the fine grain close to the feet is drawn by this code.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export const SKY_HORIZON = new THREE.Color(0xd8a877);
export const SKY_ZENITH = new THREE.Color(0x8f6748);
// The sun's place is fixed for the picture (afternoon, from the west-north-west); it is not worked out from a date.
export const SUN_DIR = new THREE.Vector3(-0.66, 0.6, -0.36).normalize();

/* ---------- ground: grid <-> world. x = metres east of the grid's west edge, z = metres south of its north edge, y = metres above Y0 ---------- */
export class Ground {
  constructor(g, dem, slope, rough) {
    this.g = g; this.dem = dem; this.slope = slope; this.rough = rough;
    this.W = g.w; this.H = g.h;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < dem.length; i++) { const v = dem[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    this.zMin = mn * g.z_scale + g.z_offset; this.zMax = mx * g.z_scale + g.z_offset;
    this.Y0 = this.zMin;
    this.sizeX = g.w * g.gx; this.sizeZ = g.h * g.gy;
  }
  elev(c, r) { return this.dem[r * this.W + c] * this.g.z_scale + this.g.z_offset; }
  xOf(lon) { return ((lon - this.g.lon0) / this.g.dlon) * this.g.gx; }
  zOf(lat) { return ((this.g.lat1 - lat) / this.g.dlat) * this.g.gy; }
  lonOf(x) { return this.g.lon0 + (x / this.g.gx) * this.g.dlon; }
  latOf(z) { return this.g.lat1 - (z / this.g.gy) * this.g.dlat; }
  inside(x, z, pad = 0) { return x >= pad + this.g.gx * 0.5 && x <= this.sizeX - this.g.gx * 0.5 - pad && z >= pad + this.g.gy * 0.5 && z <= this.sizeZ - this.g.gy * 0.5 - pad; }
  // height above Y0 at a world point: on the same triangles the mesh draws (cell centres are the mesh corners)
  height(x, z) {
    const g = this.g, W = this.W, H = this.H;
    let fc = x / g.gx - 0.5, fr = z / g.gy - 0.5;
    fc = Math.max(0, Math.min(W - 1.0001, fc)); fr = Math.max(0, Math.min(H - 1.0001, fr));
    const c = Math.floor(fc), r = Math.floor(fr), u = fc - c, v = fr - r, i = r * W + c, d = this.dem;
    const h00 = d[i], h10 = d[i + 1], h01 = d[i + W], h11 = d[i + W + 1];
    const h = u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
    return h * g.z_scale + g.z_offset - this.Y0;
  }
  cellAt(x, z) {
    const c = Math.floor(x / this.g.gx), r = Math.floor(z / this.g.gy);
    if (c < 0 || r < 0 || c >= this.W || r >= this.H) return -1;
    return r * this.W + c;
  }
  slopeAt(x, z) { const i = this.cellAt(x, z); return i < 0 || this.slope[i] === 255 ? null : this.slope[i] * this.g.slope_scale; }
  roughAt(x, z) { const i = this.cellAt(x, z); return i < 0 ? 0 : this.rough[i] * this.g.rough_scale; }
}

/* ---------- small helpers ---------- */
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function smoothNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const fbm = (x, y) => 0.5 * smoothNoise(x, y) + 0.25 * smoothNoise(x * 2.03, y * 2.03) + 0.125 * smoothNoise(x * 4.01, y * 4.01) + 0.125 * smoothNoise(x * 8.07, y * 8.07);

// a tiling grain texture: r = fine grain, g = coarser blotches
function makeDetailTexture() {
  const N = 256, c = document.createElement("canvas"); c.width = c.height = N;
  const ctx = c.getContext("2d"), img = ctx.createImageData(N, N), px = img.data;
  const tile = (f, x, y, p) => {   // tileable value noise with period p
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const w = (a, b) => hash2(((a % p) + p) % p + f * 131, ((b % p) + p) % p + f * 17);
    const a = w(xi, yi), b = w(xi + 1, yi), cc = w(xi, yi + 1), d = w(xi + 1, yi + 1);
    return a + (b - a) * su + (cc - a) * sv + (a - b - cc + d) * su * sv;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fine = 0.45 * tile(1, x / 4, y / 4, 64) + 0.3 * tile(2, x / 2, y / 2, 128) + 0.25 * hash2(x + 911, y + 73);
    const coarse = 0.6 * tile(3, x / 32, y / 32, 8) + 0.4 * tile(4, x / 12.8, y / 12.8, 20);
    const o = (y * N + x) * 4;
    px[o] = Math.round(fine * 255); px[o + 1] = Math.round(coarse * 255); px[o + 2] = Math.round(fine * 255); px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  return t;
}

// ground colour per grid cell, drawn by code: used until the HiRISE picture has loaded, and kept if it cannot load
function makeColourTexture(G) {
  const W = G.W, H = G.H, c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"), img = ctx.createImageData(W, H), px = img.data;
  const lerp = (a, b, t) => a + (b - a) * t, span = Math.max(1, G.zMax - G.zMin);
  for (let r = 0; r < H; r++) for (let col = 0; col < W; col++) {
    const i = r * W + col, s = G.slope[i] === 255 ? 0 : G.slope[i] * G.g.slope_scale, e = (G.elev(col, r) - G.zMin) / span;
    const n = fbm(col / 37, r / 37), n2 = fbm(col / 9 + 40, r / 9 + 7);
    // dusty ochre on the flats, darker rock where it is steep, a little lighter high up
    const dust = Math.min(1, Math.max(0, 0.55 + 0.5 * (n - 0.5) + 0.25 * (n2 - 0.5) + 0.2 * (e - 0.5)));
    let R = lerp(142, 198, dust), Gc = lerp(92, 140, dust), B = lerp(62, 96, dust);
    const rock = Math.min(1, s / 26);
    R = lerp(R, 104, rock * 0.55); Gc = lerp(Gc, 70, rock * 0.55); B = lerp(B, 54, rock * 0.55);
    const o = i * 4; px[o] = R; px[o + 1] = Gc; px[o + 2] = B; px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}
function finishTexture(t) {
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

// The real ground picture: the HiRISE orthomosaic of Jezero (grey, one band), given Mars colours by a fixed colour ramp.
// The picture is NASA data; the colours are ours (the camera band is not a colour photo).
function tintOrtho(img, width) {
  const W = Math.min(width, img.naturalWidth), H = Math.round((W * img.naturalHeight) / img.naturalWidth);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const id = ctx.getImageData(0, 0, W, H), px = id.data;
  const lut = new Uint8Array(256 * 3), lo = [70, 44, 32], mid = [176, 118, 80], hi = [242, 200, 160];
  for (let v = 0; v < 256; v++) {
    const g = Math.min(1, Math.max(0, (v / 255 - 0.47) * 1.5 + 0.5));   // a little more contrast around the middle grey
    for (let k = 0; k < 3; k++) lut[v * 3 + k] = g < 0.5 ? lo[k] + (mid[k] - lo[k]) * g * 2 : mid[k] + (hi[k] - mid[k]) * (g - 0.5) * 2;
  }
  for (let o = 0; o < px.length; o += 4) { const v = px[o] * 3; px[o] = lut[v]; px[o + 1] = lut[v + 1]; px[o + 2] = lut[v + 2]; }
  ctx.putImageData(id, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

// the no-go colours of the main app (yellow > orange > red) on ground steeper than the limit, as a see-through layer
function makeNoGoTexture(G, maxSlope) {
  const W = G.W, H = G.H, c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"), img = ctx.createImageData(W, H), px = img.data, lerp = (a, b, t) => a + (b - a) * t;
  for (let i = 0; i < W * H; i++) {
    const s = G.slope[i] === 255 ? 0 : G.slope[i] * G.g.slope_scale, o = i * 4;
    const t = Math.min(1, Math.max(0, (s - maxSlope) / 12));   // #facc15 -> #f97316 -> #dc2626
    px[o] = t < 0.5 ? lerp(250, 249, t * 2) : lerp(249, 220, (t - 0.5) * 2);
    px[o + 1] = t < 0.5 ? lerp(204, 115, t * 2) : lerp(115, 38, (t - 0.5) * 2);
    px[o + 2] = t < 0.5 ? lerp(21, 22, t * 2) : lerp(22, 38, (t - 0.5) * 2);
    px[o + 3] = s > maxSlope ? 118 : 0;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

/* ---------- terrain mesh, in chunks so the parts out of view are skipped ---------- */
export function buildTerrain(scene, G, maxSlope, step) {
  const W = G.W, H = G.H, g = G.g, dem = G.dem;
  const detail = makeDetailTexture();
  const mat = new THREE.MeshLambertMaterial({ map: makeColourTexture(G) });
  const uni = { uDetail: { value: detail }, uDetailRep: { value: new THREE.Vector2(G.sizeX / 5.0, G.sizeZ / 5.0) },
    uNoGo: { value: makeNoGoTexture(G, maxSlope) }, uTint: { value: 1 }, uBlot: { value: 1 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vCamDist;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvCamDist = length(mvPosition.xyz);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uDetail;\nuniform sampler2D uNoGo;\nuniform vec2 uDetailRep;\nuniform float uTint;\nuniform float uBlot;\nvarying float vCamDist;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        {
          vec4 dA = texture2D(uDetail, vMapUv * uDetailRep);
          vec4 dB = texture2D(uDetail, vMapUv * uDetailRep * 0.083);
          float nearK = 1.0 - smoothstep(25.0, 160.0, vCamDist);
          float grain = mix(1.0, 0.74 + 0.52 * dA.r, nearK);
          float blot = mix(1.0, 0.86 + 0.28 * dB.g, uBlot);
          diffuseColor.rgb *= grain * blot;
          vec4 ng = texture2D(uNoGo, vMapUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, ng.rgb, ng.a * uTint);
        }`);
  };
  mat.customProgramCacheKey = () => "rr-terrain";
  const group = new THREE.Group(); group.name = "terrain";
  const hAt = (c, r) => dem[Math.min(H - 1, r) * W + Math.min(W - 1, c)] * g.z_scale + g.z_offset - G.Y0;
  const CH = 96;   // cells per chunk side
  for (let r0 = 0; r0 < H - 1; r0 += CH) for (let c0 = 0; c0 < W - 1; c0 += CH) {
    const cols = [], rows = [];
    for (let c = c0; c < Math.min(c0 + CH, W - 1); c += step) cols.push(c);
    cols.push(Math.min(c0 + CH, W - 1));
    for (let r = r0; r < Math.min(r0 + CH, H - 1); r += step) rows.push(r);
    rows.push(Math.min(r0 + CH, H - 1));
    const nc = cols.length, nr = rows.length, pos = new Float32Array(nc * nr * 3), nor = new Float32Array(nc * nr * 3), uv = new Float32Array(nc * nr * 2);
    let k = 0, ku = 0;
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      const c = cols[i], r = rows[j];
      pos[k] = (c + 0.5) * g.gx; pos[k + 1] = hAt(c, r); pos[k + 2] = (r + 0.5) * g.gy;
      const cl = Math.max(0, c - 1), cr = Math.min(W - 1, c + 1), ru = Math.max(0, r - 1), rd = Math.min(H - 1, r + 1);
      const dx = (hAt(cr, r) - hAt(cl, r)) / ((cr - cl) * g.gx), dz = (hAt(c, rd) - hAt(c, ru)) / ((rd - ru) * g.gy);
      const inv = 1 / Math.hypot(dx, 1, dz);
      nor[k] = -dx * inv; nor[k + 1] = inv; nor[k + 2] = -dz * inv;
      uv[ku] = (c + 0.5) / W; uv[ku + 1] = 1 - (r + 0.5) / H;
      k += 3; ku += 2;
    }
    const idx = new Uint16Array((nc - 1) * (nr - 1) * 6);
    let q = 0;
    for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;   // split along b-c, as Ground.height()
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  scene.add(group);
  // beyond the mapped ground: a plain floor in haze, so the edge of the data is not a hole
  const far = new THREE.Mesh(new THREE.CircleGeometry(40000, 48), new THREE.MeshLambertMaterial({ color: 0x9a6a48 }));
  far.rotation.x = -Math.PI / 2; far.position.set(G.sizeX / 2, -6, G.sizeZ / 2); far.matrixAutoUpdate = false; far.updateMatrix();
  scene.add(far);
  // the real picture of the ground, when it has loaded
  const loadOrtho = (url, width) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { try { const old = mat.map; mat.map = tintOrtho(img, width); uni.uBlot.value = 0.35; mat.needsUpdate = true; if (old) old.dispose(); res(true); } catch (e) { rej(e); } };
    img.onerror = () => rej(new Error("ground picture did not load"));
    img.src = url;
  });
  return { group, mat, loadOrtho, setTint: (on) => { uni.uTint.value = on ? 1 : 0; } };
}

/* ---------- sky dome with the sun ---------- */
export function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR }, uHorizon: { value: SKY_HORIZON }, uZenith: { value: SKY_ZENITH } },
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `varying vec3 vDir; uniform vec3 uSun, uHorizon, uZenith;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
        col = mix(col, uHorizon * 1.04, pow(1.0 - h, 10.0));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(0.50, 0.58, 0.72) * pow(s, 18.0) * 0.22;      // the cool glow around the sun in Mars dust
        col += vec3(0.80, 0.86, 0.96) * pow(s, 320.0) * 0.75;
        col += vec3(1.0, 0.98, 0.94) * smoothstep(0.99990, 0.99996, s);   // the small sun disc
        if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.82, clamp(-d.y * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xf3dcc0, 0x7d5a42, 1.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun); scene.add(sun.target);
  return { hemi, sun };
}

/* ---------- the planned route: a red line on the ground (app's route colour), with a dark edge ---------- */
export class RouteLine {
  constructor(scene, G) {
    this.scene = scene; this.G = G; this.objs = [];
    // near: a path 1 m wide on the ground; far: a thin line that never gets thinner than 3 px, with a dark edge
    this.matEdge = new LineMaterial({ color: 0x0b0b0b, linewidth: 6, transparent: true, opacity: 0.5, depthWrite: false });
    this.matLine = new LineMaterial({ color: 0xff6a3d, linewidth: 3 });
    this.matWide = new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
    for (const m of [this.matEdge, this.matLine]) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -8; }
    this.matHome = new LineMaterial({ color: 0xf9a8d4, linewidth: 3.5, dashed: true, dashSize: 4, gapSize: 5 });
  }
  setResolution(w, h) { for (const m of [this.matEdge, this.matLine, this.matHome]) m.resolution.set(w, h); }
  // pts = [[lat, lon], ...]
  positions(pts, lift) {
    const G = this.G, out = [];
    let px = null, pz = null;
    for (const p of pts) {
      const x = G.xOf(p[1]), z = G.zOf(p[0]);
      if (px !== null) {   // add points between far-apart ones so the line follows the ground
        const d = Math.hypot(x - px, z - pz), n = Math.floor(d / 3);
        for (let i = 1; i <= n; i++) { const f = i / (n + 1), xx = px + (x - px) * f, zz = pz + (z - pz) * f; out.push(xx, G.height(xx, zz) + lift, zz); }
      }
      out.push(x, G.height(x, z) + lift, z);
      px = x; pz = z;
    }
    return out;
  }
  set(route) {
    for (const o of this.objs) { this.scene.remove(o); o.geometry.dispose(); }
    this.objs = [];
    const add = (lift, mat, order) => {
      const geo = new LineGeometry(); geo.setPositions(this.positions(route.pts, lift));
      const l = new Line2(geo, mat); l.computeLineDistances(); l.renderOrder = order; l.frustumCulled = false;
      this.scene.add(l); this.objs.push(l);
    };
    add(0.2, this.matEdge, 1); add(0.26, this.matLine, 2);
    // the path on the ground: a flat strip 0.9 m wide that lies on the terrain
    const p = this.positions(route.pts, 0.1), n = p.length / 3, G = this.G, half = 0.45;
    const pos = new Float32Array(n * 6), idx = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = p[b * 3] - p[a * 3], tz = p[b * 3 + 2] - p[a * 3 + 2];
      const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
      const lx = p[i * 3] - tz * half, lz = p[i * 3 + 2] + tx * half, rx = p[i * 3] + tz * half, rz = p[i * 3 + 2] - tx * half;
      pos.set([lx, G.height(lx, lz) + 0.1, lz, rx, G.height(rx, rz) + 0.1, rz], i * 6);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    const strip = new THREE.Mesh(geo, this.matWide); strip.renderOrder = 3; strip.frustumCulled = false;
    this.scene.add(strip); this.objs.push(strip);
  }
  setHome(pts) {
    if (this.home) { this.scene.remove(this.home); this.home.geometry.dispose(); this.home = null; }
    if (!pts || pts.length < 2) return;
    const geo = new LineGeometry(); geo.setPositions(this.positions(pts, 0.45));
    this.home = new Line2(geo, this.matHome); this.home.computeLineDistances(); this.home.renderOrder = 3; this.home.frustumCulled = false;
    this.scene.add(this.home);
  }
}

/* ---------- stops: a thin light post and a ring on the ground; the name and leave-by time are HTML labels ---------- */
export class StopMarkers {
  constructor(scene, G) { this.scene = scene; this.G = G; this.group = new THREE.Group(); scene.add(this.group); this.items = []; }
  set(stops) {   // stops = [{ id, lat, lon, color, optional }]
    this.group.clear(); this.items = [];
    for (const s of stops) {
      const x = this.G.xOf(s.lon), z = this.G.zOf(s.lat), y = this.G.height(x, z);
      const col = new THREE.Color(s.color);
      const hgt = 22 + (this.items.length % 3) * 9;   // different heights, so labels in one line of sight do not cover each other
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, hgt, 6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: s.optional ? 0.3 : 0.6, fog: false }));
      post.position.set(x + 6.5, y + hgt / 2, z - 3);
      // a ring that lies on the ground, also on a slope
      const N = 72, rp = new Float32Array((N + 1) * 6), ri = [];
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
        const ax = x + cx * 5.6, az = z + cz * 5.6, bx = x + cx * 6.0, bz = z + cz * 6.0;
        rp.set([ax, this.G.height(ax, az) + 0.3, az, bx, this.G.height(bx, bz) + 0.3, bz], k * 6);
        if (k < N) ri.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
      }
      const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(rp, 3)); rg.setIndex(ri);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: s.optional ? 0.3 : 0.75, side: THREE.DoubleSide, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
      this.group.add(post, ring);
      this.items.push({ id: s.id, top: new THREE.Vector3(x + 6.5, y + hgt + 1.5, z - 3), foot: new THREE.Vector3(x, y, z) });
    }
  }
}

/* ---------- base camp: a plain stand-in habitat (an illustration, not a real design; no marks on it) ---------- */
export function buildHabitat(scene, G, lat, lon) {
  const x = G.xOf(lon) + 9, z = G.zOf(lat) - 7, y = G.height(x, z);
  const grp = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe7e3dc }), grey = new THREE.MeshLambertMaterial({ color: 0x8d8f93 }), dark = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 8.5, 24), white); body.rotation.z = Math.PI / 2; body.position.y = 3.1;
  const capA = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 12), white); capA.scale.x = 0.45; capA.position.set(4.25, 3.1, 0);
  const capB = capA.clone(); capB.position.x = -4.25;
  const lock = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.4, 1.8), grey); lock.position.set(-1.6, 1.9, 2.7);
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.08), dark); hatch.position.set(-1.6, 1.75, 3.62);
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 1.2), grey); step.position.set(-1.6, 0.55, 4.2);
  grp.add(body, capA, capB, lock, hatch, step);
  for (const sx of [-3, 3]) for (const sz of [-1.5, 1.5]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 8), grey); leg.position.set(sx, 0.6, sz); grp.add(leg); }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), grey); mast.position.set(3.2, 6.2, -0.8);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), grey); dish.rotation.x = Math.PI * 0.8; dish.position.set(3.2, 9.3, -0.8);
  grp.add(mast, dish);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  grp.position.set(x, y - 0.25, z); grp.rotation.y = 0.5;
  scene.add(grp);
  return grp;
}
