// Splash shows a 3-tier graphics selector plus a mode choice — "Caminar"
// (manual first-person walk, WASD + mouse) or "Auto-explorar" (the hands-off
// drift). v05/v06 had dropped manual walking; v07 brings it back, the way the
// early versions offered both. The heavy boot only runs *after* a mode is
// picked, so the cost is paid in line with the chosen tier.

import * as THREE from 'three';

import { buildEnvironment }      from './environment.js';
import { buildTemplates }        from './tree-templates.js';
import { buildWorld }            from './world.js';
import { buildAutoExplorer }     from './auto-explorer.js';
import { buildPlayer }           from './player.js';
import { buildGrass }            from './grass.js';
import { buildPipeline }         from './postprocessing.js';
import { buildDust }             from './dust.js';
import { enableGyro, isMobile }  from './gyro.js';
import { updateWind }            from './wind.js';
import { getPreset, detectDefaultTier } from './quality.js';
import { buildDebugGui }         from './debug-gui.js';
import { buildInspector }        from './inspector.js';
import { buildMobilePlayer, buildAutoMobileHud } from './mobile-controls.js';

// ── Splash UI ───────────────────────────────────────────────────────────────
const overlay   = document.getElementById('overlay');
const btnFree   = document.getElementById('mode-free');
const btnAuto   = document.getElementById('mode-auto');
const btnInspect = document.getElementById('mode-inspect');
const tierBtns  = Array.from(document.querySelectorAll('.tier'));
const backHint  = document.getElementById('back-hint');
const splashHint = document.getElementById('splash-hint');
const statsEl   = document.getElementById('stats');
const appEl     = document.getElementById('app');

const MOBILE = isMobile();

let selectedTier = detectDefaultTier();
syncTierUI();

function syncTierUI() {
  for (const btn of tierBtns) {
    btn.classList.toggle('active', btn.dataset.tier === selectedTier);
  }
}
for (const btn of tierBtns) {
  btn.addEventListener('click', () => {
    selectedTier = btn.dataset.tier;
    syncTierUI();
  });
}

// On mobile "Caminar" is driven by on-screen touch controls (joystick + drag
// look + toggleable gyro), so it's available there too.
if (MOBILE && splashHint) {
  splashHint.textContent = 'caminar · joystick + arrastrá para mirar';
}

let started = false;
function chooseMode(mode) {
  if (started) return;
  started = true;
  btnFree.disabled = btnAuto.disabled = true;
  if (btnInspect) btnInspect.disabled = true;
  const clicked = mode === 'free' ? btnFree : mode === 'inspect' ? btnInspect : btnAuto;
  if (clicked) clicked.textContent = 'Cargando…';
  // Defer one frame so the disabled state paints before the heavy boot work.
  requestAnimationFrame(() => boot(getPreset(selectedTier), mode));
}
btnFree.addEventListener('click', () => chooseMode('free'));
btnAuto.addEventListener('click', () => chooseMode('auto'));
if (btnInspect) btnInspect.addEventListener('click', () => chooseMode('inspect'));

