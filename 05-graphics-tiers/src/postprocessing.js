// Post-processing pipeline — tier-aware, with proper HDR tone-mapping.
//
// The big fix vs v04: tone mapping must happen INSIDE the composer (as a
// ToneMappingEffect), not on the renderer. When the composer renders to a
// HalfFloatType target, renderer.toneMapping = ACESFilmic gets applied by the
// RenderPass before bloom sees the image — Bloom then can never find values
// > 1.0 because they've already been crushed. Setting `NoToneMapping` on the
// renderer and adding `ToneMappingEffect` after Bloom means Bloom operates
// on real HDR and the tone-map runs once at the very end.
//
// Tier-driven knobs:
//   • halfFloatHDR=false → UnsignedByte composer (low tier, no real HDR)
//   • dofEnabled / bloomEnabled / chromAbEnabled / grainEnabled gate effects
//   • bloomKernel + bloomIntensity + dofBokehScale + smaaPreset come from the
//     preset
//
// Why ChromaticAberration sits in its own pass: it carries a vertex shader
// that the merge step can't combine with the main fragment-only effects.

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

export function buildPipeline(renderer, scene, camera, preset) {
  // Required for the in-composer tone-mapping to work. The renderer's tone
  // mapping must be off so the RenderPass writes raw HDR to the target.
  renderer.toneMapping = THREE.NoToneMapping;

  const composer = new EffectComposer(renderer, {
    frameBufferType: preset.halfFloatHDR ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });

  composer.addPass(new RenderPass(scene, camera));

  const effects = [];

  // Bloom first — operates on raw HDR.
  if (preset.bloomEnabled) {
    effects.push(new BloomEffect({
      intensity:          preset.bloomIntensity ?? 0.5,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.35,
      kernelSize:         KERNEL_LOOKUP[preset.bloomKernel] ?? KernelSize.MEDIUM,
      mipmapBlur:         true,
    }));
  }

  // Depth of Field — also needs HDR input ideally.
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

  // Tone-mapping AFTER bloom + DoF — converts the HDR-accumulated signal to
  // LDR exactly once. Only matters when halfFloatHDR is on; on UnsignedByte
  // composers the buffer is already LDR so the operator just acts as a final
  // shaper.
  effects.push(new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
  }));

  // Color grade — sits in LDR space after tone-mapping.
  effects.push(new HueSaturationEffect({ saturation: 0.10 }));
  effects.push(new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.06 }));

  // Vignette — final framing.
  effects.push(new VignetteEffect({
    eskil:    false,
    offset:   preset.vignetteOffset   ?? 0.30,
    darkness: preset.vignetteDarkness ?? 0.50,
  }));

  // Film grain — cinematic grit, very subtle.
  if (preset.grainEnabled) {
    const grain = new NoiseEffect({ blendFunction: BlendFunction.SCREEN });
    grain.blendMode.opacity.value = preset.grainOpacity ?? 0.04;
    effects.push(grain);
  }

  // SMAA — last in the mergeable chain so it samples post-graded pixels.
  effects.push(new SMAAEffect({
    preset:            SMAA_LOOKUP[preset.smaaPreset] ?? SMAAPreset.MEDIUM,
    edgeDetectionMode: EdgeDetectionMode.COLOR,
  }));

  const mainPass = new EffectPass(camera, ...effects);
  composer.addPass(mainPass);

  // ChromaticAberration needs its own pass (vertex shader, won't merge).
  let chromAb = null;
  if (preset.chromAbEnabled) {
    chromAb = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(
        preset.chromAbOffset?.[0] ?? 0.0006,
        preset.chromAbOffset?.[1] ?? 0.0003,
      ),
      radialModulation: true,
      modulationOffset: 0.25,
    });
    composer.addPass(new EffectPass(camera, chromAb));
  }

  function resize() {
    const w = renderer.domElement.clientWidth  || window.innerWidth;
    const h = renderer.domElement.clientHeight || window.innerHeight;
    composer.setSize(w, h);
  }

  function setFocusTarget(worldDist) {
    if (dof) dof.cocMaterial.focusDistance = Math.max(1, worldDist);
  }

  return { composer, resize, setFocusTarget };
}
