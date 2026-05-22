// Post-processing pipeline for v06 — same HDR / in-composer tone-mapping
// shape as v05, with a GodraysPass slotted in between the RenderPass and the
// main effect chain.
//
// Order rationale:
//
//   1. RenderPass        →  raw HDR scene
//   2. GodraysPass       →  reads HDR + shadow map, adds volumetric rays in
//                           linear space, output still HDR. gammaCorrection is
//                           disabled because the pipeline's ToneMappingEffect
//                           later does the linear→display conversion exactly
//                           once; turning godrays gamma on would double-encode.
//   3. Main EffectPass   →  Bloom (picks up bright ray peaks → glow), DoF
//                           (softens distant rays for depth), ToneMappingEffect
//                           (ACES_FILMIC), HueSat, Brightness/Contrast,
//                           Vignette, SMAA.
//   4. ChromaticAberration — own pass (vertex shader, won't merge). Disabled
//                            in all v06 tiers.

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
  NoiseEffect,
  ChromaticAberrationEffect,
  ToneMappingEffect,
  ToneMappingMode,
  BlendFunction,
} from 'postprocessing';
import { GodraysPass } from 'three-good-godrays';

const SMAA_LOOKUP = {
  LOW:    SMAAPreset.LOW,
  MEDIUM: SMAAPreset.MEDIUM,
  HIGH:   SMAAPreset.HIGH,
  ULTRA:  SMAAPreset.ULTRA,
};
const KERNEL_LOOKUP = {
  VERY_SMALL: KernelSize.VERY_SMALL,
  SMALL:      KernelSize.SMALL,
  MEDIUM:     KernelSize.MEDIUM,
  LARGE:      KernelSize.LARGE,
  HUGE:       KernelSize.HUGE,
};

export function buildPipeline(renderer, scene, camera, preset, light) {
  renderer.toneMapping = THREE.NoToneMapping;

  const composer = new EffectComposer(renderer, {
    frameBufferType: preset.halfFloatHDR ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });

  composer.addPass(new RenderPass(scene, camera));

  // ── Godrays ──────────────────────────────────────────────────────────────
  let godrays = null;
  if (preset.godraysEnabled && light && light.castShadow) {
    godrays = new GodraysPass(light, camera, {
      color:               new THREE.Color(preset.godraysColor ?? 0xffeec6),
      density:             preset.godraysDensity        ?? 1 / 128,
      maxDensity:          preset.godraysMaxDensity     ?? 0.4,
      edgeStrength:        preset.godraysEdgeStrength   ?? 2,
      edgeRadius:          preset.godraysEdgeRadius     ?? 2,
      distanceAttenuation: preset.godraysDistanceAtten  ?? 2,
      raymarchSteps:       preset.godraysRaymarchSteps  ?? 60,
      blur:                preset.godraysBlur           ?? true,
      // Stay in linear HDR; ToneMappingEffect does the single final encoding.
      gammaCorrection:     false,
    });
    composer.addPass(godrays);
  }

  // ── Main effect chain (mergeable into one EffectPass) ────────────────────
  const effects = [];

  if (preset.bloomEnabled) {
    effects.push(new BloomEffect({
      intensity:          preset.bloomIntensity ?? 0.2,
      luminanceThreshold: preset.bloomThreshold ?? 0.92,
      luminanceSmoothing: preset.bloomSmoothing ?? 0.15,
      kernelSize:         KERNEL_LOOKUP[preset.bloomKernel] ?? KernelSize.MEDIUM,
      mipmapBlur:         true,
    }));
  }

  let dof = null;
  if (preset.dofEnabled) {
    dof = new DepthOfFieldEffect(camera, {
      focusDistance:   9,
      focusRange:      14,
      bokehScale:      preset.dofBokehScale ?? 2.0,
      resolutionScale: preset.dofResScale   ?? 0.5,
    });
    effects.push(dof);
  }

  effects.push(new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
  }));

  effects.push(new HueSaturationEffect({ saturation: 0.10 }));
  effects.push(new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.06 }));

  effects.push(new VignetteEffect({
    eskil:    false,
    offset:   preset.vignetteOffset   ?? 0.30,
    darkness: preset.vignetteDarkness ?? 0.50,
  }));

  if (preset.grainEnabled) {
    const grain = new NoiseEffect({ blendFunction: BlendFunction.SCREEN });
    grain.blendMode.opacity.value = preset.grainOpacity ?? 0.04;
    effects.push(grain);
  }

  effects.push(new SMAAEffect({
    preset:            SMAA_LOOKUP[preset.smaaPreset] ?? SMAAPreset.MEDIUM,
    edgeDetectionMode: EdgeDetectionMode.COLOR,
  }));

  composer.addPass(new EffectPass(camera, ...effects));

  if (preset.chromAbEnabled) {
    composer.addPass(new EffectPass(camera, new ChromaticAberrationEffect({
      offset: new THREE.Vector2(
        preset.chromAbOffset?.[0] ?? 0.0006,
        preset.chromAbOffset?.[1] ?? 0.0003,
      ),
      radialModulation: true,
      modulationOffset: 0.25,
    })));
  }

  function resize() {
    const w = renderer.domElement.clientWidth  || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;
    composer.setSize(w, h);
  }

  function setFocusTarget(worldDist) {
    if (dof) dof.cocMaterial.focusDistance = Math.max(1, worldDist);
  }

  return { composer, resize, setFocusTarget, godrays };
}
