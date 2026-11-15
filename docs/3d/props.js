/* Red Route 3D walk: small things on the ground that make the scale readable.
   - Rocks: drawn where the app's HiRISE roughness layer (docs/data/grid_rough.u8) says the ground is rough: more and
     bigger rocks on rougher cells. Each rock's exact place and shape is an illustration, not data. The planned path is kept clear.
   - Footprints behind the crew, a little dust at their feet, dust drifting in the air.
   Nothing here changes a number; the walk maths never looks at these.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const h3 = (x, y, k) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

// a lumpy, slightly flat rock with a darker underside; corners are shared so the light falls smoothly over it
function rockGeometry(detail, seed) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("uv"); g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), bumps = [];
  for (let k = 0; k < 7; k++) {
    const u = h3(seed, k, 1) * 2 - 1, a = h3(seed, k, 2) * 6.283, r = Math.sqrt(1 - u * u);
    bumps.push([r * Math.cos(a), u, r * Math.sin(a), (h3(seed, k, 3) - 0.35) * 0.55]);
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let f = 1 + (h3(Math.round(x * 97), Math.round(y * 89) + seed, Math.round(z * 83)) - 0.5) * (detail > 1 ? 0.12 : 0.2);
    for (const [bx, by, bz, amp] of bumps) { const d = Math.max(0, x * bx + y * by + z * bz); f += amp * d * d * d; }
    let yy = y * f * 0.68; if (yy < -0.22) yy = -0.22 + (yy + 0.22) * 0.25;   // sits flat on the ground
    p.setXYZ(i, x * f, yy, z * f);
    const shade = (0.6 + 0.4 * Math.min(1, Math.max(0, (yy + 0.25) / 0.6))) * (0.9 + 0.2 * h3(i, seed, 9));
    col[i * 3] = shade; col[i * 3 + 1] = shade; col[i * 3 + 2] = shade;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class Rocks {
  constructor(scene, G, lowDetail = false) {
    this.G = G; this.cx = 1e9; this.cz = 1e9; this.routeCells = new Map(); this.keepOut = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    // three sizes of rock, each with its own shape and level of detail: [mesh, smallest size in metres]
    this.small = new THREE.InstancedMesh(rockGeometry(0, 3), mat, 4500);
    this.mid = new THREE.InstancedMesh(rockGeometry(1, 11), mat, 5000);
    this.big = new THREE.InstancedMesh(rockGeometry(lowDetail ? 1 : 2, 29), mat, 1000);
    for (const m of [this.small, this.mid, this.big]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0; scene.add(m); }
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.col = new THREE.Color();
  }
  // the planned path and the stops stay clear of rocks
  setRoute(route, keepOut) {
    const G = this.G; this.routeCells = new Map(); this.keepOut = keepOut || [];
    for (const p of route.pts) {
      const x = G.xOf(p[1]), z = G.zOf(p[0]), i = G.cellAt(x, z);
      if (i < 0) continue;
      if (!this.routeCells.has(i)) this.routeCells.set(i, []);
      this.routeCells.get(i).push(x, z);
    }
    this.cx = 1e9;
  }
  nearPath(x, z, i, reach) {
    const W = this.G.W;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const a = this.routeCells.get(i + dr * W + dc);
      if (!a) continue;
      for (let k = 0; k < a.length; k += 2) if ((a[k] - x) ** 2 + (a[k + 1] - z) ** 2 < reach * reach) return true;
    }
    for (const o of this.keepOut) if ((o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r) return true;
    return false;
  }
  update(px, pz) {
    if ((px - this.cx) ** 2 + (pz - this.cz) ** 2 < 28 * 28) return;
    this.cx = px; this.cz = pz;
    const G = this.G, g = G.g, R = 165, NEAR = 30;
    const c0 = Math.max(1, Math.floor((px - R) / g.gx)), c1 = Math.min(G.W - 2, Math.floor((px + R) / g.gx));
    const r0 = Math.max(1, Math.floor((pz - R) / g.gy)), r1 = Math.min(G.H - 2, Math.floor((pz + R) / g.gy));
    const cls = [this.small, this.mid, this.big], cnt = [0, 0, 0];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const xm = (c + 0.5) * g.gx, zm = (r + 0.5) * g.gy, d2 = (xm - px) ** 2 + (zm - pz) ** 2;
      if (d2 > R * R) continue;
      const i = r * G.W + c, rough = G.rough[i] * g.rough_scale;
      let n = Math.floor(Math.min(3.2, Math.max(0, (rough - 0.035) * 9)) + h3(c, r, 1));          // rocks: more where the layer is rougher
      const pebbles = d2 < NEAR * NEAR ? Math.floor(2 + Math.min(6, rough * 22) + h3(c, r, 2)) : 0;   // small stones, only close to the viewer
      for (let k = 0; k < n + pebbles; k++) {
        const peb = k >= n, x = (c + h3(c, r, 10 + k)) * g.gx, z = (r + h3(c, r, 40 + k)) * g.gy, u = h3(c, r, 70 + k);
        let size = peb ? 0.025 + 0.06 * u : 0.07 + Math.pow(u, 3.0) * (0.34 + rough * 2.6);
        size = Math.min(size, 1.25);
        if (this.nearPath(x, z, i, 0.75 + size)) continue;
        const ci = size < 0.11 ? 0 : size < 0.5 ? 1 : 2, mesh = cls[ci];
        if (cnt[ci] >= mesh.instanceMatrix.count) continue;
        const w = 0.8 + 0.5 * h3(c, r, 100 + k);
        this.e.set(h3(c, r, 130 + k) * 0.7 - 0.35, h3(c, r, 160 + k) * 6.283, h3(c, r, 190 + k) * 0.7 - 0.35);
        this.q.setFromEuler(this.e);
        this.v.set(x, G.height(x, z) - size * 0.2, z);
        this.s.set(size * w, size * (0.55 + 0.4 * h3(c, r, 220 + k)), size * (1.6 - w));
        this.m4.compose(this.v, this.q, this.s);
        const t = h3(c, r, 250 + k);
        this.col.setRGB(0.46 + 0.34 * t, 0.30 + 0.24 * t, 0.21 + 0.18 * t, THREE.SRGBColorSpace);
        const idx = cnt[ci]++;
        mesh.setMatrixAt(idx, this.m4); mesh.setColorAt(idx, this.col);
      }
    }
    cls.forEach((m, i) => { m.count = cnt[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    this.counts = cnt;
  }
}

/* footprints: a ring buffer of small dark marks behind each walker */
export class Footprints {
  constructor(scene, G, max = 1000) {
    this.G = G; this.max = max; this.next = 0; this.used = 0; this.walkers = new Map();
    const geo = new THREE.PlaneGeometry(0.15, 0.33); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x2e1a10, transparent: true, opacity: 0.34, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 }), max);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 2; scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1); this.up = new THREE.Vector3(0, 1, 0);
  }
  clear() { this.next = 0; this.used = 0; this.mesh.count = 0; this.walkers.clear(); }
  // returns true when a new step was set down (for the dust and the step sound)
  track(id, x, z, hdgDeg) {
    let w = this.walkers.get(id);
    if (!w) { w = { x, z, acc: 0, side: 1 }; this.walkers.set(id, w); return false; }
    const d = Math.hypot(x - w.x, z - w.z);
    w.x = x; w.z = z;
    if (d > 6) { w.acc = 0; return false; }   // a jump, not a step
    w.acc += d;
    if (w.acc < 0.62) return false;
    w.acc = 0; w.side = -w.side;
    const h = (hdgDeg * Math.PI) / 180, px = x + Math.cos(h) * 0.15 * w.side, pz = z + Math.sin(h) * 0.15 * w.side;
    this.q.setFromAxisAngle(this.up, -h);
    this.v.set(px, this.G.height(px, pz) + 0.035, pz);
    this.m4.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.next, this.m4);
    this.next = (this.next + 1) % this.max; this.used = Math.min(this.max, this.used + 1);
    this.mesh.count = this.used; this.mesh.instanceMatrix.needsUpdate = true;
    this.last = this.v;
    return true;
  }
}

function blobTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const ctx = c.getContext("2d"), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* dust: small puffs at the feet, and fine dust drifting in the air around the camera */
export class Dust {
  constructor(scene) {
    const tex = blobTexture();
    this.puffs = [];
    for (let i = 0; i < 44; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xc9a07a, transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false; scene.add(sp); this.puffs.push({ sp, age: 9, life: 1 });
    }
    this.nextPuff = 0;
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 70; pos[i * 3 + 1] = Math.random() * 14 + 0.2; pos[i * 3 + 2] = (Math.random() - 0.5) * 70; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.air = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, color: 0xf2d6b4, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.4, depthWrite: false }));
    this.air.frustumCulled = false; scene.add(this.air);
    this.started = false;
  }
  puff(x, y, z) {
    const p = this.puffs[this.nextPuff]; this.nextPuff = (this.nextPuff + 1) % this.puffs.length;
    p.age = 0; p.life = 0.9 + Math.random() * 0.5; p.vx = (Math.random() - 0.5) * 0.3; p.vz = (Math.random() - 0.5) * 0.3;
    p.sp.position.set(x, y + 0.06, z); p.sp.visible = true;
  }
  update(dt, cam, groundY) {
    for (const p of this.puffs) {
      if (!p.sp.visible) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { p.sp.visible = false; continue; }
      p.sp.position.x += p.vx * dt; p.sp.position.z += p.vz * dt; p.sp.position.y += 0.22 * dt;
      const s = 0.22 + 0.75 * k; p.sp.scale.set(s, s, s);
      p.sp.material.opacity = 0.2 * (1 - k) * Math.min(1, k * 8);
    }
    // the air dust is a box of points that follows the camera; points that fall out of the box come back in on the other side
    const a = this.air.geometry.attributes.position, arr = a.array, B = 35;
    if (!this.started) { for (let i = 0; i < arr.length; i += 3) { arr[i] += cam.x; arr[i + 1] += groundY; arr[i + 2] += cam.z; } this.started = true; }
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += 0.5 * dt; arr[i + 2] += 0.18 * dt;   // a light wind
      let dx = arr[i] - cam.x, dz = arr[i + 2] - cam.z;
      if (dx > B) arr[i] -= 2 * B * Math.ceil((dx - B) / (2 * B)); else if (dx < -B) arr[i] += 2 * B * Math.ceil((-dx - B) / (2 * B));
      if (dz > B) arr[i + 2] -= 2 * B * Math.ceil((dz - B) / (2 * B)); else if (dz < -B) arr[i + 2] += 2 * B * Math.ceil((-dz - B) / (2 * B));
      const dy = arr[i + 1] - groundY;
      if (dy > 15 || dy < 0) arr[i + 1] = groundY + 0.2 + ((dy % 14) + 14) % 14;
    }
    a.needsUpdate = true;
  }
}
