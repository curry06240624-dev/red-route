/* Red Route 3D walk: the ground.
   Shape: the terrain grid the app already ships (docs/data/grid_dem.i16: the HiRISE 1 m elevation model of Jezero,
   resampled to about 4 m cells by tools/build_layers.py). True vertical scale: one metre up is one metre across.
   Picture: the real HiRISE orbital photo of the same ground (img/photo_*.jpg, stitched from NASA JPL Mars Trek tiles of
   the 25 cm orthomosaic). The photo is black and white; this code gives it a Mars tone.
   On top: the app's no-go slope layer (strong from far away, faint up close) and the green "can still get home" area,
   drawn in the shader from the walk-home time layer.
   Not data: the fine grain and pebble relief seen from a few metres (drawn by this code), and the flat ground outside
   the mapped area.
   World axes: x = east, y = up, z = south, in metres. y = 0 is the height of base camp.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";

const UNREACHABLE = 2000;   // minutes: stands for "cannot get back" in the walk-home texture

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`could not load ${src}`)); i.src = src; });

/* One-channel texture from a black-and-white picture (the orbital photo). */
function grayTexture(img, aniso) {
  const tex = new THREE.Texture(img);
  tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType; tex.colorSpace = THREE.NoColorSpace; tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = aniso; tex.needsUpdate = true;
  return tex;
}

/* Fine relief for close views, drawn by this code (it is not data): smoothed random values plus small pebble bumps.
   R = fine brightness grain, G = pebble mask, B and A = the slope of the relief in x and z (for the light). Tiles seamlessly. */
function detailTexture(n = 512) {
  let seed = 20261115;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const octave = (cells) => { const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd(); return (x, y) => {
    const fx = (x / n) * cells, fy = (y / n) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), at = (a, b) => g[((b + cells) % cells) * cells + ((a + cells) % cells)];
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy; }; };
  const oc = [octave(6), octave(12), octave(24), octave(48), octave(96), octave(192)], wH = [0.36, 0.26, 0.17, 0.11, 0.06, 0.04], wG = [0.06, 0.1, 0.16, 0.22, 0.24, 0.22];
  const h = new Float32Array(n * n), grain = new Float32Array(n * n), peb = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let a = 0, b = 0; for (let k = 0; k < oc.length; k++) { const v = oc[k](x, y); a += v * wH[k]; b += v * wG[k]; }
    h[y * n + x] = a; grain[y * n + x] = b;
  }
  for (let p = 0; p < 420; p++) {   // pebbles: small rounded bumps, more small ones than large ones
    const cx = rnd() * n, cy = rnd() * n, r = 2.5 + rnd() * rnd() * 13, hgt = 0.05 + 0.1 * rnd();
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const d = Math.hypot(dx, dy) / r; if (d >= 1) continue;
      const i = (((Math.round(cy) + dy) % n + n) % n) * n + (((Math.round(cx) + dx) % n + n) % n), f = Math.sqrt(1 - d * d);
      h[i] += hgt * f * (r / 14 + 0.35); peb[i] = Math.max(peb[i], Math.min(1, f * 1.6));
    }
  }
  const data = new Uint8Array(n * n * 4), at = (x, y) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, dx = (at(x + 1, y) - at(x - 1, y)) * 9, dz = (at(x, y + 1) - at(x, y - 1)) * 9;
    data[i] = Math.max(0, Math.min(255, Math.round(grain[y * n + x] * 255)));
    data[i + 1] = Math.round(peb[y * n + x] * 255);
    data[i + 2] = Math.max(0, Math.min(255, Math.round(127.5 + dx * 127.5)));
    data[i + 3] = Math.max(0, Math.min(255, Math.round(127.5 + dz * 127.5)));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

