/* Red Route 3D walk: the crew (EV1, EV2) and the base-camp habitat.
   Every shape is built by this code from three.js geometry. No model files, no image files, no AI-made images
   or models. The few small textures (suit weave, chest display, the EV1/EV2 marks, solar cells) are drawn on
   canvases by this code. No logos, flags or brand names: only the plain marks "EV1" and "EV2".
   Each astronaut is one skinned figure: the suit parts are merged per material and bound to a bone rig
   (hips, spine, chest, head, arms, hands, legs, boots). Poses are set by code; the legs and arms use two-bone IK,
   so the boots stay on the ground. EV1 wears red bands, EV2 blue ones (stripeHex).
   A figure faces its local +z axis, y is up, units are metres; its origin is on the ground between the boots.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (k) => sstep(0, 1, k);
const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const M4 = () => new THREE.Matrix4();
const at = (x, y, z) => M4().makeTranslation(x, y, z);
const rotX = (a) => M4().makeRotationX(a), rotY = (a) => M4().makeRotationY(a), rotZ = (a) => M4().makeRotationZ(a);
const mul = (...ms) => ms.reduce((acc, m) => acc.multiply(m), M4());
const eul = (x, y, z, o = "XYZ") => M4().makeRotationFromEuler(new THREE.Euler(x, y, z, o));
const scl = (x, y, z) => M4().makeScale(x, y, z);
// a matrix that turns the +y axis onto `dir` and moves to `p` (for cylinders and capsules)
function alignY(p, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir.clone().normalize());
  return M4().compose(p, q, V3(1, 1, 1));
}

// value noise (deterministic), used for dust blotches and texture grain
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
const fbm = (x, y, z) => (vnoise(x, y, z) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.15);

/* ---------- canvas textures (drawn by this code) ---------- */
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const WEAVE_TILE = 0.07;   // one texture tile of the suit cloth, in metres
// rip-stop suit cloth: fine basket weave, a raised grid every 32 px, slow mottling. Returns { map, bump }.
function makeWeave() {
  const n = 256, cm = canvas(n, n), cb = canvas(n, n);
  const gm = cm.getContext("2d"), gb = cb.getContext("2d");
  const im = gm.createImageData(n, n), ib = gb.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const warp = ((x >> 1) + (y >> 2)) & 1;                       // over / under
    const th = warp ? 0.5 + 0.5 * Math.cos((y % 4) * Math.PI / 2) : 0.5 + 0.5 * Math.cos((x % 4) * Math.PI / 2);
    const gx = Math.min(x % 32, 32 - (x % 32)), gy = Math.min(y % 32, 32 - (y % 32));
    const grid = Math.max(0, 1 - gx / 1.6) + Math.max(0, 1 - gy / 1.6);
    const mot = vnoise(x / 40, y / 40, 3.1) - 0.5;
    const grain = hash3(x, y, 7) - 0.5;
    const h = clamp(0.42 + th * 0.22 + Math.min(1, grid) * 0.3 + grain * 0.08, 0, 1);
    const a = clamp(0.95 + th * 0.035 - Math.min(1, grid) * 0.05 + mot * 0.035 + grain * 0.02, 0, 1);
    const i = (y * n + x) * 4;
    ib.data[i] = ib.data[i + 1] = ib.data[i + 2] = h * 255; ib.data[i + 3] = 255;
    im.data[i] = a * 255; im.data[i + 1] = a * 252; im.data[i + 2] = a * 246; im.data[i + 3] = 255;
  }
  gm.putImageData(im, 0, 0); gb.putImageData(ib, 0, 0);
  const map = tex(cm, true, true), bump = tex(cb, false, true);
  map.repeat.set(1 / WEAVE_TILE, 1 / WEAVE_TILE); bump.repeat.set(1 / WEAVE_TILE, 1 / WEAVE_TILE);
  return { map, bump };
}
// the small lit display on the chest unit: numbers and bars only
function makeDisplay() {
  const c = canvas(128, 64), g = c.getContext("2d");
  g.fillStyle = "#020805"; g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#7dffc0"; g.font = "bold 15px monospace"; g.textBaseline = "top";
  g.fillText("O2  92", 6, 5); g.fillText("P  4.3", 6, 23);
  g.fillStyle = "#ffcf6b"; g.fillText("CO2 .4", 6, 41);
  g.fillStyle = "#3fb98a";
  for (let i = 0; i < 6; i++) g.fillRect(84 + i * 7, 52 - (8 + ((i * 37) % 30)), 5, 8 + ((i * 37) % 30));
  g.fillRect(80, 54, 44, 2);
  return tex(c, true, false);
}
// "EV1" / "EV2" marks (plain letters, as the brief allows), slightly worn
function makeMark(text) {
  const c = canvas(256, 128), g = c.getContext("2d");
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = "#23262b"; g.font = "800 92px 'Arial Black', 'Arial', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 68);
  const d = g.getImageData(0, 0, 256, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    if (d.data[i + 3] > 0 && vnoise(x / 6, y / 6, 2) * 0.7 + hash3(x, y, 9) * 0.3 > 0.83) d.data[i + 3] = 0;   // wear
  }
  g.putImageData(d, 0, 0);
  return tex(c, true, false);
}
function makeSolarCells() {
  const c = canvas(256, 256), g = c.getContext("2d");
  g.fillStyle = "#c9ccd2"; g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = i * 32 + 1.5, y = j * 32 + 1.5, v = (hash3(i, j, 4) - 0.5) * 10;
    g.fillStyle = `rgb(${18 + v},${30 + v},${66 + v * 1.5})`; g.fillRect(x, y, 29, 29);
    g.fillStyle = "rgba(170,180,200,0.35)";
    for (let k = 1; k < 4; k++) g.fillRect(x, y + k * 7.3, 29, 0.8);
    g.fillRect(x + 14, y, 0.8, 29);
  }
  return tex(c, true, true);
}

