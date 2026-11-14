/* Red Route routing worker.
   Least-time walking paths on the terrain grid exported by tools/build_layers.py.
   Same model as the Python build: Tobler-style speed on slope, no-go above the slope limit,
   rough ground slower, edge cost = distance x mean cell cost (like scikit-image MCP_Geometric). */
let G = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    G = Object.assign({}, msg.grid, {
      slope: new Uint8Array(msg.slope), rough: new Uint8Array(msg.rough), dem: new Int16Array(msg.dem),
    });
    self.postMessage({ type: "ready" });
  } else if (msg.type === "plan") {
    const t0 = performance.now();
    const res = plan(msg.params, msg.stops, msg.order);
    res.ms = Math.round(performance.now() - t0);
    self.postMessage(Object.assign({ type: "plan", id: msg.id }, res));
  }
};

const DEG = Math.PI / 180;

function buildCost(p) {
  const n = G.w * G.h, cost = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s8 = G.slope[i];
    if (s8 === 255) { cost[i] = Infinity; continue; }
    const s = s8 * G.slope_scale;
    if (s > p.maxSlope) { cost[i] = Infinity; continue; }
    let c = 1 / (p.vFlat * Math.exp(-3.5 * Math.tan(s * DEG)));
    if (G.rough[i] * G.rough_scale > p.roughM) c *= p.roughPenalty;
    cost[i] = c;
  }
  return cost;
}

class Heap {
  constructor(cap) { this.i = new Int32Array(cap); this.k = new Float64Array(cap); this.n = 0; }
  push(i, k) {
    if (this.n === this.i.length) {
      const ni = new Int32Array(this.n * 2), nk = new Float64Array(this.n * 2);
      ni.set(this.i); nk.set(this.k); this.i = ni; this.k = nk;
    }
    let j = this.n++;
    while (j > 0) {
      const p = (j - 1) >> 1;
      if (this.k[p] <= k) break;
      this.i[j] = this.i[p]; this.k[j] = this.k[p]; j = p;
    }
    this.i[j] = i; this.k[j] = k;
  }
  pop() {
    const top = this.i[0], topK = this.k[0];
    const n = --this.n, i = this.i[n], k = this.k[n];
    let j = 0;
    for (;;) {
      let c = 2 * j + 1;
      if (c >= n) break;
      if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= k) break;
      this.i[j] = this.i[c]; this.k[j] = this.k[c]; j = c;
    }
    this.i[j] = i; this.k[j] = k;
    this.topK = topK;
    return top;
  }
}

function neighbours() {
  const d = Math.hypot(G.gx, G.gy);
  return [[-1, 0, G.gy], [1, 0, G.gy], [0, -1, G.gx], [0, 1, G.gx], [-1, -1, d], [-1, 1, d], [1, -1, d], [1, 1, d]];
}

/* Dijkstra (target < 0) or A* to a target cell. Returns { dist, prev }. */
function search(cost, start, target, vFlat) {
  const W = G.w, H = G.h, n = W * H;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = target >= 0 ? new Int32Array(n).fill(-1) : null;
  const heap = new Heap(1 << 16);
  const nb = neighbours();
  const tr = target >= 0 ? Math.floor(target / W) : 0, tc = target >= 0 ? target % W : 0;
  const h = (i) => (target < 0 ? 0 : Math.hypot((Math.floor(i / W) - tr) * G.gy, ((i % W) - tc) * G.gx) / vFlat);
  dist[start] = 0;
  heap.push(start, h(start));
  while (heap.n) {
    const u = heap.pop();
    const du = dist[u];
    if (heap.topK - h(u) > du + 1e-9) continue;   // stale entry
    if (u === target) break;
    const r = Math.floor(u / W), c = u % W, cu = cost[u];
    for (const [dr, dc, len] of nb) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
      const v = rr * W + cc, cv = cost[v];
      if (cv === Infinity) continue;
      const nd = du + len * 0.5 * (cu + cv);
      if (nd < dist[v]) {
        dist[v] = nd;
        if (prev) prev[v] = u;
        heap.push(v, nd + h(v));
      }
    }
  }
  return { dist, prev };
}

