/* Red Route 3D walk: the crew of two (EV1 and EV2).
   The astronaut is an AI-generated 3D model (made with Higgsfield, Meshy 6 text-to-3D; see assets/ASTRONAUT_MODEL.md),
   shown with an on-screen "AI-generated" label. Until it has loaded, or if it fails, a plain figure made by this code is used.
   The suit carries no logos, flags or mission marks; the coloured arm bands (EV1 red, EV2 blue) are added here.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const LEG = /UpLeg|Leg|Foot|Toe|Hips/;

// keep the walk on the spot: the page moves the astronaut, the clip only moves the limbs
function inPlace(clip) {
  for (const tr of clip.tracks) {
    if (!/Hips\.position$/.test(tr.name)) continue;
    const v = tr.values, x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return clip;
}

// a standing pose made from the walk clip: legs straight (the model's rest pose), arms and body at their average walk position
function makeIdle(walk, root) {
  const tracks = [];
  for (const tr of walk.tracks) {
    const dot = tr.name.lastIndexOf("."), bone = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
    const node = root.getObjectByName(bone);
    const n = tr.getValueSize(), v = tr.values, count = v.length / n;
    let val;
    if (LEG.test(bone) && node) val = node[prop].toArray();
    else {
      val = new Array(n).fill(0);
      for (let i = 0; i < count; i++) {
        let sgn = 1;
        if (prop === "quaternion") { let d = 0; for (let k = 0; k < 4; k++) d += v[i * 4 + k] * v[k]; sgn = d < 0 ? -1 : 1; }
        for (let k = 0; k < n; k++) val[k] += sgn * v[i * n + k];
      }
      const len = prop === "quaternion" ? Math.hypot(...val) || 1 : count;
      val = val.map((x) => x / len);
    }
    tracks.push(new tr.constructor(tr.name, [0], val));
  }
  return new THREE.AnimationClip("idle", -1, tracks);
}

export async function loadAstronautModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const walk = gltf.animations[0] ? inPlace(gltf.animations[0].clone()) : null;
  const idle = walk ? makeIdle(walk, scene) : null;
  return { scene, walk, idle, height: box.max.y - box.min.y, minY: box.min.y };
}

// the plain figure made by code (shown first, and kept if the AI model cannot load)
function codeFigure(bandColor) {
  const g = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color: 0xe9e6e0 }), grey = new THREE.MeshLambertMaterial({ color: 0x8b8e93 });
  const visor = new THREE.MeshLambertMaterial({ color: 0xd6a136 }), band = new THREE.MeshLambertMaterial({ color: bandColor });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(new THREE.CapsuleGeometry(0.27, 0.42, 6, 14), suit, 0, 1.12, 0);
  add(new THREE.SphereGeometry(0.2, 18, 14), suit, 0, 1.62, 0);
  add(new THREE.SphereGeometry(0.155, 18, 14), visor, 0, 1.62, 0.085);
  add(new THREE.BoxGeometry(0.46, 0.62, 0.22), suit, 0, 1.2, -0.3);
  const limb = (x, y, len, r) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), suit); m.position.y = -len / 2; m.castShadow = true; p.add(m); g.add(p); return p; };
  const parts = { lLeg: limb(-0.13, 0.82, 0.62, 0.105), rLeg: limb(0.13, 0.82, 0.62, 0.105), lArm: limb(-0.36, 1.38, 0.5, 0.08), rArm: limb(0.36, 1.38, 0.5, 0.08) };
  for (const a of [parts.lArm, parts.rArm]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.07, 14), band); b.position.y = -0.14; a.add(b); }
  for (const l of [parts.lLeg, parts.rLeg]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.3), grey); b.position.set(0, -0.78, 0.05); b.castShadow = true; l.add(b); }
  return { g, parts };
}

export class Astronaut {
  constructor(scene, bandColor) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.bandColor = bandColor;
    const f = codeFigure(bandColor);
    this.fig = f; this.root.add(f.g);
    this.mixer = null; this.phase = 0; this.w = 0; this.isAI = false;
    this.x = 0; this.z = 0; this.hdg = 0;
  }
  useModel(model) {
    const obj = cloneSkinned(model.scene);
    const s = 1.82 / model.height;
    obj.scale.multiplyScalar(s); obj.position.y = -model.minY * s;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) { o.material = o.material.clone(); o.material.side = THREE.FrontSide; o.material.metalness = 0; o.material.roughness = 0.85; } } });
    // arm bands, fixed to the upper-arm bones so they move with the arms
    const bandMat = new THREE.MeshLambertMaterial({ color: this.bandColor });
    obj.updateMatrixWorld(true);
    for (const name of ["LeftArm", "RightArm"]) {
      const bone = obj.getObjectByName(name);
      if (!bone) continue;
      const ws = new THREE.Vector3(); bone.getWorldScale(ws);
      const k = 1 / (ws.y || 1);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.082 * k, 0.082 * k, 0.07 * k, 16, 1, true), bandMat);
      band.material.side = THREE.DoubleSide;
      band.position.y = 0.13 * k; band.castShadow = false;
      bone.add(band);
    }
    this.root.remove(this.fig.g); this.fig = null;
    this.model = obj; this.root.add(obj);
    if (model.walk) {
      this.mixer = new THREE.AnimationMixer(obj);
      this.aWalk = this.mixer.clipAction(model.walk); this.aIdle = this.mixer.clipAction(model.idle);
      this.aWalk.play(); this.aIdle.play();
      this.aWalk.setEffectiveWeight(0); this.aIdle.setEffectiveWeight(1);
      this.aWalk.time = Math.random() * model.walk.duration;
    }
    this.isAI = true;
  }
  // moving: 0..1 how much the astronaut is walking; rate: how fast the legs go (1 = the clip's own pace)
  update(dt, moving, rate) {
    this.w += (moving - this.w) * Math.min(1, dt * 7);
    if (this.mixer) {
      this.aWalk.setEffectiveWeight(this.w); this.aIdle.setEffectiveWeight(1 - this.w);
      this.aWalk.timeScale = rate;
      this.mixer.update(dt);
    } else if (this.fig) {
      this.phase += dt * 5.2 * rate * (this.w > 0.05 ? 1 : 0);
      const a = Math.sin(this.phase) * 0.55 * this.w, p = this.fig.parts;
      p.lLeg.rotation.x = a; p.rLeg.rotation.x = -a; p.lArm.rotation.x = -a * 0.7; p.rArm.rotation.x = a * 0.7;
      this.fig.g.position.y = Math.abs(Math.cos(this.phase)) * 0.03 * this.w;
    }
  }
  // world position (feet on the ground) and compass heading in degrees
  place(x, y, z, hdg) {
    this.x = x; this.z = z; this.hdg = hdg;
    this.root.position.set(x, y, z);
    this.root.rotation.y = Math.PI - (hdg * Math.PI) / 180;   // the model faces +z; heading 0 = north = -z
  }
}
