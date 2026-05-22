// Post-processing pipeline — kept *deliberately light* after a lag-on-look-up
// crash. The most expensive passes here are SSAO and UnrealBloom; both
// operate on full-screen render targets that scale with DPR² and chew through
// fragment shading on the wide sky / dense canopy view. They are commented out
// (not deleted) so they can be reintroduced later under a quality toggle.
//
//   RenderPass  →  Vignette+grade  →  SMAA  →  OutputPass
//
// Vignette + light color grade gives the "framed view" feel; SMAA cleans the
// edges (renderer.antialias is off). Tone mapping is applied at OutputPass.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass }     from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass }       from 'three/examples/jsm/postprocessing/SMAAPass.js';

const VignetteShader = {
  uniforms: {
    tDiffuse:     { value: null },
    uOffset:      { value: 0.80 },
    uDarkness:    { value: 0.28 },     // mild — earlier 0.85 was crushing
    uSaturation:  { value: 1.04 },
    uContrast:    { value: 1.02 },
    uTemperature: { value: 0.025 },
    uLift:        { value: 0.05 },     // pull shadows up
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uOffset, uDarkness, uSaturation, uContrast, uTemperature, uLift;

    vec3 saturate(vec3 c, float s){
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      return mix(vec3(l), c, s);
    }

    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb;

      col = col + uLift * (1.0 - col);                // lift shadows
      col = (col - 0.5) * uContrast + 0.5;
      col = saturate(col, uSaturation);
      col += vec3(uTemperature, uTemperature * 0.4, -uTemperature * 0.6);

      vec2 uv = vUv - 0.5;
      float d = dot(uv, uv) * uOffset;
      float v = smoothstep(0.0, 0.85, d);
      col *= mix(1.0, 1.0 - uDarkness, v);

      gl_FragColor = vec4(col, src.a);
    }
  `,
};

export function buildPipeline(renderer, scene, camera) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const dpr = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  const vignette = new ShaderPass(VignetteShader);
  composer.addPass(vignette);

  const smaa = new SMAAPass(Math.floor(size.x * dpr), Math.floor(size.y * dpr));
  composer.addPass(smaa);

  composer.addPass(new OutputPass());

  function resize() {
    const s = new THREE.Vector2();
    renderer.getSize(s);
    const pr = renderer.getPixelRatio();
    composer.setPixelRatio(pr);
    composer.setSize(s.x, s.y);
    smaa.setSize(Math.floor(s.x * pr), Math.floor(s.y * pr));
  }

  return { composer, resize, passes: { vignette, smaa } };
}
