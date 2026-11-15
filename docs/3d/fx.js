/* Red Route 3D walk: the film look.
   The picture is drawn in high range, then gets a soft glow on the brightest parts (the sun, sunlit suits), darker
   corners, a little film grain and filmic tone mapping. It changes how the picture looks, never a number.
   Uses three.js post-processing (EffectComposer, UnrealBloomPass, OutputPass; MIT, vendored).
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const Grade = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.5 }, uGrain: { value: 0.03 },
    uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uAspect: { value: 1.78 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uSunVis, uAspect; uniform vec2 uSun;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (uSunVis > 0.003) {   // the lens looking toward the sun: a veil, a wide streak, a few faint ghosts
        vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
        vec3 fl = vec3(1.0, 0.86, 0.70) * exp(-length(d) * 3.4) * 0.20;
        fl += vec3(0.55, 0.72, 1.0) * exp(-abs(d.y) * 110.0) * exp(-abs(d.x) * 1.5) * 0.50;
        fl += vec3(1.0, 0.92, 0.82) * exp(-abs(d.y) * 26.0) * exp(-abs(d.x) * 5.0) * 0.16;
        vec2 ax = vec2(0.5) - uSun;
        for (int i = 1; i <= 4; i++) {
          float t = float(i) * 0.48;
          float r = length((vUv - (uSun + ax * t)) * vec2(uAspect, 1.0));
          float sz = 0.035 + 0.022 * float(i);
          fl += vec3(0.55 + 0.1 * float(i), 0.7, 1.0 - 0.12 * float(i)) * smoothstep(sz, sz * 0.72, r) * 0.022;
        }
        c.rgb += fl * uSunVis;
      }
      vec2 q = (vUv - 0.5) * vec2(1.0, 0.86);
      c.rgb *= mix(1.0 - uVig, 1.0, smoothstep(0.80, 0.22, length(q)));          // darker corners
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb * vec3(0.95, 0.99, 1.06), c.rgb * vec3(1.05, 1.0, 0.95), smoothstep(0.03, 0.55, l));   // cool shadows, warm lights
      float n = fract(sin(dot(vUv * vec2(1387.13, 947.71) + fract(uTime) * 61.7, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * uGrain * (0.35 + l);                                   // film grain
      gl_FragColor = c;
    }`,
};

export function makeFx(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.27, 0.72, 1.05);
  composer.addPass(bloom);
  const grade = new ShaderPass(Grade);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return {
    composer, bloom, grade,
    setSize(w, h, pixelRatio) { composer.setPixelRatio(pixelRatio); composer.setSize(w, h); },
    render(dt) { grade.uniforms.uTime.value += dt; composer.render(dt); },
  };
}
