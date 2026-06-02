// Live tuning GUI (lil-gui) for every post-processing effect, plus the godrays,
// grass and the scene light/fog — so you can see exactly what each knob does
// and what the current build is set to. Built only in this debug version.
//
// Effects are bound through small onChange handlers rather than directly, because
// postprocessing's Effect uniforms live in a Map (effect.uniforms.get(name)).
//
// Usage (desktop): in auto mode the mouse is free — just drag. In walk mode,
// press Esc once to release the pointer lock (it does NOT return to the menu),
// tweak, then click the canvas to walk again. "Reload / Menu" resets everything.

import GUI from 'lil-gui';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { CONFIG, setForestConfig } from './chunk.js';

function setUniform(effect, name, value) {
  const u = effect?.uniforms?.get?.(name);
  if (u) u.value = value;
}

export function buildDebugGui({ post, env, grass, scene, world, preset, grControl, onReturnToMenu }) {
  const gui = new GUI({ title: `10 · ${preset.label}` });
  gui.domElement.style.zIndex = '20';
  const fx = post.effects;

  // ── Tone & Colour ──────────────────────────────────────────────────────────
  const fTone = gui.addFolder('Tone & Colour');
  const toneModes = {
    ACES_FILMIC: ToneMappingMode.ACES_FILMIC,
    AGX:         ToneMappingMode.AGX,
    NEUTRAL:     ToneMappingMode.NEUTRAL,
    REINHARD:    ToneMappingMode.REINHARD,
    REINHARD2:   ToneMappingMode.REINHARD2,
    CINEON:      ToneMappingMode.CINEON,
    LINEAR:      ToneMappingMode.LINEAR,
  };
  const toneParams = {
    mode: fx.toneMapping.mode,
    brightness: 0.02,
    contrast: 0.0,
    saturation: 0.08,
  };
  fTone.add(toneParams, 'mode', toneModes).name('tone mapping')
    .onChange((v) => { fx.toneMapping.mode = v; });
  fTone.add(toneParams, 'brightness', -0.5, 0.5, 0.005)
    .onChange((v) => setUniform(fx.brightnessContrast, 'brightness', v));
  fTone.add(toneParams, 'contrast', -0.5, 0.5, 0.005)
    .onChange((v) => setUniform(fx.brightnessContrast, 'contrast', v));
  fTone.add(toneParams, 'saturation', -1, 1, 0.01)
    .onChange((v) => setUniform(fx.hueSat, 'saturation', v));

  // ── Bloom ──────────────────────────────────────────────────────────────────
  if (fx.bloom) {
    const fBloom = gui.addFolder('Bloom');
    const p = {
      intensity: fx.bloom.intensity,
      threshold: preset.bloomThreshold ?? 0.92,
      smoothing: preset.bloomSmoothing ?? 0.15,
    };
    fBloom.add(p, 'intensity', 0, 1.5, 0.01).onChange((v) => { fx.bloom.intensity = v; });
    fBloom.add(p, 'threshold', 0, 1, 0.01).onChange((v) => { fx.bloom.luminanceMaterial.threshold = v; });
    fBloom.add(p, 'smoothing', 0, 1, 0.01).onChange((v) => { fx.bloom.luminanceMaterial.smoothing = v; });
  }

  // ── Depth of Field ───────────────────────────────────────────────────────--
  if (fx.dof) {
    const fDof = gui.addFolder('Depth of Field');
    const p = {
      focusDistance: fx.dof.cocMaterial.focusDistance ?? 9,
      focusRange:    fx.dof.cocMaterial.focusRange ?? 14,
      bokehScale:    fx.dof.bokehScale ?? 2,
    };
    fDof.add(p, 'focusDistance', 1, 40, 0.5).onChange((v) => { fx.dof.cocMaterial.focusDistance = v; });
    fDof.add(p, 'focusRange', 1, 40, 0.5).onChange((v) => { fx.dof.cocMaterial.focusRange = v; });
    fDof.add(p, 'bokehScale', 0, 5, 0.1).onChange((v) => { fx.dof.bokehScale = v; });
  }

  // ── Vignette ─────────────────────────────────────────────────────────────--
  if (fx.vignette) {
    const fVig = gui.addFolder('Vignette');
    const p = { offset: 0.30, darkness: 0.36 };
    fVig.add(p, 'offset', 0, 1, 0.01).onChange((v) => setUniform(fx.vignette, 'offset', v));
    fVig.add(p, 'darkness', 0, 1, 0.01).onChange((v) => setUniform(fx.vignette, 'darkness', v));
  }

  // ── Godrays ──────────────────────────────────────────────────────────────--
  if (post.godrays) {
    const fGod = gui.addFolder('Godrays');
    const p = {
      maxDensity:          preset.godraysMaxDensity ?? 0.5,
      distanceAttenuation: preset.godraysDistanceAtten ?? 1.0,
      color:               '#' + new THREE.Color(preset.godraysColor ?? 0xffe6bf).getHexString(),
    };
    // density is driven per-frame (directional falloff in main.js), so the slider
    // edits the shared base. setParams() repopulates EVERY unspecified param to
    // its default, so apply() must pass the FULL set — otherwise dragging one
    // slider resets colour/blur/resolution and flickers the pass to black.
    const apply = () => post.godrays.setParams({
      density:             grControl ? grControl.baseDensity : (preset.godraysDensity ?? 0.013),
      maxDensity:          p.maxDensity,
      distanceAttenuation: p.distanceAttenuation,
      color:               new THREE.Color(p.color),
      raymarchSteps:       preset.godraysRaymarchSteps ?? 60,
      blur:                preset.godraysBlur ?? true,
      gammaCorrection:     false,
    });
    if (grControl) {
      fGod.add(grControl, 'baseDensity', 0, 0.05, 0.0005).name('density');
      fGod.add(grControl, 'directional').name('fade w/ view dir');
      fGod.add(grControl, 'floor', 0, 1, 0.01).name('back-turned floor');
    }
    fGod.add(p, 'maxDensity', 0, 1, 0.01).onChange(apply);
    fGod.add(p, 'distanceAttenuation', 0, 3, 0.05).onChange(apply);
    fGod.addColor(p, 'color').onChange(apply);
  }

  // ── Grass ────────────────────────────────────────────────────────────────--
  if (grass?.uniforms) {
    const u = grass.uniforms;
    const fGrass = gui.addFolder('Grass');
    const p = {
      base: '#' + u.uBaseColor.value.getHexString(),
      tip1: '#' + u.uTipColor1.value.getHexString(),
      tip2: '#' + u.uTipColor2.value.getHexString(),
      aoFloor: u.uAoFloor.value,
      windAmp: u.uWindAmp.value,
      noiseScale: u.uNoiseScale.value,
    };
    fGrass.addColor(p, 'base').name('base colour').onChange((v) => u.uBaseColor.value.set(v));
    fGrass.addColor(p, 'tip1').name('tip colour 1').onChange((v) => u.uTipColor1.value.set(v));
    fGrass.addColor(p, 'tip2').name('tip colour 2').onChange((v) => u.uTipColor2.value.set(v));
    fGrass.add(p, 'aoFloor', 0, 1, 0.01).name('root brightness').onChange((v) => { u.uAoFloor.value = v; });
    fGrass.add(p, 'windAmp', 0, 0.3, 0.005).name('wind').onChange((v) => { u.uWindAmp.value = v; });
    fGrass.add(p, 'noiseScale', 0.0005, 0.02, 0.0005).name('colour scale').onChange((v) => { u.uNoiseScale.value = v; });
  }

  // ── Forest generation (regenerates the world live) ───────────────────────--
  if (world?.regenerate) {
    const fForest = gui.addFolder('Forest');
    const regen = () => world.regenerate();

    const sw = fForest.addFolder('Species mix (× weight)');
    const swParams = { ...CONFIG.speciesWeight };
    for (const k of Object.keys(swParams)) {
      sw.add(swParams, k, 0, 4, 0.1).name(k).onChange((v) => {
        setForestConfig({ speciesWeight: { [k]: v } });
        regen();
      });
    }

    const dn = fForest.addFolder('Density');
    const dp = { densityMin: CONFIG.densityMin, densityMax: CONFIG.densityMax, densityZone: CONFIG.densityZone };
    dn.add(dp, 'densityMin', 0, 20, 1).name('clearing (min)').onChange((v) => { setForestConfig({ densityMin: v }); regen(); });
    dn.add(dp, 'densityMax', 5, 40, 1).name('thicket (max)').onChange((v) => { setForestConfig({ densityMax: v }); regen(); });
    dn.add(dp, 'densityZone', 30, 250, 5).name('zone size (m)').onChange((v) => { setForestConfig({ densityZone: v }); regen(); });

    const gv = fForest.addFolder('Groves');
    const gp = { groveZone: CONFIG.groveZone, offSpecies: CONFIG.offSpecies, bushChance: CONFIG.bushChance };
    gv.add(gp, 'groveZone', 20, 200, 5).name('grove size (m)').onChange((v) => { setForestConfig({ groveZone: v }); regen(); });
    gv.add(gp, 'offSpecies', 0, 0.6, 0.01).name('edge mixing').onChange((v) => { setForestConfig({ offSpecies: v }); regen(); });
    gv.add(gp, 'bushChance', 0, 0.6, 0.01).name('bush amount').onChange((v) => { setForestConfig({ bushChance: v }); regen(); });

    let seedN = 1;
    fForest.add({ reseed: () => { seedN = (seedN * 1664525 + 1013904223) & 0x7fffffff; world.setSeed(seedN); } }, 'reseed')
      .name('🎲 new forest (reseed)');
    fForest.add({ rebuild: regen }, 'rebuild').name('↻ regenerate');
  }

  // ── Light & Fog ──────────────────────────────────────────────────────────--
  const fLight = gui.addFolder('Light & Fog');
  const lp = {
    sunIntensity: env.sun.intensity,
    sunColor: '#' + env.sun.color.getHexString(),
    hemiIntensity: env.hemi.intensity,
    fogNear: scene.fog?.near ?? 6,
    fogFar: scene.fog?.far ?? 30,
    fogColor: '#' + (scene.fog?.color ?? new THREE.Color()).getHexString(),
  };
  fLight.add(lp, 'sunIntensity', 0, 4, 0.05).onChange((v) => { env.sun.intensity = v; });
  fLight.addColor(lp, 'sunColor').onChange((v) => env.sun.color.set(v));
  fLight.add(lp, 'hemiIntensity', 0, 2, 0.05).onChange((v) => { env.hemi.intensity = v; });
  fLight.add(lp, 'fogNear', 0, 40, 0.5).onChange((v) => { if (scene.fog) scene.fog.near = v; });
  fLight.add(lp, 'fogFar', 5, 120, 1).onChange((v) => { if (scene.fog) scene.fog.far = v; });
  fLight.addColor(lp, 'fogColor').onChange((v) => {
    scene.fog?.color.set(v);
    if (scene.background?.set) scene.background.set(v);
  });

  // ── Reset / Menu ─────────────────────────────────────────────────────────--
  gui.add({ menu: () => onReturnToMenu?.() }, 'menu').name('↩ Reload / Menu');
  gui.add({ log: () => console.log('[10] current GUI state — read controllers above') }, 'log')
    .name('log to console');

  gui.close();   // start collapsed; click the title to open
  return gui;
}