/* ---------- materials (shared by both figures; per-part colour comes from vertex colours) ---------- */
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const weave = makeWeave();
  MATS = {
    // suit cloth: weave bump + a soft cloth sheen at grazing angles; less sky fill so the sun models the folds
    fabric: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, map: weave.map, bumpMap: weave.bump, bumpScale: 1.6, roughness: 0.9, metalness: 0,
      sheen: 0.35, sheenRoughness: 0.7, sheenColor: 0xf3ece2, envMapIntensity: 0.55 }),
    hard: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.25, envMapIntensity: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.92 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.05, envMapIntensity: 0.6 }),
    // gold visor: mirror metal with a thin-film shimmer
    visor: new THREE.MeshPhysicalMaterial({ color: 0xe9ad48, vertexColors: true, metalness: 1, roughness: 0.09, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4,
      iridescence: 0.35, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 520] }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x15130f, emissive: 0xfff1d6, emissiveIntensity: 1.25, roughness: 0.25 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: makeDisplay(), emissiveIntensity: 1.5, roughness: 0.2, metalness: 0 }),
  };
  return MATS;
}
const MARKS = {};
function markMat(text) {
  if (!MARKS[text]) MARKS[text] = new THREE.MeshStandardMaterial({ map: makeMark(text), alphaTest: 0.5, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return MARKS[text];
}

/* ---------- shape generators ----------
   All return indexed BufferGeometry with position, normal and uv (uv in metres where it matters). */

// Surface of revolution about +y. prof = [[r, y, colourHex?], ...] from top to bottom. Two equal points make a
// crisp edge. sx / sz stretch it into an ellipse. Normals are exact; v runs along the profile in metres.
function revolve(prof, segs = 24, o = {}) {
  const P = prof.length, phi0 = o.phi0 ?? 0, phiLen = o.phiLen ?? TAU, sx = o.sx ?? 1, sz = o.sz ?? 1;
  const pos = [], nor = [], uv = [], col = [], idx = [], c = new THREE.Color();
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const s = [0];
  for (let j = 1; j < P; j++) s.push(s[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  let rMean = 0; for (const p of prof) rMean += p[0] / P;
  const hasCol = prof.some((p) => p[2] != null);
  for (let j = 0; j < P; j++) {
    let a, b;
    if (j < P - 1 && same(prof[j], prof[j + 1])) { a = prof[Math.max(0, j - 1)]; b = prof[j]; }
    else if (j > 0 && same(prof[j], prof[j - 1])) { a = prof[j]; b = prof[Math.min(P - 1, j + 1)]; }
    else { a = prof[Math.max(0, j - 1)]; b = prof[Math.min(P - 1, j + 1)]; }
    let nr = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nr, ny); if (l < 1e-9) { nr = 1; ny = 0; } else { nr /= l; ny /= l; }
    const [r, y] = prof[j];
    for (let i = 0; i <= segs; i++) {
      const ph = phi0 + (i / segs) * phiLen, sn = Math.sin(ph), cs = Math.cos(ph);
      pos.push(r * sn * sx, y, r * cs * sz);
      const nx = (nr * sn) / sx, nz = (nr * cs) / sz, nn = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / nn, ny / nn, nz / nn);
      uv.push((i / segs) * phiLen * rMean * Math.max(sx, sz), s[j]);
      if (hasCol) { c.setHex(prof[j][2] ?? 0xffffff); col.push(c.r, c.g, c.b); }
    }
  }
  for (let j = 0; j < P - 1; j++) for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i, b = a + segs + 1;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (hasCol) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// Closed shell made of horizontal superellipse rings (the hard torso, the brief). rings = [{y, a, b, bb, n, zc}]
// from top to bottom: half-width a, front depth b, back depth bb, exponent n (2 = ellipse, higher = boxier).
function ringShell(rings, segs = 48) {
  const pos = [], idx = [], uv = [];
  const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  rings.forEach((R) => {
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * TAU, sn = Math.sin(t), cs = Math.cos(t), e = 2 / (R.n ?? 2);
      const dz = sp(cs, e);
      pos.push(R.a * sp(sn, e), R.y, (R.zc ?? 0) + dz * (dz >= 0 ? R.b : (R.bb ?? R.b)));
      uv.push(i / segs, R.y);
    }
  });
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs, a = j * segs + i, b = (j + 1) * segs + i, a1 = j * segs + i1, b1 = (j + 1) * segs + i1;
    idx.push(a, b, b1, a, b1, a1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Box with rounded edges and corners (exact normals). cuts: extra grid lines (for crisp colour bands).
function rbox(w, h, d, r, o = {}) {
  const m = o.bevel ?? 3, nf = o.flat ?? 2;
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const coords = (half, extra = []) => {
    const inner = half - r, out = [];
    for (let k = m; k >= 1; k--) out.push(-(inner + r * Math.tan((k / m) * Math.PI / 4)));
    for (let k = 0; k <= nf; k++) out.push(-inner + (2 * inner * k) / nf);
    for (let k = 1; k <= m; k++) out.push(inner + r * Math.tan((k / m) * Math.PI / 4));
    for (const e of extra) if (Math.abs(e) < inner) out.push(e);
    return [...new Set(out.map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
  };
  const hx = w / 2, hy = h / 2, hz = d / 2, ix = hx - r, iy = hy - r, iz = hz - r;
  const X = coords(hx, o.cutsX), Y = coords(hy, o.cutsY), Z = coords(hz, o.cutsZ);
  const pos = [], nor = [], uv = [], idx = [];
  const face = (A, B, mk) => {
    const base = pos.length / 3;
    for (let j = 0; j < B.length; j++) for (let i = 0; i < A.length; i++) {
      const [x, y, z] = mk(A[i], B[j]);
      const cx = clamp(x, -ix, ix), cy = clamp(y, -iy, iy), cz = clamp(z, -iz, iz);
      let nx = x - cx, ny = y - cy, nz = z - cz; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      pos.push(cx + nx * r, cy + ny * r, cz + nz * r); nor.push(nx, ny, nz); uv.push(A[i], B[j]);
    }
    for (let j = 0; j < B.length - 1; j++) for (let i = 0; i < A.length - 1; i++) {
      const a = base + j * A.length + i, b = a + A.length;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
  };
  face(Y, Z, (u, v) => [hx, u, v]);  face(Z, Y, (u, v) => [-hx, v, u]);
  face(Z, X, (u, v) => [v, hy, u]);  face(X, Z, (u, v) => [u, -hy, v]);
  face(X, Y, (u, v) => [u, v, hz]);  face(Y, X, (u, v) => [v, u, -hz]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// tube along points (hoses, rails, rims)
function tube(pts, r, seg = 24, rs = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, "centripetal");
  return new THREE.TubeGeometry(curve, seg, r, rs, closed);
}
// a strip lying on a sphere of radius R round c: along a great circle in the y-z plane, from angle t0 to t1
// (angle 0 = +z, pi/2 = +y), half-width hw across x
function sphereStrip(c, R, t0, t1, hw, nt = 24, nw = 4) {
  const pos = [], nor = [], uv = [], idx = [], p = V3();
  for (let j = 0; j <= nt; j++) for (let i = 0; i <= nw; i++) {
    const t = lerp(t0, t1, j / nt), w = lerp(-hw, hw, i / nw);
    p.set(w / R, Math.sin(t), Math.cos(t)).normalize();
    nor.push(p.x, p.y, p.z); pos.push(c.x + p.x * R, c.y + p.y * R, c.z + p.z * R); uv.push(i / nw, j / nt);
  }
  for (let j = 0; j < nt; j++) for (let i = 0; i < nw; i++) {
    const a = j * (nw + 1) + i, b = a + nw + 1;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
const sphere = (r, ws = 24, hs = 16, ...a) => new THREE.SphereGeometry(r, ws, hs, ...a);
const cyl = (rt, rb, h, rs = 20, open = false, hs = 1) => new THREE.CylinderGeometry(rt, rb, h, rs, hs, open);
const torus = (R, r, rs = 10, ts = 32, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);
const capsule = (r, len, cs = 6, rs = 16) => new THREE.CapsuleGeometry(r, len, cs, rs);

/* ---------- Kit: collects parts per material, paints vertex colours, binds them to bones, merges ---------- */
const DUST = new THREE.Color(0xa86f42);    // butterscotch Mars dust
function dustify(c, p, k) {
  const n = fbm(p.x * 8 + 11, p.y * 8, p.z * 8);
  let d = Math.pow(clamp(1 - p.y / 1.0, 0, 1), 1.5) * 0.95;                        // stronger toward the boots
  d += 0.32 * Math.max(0, 1 - Math.abs(p.y - 0.5) / 0.09) * (p.z > 0 ? 1 : 0.35);  // knees (from kneeling)
  d *= 0.45 + 1.0 * n;
  c.lerp(DUST, clamp(d * k * 1.2, 0, 0.9));
}
class Kit {
  constructor(skin = true) { this.skin = skin; this.groups = new Map(); }
  // key: material name (or a material); o: { m: Matrix4, bone: index, bind: (p) => [b0, b1, w1],
  //   color: hex, paint: (p, colour, i) => void, dust: 0..1, ao: (p) => factor (painted occlusion), uvm: [su, sv] }
  add(key, geo, o = {}) {
    if (o.m) geo.applyMatrix4(o.m);
    if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    const pos = geo.attributes.position, n = pos.count;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    else if (o.uvm) { const uv = geo.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * o.uvm[0], uv.getY(i) * o.uvm[1]); }
    const base = geo.attributes.color, col = new Float32Array(n * 3), c = new THREE.Color(), p = V3(), tint = new THREE.Color(o.color ?? 0xffffff);
    const si = this.skin ? new Uint16Array(n * 4) : null, sw = this.skin ? new Float32Array(n * 4) : null;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      if (base) c.fromBufferAttribute(base, i).multiply(tint); else c.copy(tint);
      if (o.paint) o.paint(p, c, i);
      if (o.dust) dustify(c, p, o.dust);
      if (o.ao) c.multiplyScalar(o.ao(p));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      if (this.skin) {
        if (o.bind) { const [b0, b1, w] = o.bind(p); si[i * 4] = b0; si[i * 4 + 1] = b1; sw[i * 4] = 1 - w; sw[i * 4 + 1] = w; }
        else { si[i * 4] = o.bone ?? 0; sw[i * 4] = 1; }
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (this.skin) { geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4)); geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4)); }
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(geo);
    return geo;
  }
  build(parent, skeleton) {
    const meshes = [];
    for (const [key, list] of this.groups) {
      const geo = mergeGeos(list, this.skin), mat = typeof key === "string" ? mats()[key] : key;
      let mesh;
      if (skeleton) {
        mesh = new THREE.SkinnedMesh(geo, mat);
        mesh.bind(skeleton, new THREE.Matrix4());
        mesh.boundingSphere = new THREE.Sphere(V3(0, 0.9, 0.1), 1.7);   // covers every pose
      } else mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh); meshes.push(mesh);
    }
    return meshes;
  }
}
function mergeGeos(list, skin) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const names = ["position", "normal", "uv", "color"].concat(skin ? ["skinIndex", "skinWeight"] : []);
  const arr = {};
  for (const nm of names) { const s = list[0].attributes[nm].itemSize; arr[nm] = { a: new (nm === "skinIndex" ? Uint16Array : Float32Array)(nv * s), s }; }
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const cnt = g.attributes.position.count;
    for (const nm of names) {
      const src = g.attributes[nm], A = arr[nm];
      for (let i = 0; i < cnt; i++) for (let k = 0; k < A.s; k++) A.a[(vo + i) * A.s + k] = src.getComponent(i, k);
    }
    const idx = g.index.array;
    for (let k = 0; k < idx.length; k++) index[io + k] = idx[k] + vo;
    vo += cnt; io += idx.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  for (const nm of names) out.setAttribute(nm, new THREE.BufferAttribute(arr[nm].a, arr[nm].s));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/* ---------- the astronaut ---------- */
// rest pose (figure space, metres): standing straight, arms hanging, palms in
const J = { pelvis: 0.98, hipY: 0.94, hipX: 0.105, kneeY: 0.52, ankleY: 0.105, spine: 1.1, chest: 1.26, neck: 1.57,
  shoY: 1.44, shoX: 0.25, elbY: 1.15, wriY: 0.885, knuY: 0.8 };
const THIGH = J.hipY - J.kneeY, SHIN = J.kneeY - J.ankleY, UPARM = J.shoY - J.elbY, FORE = J.elbY - J.wriY;
const C = { suit: 0xe7e4dd, hard: 0xefeeea, metal: 0xc9ced5, metalD: 0x7f858e, gold: 0xd3a95c, dark: 0x2a2c30,
  glove: 0xdcd9d2, glove2: 0xaaa79f, rubber: 0x3b3d42, seam: 0xd6d1c6 };
// a stitched seam (thin piping) running down a cloth profile at angle phi round the limb axis (cx, cz)
function seamPts(prof, cx, cz, phi, out = 0.0016) {
  const pts = [];
  for (let i = 0; i < prof.length; i++) {
    if (i > 0 && Math.abs(prof[i][1] - prof[i - 1][1]) < 1e-6) continue;
    const r = prof[i][0] + out;
    pts.push(V3(cx + r * Math.sin(phi), prof[i][1], cz + r * Math.cos(phi)));
  }
  return pts;
}
// a bearing ring: inner radius, outer radius, top y, bottom y, bevel (radial), bevel (vertical)
const ringProf = (ri, ro, yT, yB, bv = 0.004, bvy = bv) => [[ri, yT], [ro - bv, yT], [ro, yT - bvy], [ro, yB + bvy], [ro - bv, yB], [ri, yB]];
// cloth tube with soft folds, optional colour band [yHigh, yLow]
function clothProf(yT, yB, r0, r1, fold, band, n, col, bandCol, bulge = 0) {
  const ys = [];
  for (let i = 0; i <= n; i++) ys.push(lerp(yT, yB, i / n));
  const out = [], rAt = (y) => {
    const t = (yT - y) / (yT - yB);
    return lerp(r0, r1, t) + bulge * Math.sin(Math.PI * t) + fold * 1.5 * (0.6 * Math.sin(t * 23.1 + 1.3) + 0.4 * Math.sin(t * 41.7 + 0.4)) * Math.sin(Math.PI * clamp(t * 1.15, 0, 1));
  };
  const all = ys.concat(band ? [band[0], band[1]] : []).sort((a, b) => b - a);
  for (const y of all) {
    if (band && Math.abs(y - band[0]) < 1e-9) { out.push([rAt(y), y, col], [rAt(y), y, bandCol]); continue; }
    if (band && Math.abs(y - band[1]) < 1e-9) { out.push([rAt(y), y, bandCol], [rAt(y), y, col]); continue; }
    out.push([rAt(y), y, band && y < band[0] && y > band[1] ? bandCol : col]);
  }
  return out;
}
// pleated joint section (convolute)
function bellowsProf(yT, yB, rIn, rOut, ridges, per = 8) {
  const out = [], n = ridges * per;
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = lerp(yT, yB, t);
    out.push([rIn + (rOut - rIn) * Math.pow(Math.abs(Math.sin(Math.PI * ridges * t)), 0.7), y]);
  }
  return out;
}
const blendY = (b0, b1, yA, yB) => (p) => [b0, b1, sstep(yA, yB, p.y)];
// painted occlusion: pleat valleys, joint balls, crotch, armpits, where the pack meets the back
const aoRad = (cx, cz, rIn, rOut, lo = 0.6) => (p) => lerp(lo, 1, clamp((Math.hypot(p.x - cx, p.z - cz) - rIn) / (rOut - rIn), 0, 1));
const aoK = (k) => () => k;
const grime = (p) => 0.94 + 0.08 * vnoise(p.x * 6 + 1, p.y * 6, p.z * 6);
const atV = (v) => at(v.x, v.y, v.z);
let made = 0;

export function makeAstronaut(stripeHex) {
  // band colour: the given colour, a little deeper so it stays saturated in bright sun under film tone mapping
  const STRIPE = new THREE.Color(stripeHex ?? 0xe5432f).multiplyScalar(0.62).getHex();
  made++;
  const label = stripeHex === 0x38bdf8 ? "EV2" : stripeHex === 0xe5432f ? "EV1" : `EV${made}`;
  const root = new THREE.Group(); root.name = label;

  /* bones */
  const bones = [];
  const bone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); bones.push(b); return b; };
  const body = bone("body", root, 0, 0, 0);
  const pelvis = bone("pelvis", body, 0, J.pelvis, 0);
  const spine = bone("spine", pelvis, 0, J.spine - J.pelvis, 0);
  const chest = bone("chest", spine, 0, J.chest - J.spine, 0);
  const head = bone("head", chest, 0, J.neck - J.chest, 0.02);
  for (const b of [pelvis, spine, chest, head]) b.rotation.order = "YXZ";
  const leg = {}, arm = {};
  for (const s of [1, -1]) {
    const k = s > 0 ? "L" : "R";
    const thigh = bone("thigh" + k, pelvis, s * J.hipX, J.hipY - J.pelvis, 0);
    const shin = bone("shin" + k, thigh, 0, -THIGH, 0);
    const foot = bone("foot" + k, shin, 0, -SHIN, 0);
    leg[s] = { thigh, shin, foot };
  }
  for (const s of [1, -1]) {
    const k = s > 0 ? "L" : "R";
    const up = bone("arm" + k, chest, s * J.shoX, J.shoY - J.chest, 0);
    const fore = bone("fore" + k, up, 0, -UPARM, 0);
    const hand = bone("hand" + k, fore, 0, -FORE, 0);
    const fing = bone("fing" + k, hand, 0, J.knuY - J.wriY, 0);
    arm[s] = { up, fore, hand, fing };
  }
  const tool = bone("tool", arm[-1].hand, 0.028, -0.06, 0);   // sample scoop in the right hand (shown while working)
  const bi = (b) => bones.indexOf(b);
  const P_ = bi(pelvis), S_ = bi(spine), C_ = bi(chest), H_ = bi(head);

  /* parts */
  const K = new Kit(true);
  const fab = (g, o = {}) => K.add("fabric", g, { color: C.suit, dust: 1, ...o });
  const hard = (g, o = {}) => K.add("hard", g, { color: C.hard, dust: 0.45, ...o });
  const metal = (g, o = {}) => K.add("metal", g, { color: C.metal, dust: 0.25, ...o });
  const dark = (g, o = {}) => K.add("dark", g, { color: C.dark, dust: 0.6, ...o });

  // legs
  for (const s of [1, -1]) {
    const x = s * J.hipX, L = leg[s], T = bi(L.thigh), Sh = bi(L.shin), F = bi(L.foot), mx = at(x, 0, 0);
    fab(sphere(0.097, 22, 12), { m: at(x, J.hipY, 0), bone: T, uvm: [0.61, 0.3], ao: aoK(0.8) });
    metal(revolve(ringProf(0.09, 0.102, 0.893, 0.871, 0.004), 28), { m: mx, bone: T, color: 0xaab0b8 });
    const thighP = clothProf(0.884, 0.596, 0.094, 0.086, 0.0021, [0.805, 0.69], 18, C.suit, STRIPE);
    fab(revolve(thighP, 28), { m: mx, bone: T,
      ao: (p) => grime(p) * (1 - 0.22 * sstep(0.84, 0.88, p.y)) * (1 - 0.16 * sstep(-0.03, -0.08, s * (p.x - x))) });
    for (const ph of [s * Math.PI / 2, 0.15 * s]) fab(tube(seamPts(thighP, x, 0, ph), 0.0024, 24, 5), { bone: T, color: C.seam, dust: 0.8 });
    fab(revolve(bellowsProf(0.6, 0.446, 0.0815, 0.0915, 5, 6), 28), { m: mx, bind: blendY(T, Sh, 0.585, 0.46), ao: aoRad(x, 0, 0.0815, 0.0915, 0.58) });
    fab(sphere(0.081, 20, 12), { m: at(x, J.kneeY, 0.004), bone: Sh, uvm: [0.5, 0.25], ao: aoK(0.75) });
    const shinP = clothProf(0.45, 0.172, 0.087, 0.077, 0.0019, null, 16, C.suit, 0, 0.004);
    fab(revolve(shinP, 28), { m: mx, bone: Sh,
      ao: (p) => grime(p) * (1 - 0.15 * sstep(0.42, 0.45, p.y)) * (1 - 0.15 * sstep(0.2, 0.175, p.y)) });
    for (const ph of [s * Math.PI / 2, 0]) fab(tube(seamPts(shinP, x, 0, ph), 0.0024, 20, 5), { bone: Sh, color: C.seam, dust: 1 });
    metal(revolve(ringProf(0.068, 0.082, 0.187, 0.164, 0.004), 28), { m: mx, bone: Sh, dust: 0.5 });
    // boot: thick treaded sole, a rounded upper with rubber toe and heel caps, an instep strap, the ankle shaft
    dark(rbox(0.13, 0.036, 0.305, 0.014, { bevel: 2, flat: 2 }), { m: at(x, 0.027, 0.056), bone: F, color: 0x34363a, dust: 0.7 });
    for (let i = 0; i < 9; i++) dark(rbox(0.116, 0.01, 0.019, 0.004, { bevel: 1, flat: 1 }), { m: at(x, 0.0055, -0.084 + i * 0.0348), bone: F, color: 0x26282b, dust: 0.8 });
    fab(capsule(0.062, 0.165, 6, 20), { m: mul(at(x, 0.1, 0.05), scl(0.97, 0.86, 1), rotX(Math.PI / 2)), bone: F, color: 0xebe8df, dust: 0.7,
      paint: (p, c) => { if (p.z > 0.145 && p.y < 0.12) c.setHex(0x5a5d62); else if (p.z < -0.055 && p.y < 0.115) c.setHex(0x5a5d62); },
      ao: (p) => 1 - 0.18 * sstep(0.08, 0.05, p.y) });
    dark(torus(0.0625, 0.0075, 6, 20, Math.PI), { m: mul(at(x, 0.1, 0.075), scl(0.99, 0.88, 1)), bone: F, color: 0x55595f, dust: 0.6 });
    metal(rbox(0.008, 0.02, 0.026, 0.003, { bevel: 1, flat: 1 }), { m: at(x + s * 0.061, 0.1, 0.075), bone: F });
    fab(revolve([[0.07, 0.208], [0.0785, 0.201], [0.082, 0.184], [0.083, 0.15], [0.078, 0.118]], 24), { m: at(x, 0, -0.008), bone: F, color: 0xe6e2d8, dust: 0.8, ao: aoK(0.92) });
    dark(revolve(ringProf(0.079, 0.0855, 0.17, 0.152, 0.003), 24), { m: at(x, 0, -0.008), bone: F, color: 0x575b61, dust: 0.6 });
  }

  // brief (lower torso) and waist bearing
  fab(ringShell([
    { y: 1.088, a: 0.176, b: 0.146, bb: 0.134, n: 2.3 }, { y: 1.045, a: 0.186, b: 0.148, bb: 0.143, n: 2.5 },
    { y: 0.99, a: 0.194, b: 0.143, bb: 0.152, n: 2.7 }, { y: 0.94, a: 0.197, b: 0.134, bb: 0.155, n: 2.8 },
    { y: 0.895, a: 0.188, b: 0.124, bb: 0.148, n: 2.7 }, { y: 0.858, a: 0.162, b: 0.104, bb: 0.128, n: 2.5 },
    { y: 0.83, a: 0.118, b: 0.08, bb: 0.098, n: 2.3 }, { y: 0.812, a: 0.064, b: 0.05, bb: 0.06, n: 2 },
    { y: 0.806, a: 0.004, b: 0.004, bb: 0.004, n: 2 },
  ], 44), { bind: (p) => [P_, S_, sstep(1.035, 1.085, p.y)], uvm: [1.1, 1],
    ao: (p) => grime(p) * (0.66 + 0.34 * sstep(0.8, 0.9, p.y)) * (1 - 0.2 * sstep(1.04, 1.085, p.y)) });
  metal(revolve(ringProf(0.9, 1, 1.118, 1.071, 0.024, 0.004), 44, { sx: 0.193, sz: 0.16 }), { m: at(0, 0, 0.008), bone: S_, color: 0x9ba1aa });

  // upper torso: a hard shell under a taut cloth cover
  fab(ringShell([
    { y: 1.582, a: 0.148, b: 0.122, bb: 0.118, n: 2, zc: 0.022 }, { y: 1.574, a: 0.175, b: 0.13, bb: 0.124, n: 2.2, zc: 0.022 },
    { y: 1.561, a: 0.207, b: 0.141, bb: 0.132, n: 2.5, zc: 0.022 }, { y: 1.541, a: 0.239, b: 0.152, bb: 0.14, n: 2.9, zc: 0.022 },
    { y: 1.511, a: 0.262, b: 0.161, bb: 0.145, n: 3.2, zc: 0.022 }, { y: 1.476, a: 0.272, b: 0.169, bb: 0.148, n: 3.3, zc: 0.024 },
    { y: 1.436, a: 0.268, b: 0.176, bb: 0.15, n: 3.1, zc: 0.026 }, { y: 1.395, a: 0.249, b: 0.181, bb: 0.15, n: 2.9, zc: 0.028 },
    { y: 1.35, a: 0.229, b: 0.183, bb: 0.15, n: 2.7, zc: 0.03 }, { y: 1.3, a: 0.215, b: 0.181, bb: 0.148, n: 2.6, zc: 0.03 },
    { y: 1.25, a: 0.205, b: 0.176, bb: 0.145, n: 2.5, zc: 0.028 }, { y: 1.2, a: 0.198, b: 0.168, bb: 0.142, n: 2.4, zc: 0.022 },
    { y: 1.15, a: 0.192, b: 0.16, bb: 0.14, n: 2.3, zc: 0.015 }, { y: 1.112, a: 0.187, b: 0.154, bb: 0.137, n: 2.3, zc: 0.01 },
    { y: 1.098, a: 0.178, b: 0.146, bb: 0.13, n: 2.3, zc: 0.01 },
  ], 56), { bone: C_, dust: 0.3, uvm: [1.3, 1], ao: (p) => (0.72 + 0.28 * sstep(1.1, 1.19, p.y)) * (1 - 0.25 * sstep(0.15, 0.2, Math.abs(p.x)) * sstep(1.16, 1.24, p.y) * (1 - sstep(1.36, 1.43, p.y)))
      * (1 - 0.3 * sstep(-0.09, -0.135, p.z)) });
  // panel seams on the torso shell: a thin darker line round the chest and over each shoulder
  fab(revolve(ringProf(0.995, 1.006, 1.304, 1.297, 0.003, 0.002), 56, { sx: 0.216, sz: 0.17 }), { m: at(0, 0, 0.03), bone: C_, color: C.seam, dust: 0.2 });
  fab(tube([V3(0, 1.57, 0.15), V3(0, 1.52, 0.183), V3(0, 1.44, 0.206), V3(0, 1.36, 0.214), V3(0, 1.3, 0.212)], 0.0024, 16, 5), { bone: C_, color: C.seam, dust: 0.1 });

  // arms
  for (const s of [1, -1]) {
    const x = s * J.shoX, A = arm[s], U = bi(A.up), Fo = bi(A.fore), Hn = bi(A.hand), Fi = bi(A.fing), mx = at(x, 0, 0);
    metal(revolve(ringProf(0.08, 0.096, 0.019, -0.019, 0.004), 32), { m: alignY(V3(s * 0.259, 1.447, 0.012), V3(s, -0.72, 0.1)), bone: C_ });
    fab(sphere(0.082, 22, 12), { m: at(x, J.shoY, 0), bone: U, uvm: [0.5, 0.25], ao: aoK(0.78) });
    metal(revolve(ringProf(0.07, 0.081, 1.394, 1.376, 0.003), 26), { m: mx, bone: U });
    const upP = clothProf(1.384, 1.208, 0.077, 0.071, 0.0017, [1.356, 1.268], 14, C.suit, STRIPE);
    fab(tube(seamPts(upP, x, 0, s * Math.PI / 2), 0.0022, 16, 5), { bone: U, color: C.seam, dust: 0.3 });
    fab(revolve(upP, 26), { m: mx, bone: U,
      ao: (p) => grime(p) * (1 - 0.2 * sstep(-0.02, -0.07, s * (p.x - x))) * (1 - 0.15 * sstep(1.36, 1.384, p.y)) });
    fab(revolve(bellowsProf(1.214, 1.086, 0.0655, 0.0745, 4, 6), 26), { m: mx, bind: blendY(U, Fo, 1.2, 1.1), ao: aoRad(x, 0, 0.0655, 0.0745, 0.6) });
    fab(sphere(0.066, 18, 10), { m: at(x, J.elbY, 0), bone: Fo, uvm: [0.41, 0.2], ao: aoK(0.75) });
    fab(revolve(clothProf(1.09, 0.937, 0.068, 0.061, 0.0015, null, 10, C.suit, 0), 24), { m: mx, bone: Fo, ao: (p) => grime(p) * (1 - 0.12 * sstep(0.96, 0.94, p.y)) });
    metal(revolve(ringProf(0.054, 0.0665, 0.946, 0.925, 0.003), 26), { m: mx, bone: Fo });
    metal(revolve(ringProf(0.056, 0.0678, 0.925, 0.911, 0.003), 26), { m: mx, bone: Fo, color: C.gold, dust: 0.15 });
    if (s > 0) {   // checklist booklet on the left cuff
      hard(rbox(0.016, 0.075, 0.058, 0.005, { bevel: 2, flat: 1 }), { m: at(x + 0.066, 1.005, 0.0), bone: Fo, color: 0xe9e4d4, dust: 0.3 });
      dark(rbox(0.018, 0.012, 0.06, 0.004, { bevel: 1, flat: 1 }), { m: at(x + 0.066, 1.044, 0.0), bone: Fo, color: 0x3f4247 });
      dark(rbox(0.01, 0.02, 0.012, 0.003, { bevel: 1, flat: 1 }), { m: at(x + 0.06, 0.975, 0.03), bone: Fo, color: 0x3f4247 });
    }
    // glove: gauntlet, palm, knuckle guard, four fingers on the finger bone, thumb
    fab(revolve([[0.0575, 0.914], [0.0618, 0.906], [0.0638, 0.889], [0.0606, 0.871], [0.052, 0.857]], 22), { m: mx, bone: Hn, color: C.glove, dust: 0.5 });
    fab(rbox(0.04, 0.092, 0.098, 0.018, { bevel: 3, flat: 1 }), { m: at(x, 0.843, 0.004), bone: Hn, color: C.glove, dust: 0.55,
      paint: (p, c) => { if (s * (p.x - x) < -0.008) c.setHex(0x7a7c80); } });
    hard(rbox(0.014, 0.018, 0.088, 0.006, { bevel: 2, flat: 1 }), { m: at(x + s * 0.017, 0.808, 0.004), bone: Hn, color: 0xcfccc4, dust: 0.4 });
    const fz = [0.033, 0.011, -0.011, -0.031], fl = [0.072, 0.08, 0.075, 0.062], fr = [0.0134, 0.014, 0.0134, 0.012], spr = [0.08, 0.025, -0.03, -0.09];
    for (let i = 0; i < 4; i++) {
      const base = V3(x - s * 0.003, J.knuY + 0.004, 0.004 + fz[i]), l1 = fl[i] * 0.55, l2 = fl[i] * 0.45;
      const d1 = V3(-s * 0.12, -1, spr[i]).normalize(), mid = base.clone().addScaledVector(d1, l1);
      const d2 = V3(-s * Math.sin(0.65), -Math.cos(0.65), spr[i] * 0.8).normalize(), tip = mid.clone().addScaledVector(d2, l2);
      fab(capsule(fr[i], l1, 3, 10), { m: alignY(base.clone().addScaledVector(d1, l1 / 2), d1), bone: Fi, color: C.glove, dust: 0.6 });
      fab(capsule(fr[i] * 0.96, l2, 3, 10), { m: alignY(mid.clone().addScaledVector(d2, l2 / 2), d2), bone: Fi, color: C.glove2, dust: 0.8,
        paint: (p, c) => { if (p.distanceTo(tip) < 0.014) c.setHex(0x86847e); } });
    }
    const tb = V3(x - s * 0.012, 0.866, 0.046), t1 = V3(-s * 0.3, -0.72, 0.62).normalize(), t2 = V3(-s * 0.62, -0.72, 0.3).normalize();
    const tm = tb.clone().addScaledVector(t1, 0.036), tt = tm.clone().addScaledVector(t2, 0.03);
    fab(capsule(0.0135, 0.036, 3, 10), { m: alignY(tb.clone().addScaledVector(t1, 0.018), t1), bone: Hn, color: C.glove, dust: 0.5 });
    fab(capsule(0.0127, 0.03, 3, 10), { m: alignY(tm.clone().addScaledVector(t2, 0.015), t2), bone: Hn, color: C.glove2, dust: 0.7,
      paint: (p, c) => { if (p.distanceTo(tt) < 0.014) c.setHex(0x86847e); } });
    fab(sphere(0.022, 12, 8), { m: mul(at(x - s * 0.006, 0.856, 0.033), scl(0.8, 1.25, 1)), bone: Hn, color: C.glove, dust: 0.5 });
  }

  // sample scoop (bone "tool": shown only while working)
  const TI = bi(tool), tp = V3(-J.shoX + 0.028, J.wriY - 0.06, 0);
  dark(cyl(0.013, 0.013, 0.13, 12), { m: mul(at(tp.x, tp.y, tp.z - 0.03), rotX(Math.PI / 2)), bone: TI, color: 0x303236 });
  metal(cyl(0.006, 0.006, 0.2, 8), { m: mul(at(tp.x, tp.y, tp.z - 0.19), rotX(Math.PI / 2)), bone: TI });
  metal(sphere(0.036, 14, 8, 0, TAU, Math.PI / 2, Math.PI / 2), { m: mul(at(tp.x, tp.y, tp.z - 0.3), rotX(Math.PI / 2 + 0.4), scl(1, 0.7, 1.3)), bone: TI, color: 0xb8bec6 });

  // helmet: gold visor, white sun-shade shell with a rolled rim, crown band, lamp pods, neck rings
  const HC = V3(0, 1.685, 0.025), HR = 0.178, AL = 1.05, TT = 0.92, TB = 1.95;
  const sph = (R, phi, th) => V3(-R * Math.cos(phi) * Math.sin(th), R * Math.cos(th), R * Math.sin(phi) * Math.sin(th)).add(HC);
  // gold visor, a touch deeper in tone toward the chin
  K.add("visor", sphere(HR - 0.006, 48, 26, Math.PI / 2 - AL - 0.09, 2 * (AL + 0.09), TT - 0.09, TB - TT + 0.09), { m: atV(HC), bone: H_,
    paint: (p, c) => c.multiplyScalar(lerp(1, 0.72, sstep(1.74, 1.62, p.y))) });
  hard(sphere(HR, 48, 10, 0, TAU, 0, TT), { m: atV(HC), bone: H_, dust: 0.12 });
  hard(sphere(HR, 40, 14, Math.PI / 2 + AL, TAU - 2 * AL, TT, TB - TT), { m: atV(HC), bone: H_, dust: 0.18, ao: (p) => 1 - 0.25 * sstep(1.66, 1.62, p.y) });
  const rim = [];
  for (let i = 0; i <= 6; i++) rim.push(sph(HR + 0.001, Math.PI / 2 - AL, lerp(TB - 0.02, TT + 0.06, i / 6)));
  for (let i = 0; i <= 10; i++) rim.push(sph(HR + 0.001, lerp(Math.PI / 2 - AL + 0.06, Math.PI / 2 + AL - 0.06, i / 10), TT));
  for (let i = 0; i <= 6; i++) rim.push(sph(HR + 0.001, Math.PI / 2 + AL, lerp(TT + 0.06, TB - 0.02, i / 6)));
  hard(tube(rim, 0.0088, 96, 8), { bone: H_, color: 0xeae9e4, dust: 0.12 });
  hard(sphereStrip(HC, HR + 0.0016, Math.PI / 2 - TT + 0.05, Math.PI + 0.42, 0.027, 36, 4), { bone: H_, color: STRIPE, dust: 0.08 });
  for (const s of [1, -1]) {
    // lamp / camera pod on each temple: housing, recessed bar light, bezel, mounting arm
    const phi = Math.PI / 2 + s * (AL + 0.28), th = 1.3, pd = sph(HR + 0.024, phi, th), sf = sph(HR, phi, th);
    const yaw = s * 0.18, pm = mul(atV(pd), rotY(yaw));
    hard(rbox(0.038, 0.034, 0.096, 0.012, { bevel: 3, flat: 1 }), { m: pm.clone(), bone: H_, color: 0xd8d6cf, dust: 0.15 });
    dark(rbox(0.03, 0.025, 0.006, 0.005, { bevel: 2, flat: 1 }), { m: mul(pm.clone(), at(0, 0.001, 0.048)), bone: H_, color: 0x2c2f33, dust: 0 });
    K.add("lamp", rbox(0.022, 0.012, 0.004, 0.003, { bevel: 1, flat: 1 }), { m: mul(pm.clone(), at(0, 0.004, 0.0505)), bone: H_ });
    hard(rbox(0.016, 0.02, 0.05, 0.006, { bevel: 2, flat: 1 }), { m: atV(pd.clone().lerp(sf, 0.6).add(V3(0, 0, -0.012))), bone: H_, color: 0xc9c7c0 });
    if (s < 0) {   // small camera lens under the right lamp
      metal(cyl(0.0068, 0.0068, 0.005, 14), { m: mul(pm.clone(), at(0, -0.009, 0.05), rotX(Math.PI / 2)), bone: H_, color: 0x15171a, dust: 0 });
    }
  }
  metal(revolve(ringProf(0.14, 0.167, 1.603, 1.573, 0.004), 44), { m: at(0, 0, 0.025), bone: C_ });
  metal(revolve(ringProf(0.15, 0.171, 1.628, 1.603, 0.004), 44), { m: at(0, 0, 0.025), bone: H_, color: 0xaab0b8, dust: 0.1 });

  // chest control unit: housing tilted to the face, knobs, lit display, gauge, switches, hose ports, straps
  const D = mul(at(0, 1.24, 0.222), rotX(-0.38)), dm = (m) => mul(D.clone(), m);
  hard(rbox(0.25, 0.11, 0.085, 0.02, { bevel: 3, flat: 2 }), { m: D.clone(), bone: C_, color: 0xe5e4df, dust: 0.3 });
  dark(rbox(0.206, 0.07, 0.012, 0.005, { bevel: 2, flat: 1 }), { m: dm(at(0, 0.004, 0.042)), bone: C_, color: 0x3b3f46, dust: 0.1 });
  K.add("screen", new THREE.PlaneGeometry(0.074, 0.037), { m: dm(at(0.046, 0.006, 0.0485)), bone: C_ });
  for (const [kx, kr, kh, col] of [[-0.078, 0.016, 0.018, C.metal], [-0.034, 0.011, 0.014, C.metal], [0.028, 0.012, 0.014, C.metal], [0.08, 0.0145, 0.016, 0xd0683a]]) {
    metal(cyl(kr, kr * 1.05, kh, 16), { m: dm(at(kx, 0.055 + kh / 2, -0.006)), bone: C_, color: col, dust: 0.1 });
    metal(cyl(kr * 1.25, kr * 1.25, 0.004, 16), { m: dm(at(kx, 0.056, -0.006)), bone: C_, color: C.metalD });
  }
  for (let i = 0; i < 3; i++) metal(cyl(0.0032, 0.0032, 0.017, 8), { m: dm(mul(at(-0.082 + i * 0.021, -0.014, 0.054), rotX(Math.PI / 2 - 0.35))), bone: C_ });
  metal(cyl(0.017, 0.017, 0.008, 20), { m: dm(mul(at(-0.032, 0.008, 0.049), rotX(Math.PI / 2))), bone: C_ });
  hard(cyl(0.0135, 0.0135, 0.002, 20), { m: dm(mul(at(-0.032, 0.008, 0.0535), rotX(Math.PI / 2))), bone: C_, color: 0xf6f4ec, dust: 0 });
  for (const s of [1, -1]) {
    metal(cyl(0.021, 0.023, 0.022, 16), { m: dm(mul(at(s * 0.134, -0.008, 0), rotZ(Math.PI / 2))), bone: C_, color: C.metalD });
    dark(rbox(0.03, 0.1, 0.012, 0.004, { bevel: 1, flat: 1 }), { m: mul(at(s * 0.105, 1.315, 0.192), rotX(-0.22)), bone: C_, color: 0x4a4d53 });
  }
  K.add(markMat(label), new THREE.PlaneGeometry(0.084, 0.042), { m: mul(at(0.122, 1.414, 0.2035), rotY(0.2)), bone: C_ });

  // life-support backpack: shell, mount, colour band, back panel with the mark, vent, covers, handles, antenna
  const PZ = -0.262, PY = 1.265;
  hard(rbox(0.5, 0.6, 0.21, 0.05, { bevel: 4, flat: 3 }), { m: at(0, PY, PZ), bone: C_, dust: 0.45, ao: (p) => (1 - 0.35 * sstep(-0.2, -0.16, p.z)) * (1 - 0.15 * sstep(1.0, 0.97, p.y)) });
  dark(rbox(0.36, 0.44, 0.08, 0.02, { bevel: 2, flat: 1 }), { m: at(0, 1.27, -0.145), bone: C_, color: 0x55585e });
  hard(rbox(0.507, 0.11, 0.217, 0.035, { bevel: 3, flat: 2 }), { m: at(0, 1.462, PZ), bone: C_, color: STRIPE, dust: 0.15 });
  hard(rbox(0.4, 0.21, 0.018, 0.008, { bevel: 2, flat: 2 }), { m: at(0, 1.27, PZ - 0.107), bone: C_, color: 0xe0ded7, dust: 0.35 });
  K.add(markMat(label), new THREE.PlaneGeometry(0.17, 0.085), { m: mul(at(0, 1.286, PZ - 0.1165), rotY(Math.PI)), bone: C_ });
  for (const [cx, cy] of [[-0.18, 1.355], [0.18, 1.355], [-0.18, 1.185], [0.18, 1.185]]) metal(cyl(0.0065, 0.0065, 0.006, 10), { m: mul(at(cx, cy, PZ - 0.117), rotX(Math.PI / 2)), bone: C_ });
  dark(rbox(0.3, 0.1, 0.012, 0.004, { bevel: 1, flat: 1 }), { m: at(0, 1.07, PZ - 0.106), bone: C_, color: 0x26282c, dust: 0.3 });
  for (let i = 0; i < 5; i++) metal(rbox(0.284, 0.007, 0.01, 0.002, { bevel: 1, flat: 1 }), { m: at(0, 1.035 + i * 0.017, PZ - 0.112), bone: C_, color: 0x9aa0a8 });
  hard(rbox(0.46, 0.05, 0.19, 0.02, { bevel: 2, flat: 2 }), { m: at(0, 0.975, PZ), bone: C_, color: 0xa9a7a1, dust: 0.7 });
  dark(rbox(0.503, 0.594, 0.012, 0.05, { bevel: 3, flat: 1 }), { m: at(0, PY, PZ - 0.03), bone: C_, color: 0x6a6d72, dust: 0.3 });   // parting line
  for (const s of [1, -1]) {
    hard(rbox(0.01, 0.3, 0.12, 0.008, { bevel: 2, flat: 1 }), { m: at(s * 0.252, 1.245, PZ - 0.045), bone: C_, color: 0xe2e0d9, dust: 0.4 });
    for (const yy of [1.1, 1.4]) metal(cyl(0.006, 0.006, 0.006, 10), { m: mul(at(s * 0.258, yy, PZ - 0.045), rotZ(Math.PI / 2)), bone: C_ });
  }
  metal(tube([V3(-0.11, 1.585, PZ - 0.075), V3(-0.1, 1.625, PZ - 0.08), V3(0.1, 1.625, PZ - 0.08), V3(0.11, 1.585, PZ - 0.075)], 0.009, 24, 8), { bone: C_, color: 0xb9bec6 });
  hard(rbox(0.44, 0.035, 0.17, 0.015, { bevel: 2, flat: 2 }), { m: at(0, 1.567, PZ - 0.01), bone: C_, color: 0xe8e6e0, dust: 0.25 });
  for (const s of [1, -1]) metal(tube([V3(s * 0.25, 1.392, PZ + 0.05), V3(s * 0.283, 1.382, PZ + 0.04), V3(s * 0.288, 1.26, PZ + 0.03), V3(s * 0.283, 1.138, PZ + 0.04), V3(s * 0.25, 1.128, PZ + 0.05)], 0.009, 30, 8), { bone: C_, color: 0xb9bec6 });
  metal(cyl(0.013, 0.016, 0.03, 12), { m: at(0.17, 1.597, PZ - 0.05), bone: C_, color: C.metalD });
  metal(cyl(0.0035, 0.005, 0.36, 6), { m: alignY(V3(0.179, 1.777, PZ - 0.07), V3(0.05, 1, -0.11)), bone: C_, color: 0x4c5056 });
  dark(sphere(0.008, 8, 6), { m: at(0.188, 1.955, PZ - 0.09), bone: C_ });
  // hoses from the pack round the waist to the chest unit, with rib rings
  for (const s of [1, -1]) {
    const pts = [V3(0.2, 1.03, -0.17), V3(0.25, 1.0, -0.08), V3(0.255, 1.04, 0.05), V3(0.2, 1.13, 0.17), V3(0.141, 1.2, 0.217)].map((v) => v.set(v.x * s, v.y, v.z));
    dark(tube(pts, 0.019, 44, 12), { bone: C_, color: s > 0 ? 0x5d6672 : 0x3a3d42, dust: 0.35 });
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    for (let i = 1; i < 8; i++) metal(revolve(ringProf(0.018, 0.0222, 0.003, -0.003, 0.0012), 12), { m: alignY(curve.getPointAt(i / 8), curve.getTangentAt(i / 8)), bone: C_, color: 0x8b9199 });
  }

  // skin it
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const meshes = K.build(root, skeleton);
  const P = { root, body, head, meshes, skeleton, label };
  installPoses(P, { root, body, pelvis, spine, chest, head, leg, arm, tool, bones });
  P.idle(0, 0);
  return P;
}

/* ---------- posing: two-bone IK in figure space ---------- */
const _m4 = new THREE.Matrix4(), _bx = V3(), _by = V3(), _bz = V3(), _u = V3(), _v = V3();
const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1);
// orientation whose local -y runs along `dir` and whose local +z leans toward `front`
function boneQuat(dir, front, out) {
  _by.copy(dir).negate().normalize();
  _bz.copy(front).addScaledVector(_by, -front.dot(_by));
  if (_bz.lengthSq() < 1e-10) _bz.set(0, 0, 1).addScaledVector(_by, -_by.z);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  return out.setFromRotationMatrix(_m4.makeBasis(_bx, _by, _bz));
}
// joint A, target T, bone lengths l1 l2; the middle joint bulges toward `bend`. Returns the bend used.
function solve2(A, T, l1, l2, bend, mid, end) {
  _u.subVectors(T, A);
  let d = _u.length();
  _u.divideScalar(d || 1);
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  _v.copy(bend).addScaledVector(_u, -bend.dot(_u));
  if (_v.lengthSq() < 1e-10) _v.set(0, 0, 1).addScaledVector(_u, -_u.z);
  _v.normalize();
  const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
  mid.copy(A).addScaledVector(_u, l1 * ca).addScaledVector(_v, l1 * sa);
  end.copy(A).addScaledVector(_u, d);
  return _v;
}
const TOE = 0.2, HEEL = -0.085;

function installPoses(P, R) {
  const { root, body, pelvis, spine, chest, head, leg, arm, tool, bones } = R;
  const Q = () => new THREE.Quaternion();
  const tq = V3(), mid = V3(), end = V3(), d1 = V3(), d2 = V3(), qU = Q(), qL = Q(), fr = V3(), jA = V3(), qA = Q();
  const qY = Q(), qP = Q(), qR = Q(), footQ = Q(), piv = V3(), ank = V3(), off = V3(), wr = V3(), sh = V3(), tmp = V3(), hq = Q(), defBend = V3(), hipP = V3();
  const curl = { 1: 0.4, "-1": 0.4 };

  // figure-space position and orientation of a bone's joint, from the current local transforms
  function frame(b, outP, outQ) {
    const chain = [];
    for (let o = b; o !== root; o = o.parent) chain.push(o);
    outP.set(0, 0, 0); outQ.identity();
    for (let i = chain.length - 1; i >= 0; i--) { const o = chain[i]; outP.add(tq.copy(o.position).applyQuaternion(outQ)); outQ.multiply(o.quaternion); }
  }
  function chainTo(upper, lower, eff, parentQ, A, T, l1, l2, bend, frontSign, effQ) {
    const v = solve2(A, T, l1, l2, bend, mid, end);
    fr.copy(v).multiplyScalar(frontSign);
    d1.subVectors(mid, A); d2.subVectors(end, mid);
    boneQuat(d1, fr, qU); boneQuat(d2, fr, qL);
    upper.quaternion.copy(parentQ).invert().multiply(qU);
    lower.quaternion.copy(qU).invert().multiply(qL);
    if (effQ) eff.quaternion.copy(qL).invert().multiply(effQ);
  }
  // leg: ankle target + boot orientation; bend = where the knee points
  function legTo(s, ankle, bootQ, bend) {
    const L = leg[s];
    frame(pelvis, jA, qA);
    hipP.copy(L.thigh.position).applyQuaternion(qA).add(jA);
    chainTo(L.thigh, L.shin, L.foot, qA, hipP, ankle, THIGH, SHIN, bend, 1, bootQ);
  }
  // boot on the ground: g = point under the ankle when flat, yaw (+ turns the toe to +x), pitch (+ = toe up),
  // lift (m), roll (+ = sole turned in). The boot rolls over the toe when the heel is up, over the heel when the toe is up.
  function footAt(s, gx, gz, yaw, pitch, lift = 0, roll = 0, bend = null) {
    qY.setFromAxisAngle(AY, yaw); qP.setFromAxisAngle(AX, -pitch); qR.setFromAxisAngle(AZ, -s * roll);
    footQ.copy(qY).multiply(qP).multiply(qR);
    const pz = pitch < 0 ? TOE : HEEL;
    piv.set(0, 0, pz).applyQuaternion(qY).add(tmp.set(gx, lift + 0.062 * Math.abs(Math.sin(roll)), gz));   // a rolled boot stands on its edge
    off.set(0, J.ankleY, -pz).applyQuaternion(footQ);
    ank.copy(piv).add(off);
    legTo(s, ank, footQ, bend || defBend.set(s * 0.12, 0.05, 1));
  }
  function shoulder(s, out) { frame(chest, jA, qA); return out.copy(arm[s].up.position).applyQuaternion(qA).add(jA); }
  function chestPoint(x, y, z, out) { frame(chest, jA, qA); return out.set(x, y - J.chest, z).applyQuaternion(qA).add(jA); }
  function jointPos(b, out) { frame(b, out, qA); return out; }
  // arm: wrist target; bend = where the elbow points; handQ = figure-space hand orientation (or null: in line)
  function armTo(s, wrist, bend, handQ = null) {
    const A = arm[s];
    frame(chest, jA, qA);
    const shp = tmp.copy(A.up.position).applyQuaternion(qA).add(jA).clone();
    chainTo(A.up, A.fore, A.hand, qA, shp, wrist, UPARM, FORE, bend, -1, handQ);
  }
  // hand orientation from where the fingers point and where the palm faces
  function handQuat(s, fingers, palm, out) {
    _by.copy(fingers).negate().normalize();
    _bx.copy(palm).multiplyScalar(-s);
    _bx.addScaledVector(_by, -_bx.dot(_by)).normalize();
    _bz.crossVectors(_bx, _by);
    return out.setFromRotationMatrix(_m4.makeBasis(_bx, _by, _bz));
  }
  const kneeB = (s, up = 0.05, out = 0.12) => V3(s * out, up, 1);
  const elbowB = (s) => V3(s * 0.55, -0.25, -1);
  // after armTo: a relaxed hand, palm turned in toward the body, the wrist dropped a little
  const rf = V3(), rp = V3(), hq2 = Q();
  function relaxHand(s, droop = 0.35, palmDown = 0.25) {
    rf.copy(d2).normalize(); rf.y -= droop; rf.normalize();
    rp.set(-s, -palmDown, 0.1);
    handQuat(s, rf, rp, hq2);
    arm[s].hand.quaternion.copy(qL).invert().multiply(hq2);
  }
  function neutralArm(s, t = 0, sway = 0) {
    shoulder(s, sh);
    wr.set(sh.x + s * 0.09, sh.y - 0.44 + 0.01 * Math.sin(t * 0.9 + s), sh.z + 0.13 + sway);
    armTo(s, wr, elbowB(s));
    relaxHand(s);
  }
  function reset() {
    for (const b of bones) b.quaternion.identity();
    body.position.set(0, 0, 0);
    tool.scale.setScalar(1e-4);
    curl[1] = curl[-1] = 0.4;
    lastPose = "";
  }
  function finish() {
    for (const s of [1, -1]) arm[s].fing.quaternion.setFromAxisAngle(AZ, -s * curl[s] * 0.9);
  }
  // feet for a stepping gait. u = phase 0..1 (left heel strike at 0), S = distance per cycle, s0 = stance share
  function gaitFeet(u, S, lift, s0, toeOff, heelUp, width, yawOut) {
    for (const s of [1, -1]) {
      const fu = (u + (s > 0 ? 0 : 0.5)) % 1;
      let z, l = 0, pitch;
      if (fu < s0) {
        const w = fu / s0;
        z = S * s0 * (0.5 - w);
        pitch = w < 0.15 ? heelUp * (1 - w / 0.15) ** 1.5 : w > 0.62 ? -toeOff * ((w - 0.62) / 0.38) ** 1.6 : 0;
      } else {
        const w = (fu - s0) / (1 - s0), e = w * w * (3 - 2 * w);
        z = S * s0 * (-0.5 + e);
        l = lift * Math.sin(Math.PI * Math.pow(w, 0.8));
        pitch = lerp(-toeOff, heelUp, sstep(0.05, 0.9, w));
      }
      footAt(s, s * width, z, s * yawOut, pitch, l, 0, kneeB(s));
    }
  }

  /* walk: heavy suit, low gravity: long soft strides, a bounce, the body leaning into the pack's weight */
  P.walk = (ph, amp = 1) => {
    reset();
    const a = clamp(amp, 0, 1), u = (((ph / TAU) % 1) + 1) % 1, c1 = Math.cos(TAU * u), s1 = Math.sin(TAU * u);
    body.position.set(0.024 * a * s1, -0.014 - 0.016 * a - 0.024 * a * Math.cos(4 * Math.PI * (u - 0.08)), 0.0);
    pelvis.rotation.set(0.05 * a, -0.11 * a * c1, 0.035 * a * s1);
    spine.rotation.set(0.05 + 0.08 * a, 0.06 * a * c1, -0.01 * a * s1);
    chest.rotation.set(0.03 + 0.05 * a + 0.012 * a * Math.cos(4 * Math.PI * (u - 0.2)), 0.07 * a * c1, -0.02 * a * s1);
    head.rotation.set(-0.13 * a - 0.02 + 0.015 * a * Math.cos(4 * Math.PI * (u - 0.2)), -0.05 * a * c1, 0);
    gaitFeet(u, 1.12 * a, 0.13 * a, 0.57, 0.62 * a, 0.27 * a, 0.125, 0.07);
    for (const s of [1, -1]) {
      const sw = -Math.cos(TAU * (u + (s > 0 ? 0 : 0.5))) * a;    // + = this arm forward
      shoulder(s, sh);
      wr.set(sh.x + s * (0.085 + 0.02 * a), sh.y - 0.45 + 0.05 * Math.max(0, sw), sh.z + 0.11 + 0.17 * sw);
      armTo(s, wr, elbowB(s));
      relaxHand(s, 0.3 - 0.2 * sw);
    }
    curl[1] = curl[-1] = 0.45;
    finish();
  };

  /* idle: weight shifts, looks around; now and then checks the chest display */
  P.idle = (t, look = 0) => {
    reset();
    const w = Math.sin(t * 0.45 + look * 1.3), chk = sstep(0.62, 0.92, Math.sin(t * 0.21 + look * 2.1));
    const yaw = 0.5 * Math.sin(t * 0.31 + look) + 0.18 * Math.sin(t * 0.83 + look * 2);
    body.position.set(0.02 * w, -0.016 + 0.004 * Math.sin(t * 1.6 + look), 0);
    pelvis.rotation.set(0.02, 0.04 * Math.sin(t * 0.3 + look), -0.03 * w);
    spine.rotation.set(0.04, 0, 0.015 * w);
    chest.rotation.set(0.02 + 0.008 * Math.sin(t * 1.6 + look) + 0.06 * chk, yaw * 0.18 * (1 - chk), 0.012 * w);
    head.rotation.set(lerp(-0.04 + 0.07 * Math.sin(t * 0.53 + look), 0.42, chk), yaw * 0.75 * (1 - chk), 0.03 * Math.sin(t * 0.4 + look));
    footAt(1, 0.13, 0.035, 0.1, 0, 0, 0, kneeB(1));
    footAt(-1, -0.13, -0.035, -0.13, 0, 0, 0, kneeB(-1));
    neutralArm(1, t, 0.01 * Math.sin(t * 0.7 + look));
    if (chk > 0.01) {
      shoulder(-1, sh); chestPoint(-0.05, 1.27, 0.36, tmp);
      wr.set(sh.x - 0.09, sh.y - 0.44, sh.z + 0.13).lerp(tmp, chk);
      armTo(-1, wr, V3(-0.6, -0.6, -0.5));
      curl[-1] = lerp(0.4, 0.75, chk);
    } else neutralArm(-1, t, -0.01 * Math.sin(t * 0.7 + look));
    finish();
  };

  /* kneeling on the right knee, left foot forward. mode "work": right hand down at the ground with the scoop;
     mode "help": right hand reaching to a crewmate sitting in front. e = 0 standing .. 1 down */
  function kneelPose(e, mode, t) {
    const lean = mode === "work" ? 0.62 : 0.3;
    body.position.set(lerp(0, 0.01, e), lerp(-0.016, -0.44, e), lerp(0, -0.16, e));
    pelvis.rotation.set(lerp(0, 0.12, e), lerp(0, mode === "help" ? -0.12 : 0.05, e), lerp(0, 0.04, e));
    spine.rotation.set(lerp(0.04, lean * 0.5, e), lerp(0, mode === "help" ? -0.1 : 0, e), 0);
    chest.rotation.set(lerp(0.02, lean * 0.5, e), lerp(0, mode === "help" ? -0.12 : 0.05, e), 0);
    head.rotation.set(lerp(-0.02, mode === "work" ? 0.2 : 0.25, e), lerp(0, mode === "help" ? -0.25 : 0, e), 0);
    // right knee to the ground, toes tucked; left foot planted forward
    footAt(-1, lerp(-0.13, -0.12, e), lerp(-0.03, -0.77, e), lerp(-0.13, -0.05, e), lerp(0, -1.42, e), 0, 0, V3(-0.05, -0.35 * e, 1));
    footAt(1, lerp(0.13, 0.15, e), lerp(0.03, 0.15, e), lerp(0.1, 0.12, e), 0, 0, 0, V3(0.18, 0.45 * e, 1));
    const knee = jointPos(leg[1].shin, V3());
    // left hand rests on the left knee
    shoulder(1, sh);
    wr.set(sh.x + 0.09, sh.y - 0.44, sh.z + 0.13).lerp(tmp.copy(knee).add(V3(0.02, 0.1, 0.03)), e);
    armTo(1, wr, elbowB(1), e > 0.5 ? handQuat(1, V3(0.1, -0.35, 1), V3(0, -1, 0.1), hq) : null);
    shoulder(-1, sh);
    if (mode === "work") {
      const dig = Math.sin(t * 2.6) * 0.04, d2 = Math.sin(t * 1.3) * 0.03;
      tmp.set(-0.15 + d2, 0.4 + Math.max(0, -dig) * 0.8, 0.36 + dig);
      wr.set(sh.x - 0.09, sh.y - 0.44, sh.z + 0.13).lerp(tmp, e);
      armTo(-1, wr, V3(-0.8, 0.1, -0.5), e > 0.3 ? handQuat(-1, V3(0.05, 0.2 + dig * 2, 1), V3(1, 0, 0), hq) : null);
      tool.scale.setScalar(e > 0.2 ? 1 : 1e-4);
      curl[-1] = 0.9;
    } else {
      tmp.set(-0.26, 0.74, 0.33);
      wr.set(sh.x - 0.09, sh.y - 0.44, sh.z + 0.13).lerp(tmp, ease(e * 1.3));
      armTo(-1, wr, V3(-0.6, -0.5, -0.5), e > 0.4 ? handQuat(-1, V3(0.05, -0.3, 1), V3(0.3, -1, 0), hq) : null);
      curl[-1] = lerp(0.4, 0.7, e);
    }
    curl[1] = lerp(0.4, 0.6, e);
  }
  /* working at a stop: kneels, digs with the scoop, gets up, pauses, repeats */
  // the work cycle starts standing each time the figure arrives at a stop (or the clock jumps back)
  let workT0 = 0, workLast = -1e9, lastPose = "";
  P.work = (t) => {
    if (lastPose !== "work" || t < workLast || t - workLast > 1) workT0 = t;
    workLast = t;
    reset();
    lastPose = "work";
    const T = 7.5, tt = t - workT0, p = (tt % T) / T;
    const e = sstep(0.05, 0.24, p) * (1 - sstep(0.76, 0.94, p));
    kneelPose(e, "work", t);
    finish();
  };
  /* goes down on one knee beside a crewmate in front (k is also used going back up) */
  P.kneel = (k) => {
    reset();
    kneelPose(ease(clamp(k, 0, 1)), "help", 0);
    finish();
  };

  /* the fall: the left ankle turns, a stumble, a crouch, then sitting with the hurt left leg stretched out.
     Keyframes, each fully set; the crouch in the middle also reads well played backwards (getting up). */
  const KF = [
    { k: 0, b: [0, -0.016, 0], pr: [0.02, 0, 0], sr: [0.04, 0, 0], cr: [0.02, 0, 0], hr: [-0.03, 0, 0],
      fL: [0.13, 0.035, 0.1, 0, 0, 0], fR: [-0.13, -0.035, -0.13, 0, 0, 0], kL: [0.12, 0.05, 1], kR: [-0.12, 0.05, 1],
      wL: ["sh", 0.09, -0.44, 0.13], wR: ["sh", -0.09, -0.44, 0.13], hL: 0, hR: 0, cl: 0.4 },
    { k: 0.2, b: [0.07, -0.1, 0.04], pr: [0.16, 0.08, -0.14], sr: [0.14, 0.05, -0.06], cr: [0.12, 0.06, -0.08], hr: [0.25, 0.15, 0.05],
      fL: [0.15, 0.06, 0.25, -0.15, 0, 0.42], fR: [-0.16, 0.24, -0.15, 0.22, 0.07, 0], kL: [0.35, 0.0, 1], kR: [-0.12, 0.1, 1],
      wL: ["abs", 0.64, 1.16, 0.08], wR: ["abs", -0.58, 1.26, 0.3], hL: 0, hR: 0, cl: 0.1 },
    { k: 0.42, b: [0.03, -0.44, -0.13], pr: [0.42, 0.05, -0.06], sr: [0.18, 0.03, 0], cr: [0.12, 0.04, 0], hr: [0.2, 0.15, 0],
      fL: [0.16, 0.17, 0.25, 0.05, 0, 0.25], fR: [-0.15, 0.12, -0.12, 0, 0, 0], kL: [0.2, 0.2, 1], kR: [-0.12, 0.2, 1],
      wL: ["abs", 0.34, 0.33, -0.3], wR: ["abs", -0.34, 0.33, -0.3], hL: 1, hR: 1, cl: 0.25 },
    { k: 0.64, b: [0, -0.8, -0.3], pr: [-0.32, 0, 0], sr: [-0.04, 0, 0], cr: [0.06, 0, 0], hr: [0.15, 0.1, 0],
      fL: [0.14, 0.42, 0.18, 0.95, 0, 0.1], fR: [-0.16, 0.2, -0.12, 0, 0, 0], kL: [0.15, 0.6, 1], kR: [-0.15, 0.6, 1],
      wL: ["abs", 0.33, 0.055, -0.56], wR: ["abs", -0.33, 0.055, -0.56], hL: 1, hR: 1, cl: 0.25 },
    { k: 0.84, b: [0, -0.8, -0.31], pr: [-0.26, 0.04, 0], sr: [0.06, 0.04, 0], cr: [0.18, 0.08, 0], hr: [0.42, 0.18, 0.04],
      fL: [0.13, 0.55, 0.2, 1.2, 0, 0.05], fR: [-0.18, 0.18, -0.14, 0, 0, 0], kL: [0.15, 0.8, 0.6], kR: [-0.18, 0.7, 1],
      wL: ["knee", 0.03, 0.1, -0.02], wR: ["abs", -0.35, 0.052, -0.52], hL: 2, hR: 1, cl: 0.55 },
    { k: 1, b: [0, -0.802, -0.315], pr: [-0.24, 0.05, 0.02], sr: [0.08, 0.05, 0], cr: [0.22, 0.1, 0.02], hr: [0.48, 0.22, 0.06],
      fL: [0.13, 0.56, 0.22, 1.25, 0, 0.05], fR: [-0.18, 0.17, -0.15, 0, 0, 0], kL: [0.15, 0.8, 0.6], kR: [-0.18, 0.7, 1],
      wL: ["knee", 0.03, 0.09, -0.03], wR: ["abs", -0.35, 0.052, -0.52], hL: 2, hR: 1, cl: 0.6 },
  ];
  const mix3 = (a, b, e) => [lerp(a[0], b[0], e), lerp(a[1], b[1], e), lerp(a[2], b[2], e)];
  const mixN = (a, b, e) => a.map((v, i) => lerp(v, b[i], e));
  function wristTarget(s, w, out) {
    if (w[0] === "sh") { shoulder(s, sh); return out.set(sh.x + w[1], sh.y + w[2], sh.z + w[3]); }
    if (w[0] === "knee") return jointPos(leg[s].shin, out).add(tmp.set(w[1], w[2], w[3]));
    return out.set(w[1], w[2], w[3]);
  }
  const hW = V3(), hW2 = V3(), q1 = Q(), q2 = Q();
  function handFor(s, mode, out) {
    if (mode === 1) return handQuat(s, V3(s * 0.25, -0.15, -1), V3(0, -1, 0), out);           // flat on the ground, fingers back
    if (mode === 2) return handQuat(s, V3(-s * 0.1, -0.45, 1), V3(-s * 0.2, -1, 0.1), out);   // on the knee
    return null;
  }
  P.fall = (k) => {
    reset();
    k = clamp(k, 0, 1);
    let i = 0; while (i < KF.length - 2 && k > KF[i + 1].k) i++;
    const A = KF[i], B = KF[i + 1], e = ease((k - A.k) / (B.k - A.k));
    body.position.set(...mix3(A.b, B.b, e));
    pelvis.rotation.set(...mix3(A.pr, B.pr, e)); spine.rotation.set(...mix3(A.sr, B.sr, e));
    chest.rotation.set(...mix3(A.cr, B.cr, e)); head.rotation.set(...mix3(A.hr, B.hr, e));
    const fL = mixN(A.fL, B.fL, e), fR = mixN(A.fR, B.fR, e);
    footAt(1, fL[0], fL[1], fL[2], fL[3], fL[4], fL[5], V3(...mix3(A.kL, B.kL, e)));
    footAt(-1, fR[0], fR[1], fR[2], fR[3], fR[4], fR[5], V3(...mix3(A.kR, B.kR, e)));
    for (const s of [1, -1]) {
      const wa = s > 0 ? A.wL : A.wR, wb = s > 0 ? B.wL : B.wR, ha = s > 0 ? A.hL : A.hR, hb = s > 0 ? B.hL : B.hR;
      wristTarget(s, wa, hW); wristTarget(s, wb, hW2); hW.lerp(hW2, e);
      const qa = handFor(s, ha, q1), qb = handFor(s, hb, q2);
      let hqq = null;
      if (qa && qb) hqq = hq.copy(qa).slerp(qb, e);
      else if (qb && e > 0.5) hqq = hq.copy(qb);
      else if (qa && e < 0.5) hqq = hq.copy(qa);
      armTo(s, hW, s > 0 ? V3(0.6, -0.1, -1) : V3(-0.6, -0.1, -1), hqq);
      if (!hqq) relaxHand(s, 0.1, 0);
    }
    curl[1] = curl[-1] = lerp(A.cl, B.cl, e);
    finish();
  };

  /* the walk home. Both use the same phase; the helper takes two short steps per cycle, the hurt one hops once.
     side = +1: the partner is at this figure's +x. Bodies are staggered a little so the shoulders clear. */
  const bobPair = (u) => 0.012 * Math.cos(4 * Math.PI * (u - 0.1));
  P.supported = (ph, side) => {
    reset();
    const sd = side >= 0 ? 1 : -1, u = (((ph / TAU) % 1) + 1) % 1, good = -sd, bad = sd;
    body.position.set(sd * 0.05, -0.05 + bobPair(u), 0.05);
    pelvis.rotation.set(0.12, sd * 0.08, sd * 0.1);
    spine.rotation.set(0.14, sd * 0.05, -sd * 0.06);
    chest.rotation.set(0.12, sd * 0.12, -sd * 0.08);
    head.rotation.set(0.32, sd * 0.15, -sd * 0.05);
    // good leg: planted, then a short low hop forward
    const s0 = 0.68;
    let z, l = 0, pitch = 0;
    if (u < s0) { const w = u / s0; z = 0.12 - 0.24 * w; pitch = w > 0.75 ? -0.3 * ((w - 0.75) / 0.25) : 0; }
    else { const w = (u - s0) / (1 - s0); z = -0.12 + 0.24 * ease(w); l = 0.075 * Math.sin(Math.PI * w); pitch = lerp(-0.3, 0.12, w); }
    footAt(good, good * 0.12, z, good * 0.06, pitch, l, 0, kneeB(good));
    // bad leg held off the ground, knee bent, swinging a little
    footAt(bad, bad * 0.15, -0.2 + 0.04 * Math.sin(TAU * u), bad * 0.08, -0.65, 0.3 + 0.02 * Math.cos(TAU * u), 0, V3(bad * 0.1, -0.2, 1));
    // near arm over the helper's shoulders, hand on the top of the helper's pack
    tmp.set(sd * 0.6, 1.585, -0.215);
    armTo(bad, tmp.clone(), V3(sd * 0.1, -1, -0.25), handQuat(bad, V3(sd * 0.85, -0.25, -0.2), V3(0, -1, 0), hq));
    curl[bad] = 0.75;
    // far arm loose in front
    shoulder(good, sh);
    wr.set(sh.x + good * 0.05, sh.y - 0.4, sh.z + 0.2 + 0.03 * Math.sin(TAU * u));
    armTo(good, wr, elbowB(good));
    relaxHand(good);
    curl[good] = 0.5;
    finish();
  };
  P.supporting = (ph, side) => {
    reset();
    const sd = side >= 0 ? 1 : -1, u = (((ph / TAU) % 1) + 1) % 1;
    body.position.set(-sd * 0.01, -0.06 + bobPair(u), -0.05);
    pelvis.rotation.set(0.06, -0.05 * Math.cos(TAU * u), -sd * 0.03);
    spine.rotation.set(0.06, sd * 0.06, -sd * 0.02);
    chest.rotation.set(0.04, sd * 0.12, -sd * 0.03);
    head.rotation.set(0.05, sd * 0.35, 0);
    gaitFeet(u, 0.46, 0.055, 0.62, 0.32, 0.14, 0.13, 0.08);
    // near arm round the crewmate's back, hand on the back of their pack
    tmp.set(sd * 0.5, 1.17, -0.355);
    armTo(sd, tmp.clone(), V3(sd * 0.2, 0.1, -1), handQuat(sd, V3(sd * 0.8, -0.35, 0.1), V3(0, 0, 1), hq));
    curl[sd] = 0.6;
    // far arm swings a little
    shoulder(-sd, sh);
    const sw = 0.08 * Math.cos(TAU * u);
    wr.set(sh.x - sd * 0.09, sh.y - 0.44, sh.z + 0.14 + sw);
    armTo(-sd, wr, elbowB(-sd));
    relaxHand(-sd);
    finish();
  };
}

/* ---------- base camp ----------
   A surface habitat drawn by this code, not a copy of a real design: a long pressurised module on legs with ribs
   and lit windows, an airlock with a hatch, a porch and steps facing +z, a lattice mast with a lamp, a dish antenna,
   two solar arrays on frames, tanks and cargo. It fits inside 14 m and keeps z = +6 to +12 m in front clear. */
function glowTexture() {
  const c = canvas(64, 64), g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c, true, false);
}
export function makeBaseCamp() {
  const g = new THREE.Group(); g.name = "baseCamp";
  const K = new Kit(false);
  const glow = new THREE.MeshStandardMaterial({ color: 0x2a1a0b, emissive: 0xffb25c, emissiveIntensity: 1.8, roughness: 0.3 });
  const beacon = new THREE.MeshStandardMaterial({ color: 0x2a0d05, emissive: 0xff6a3d, emissiveIntensity: 2.8, roughness: 0.4 });
  const cells = new THREE.MeshStandardMaterial({ color: 0xc6cede, map: makeSolarCells(), metalness: 0.1, roughness: 0.5, envMapIntensity: 0.25 });
  const hd = (amt = 1, top = 2.4) => (p, c) => {
    const n = fbm(p.x * 0.8 + 5, p.y * 1.4, p.z * 0.8);
    c.lerp(DUST, clamp(Math.pow(clamp(1 - p.y / top, 0, 1), 1.3) * (0.3 + 0.9 * n) * amt, 0, 0.85));
  };
  const H = (geo, o = {}) => K.add("hard", geo, { color: 0xe8e5dd, paint: hd(1), ...o });
  const Mt = (geo, o = {}) => K.add("metal", geo, { color: 0xb0b6be, paint: hd(0.8), ...o });
  const Dk = (geo, o = {}) => K.add("dark", geo, { color: 0x383b40, paint: hd(0.9), ...o });
  const rod = (a, b, r, fn = Mt, o = {}, rs = 10) => { const d = V3().subVectors(b, a); fn(cyl(r, r, d.length(), rs), { m: alignY(V3().addVectors(a, b).multiplyScalar(0.5), d), ...o }); };
  const X2Y = rotZ(-Math.PI / 2), Z2Y = rotX(Math.PI / 2);   // revolve axis (y) onto x, onto z

  // main module: axis along x at y 2.75, z -1.2; radius 2, cylinder 8 m with shallow domed ends and panel seams
  const MY = 2.75, MZ = -1.2, MR = 2.0;
  const prof = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([MR * Math.sin((t * Math.PI) / 2), 4 + 0.95 * Math.cos((t * Math.PI) / 2)]); }
  for (const a of [2.7, 1.35, 0, -1.35, -2.7]) prof.push([MR, a + 0.03], [MR - 0.014, a + 0.012], [MR - 0.014, a - 0.012], [MR, a - 0.03]);
  for (let i = 10; i >= 0; i--) { const t = i / 10; prof.push([MR * Math.sin((t * Math.PI) / 2), -4 - 0.95 * Math.cos((t * Math.PI) / 2)]); }
  const hull = prof.filter((p, i) => i === 0 || Math.abs(p[1] - prof[i - 1][1]) > 1e-6 || Math.abs(p[0] - prof[i - 1][0]) > 1e-6);
  hull.sort((p, q) => q[1] - p[1]);
  const modM = mul(at(0, MY, MZ), X2Y);
  // hull panels: each slightly different in tone, dust from the ground up
  H(revolve(hull, 72), { m: modM, paint: (p, c) => {
    const sec = Math.floor((Math.atan2(p.z - MZ, p.y - MY) + Math.PI) / (TAU / 12)), seg = Math.floor((p.x + 5) / 1.35);
    c.multiplyScalar(0.955 + 0.07 * hash3(sec, seg, 3)); hd(1)(p, c);
  } });
  for (const a of [-3.75, -2.45, -0.95, 0.95, 2.45, 3.75]) H(revolve(ringProf(1.99, 2.1, a + 0.1, a - 0.1, 0.025), 72), { m: modM, color: 0xcdcbc4 });
  // EVA handrails along the top
  for (const z of [-0.45, 0.45]) {
    rod(V3(-3.4, MY + MR + 0.16, MZ + z), V3(3.4, MY + MR + 0.16, MZ + z), 0.03, Mt, { color: 0xd8a34a });
    for (const x of [-3.2, -1.6, 1.6, 3.2]) rod(V3(x, MY + MR - 0.02, MZ + z * 0.95), V3(x, MY + MR + 0.16, MZ + z), 0.02);
  }
  // windows (warm light inside): four on the airlock side, two at the back
  const win = (x, side) => {
    const z = MZ + side * (MR + 0.02), m = mul(at(x, MY + 0.1, z), rotY(side > 0 ? 0 : Math.PI), rotX(-0.05));
    Dk(rbox(0.76, 0.6, 0.07, 0.03, { bevel: 3, flat: 1 }), { m, color: 0x4a4e55 });
    K.add(glow, rbox(0.6, 0.44, 0.03, 0.012, { bevel: 2, flat: 1 }), { m: mul(m, at(0, 0, 0.028)) });
  };
  for (const x of [-3.15, -1.95, 1.95, 3.15]) win(x, 1);
  for (const x of [-2.2, 0, 2.2]) win(x, -1);
  // legs: struts, damper sleeves, footpads, braces
  const legs = [[-3, -1], [3, -1], [-3, 1], [3, 1], [0, -1]];
  const legAt = {};
  for (const [x, sz] of legs) {
    const top = V3(x, MY - MR * 0.72, MZ + sz * MR * 0.62), foot = V3(x + Math.sign(x) * 0.25, 0.09, MZ + sz * 2.05);
    legAt[`${x},${sz}`] = (y) => top.clone().lerp(foot, (top.y - y) / (top.y - foot.y));
    rod(top, foot, 0.075);
    rod(top.clone().lerp(foot, 0.08), top.clone().lerp(foot, 0.45), 0.11, Dk, { color: 0x50545a });
    Mt(cyl(0.36, 0.42, 0.09, 24), { m: atV(foot.clone().setY(0.045)), color: 0xa5aab1 });
    Mt(sphere(0.1, 12, 8), { m: atV(foot) });
  }
  rod(legAt["-3,-1"](0.62), legAt["0,-1"](0.62), 0.04); rod(legAt["0,-1"](0.62), legAt["3,-1"](0.62), 0.04);
  rod(legAt["-3,-1"](0.62), legAt["-3,1"](0.62), 0.04); rod(legAt["3,-1"](0.62), legAt["3,1"](0.62), 0.04);

  // airlock: a short cylinder toward +z, with its own ribs, an orange band, lights and the hatch
  const AY_ = 2.2, AR = 1.15, AF = 3.1;
  const lockM = mul(at(0, AY_, 0), Z2Y);
  H(revolve([[0, AF], [AR - 0.06, AF], [AR - 0.06, AF], [AR, AF - 0.06], [AR, AF - 0.06], [AR, -0.3]], 56), { m: lockM });
  for (const a of [2.75, 1.25]) H(revolve(ringProf(1.14, 1.23, a + 0.08, a - 0.08, 0.02), 56), { m: lockM, color: 0xcdcbc4 });
  H(revolve(ringProf(1.145, 1.158, 2.15, 1.85, 0.004), 56), { m: lockM, color: 0xd8623a });
  Dk(rbox(1.16, 1.66, 0.08, 0.12, { bevel: 3, flat: 1 }), { m: at(0, 2.15, AF + 0.02), color: 0x52565c });
  H(rbox(1.0, 1.5, 0.09, 0.1, { bevel: 3, flat: 1 }), { m: at(0, 2.15, AF + 0.06), color: 0xd9d7d0, paint: hd(0.6) });
  K.add(glow, cyl(0.13, 0.13, 0.05, 24), { m: mul(at(0, 2.58, AF + 0.1), rotX(Math.PI / 2)) });
  Mt(torus(0.15, 0.025, 8, 28), { m: at(0, 2.58, AF + 0.115), color: 0x8f959d });
  rod(V3(0.36, 1.85, AF + 0.19), V3(0.36, 2.35, AF + 0.19), 0.02, Mt, { color: 0xd8a34a });
  for (const y of [1.85, 2.35]) rod(V3(0.36, y, AF + 0.1), V3(0.36, y, AF + 0.2), 0.014);
  for (const y of [1.6, 2.15, 2.7]) Mt(cyl(0.035, 0.035, 0.12, 12), { m: at(-0.51, y, AF + 0.1) });
  for (const x of [-0.78, 0.78]) {
    Dk(rbox(0.16, 0.1, 0.08, 0.025, { bevel: 2, flat: 1 }), { m: at(x, 2.95, AF + 0.03), color: 0x44474d });
    K.add(glow, rbox(0.12, 0.05, 0.03, 0.012, { bevel: 2, flat: 1 }), { m: at(x, 2.94, AF + 0.075) });
  }
  // porch deck, railings, steps down to the ground (they end before z = 6)
  const DY = 1.36, Z0 = AF + 0.02, Z1 = 4.25;
  for (let i = 0; i < 8; i++) Dk(rbox(2.3, 0.05, 0.125, 0.012, { bevel: 1, flat: 1 }), { m: at(0, DY - 0.025, Z0 + 0.08 + i * 0.145), color: 0x6c7077 });
  for (const x of [-1.05, 1.05]) Mt(rbox(0.08, 0.14, Z1 - Z0, 0.02, { bevel: 1, flat: 1 }), { m: at(x, DY - 0.12, (Z0 + Z1) / 2) });
  for (const [x, z] of [[-1.05, Z0 + 0.15], [1.05, Z0 + 0.15], [-1.05, Z1 - 0.08], [1.05, Z1 - 0.08]]) {
    rod(V3(x, 0.05, z), V3(x, DY - 0.18, z), 0.05);
    Mt(rbox(0.26, 0.04, 0.26, 0.015, { bevel: 1, flat: 1 }), { m: at(x, 0.02, z) });
  }
  for (const x of [-1.12, 1.12]) {
    for (const z of [Z0 + 0.12, (Z0 + Z1) / 2, Z1 - 0.05]) rod(V3(x, DY, z), V3(x, DY + 1.0, z), 0.025);
    rod(V3(x, DY + 1.0, Z0 + 0.05), V3(x, DY + 1.0, Z1), 0.03, Mt, { color: 0xd8a34a });
    rod(V3(x, DY + 0.5, Z0 + 0.12), V3(x, DY + 0.5, Z1 - 0.05), 0.02);
  }
  const NS = 5, rise = DY / NS, run = 0.3;
  for (let i = 1; i < NS; i++) Dk(rbox(1.0, 0.045, 0.28, 0.012, { bevel: 1, flat: 1 }), { m: at(0, DY - rise * i - 0.0225, Z1 + run * i - 0.14), color: 0x6c7077 });
  const sLen = Math.hypot(DY, run * NS), sAng = Math.atan2(DY, run * NS);
  for (const x of [-0.56, 0.56]) {
    Mt(rbox(0.06, 0.2, sLen, 0.02, { bevel: 1, flat: 1 }), { m: mul(at(x, DY / 2 - 0.06, Z1 + (run * NS) / 2), rotX(sAng)) });
    rod(V3(x * 1.12, DY + 1.0, Z1), V3(x * 1.12, 0.95, Z1 + run * NS - 0.05), 0.028, Mt, { color: 0xd8a34a });
    rod(V3(x * 1.12, 0.05, Z1 + run * NS - 0.05), V3(x * 1.12, 0.95, Z1 + run * NS - 0.05), 0.025);
  }

  // lattice mast with the lamp (route colour) and a weather box
  const mb = V3(-5.1, 0, -3.7), MH = 8.2, tri = [0, 1, 2].map((i) => V3(Math.cos((i * TAU) / 3) * 0.19, 0, Math.sin((i * TAU) / 3) * 0.19));
  for (const p of tri) rod(mb.clone().add(p), mb.clone().add(p).setY(MH), 0.03, Mt, {}, 8);
  for (let y = 0.3, i = 0; y < MH - 0.3; y += 0.62, i++) {
    const a = tri[i % 3], b = tri[(i + 1) % 3];
    rod(mb.clone().add(a).setY(y), mb.clone().add(b).setY(y + 0.62), 0.012, Mt, {}, 6);
    rod(mb.clone().add(a).setY(y), mb.clone().add(b).setY(y), 0.012, Mt, {}, 6);
  }
  Mt(rbox(0.8, 0.08, 0.8, 0.02, { bevel: 1, flat: 1 }), { m: atV(mb.clone().setY(0.04)) });
  Dk(cyl(0.12, 0.14, 0.24, 16), { m: atV(mb.clone().setY(MH + 0.1)), color: 0x2e3135 });
  K.add(beacon, sphere(0.17, 18, 12), { m: atV(mb.clone().setY(MH + 0.36)) });
  Dk(rbox(0.3, 0.38, 0.22, 0.03, { bevel: 2, flat: 1 }), { m: atV(mb.clone().add(V3(0.3, 3.0, 0))), color: 0xd9d6ce });
  rod(mb.clone().add(V3(0, 6.6, 0)), mb.clone().add(V3(0.75, 6.6, 0)), 0.015);
  Mt(cyl(0.05, 0.05, 0.1, 10), { m: atV(mb.clone().add(V3(0.78, 6.68, 0))) });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff6a3d, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  halo.position.copy(mb).setY(MH + 0.36); halo.scale.set(1.5, 1.5, 1);
  g.add(halo);

  // dish antenna on a tripod
  const db = V3(4.7, 0, -4.3);
  for (let i = 0; i < 3; i++) { const a = (i * TAU) / 3 + 0.3; rod(db.clone().add(V3(Math.cos(a) * 0.9, 0.04, Math.sin(a) * 0.9)), db.clone().setY(1.75), 0.05); }
  rod(db.clone().setY(1.6), db.clone().setY(2.35), 0.09, Mt, { color: 0xc4c9cf });
  Dk(rbox(0.32, 0.26, 0.32, 0.05, { bevel: 2, flat: 1 }), { m: atV(db.clone().setY(2.45)), color: 0x55595f });
  const dishDir = V3(-0.35, 0.72, 0.6).normalize(), dc = db.clone().setY(2.55).addScaledVector(dishDir, 0.25), f = 0.85, dprof = [];
  for (let i = 0; i <= 12; i++) { const r = (0.95 * i) / 12; dprof.push([r, (r * r) / (4 * f)]); }
  dprof.push([0.985, 0.275], [0.95, 0.24]);
  for (let i = 12; i >= 0; i--) { const r = (0.95 * i) / 12; dprof.push([r * 0.98, (r * r) / (4 * f) - 0.05]); }
  H(revolve(dprof, 48), { m: alignY(dc, dishDir), color: 0xeceae4 });
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3, q = new THREE.Quaternion().setFromUnitVectors(AY, dishDir);
    const rimP = V3(Math.cos(a) * 0.9, 0.24, Math.sin(a) * 0.9).applyQuaternion(q).add(dc);
    rod(rimP, dc.clone().addScaledVector(dishDir, f), 0.012);
  }
  Dk(cyl(0.05, 0.07, 0.16, 12), { m: alignY(dc.clone().addScaledVector(dishDir, f), dishDir), color: 0x3a3d42 });

  // two solar arrays on frames, tilted a little toward +z
  for (const sx of [-1, 1]) {
    const ac = V3(sx * 9.4, 1.45, -0.8), tilt = 0.32, am = mul(atV(ac), rotX(tilt));
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
      const px = (i - 0.5) * 1.66, pz = (j - 1) * 1.76;
      Mt(rbox(1.62, 0.05, 1.72, 0.015, { bevel: 1, flat: 1 }), { m: mul(am.clone(), at(px, 0, pz)), color: 0xc2c6cc });
      K.add(cells, new THREE.PlaneGeometry(1.54, 1.64), { m: mul(am.clone(), at(px, 0.027, pz), rotX(-Math.PI / 2)) });
    }
    for (const lx of [-1.4, 1.4]) for (const lz of [-2.2, 2.2]) {
      const topP = V3(lx, -0.06, lz).applyMatrix4(am);
      rod(V3(topP.x, 0.04, topP.z), topP, 0.045);
      Mt(rbox(0.22, 0.04, 0.22, 0.012, { bevel: 1, flat: 1 }), { m: at(topP.x, 0.02, topP.z) });
    }
    rod(V3(-1.66, -0.07, 0).applyMatrix4(am), V3(1.66, -0.07, 0).applyMatrix4(am), 0.035);
    rod(V3(0, -0.07, -2.6).applyMatrix4(am), V3(0, -0.07, 2.6).applyMatrix4(am), 0.035);
    // power box and a cable on the ground to the module
    Dk(rbox(0.55, 0.7, 0.4, 0.04, { bevel: 2, flat: 1 }), { m: at(sx * 5.4, 0.35, -2.3), color: 0xd4d1c9 });
    Dk(tube([V3(sx * 7.7, 0.04, -0.9), V3(sx * 6.6, 0.04, -1.9), V3(sx * 5.7, 0.05, -2.3), V3(sx * 5.4, 0.3, -2.3)], 0.035, 30, 6), { color: 0x2b2d31 });
    Dk(tube([V3(sx * 5.15, 0.5, -2.3), V3(sx * 4.6, 0.45, -2.2), V3(sx * 3.6, 0.9, -1.8), V3(sx * 3.3, 1.2, -1.5)], 0.03, 30, 6), { color: 0x2b2d31 });
  }

  // tanks on cradles at the back (one in gold foil), pipes up to the module
  for (const sx of [-1, 1]) {
    const tc = V3(sx * 1.7, 0.92, -5.1), tr = 0.6, half = 1.0, tp = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); tp.push([tr * Math.sin(a), half + tr * Math.cos(a)]); }
    for (let i = 8; i >= 0; i--) { const a = (i / 8) * (Math.PI / 2); tp.push([tr * Math.sin(a), -half - tr * Math.cos(a)]); }
    const tm = mul(atV(tc), X2Y);
    if (sx < 0) K.add("metal", revolve(tp, 40), { m: tm, color: 0xd4a85a, paint: (p, c) => { c.multiplyScalar(0.78 + 0.35 * vnoise(p.x * 9, p.y * 9, p.z * 9)); hd(0.5)(p, c); } });
    else H(revolve(tp, 40), { m: tm });
    for (const dx of [-0.65, 0.65]) Dk(rbox(0.16, 0.5, 1.0, 0.03, { bevel: 2, flat: 1 }), { m: at(tc.x + dx, 0.25, tc.z), color: 0x5d6168 });
    Dk(tube([V3(tc.x, tc.y + 0.55, tc.z + 0.2), V3(tc.x, 1.6, tc.z + 1.0), V3(tc.x * 0.6, 1.0, MZ - 1.5), V3(tc.x * 0.5, 1.1, MZ - 1.25)], 0.04, 30, 8), { color: 0x6b7078 });
  }

  // cargo: crates with orange bands and latches, a drum
  const crate = (x, y, z, w, h, d, ry) => {
    const m = mul(at(x, y + h / 2, z), rotY(ry));
    H(rbox(w, h, d, 0.05, { bevel: 2, flat: 1 }), { m, color: 0xd9d6ce });
    H(rbox(w + 0.012, 0.09, d + 0.012, 0.03, { bevel: 2, flat: 1 }), { m: mul(m, at(0, h * 0.22, 0)), color: 0xd8703c });
    for (const sx of [-1, 1]) Dk(rbox(0.07, 0.1, 0.03, 0.01, { bevel: 1, flat: 1 }), { m: mul(m, at(sx * w * 0.32, h * 0.38, d / 2 + 0.01)), color: 0x3a3d42 });
  };
  crate(5.3, 0, 1.6, 1.1, 0.75, 0.85, 0.08); crate(5.25, 0.75, 1.6, 0.8, 0.55, 0.7, -0.12); crate(6.45, 0, 0.9, 0.9, 0.6, 0.75, 0.42);
  H(cyl(0.3, 0.3, 0.8, 24), { m: at(4.5, 0.4, 2.55), color: 0x9aa3ad });
  Mt(torus(0.3, 0.018, 6, 24), { m: mul(at(4.5, 0.62, 2.55), rotX(Math.PI / 2)) });
  Mt(torus(0.3, 0.018, 6, 24), { m: mul(at(4.5, 0.18, 2.55), rotX(Math.PI / 2)) });

  K.build(g, null);
  return g;
}
