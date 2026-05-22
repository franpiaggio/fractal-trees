// Post-processing pipeline — v04 "Post Processing" edition.
//
// Uses the `postprocessing` package (pmndrs/vanruesc) instead of Three.js
// built-ins. Key advantage: all effects below share a *single* EffectPass,
// meaning they're compiled into one combined fragment shader and the GPU sees
// one full-screen quad draw per frame instead of one per effect. This leaves
// headroom for Bloom + DoF without fps regressions.
//
// Pipeline:
//   RenderPass (HDR RGBA16F target)
//     └─ EffectPass
//          ├─ DepthOfFieldEffect  — focus mid-forest, blur near/far
//          ├─ BloomEffect         — soft glow on sky through canopy
//          ├─ HueSaturationEffect — slight green/warmth boost
//          ├─ BrightnessContrast  — gentle lift + contrast
//          ├─ VignetteEffect      — darken edges for natural framing
//          └─ SMAAEffect          — high-quality temporal AA
//
// The composer is created with frameBufferType = HalfFloat so intermediate
// targets hold HDR values. Bloom then actually brightens luminance > 1 (sky
// through canopy reads as > 1 in linear HDR before tone mapping).

import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  BloomEffect,
  KernelSize,
  DepthOfFieldEffect,
  VignetteEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
} from 'postprocessing';

export function buildPipeline(renderer, scene, camera) {
  // HalfFloat intermediate buffers = HDR values survive between passes.
  // Bloom can then brighten any sample above 1.0 (real overbright).
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });

  // ── Render pass ──────────────────────────────────────────────────────────
  composer.addPass(new RenderPass(scene, camera));

  // ── Depth of Field ───────────────────────────────────────────────────────
  // focusDistance / focusRange in world-space metres.
  // Focus at ~9 m (mid-forest): sharp from ~2 m to ~23 m, then blurs.
  // resolutionScale 0.5 (default) renders the CoC pass at half res → big perf win.
  const dof = new DepthOfFieldEffect(camera, {
    focusDistance:   9,
    focusRange:      14,
    bokehScale:      3.0,
    resolutionScale: 0.5,
  });

  // ── Bloom ─────────────────────────────────────────────────────────────────
  // Luminance threshold keeps bloom on sky and sunlit leaf tips only.
  const bloom = new BloomEffect({
    intensity:          0.55,
    luminanceThreshold: 0.82,
    luminanceSmoothing: 0.35,
    kernelSize:         KernelSize.MEDIUM,
    mipmapBlur:         true,
  });

  // ── Color grade ───────────────────────────────────────────────────────────
  const hueSat = new HueSaturationEffect({ saturation: 0.10 });
  const briCon = new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.06 });

  // ── Vignette ──────────────────────────────────────────────────────────────
  const vignette = new VignetteEffect({ eskil: false, offset: 0.30, darkness: 0.50 });

  // ── SMAA ──────────────────────────────────────────────────────────────────
  const smaa = new SMAAEffect({
    preset:            SMAAPreset.HIGH,
    edgeDetectionMode: EdgeDetectionMode.COLOR,
  });

  // Single combined pass — all effects share one fragment shader invocation.
  const effectPass = new EffectPass(camera, dof, bloom, hueSat, briCon, vignette, smaa);
  composer.addPass(effectPass);

  function resize() {
    const w = renderer.domElement.clientWidth  || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;
    composer.setSize(w, h);
  }

  // Update world focus distance each frame (called from main.js).
  function setFocusTarget(worldDist) {
    dof.cocMaterial.focusDistance = Math.max(1, worldDist);
  }

  return { composer, resize, effects: { dof, bloom, hueSat, briCon, vignette, smaa }, setFocusTarget };
}