// ── Boot ────────────────────────────────────────────────────────────────────
function boot(preset, mode) {
  if (MOBILE) {
    backHint.innerHTML = mode === 'free'
      ? 'joystick to move · drag to look · ✕ Salir to exit'
      : 'tilt phone to look · 🧭 toggles gyro · ✕ Salir to exit';
  } else if (mode === 'free') {
    backHint.innerHTML = 'WASD move · Shift run · arrows look · <kbd>Esc</kbd> for menu';
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // NOTE: do NOT set toneMapping here — buildPipeline sets NoToneMapping and
  // adds a ToneMappingEffect inside the composer, so bloom can act on real HDR.
  // In v06 shadows are ALWAYS on (godrays raymarch the shadow map). Only the
  // map size is tier-driven (set in environment.js).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  appEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    72, window.innerWidth / window.innerHeight, 0.05, 250
  );
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 1.7, -1);

  // ── Inspector mode: one centred tree + orbit camera, no world/grass/post ──
  if (mode === 'inspect') {
    overlay.classList.add('hidden');
    buildInspector(renderer, scene, camera, preset, { onReturnToMenu: () => location.reload() });
    return;
  }

  const env       = buildEnvironment(scene, renderer, preset);
  const templates = buildTemplates({ lowPoly: true, leavesCountMult: preset.leavesCountMult });
  const world     = buildWorld(scene, templates, {
    worldSeed:      1337,
    viewChunks:     preset.viewChunks,
    treeCastShadow: preset.treeCastShadow,
    renderDistance: preset.renderDistance,
  });

  const grass = buildGrass(scene, {
    gridSide:      preset.grassGridSide,
    cellSize:      preset.grassCellSize,
    clumpHeight:   0.55,
    clumpWidth:    0.55,
    planes:        preset.grassPlanes,
    segments:      4,
    windAmp:       0.08,
    baseColor:     '#2f3f1e',
    tipColor1:     '#a6cf7e',
    tipColor2:     '#46662b',
    edgeFadeStart: preset.grassEdgeFade,
  });

  // Sun is required by the godrays pass; pass it to the pipeline.
  const post = buildPipeline(renderer, scene, camera, preset, env.sun);
  const dust = buildDust(scene, { count: preset.dustCount });

  // three-good-godrays has NO phase function — it accumulates lit air along the
  // view ray regardless of where the sun is, so rays read the same with your
  // back to the sun. We re-introduce the expected directional falloff by fading
  // `density` toward 0 as the camera looks away from the sun. `grControl` is the
  // shared base the GUI edits; `directional` toggles the falloff.
  const grControl = {
    baseDensity: preset.godraysDensity ?? 0.013,
    directional: true,
    floor: 0.12,        // residual rays even facing away (atmospheric haze)
  };
  const _camFwd = new THREE.Vector3();
  // Set the density UNIFORM directly each frame. NOT setParams() — that repopulates
  // every other param to its default (white colour, blur, resolutionScale → setSize),
  // which recreated the render targets every frame and flickered to black.
  const grDensityU = post.godrays?.illumPass?.material?.uniforms?.density ?? null;

  // Build the controller for the chosen mode. Both expose the same shape:
  // { update(dt, world), isAuto }.
  let explorer;
  let mobileHud = null;
  if (mode === 'free' && MOBILE) {
    // Touch walk: joystick + drag look + toggleable gyro + its own Exit button.
    explorer = buildMobilePlayer(camera, scene, { onExit: () => returnToMenu() });
  } else if (mode === 'free') {
    explorer = buildPlayer(camera, renderer.domElement, scene);
    // Defer the lock request one frame so it isn't fighting the click that hid
    // the overlay (Chrome rejects pointer-lock from a synthetic-looking event).
    requestAnimationFrame(() => {
      try { explorer.controls.lock(); } catch (_) { /* user-gesture race */ }
    });
    // Re-acquire lock on click (e.g. after the first attempt lost the race).
    renderer.domElement.addEventListener('click', () => {
      if (!explorer.controls.isLocked) {
        try { explorer.controls.lock(); } catch (_) { /* ignore */ }
      }
    });
    // Esc pops out of pointer-lock → frees the mouse so the GUI is usable. It
    // does NOT return to the menu (that's the GUI's "Reload / Menu" button), so
    // you can tweak post-processing mid-walk and click the canvas to resume.
  } else {
    explorer = buildAutoExplorer(camera, scene);
    if (MOBILE) {
      enableGyro();
      // Exit button + gyro toggle for the hands-off auto mode.
      mobileHud = buildAutoMobileHud({ onExit: () => returnToMenu(), gyroOn: true });
    }
  }

  // Surface the back hint briefly.
  backHint.classList.add('show');
  setTimeout(() => backHint.classList.remove('show'), 3500);

  // Hide the splash overlay once everything is wired.
  overlay.classList.add('hidden');

  // ── Return-to-menu ────────────────────────────────────────────────────────
  // Reloads the page so the user can pick a different tier/mode. On mobile the
  // ONLY way back is the on-screen "✕ Salir" button (the old tap-anywhere
  // handler hijacked the first touch and bounced you to the menu). On desktop,
  // Esc returns from auto mode (walk mode keeps Esc for the GUI).
  function returnToMenu() {
    location.reload();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && mode === 'auto') returnToMenu();
  });

  // ── Live tuning GUI (desktop debug build) ─────────────────────────────────
  // Set DoF focus once here so the GUI can own it (no per-frame override).
  if (post.setFocusTarget) post.setFocusTarget(explorer.isAuto ? 9 : 6);
  if (!MOBILE) {
    buildDebugGui({ post, env, grass, scene, preset, grControl, onReturnToMenu: returnToMenu });
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.resize();
  });

  // ── Frame loop ────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let frameCount = 0;
  let lastStatTime = 0;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    explorer.update(dt, world);

    const counts = world.update(camera);
    grass.update(camera);
    grass.setTime(t);
    dust.update(camera, t);
    env.updateSun(camera.position);
    updateWind(t);

    // Directional godray falloff: fade rays out as the camera turns away from
    // the sun, so they no longer read the same with your back to it.
    if (grDensityU) {
      let factor = 1;
      if (grControl.directional) {
        camera.getWorldDirection(_camFwd);
        const facing = _camFwd.dot(env.sunDir);                 // -1 away … +1 toward
        const f = THREE.MathUtils.smoothstep(facing, -0.15, 0.55);
        factor = grControl.floor + (1 - grControl.floor) * f;
      }
      grDensityU.value = grControl.baseDensity * factor;
    }

    post.composer.render();
    frameCount++;

    if (t - lastStatTime > 0.5) {
      const fps = Math.round(frameCount / (t - lastStatTime));
      // trees drawn / in-fog-range / total-loaded — the gap between the last
      // two is what v06 was wastefully rendering.
      statsEl.textContent =
        `${mode}  ·  ${preset.label}  ·  fps ${fps}  ·  trees ${counts.totalVisible}/${counts.totalInRange}/${counts.totalActive}` +
        `  ·  calls ${renderer.info.render.calls}`;
      frameCount = 0;
      lastStatTime = t;
    }
  });

  renderer.compile(scene, camera);
  console.log(
    `[08] tier=${preset.label}`,
    `grass=${grass.total}`,
    `viewChunks=${preset.viewChunks}`,
    `renderDist=${preset.renderDistance}`,
    `shadow=${preset.shadowMapSize}`,
    `HDR=${preset.halfFloatHDR}`,
    `godrays=${preset.godraysEnabled ? `on(steps=${preset.godraysRaymarchSteps})` : 'off'}`,
  );
}
