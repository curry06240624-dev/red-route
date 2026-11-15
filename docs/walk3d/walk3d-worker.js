/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
   Red Route add-on: walk-home worker for the 3D walk.
   It loads the planner's own routing code (router.js) unchanged and asks it for the quickest walk home to base camp
   from every cell of the terrain grid. The 3D view uses it for WALK HOME and SPARE while the crew walks freely. */
importScripts((new URL(self.location.href).searchParams.get("root") || "./") + "router.js");

const routerOnMessage = self.onmessage;   // router.js handles "init" (and its own "plan" and "field")

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== "field") { routerOnMessage(e); return; }
  try {
    const g = msg.grid, p = msg.params;
    const cost = buildCost(p);                                           // from router.js
    const c = Math.round((msg.lon - g.lon0) / g.dlon - 0.5), r = Math.round((g.lat1 - msg.lat) / g.dlat - 0.5);
    const start = snap(cost, r, c);                                      // from router.js
    if (start < 0) { self.postMessage({ type: "field", error: "Base camp is on no-go ground" }); return; }
    const dist = search(cost, start, -1, p.vFlat).dist;                  // seconds from base camp, from router.js
    const minutes = new Float32Array(dist.length);
    for (let i = 0; i < dist.length; i++) minutes[i] = dist[i] / 60;     // Infinity where the crew cannot walk
    self.postMessage({ type: "field", minutes }, [minutes.buffer]);
  } catch (err) {
    self.postMessage({ type: "field", error: String(err && err.message || err) });
  }
};