export async function buildTerrain(grid, demBuffer, { stride = 1, zRef = 0, small = false, maxTex = 8192, aniso = 8 } = {}) {
  const { w, h, gx, gy } = grid;
  const dem = new Int16Array(demBuffer);   // little-endian, row 0 = north (checked against hillshade.png and the stop heights)
  const W = w * gx, D = h * gy;
  const zOf = (i) => dem[i] * grid.z_scale + grid.z_offset - zRef;

  /* --- helpers --- */
  const toWorld = (lon, lat) => ({ x: ((lon - grid.lon0) / grid.dlon) * gx - W / 2, z: ((grid.lat1 - lat) / grid.dlat) * gy - D / 2 });
  const toCell = (x, z) => ({ c: (x + W / 2) / gx - 0.5, r: (z + D / 2) / gy - 0.5 });   // cell-centre index, fractional
  const cellToWorld = (i) => ({ x: ((i % w) + 0.5) * gx - W / 2, z: (((i / w) | 0) + 0.5) * gy - D / 2 });
  function heightAt(x, z) {
    let { c, r } = toCell(x, z);
    c = Math.max(0, Math.min(w - 1.001, c)); r = Math.max(0, Math.min(h - 1.001, r));
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, i = r0 * w + c0;
    return (zOf(i) * (1 - fc) + zOf(i + 1) * fc) * (1 - fr) + (zOf(i + w) * (1 - fc) + zOf(i + w + 1) * fc) * fr;
  }
  function normalAt(x, z, out) {
    const e = 2, dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e), inv = 1 / Math.hypot(dx, 1, dz);
    return out.set(-dx * inv, inv, -dz * inv);
  }

  /* --- mesh: one vertex per grid cell (or per `stride` cells on small devices) --- */
  const cols = [], rows = [];
  for (let c = 0; c < w - 1; c += stride) cols.push(c); cols.push(w - 1);
  for (let r = 0; r < h - 1; r += stride) rows.push(r); rows.push(h - 1);
  const nx = cols.length, nz = rows.length;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  let yMin = Infinity, yMax = -Infinity, edgeSum = 0, edgeN = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const c = cols[i], r = rows[j], k = j * nx + i, cell = r * w + c, y = zOf(cell);
    pos[k * 3] = (c + 0.5) * gx - W / 2; pos[k * 3 + 1] = y; pos[k * 3 + 2] = (r + 0.5) * gy - D / 2;
    const cl = Math.max(0, c - 1), cr = Math.min(w - 1, c + 1), ru = Math.max(0, r - 1), rd = Math.min(h - 1, r + 1);
    const dx = (zOf(r * w + cr) - zOf(r * w + cl)) / ((cr - cl) * gx), dz = (zOf(rd * w + c) - zOf(ru * w + c)) / ((rd - ru) * gy);
    const inv = 1 / Math.hypot(dx, 1, dz);
    nor[k * 3] = -dx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -dz * inv;
    uv[k * 2] = (c + 0.5) / w; uv[k * 2 + 1] = (r + 0.5) / h;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) { edgeSum += y; edgeN++; }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx, c2 = a + 1, d = b + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = c2; idx[q++] = b; idx[q++] = d; idx[q++] = c2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();

  /* --- pictures: the orbital photo (whole area + a sharper part where the walks are), the slope layer, the grain --- */
  const half = small || maxTex < 8192;
  const [info, areaImg, walkImg, slopeImg] = await Promise.all([
    fetch("img/photo.json").then((r) => r.json()),
    loadImage(half ? "img/photo_area_half.jpg" : "img/photo_area.jpg"),
    loadImage(half ? "img/photo_walk_half.jpg" : "img/photo_walk.jpg"),
    loadImage("../data/slope.png"),
  ]);
  const photoArea = grayTexture(areaImg, aniso), photoWalk = grayTexture(walkImg, aniso);
  const slopeMap = new THREE.Texture(slopeImg);
  slopeMap.colorSpace = THREE.SRGBColorSpace; slopeMap.flipY = false; slopeMap.premultiplyAlpha = false; slopeMap.generateMipmaps = true;
  slopeMap.minFilter = THREE.LinearMipmapLinearFilter; slopeMap.anisotropy = Math.min(4, aniso); slopeMap.needsUpdate = true;
  // where the sharper photo sits inside the grid, as texture coordinates (u0, v0, u1, v1)
  const wk = info.walk, lonW = w * grid.dlon, latH = h * grid.dlat;
  const walkRect = new THREE.Vector4((wk.lon0 - grid.lon0) / lonW, (grid.lat1 - wk.lat1) / latH, (wk.lon1 - grid.lon0) / lonW, (grid.lat1 - wk.lat0) / latH);

  /* --- walk-home time layer (minutes) as a texture; the shader draws the green area and its edges from it --- */
  const fieldData = new Uint16Array(w * h).fill(THREE.DataUtils.toHalfFloat(UNREACHABLE));
  const fieldTex = new THREE.DataTexture(fieldData, w, h, THREE.RedFormat, THREE.HalfFloatType);
  fieldTex.minFilter = fieldTex.magFilter = THREE.LinearFilter; fieldTex.generateMipmaps = false; fieldTex.flipY = false; fieldTex.needsUpdate = true;
  let field = null;
  const lin = (hex) => new THREE.Color(hex);   // three converts sRGB hex to the linear working space
  const uniforms = {
    photoArea: { value: photoArea }, photoWalk: { value: photoWalk }, walkRect: { value: walkRect }, slopeMap: { value: slopeMap },
    fieldMap: { value: fieldTex }, detailMap: { value: detailTexture(small ? 256 : 512) },
    levels: { value: new THREE.Vector2(info.lo ?? 0.12, info.hi ?? 0.9) },
    toneLo: { value: lin(0x2b1c15) }, toneMid: { value: lin(0x956a4e) }, toneHi: { value: lin(0xe2c2a2) },
    zoneOn: { value: 0 }, thrBad: { value: -1 }, thrN: { value: -1 }, o2Lim: { value: 50 }, o2On: { value: 1 },
    slopeNear: { value: 0.13 }, slopeFar: { value: 0.62 }, zoneGain: { value: 1 },
    zoneFill: { value: lin(0x4ade80) }, zoneEdge: { value: lin(0xbbf7d0) }, o2Col: { value: lin(0xfbbf24) },
    gridPx: { value: new THREE.Vector2(w, h) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0, envMapIntensity: 0.55 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWxz; varying vec2 vTuv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWxz = position.xz; vTuv = uv;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      varying vec2 vWxz; varying vec2 vTuv;
      uniform sampler2D photoArea; uniform sampler2D photoWalk; uniform vec4 walkRect; uniform sampler2D slopeMap;
      uniform sampler2D fieldMap; uniform sampler2D detailMap; uniform vec2 levels;
      uniform vec3 toneLo; uniform vec3 toneMid; uniform vec3 toneHi;
      uniform float zoneOn; uniform float thrBad; uniform float thrN; uniform float o2Lim; uniform float o2On;
      uniform float slopeNear; uniform float slopeFar; uniform float zoneGain;
      uniform vec3 zoneFill; uniform vec3 zoneEdge; uniform vec3 o2Col; uniform vec2 gridPx;`)
      .replace("#include <map_fragment>", `
      float rrCamD = length(vViewPosition);
      // the real orbital photo: the whole area, and a sharper picture where the walks are
      float rrG = texture2D(photoArea, vTuv).r;
      vec2 rrW = (vTuv - walkRect.xy) / (walkRect.zw - walkRect.xy);
      float rrIn = min(min(rrW.x, 1.0 - rrW.x), min(rrW.y, 1.0 - rrW.y));
      if (rrIn > 0.0) rrG = mix(rrG, texture2D(photoWalk, rrW).r, smoothstep(0.0, 0.03, rrIn));
      float rrL = clamp((rrG - levels.x) / (levels.y - levels.x), 0.0, 1.0);
      rrL = pow(rrL, 1.08);
      vec3 rrCol = rrL < 0.55 ? mix(toneLo, toneMid, rrL / 0.55) : mix(toneMid, toneHi, (rrL - 0.55) / 0.45);
      // grain and pebbles close to the camera (drawn by code, not data)
      vec4 rrD1 = texture2D(detailMap, vWxz / 5.3), rrD2 = texture2D(detailMap, vWxz.yx / 0.93 + 0.37);
      float rrK1 = 1.0 - smoothstep(25.0, 200.0, rrCamD), rrK2 = 1.0 - smoothstep(3.0, 32.0, rrCamD);
      rrCol *= 1.0 + (rrD1.r - 0.5) * 0.55 * rrK1 + (rrD2.r - 0.5) * 0.6 * rrK2;
      rrCol *= 1.0 - 0.42 * rrD2.g * rrK2 - 0.2 * rrD1.g * rrK1;
      // the app's no-go slope layer: strong from far away (like the map), faint up close so the ground shows
      vec4 rrS = texture2D(slopeMap, vTuv);
      rrCol = mix(rrCol, rrS.rgb, rrS.a * mix(slopeNear, slopeFar, smoothstep(150.0, 1500.0, rrCamD)));
      // walk-home time here, in minutes
      float rrF = texture2D(fieldMap, vTuv).r;
      float rrFw = max(fwidth(rrF), 0.0005);
      float rrOk = 1.0 - smoothstep(12.0, 40.0, rrFw);
      float rrEdge = 0.0, rrEdgeN = 0.0;
      if (zoneOn > 0.5) {
        // green: from here a hurt crewmate can still be helped home at half speed in the time left
        float inBad = (1.0 - smoothstep(thrBad - rrFw, thrBad + rrFw, rrF)) * step(0.0, thrBad);
        float nearEdge = smoothstep(thrBad - 10.0, thrBad, rrF);
        rrCol *= mix(0.74, 1.0, inBad);
        rrCol = mix(rrCol, zoneFill, inBad * (0.07 + 0.30 * nearEdge) * zoneGain);
        rrEdge = (1.0 - smoothstep(rrFw * 1.1, rrFw * 2.2, abs(rrF - thrBad))) * step(0.0, thrBad) * rrOk;
        rrEdgeN = (1.0 - smoothstep(rrFw * 0.7, rrFw * 1.5, abs(rrF - thrN))) * step(0.0, thrN) * rrOk;
        rrCol = mix(rrCol, zoneEdge, rrEdge * 0.9);
        rrCol = mix(rrCol, vec3(1.0), rrEdgeN * 0.5);
      }
      // amber dashes: 50 min of walking from base camp (backup oxygen)
      float rrO = (1.0 - smoothstep(rrFw * 0.9, rrFw * 1.9, abs(rrF - o2Lim))) * step(0.4, fract((vTuv.x * gridPx.x + vTuv.y * gridPx.y) / 6.0)) * o2On * rrOk;
      rrCol = mix(rrCol, o2Col, rrO * 0.85);
      diffuseColor.rgb = rrCol;`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      {
        vec2 rrDn = (rrD1.ba * 2.0 - 1.0) * rrK1 * 0.55 + (rrD2.ba * 2.0 - 1.0) * rrK2 * 0.9;
        normal = normalize(normal + (viewMatrix * vec4(-rrDn.x, 0.0, -rrDn.y, 0.0)).xyz);
      }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      totalEmissiveRadiance += zoneEdge * rrEdge * 0.3 + vec3(1.0) * rrEdgeN * 0.08 + o2Col * rrO * 0.2;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.name = "terrain";

  /* --- beyond the mapped area: a flat placeholder plain and a dark skirt (not data) --- */
  const edgeY = edgeSum / edgeN, far = new THREE.Group();
  const plain = new THREE.Mesh(new THREE.CircleGeometry(60000, 48), new THREE.MeshStandardMaterial({ color: 0x7a4c33, roughness: 1, metalness: 0, envMapIntensity: 0.4 }));
  plain.rotation.x = -Math.PI / 2; plain.position.y = Math.min(edgeY, yMin + 20) - 14; far.add(plain);
  const sk = [], skI = [], ring = [];
  for (let i = 0; i < nx; i++) ring.push(i);
  for (let j = 1; j < nz; j++) ring.push(j * nx + nx - 1);
  for (let i = nx - 2; i >= 0; i--) ring.push((nz - 1) * nx + i);
  for (let j = nz - 2; j >= 0; j--) ring.push(j * nx);
  ring.forEach((k, n) => { sk.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], pos[k * 3], plain.position.y, pos[k * 3 + 2]); if (n) { const a = (n - 1) * 2; skI.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  const skGeo = new THREE.BufferGeometry();
  skGeo.setAttribute("position", new THREE.Float32BufferAttribute(sk, 3)); skGeo.setIndex(skI);
  far.add(new THREE.Mesh(skGeo, new THREE.MeshBasicMaterial({ color: 0x3a2318, side: THREE.DoubleSide })));

  /* --- the walk-home layer from the route engine: Uint16, minutes x 10, 65535 = cannot get back --- */
  function setField(f) {
    field = f;
    for (let i = 0; i < f.length; i++) fieldData[i] = THREE.DataUtils.toHalfFloat(f[i] === 65535 ? UNREACHABLE : f[i] / 10);
    fieldTex.needsUpdate = true;
  }

  /* The way home from a point: walk downhill on the walk-home layer until base camp (wayHome in docs/app.js).
     Returns world points with the walk-home minutes left at each, or null if it does not reach base camp. */
  function wayHome(x, z) {
    const f = field;
    if (!f) return null;
    const cc = toCell(x, z), c0 = Math.floor(cc.c + 0.5), r0 = Math.floor(cc.r + 0.5);
    if (r0 < 0 || r0 >= h || c0 < 0 || c0 >= w) return null;
    let i = r0 * w + c0;
    if (f[i] === 65535) {
      let best = -1, bd = Infinity;
      for (let dr = -8; dr <= 8; dr++) for (let dc = -8; dc <= 8; dc++) {
        const rr = r0 + dr, c1 = c0 + dc;
        if (rr < 0 || rr >= h || c1 < 0 || c1 >= w) continue;
        const j = rr * w + c1, d2 = dr * dr + dc * dc;
        if (f[j] !== 65535 && d2 < bd) { bd = d2; best = j; }
      }
      if (best < 0) return null;
      i = best;
    }
    const pts = [{ x, z, back: f[i] / 10 }], seen = new Set([i]);
    for (let n = 0; n < 40000 && f[i] > 0; n++) {
      const r = (i / w) | 0, c = i % w;
      let best = -1, bv = f[i], tie = -1;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, c1 = c + dc;
        if (rr < 0 || rr >= h || c1 < 0 || c1 >= w) continue;
        const j = rr * w + c1;
        if (f[j] < bv) { bv = f[j]; best = j; } else if (f[j] === f[i] && !seen.has(j) && tie < 0) tie = j;
      }
      if (best < 0) best = tie;
      if (best < 0) break;
      i = best; seen.add(i);
      const p = cellToWorld(i); pts.push({ x: p.x, z: p.z, back: f[i] / 10 });
    }
    if (f[i] > 10) return null;   // did not come within a minute of base camp
    return pts;
  }

  return { mesh, far, uniforms, heightAt, normalAt, toWorld, toCell, setField, wayHome, getField: () => field,
    size: { W, D, w, h, gx, gy, yMin, yMax, stride, verts: nx * nz, tris: idx.length / 3, photo: half ? "half" : "full" } };
}