function snap(cost, r, c) {
  const W = G.w, H = G.h;
  r = Math.max(0, Math.min(H - 1, r)); c = Math.max(0, Math.min(W - 1, c));
  if (cost[r * W + c] !== Infinity) return r * W + c;
  for (let rad = 1; rad <= 25; rad++) {
    let best = -1, bd = Infinity;
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
      const i = rr * W + cc;
      if (cost[i] !== Infinity && dr * dr + dc * dc < bd) { bd = dr * dr + dc * dc; best = i; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const zOf = (i) => G.dem[i] * G.z_scale + G.z_offset;
const lonlat = (i) => [G.lon0 + ((i % G.w) + 0.5) * G.dlon, G.lat1 - (Math.floor(i / G.w) + 0.5) * G.dlat];

function plan(p, stops, order) {
  const cost = buildCost(p);
  const W = G.w;
  const cell = {};
  for (const s of stops) {
    const c = Math.round((s.lon - G.lon0) / G.dlon - 0.5), r = Math.round((G.lat1 - s.lat) / G.dlat - 0.5);
    cell[s.id] = snap(cost, r, c);
    if (cell[s.id] < 0) return { error: `${s.name} is on ground steeper than ${p.maxSlope}°` };
  }
  const back = search(cost, cell[order[0]], -1, p.vFlat).dist;   // walk-back field from base camp

  const legs = [], profile = [];
  let dTot = 0, tStart = 0;
  const dwell = Object.fromEntries(stops.map((s) => [s.id, s.dwell_min || 0]));
  for (let k = 0; k < order.length - 1; k++) {
    const a = cell[order[k]], b = cell[order[k + 1]];
    const { dist, prev } = search(cost, a, b, p.vFlat);
    if (!isFinite(dist[b])) return { error: `No safe path from ${order[k]} to ${order[k + 1]} with these rules` };
    const path = [];
    for (let v = b; v !== -1; v = prev[v]) { path.push(v); if (v === a) break; }
    path.reverse();
    let d = 0, gain = 0, loss = 0, maxS = 0;
    const coords = [];
    for (let j = 0; j < path.length; j++) {
      const v = path[j], z = zOf(v), s = G.slope[v] * G.slope_scale;
      if (j) {
        const u = path[j - 1], dz = z - zOf(u);
        const dr = Math.floor(v / W) - Math.floor(u / W), dc = (v % W) - (u % W);
        d += Math.sqrt((dc * G.gx) ** 2 + (dr * G.gy) ** 2 + dz * dz);
        if (dz > 0) gain += dz; else loss -= dz;
      }
      maxS = Math.max(maxS, s);
      coords.push(lonlat(v));
      profile.push({ d: Math.round((dTot + d) * 10) / 10, z: Math.round(z * 10) / 10, s: Math.round(s * 10) / 10, leg: k,
        t: Math.round((tStart + dist[v] / 60) * 10) / 10, back: Math.round((back[v] / 60) * 10) / 10 });
    }
    const walkMin = dist[b] / 60;
    legs.push({ frm: order[k], to: order[k + 1], dist_m: Math.round(d), walk_min: Math.round(walkMin * 10) / 10,
      gain_m: Math.round(gain), loss_m: Math.round(loss), max_slope: Math.round(maxS * 10) / 10, coords });
    dTot += d;
    tStart += walkMin + dwell[order[k + 1]];
  }
  const budget = p.evaH * 60 * (1 - p.reserve);
  let worst = { margin_min: 1e9 };
  for (const q of profile) {
    const m = budget - (q.t + q.back);
    if (m < worst.margin_min) worst = { margin_min: Math.round(m * 10) / 10, t: q.t, back: q.back };
  }
  const walkMin = legs.reduce((s, l) => s + l.walk_min, 0);
  const dwellMin = order.slice(1, -1).reduce((s, id) => s + dwell[id], 0);
  const step = Math.max(1, Math.floor(profile.length / 700));
  return {
    legs,
    stopCells: Object.fromEntries(Object.entries(cell).map(([id, i]) => [id, { lonlat: lonlat(i), z: Math.round(zOf(i) * 10) / 10 }])),
    totals: { dist_km: Math.round(dTot / 10) / 100, walk_h: Math.round((walkMin / 60) * 100) / 100, dwell_min: dwellMin,
      eva_h: Math.round(((walkMin + dwellMin) / 60) * 100) / 100,
      gain_m: legs.reduce((s, l) => s + l.gain_m, 0), loss_m: legs.reduce((s, l) => s + l.loss_m, 0),
      max_slope: Math.max(...legs.map((l) => l.max_slope)) },
    walkback: { budget_min: Math.round(budget), worst, eva_limit_h: p.evaH, reserve: p.reserve },
    profile: profile.filter((_, i) => i % step === 0 || i === profile.length - 1),
  };
}
