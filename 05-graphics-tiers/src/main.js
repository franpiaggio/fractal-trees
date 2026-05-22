// Auto-explore-only entry. Splash shows a 3-tier graphics selector and a
// single Start button — the heavy `init()` only runs *after* the user
// picks a tier, so the boot cost is paid in line with their hardware.

import * as THREE from 'three';

import { buildEnvironment }      from './environment.js';
import { buildTemplates }        from './tree-templates.js';
import { buildWorld }            from './world.js';
import { buildAutoExplorer }     from './auto-explorer.js';
import { buildGrass }            from './grass.js';
import { buildPipeline }         from './postprocessing.js';
import { buildDust }             from './dust.js';
import { enableGyro, isMobile }  from './gyro.js';
import { updateWind }            from './wind.js';
import { getPreset, detectDefaultTier } from './quality.js';

// ── Splash UI ───────────────────────────────────────────────────────────────
const overlay   = document.getElementById('overlay');
const startBtn  = document.getElementById('start');
const tierBtns  = Array.from(document.querySelectorAll('.tier'));
const backHint  = document.getElementById('back-hint');
const statsEl   = document.getElementById('stats');
const appEl     = document.getElementById('app');

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

let started = false;
startBtn.addEventListener('click', () => {
  if (started) return;
  started = true;
  startBtn.disabled = true;
  startBtn.textContent = 'Loading…';
  // Defer one frame so the disabled state paints before the heavy boot work.
  requestAnimationFrame(() => boot(getPreset(selectedTier)));
});

// ── Boot ────────────────────────────────────────────────────────────────────
function boot(preset) {
  const MOBILE = isMobile();
  if (MOBILE) {
    backHint.innerHTML = 'tilt phone to look around · tap once to return';
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
  if (preset.shadowMapSize > 0) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  } else {
    renderer.shadowMap.enabled = false;
  }
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

  const post = buildPipeline(renderer, scene, camera, preset);
  const dust = buildDust(scene, { count: preset.dustCount });

  // Start auto-explore right away — no mode picker, this build is auto-only.
  const explorer = buildAutoExplorer(camera, scene);
  if (MOBILE) enableGyro();

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

    if (post.setFocusTarget) post.setFocusTarget(9);

    post.composer.render();
    frameCount++;

    if (t - lastStatTime > 0.5) {
      const fps = Math.round(frameCount / (t - lastStatTime));
      statsEl.textContent =
        `${preset.label}  ·  fps ${fps}  ·  trees ${counts.totalVisible}/${counts.totalActive}` +
        `  ·  calls ${renderer.info.render.calls}`;
      frameCount = 0;
      lastStatTime = t;
    }
  });

  renderer.compile(scene, camera);
  console.log(
    `[05] tier=${preset.label}`,
    `grass=${grass.total}`,
    `viewChunks=${preset.viewChunks}`,
    `shadow=${preset.shadowMapSize || 'off'}`,
    `HDR=${preset.halfFloatHDR}`,
  );
}
