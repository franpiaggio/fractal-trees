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

// ── Splash UI ───────────────────────────────────────────────────────────────
const overlay   = document.getElementById('overlay');
const btnFree   = document.getElementById('mode-free');
const btnAuto   = document.getElementById('mode-auto');
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

// Manual walking needs pointer-lock + a keyboard, neither of which a phone has.
// On mobile we disable "Caminar" and steer everyone to the gyro-driven auto
// mode instead.
if (MOBILE) {
  btnFree.disabled = true;
  btnFree.title = 'Necesita teclado y mouse';
  if (splashHint) splashHint.textContent = 'auto · inclina el teléfono para mirar';
}

let started = false;
function chooseMode(mode) {
  if (started) return;
  started = true;
  btnFree.disabled = btnAuto.disabled = true;
  (mode === 'free' ? btnFree : btnAuto).textContent = 'Cargando…';
  // Defer one frame so the disabled state paints before the heavy boot work.
  requestAnimationFrame(() => boot(getPreset(selectedTier), mode));
}
btnFree.addEventListener('click', () => chooseMode('free'));
btnAuto.addEventListener('click', () => chooseMode('auto'));

// ── Boot ────────────────────────────────────────────────────────────────────
function boot(preset, mode) {
  if (MOBILE) {
    backHint.innerHTML = 'tilt phone to look around · tap once to return';
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
    bladeHeight:   0.50,
    bladeWidth:    0.025,
    segments:      3,
    windBend:      0.30,
    tipColor:      '#c8df8a',
    baseColor:     '#436d28',
    edgeFadeStart: preset.grassEdgeFade,
  });

  // Sun is required by the godrays pass; pass it to the pipeline.
  const post = buildPipeline(renderer, scene, camera, preset, env.sun);
  const dust = buildDust(scene, { count: preset.dustCount });

  // Build the controller for the chosen mode. Both expose the same shape:
  // { update(dt, world), isAuto }.
  let explorer;
  if (mode === 'free') {
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
    // Esc pops out of pointer-lock → return to the menu, same as auto mode.
    explorer.controls.addEventListener('unlock', () => returnToMenu());
  } else {
    explorer = buildAutoExplorer(camera, scene);
    if (MOBILE) enableGyro();
  }

  // Surface the back hint briefly.
  backHint.classList.add('show');
  setTimeout(() => backHint.classList.remove('show'), 3500);

  // Hide the splash overlay once everything is wired.
  overlay.classList.add('hidden');

  // ── Return-to-menu ────────────────────────────────────────────────────────
  // Esc on desktop, single tap on mobile. Reloads the page so the user can
  // pick a different tier without having to re-tear-down the GL context.
  function returnToMenu() {
    location.reload();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') returnToMenu();
  });
  if (MOBILE) {
    renderer.domElement.addEventListener('touchstart', returnToMenu, { passive: true, once: true });
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

    if (post.setFocusTarget) post.setFocusTarget(explorer.isAuto ? 9 : 6);

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
    `[07] tier=${preset.label}`,
    `grass=${grass.total}`,
    `viewChunks=${preset.viewChunks}`,
    `renderDist=${preset.renderDistance}`,
    `shadow=${preset.shadowMapSize}`,
    `HDR=${preset.halfFloatHDR}`,
    `godrays=${preset.godraysEnabled ? `on(steps=${preset.godraysRaymarchSteps})` : 'off'}`,
  );
}
