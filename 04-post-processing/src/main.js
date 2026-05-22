import * as THREE from 'three';

import { buildEnvironment }   from './environment.js';
import { buildTemplates }     from './tree-templates.js';
import { buildWorld }         from './world.js';
import { buildPlayer }        from './player.js';
import { buildAutoExplorer }  from './auto-explorer.js';
import { buildGrass }         from './grass.js';
import { buildPipeline }      from './postprocessing.js';
import { buildDust }          from './dust.js';
import { updateWind }         from './wind.js';

const appEl = document.getElementById('app');
const overlay = document.getElementById('overlay');
const statsEl = document.getElementById('stats');
const btnFree = document.getElementById('mode-free');
const btnAuto = document.getElementById('mode-auto');
const autoHint = document.getElementById('auto-hint');
let autoHintTimer = null;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
// v04: cap DPR at 1.0 since DoF + Bloom already fill the fragment budget.
// The postprocessing composer renders into a HalfFloat HDR target so tone
// mapping must be disabled on the renderer itself (the composer handles it).
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
// PCFShadowMap (no Soft) cuts shadow cost ~40% — still looks good at distance.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 250);
// Menu backdrop: park the camera above the grass and tilt it so the forest
// reads as a scene, not a wall of green. Both explorers reset position/look
// when their mode is selected, so this only governs what's visible behind
// the picker overlay (and again whenever the user returns to the menu).
camera.position.set(2, 7.5, 8);
camera.lookAt(0, 3, -10);

const env = buildEnvironment(scene, renderer);
const templates = buildTemplates({ lowPoly: true });
const world = buildWorld(scene, templates, { worldSeed: 1337 });

// "Codrops fluffiest grass" target — *~5× the density of 02*.
// 1024² = 1 048 576 blades, density ≈ 494 / m² over a 23 m radius. Single
// draw call. ~6.3 M triangles. Pairs with a tight FOG_FAR so the patch
// boundary (and the narrow fade band) lives in heavy fog and never pops in.
const grass = buildGrass(scene, {
  gridSide:    1024,
  cellSize:    0.045,         // half-size ≈ 23.04 m, density ≈ 494 / m²
  bladeHeight: 0.50,
  bladeWidth:  0.025,
  segments:    3,
  // No `windStrength` here — grass now reads the shared uWindStrength
  // (Vector3) that drives the trees' leaves. `windBend` is the grass-only
  // scalar that trims the magnitude so short blades aren't blown over.
  windBend:    0.30,
  tipColor:    '#c8df8a',
  baseColor:   '#436d28',
  edgeFadeStart: 0.92,        // narrow fade band: 21.2–23 m, inside heavy fog
});

const post = buildPipeline(renderer, scene, camera);
const dust = buildDust(scene);

// `explorer` is the currently-active camera controller. It starts null — no
// controller runs while the mode-picker overlay is visible — and is built (or
// rebuilt) when the user picks a mode. Both modes expose the same shape:
// { controls, update(dt, world), dispose() }, and main.js only cares that
// .update gets called every frame.
let explorer = null;
let mode = null;             // 'free' | 'auto' | null

function disposeExplorer() {
  if (!explorer) return;
  if (explorer.controls && explorer.controls.isLocked) {
    explorer.controls.unlock();
  }
  if (explorer.debugGroup) scene.remove(explorer.debugGroup);
  explorer.dispose();
  explorer = null;
}

function startMode(nextMode) {
  if (mode === nextMode && explorer) return;
  disposeExplorer();
  mode = nextMode;
  overlay.classList.add('hidden');
  document.body.classList.toggle('auto-mode', nextMode === 'auto');

  if (nextMode === 'free') {
    explorer = buildPlayer(camera, renderer.domElement, scene);
    explorer.controls.addEventListener('unlock', onFreeUnlock);
    // Defer the lock request one frame so it isn't fighting the click that
    // hid the overlay (Chrome rejects pointer-lock from synthetic events).
    requestAnimationFrame(() => {
      try { explorer.controls.lock(); } catch (_) { /* user-gesture race */ }
    });
  } else if (nextMode === 'auto') {
    explorer = buildAutoExplorer(camera, scene);
    // Briefly surface the Esc hint, then fade — the CSS transition handles
    // the actual easing; we only flip the .show class on/off here.
    if (autoHintTimer) clearTimeout(autoHintTimer);
    autoHint.classList.add('show');
    autoHintTimer = setTimeout(() => autoHint.classList.remove('show'), 3200);
  }
}

function onFreeUnlock() {
  // Player pressed Esc out of pointer-lock. Surface the mode picker again so
  // they can switch to auto-explore without reloading.
  overlay.classList.remove('hidden');
}

function returnToMenu() {
  disposeExplorer();
  mode = null;
  overlay.classList.remove('hidden');
  document.body.classList.remove('auto-mode');
  if (autoHintTimer) { clearTimeout(autoHintTimer); autoHintTimer = null; }
  autoHint.classList.remove('show');
  // Restore the elevated menu framing — otherwise we'd see whatever low
  // viewpoint the just-exited explorer left behind.
  camera.position.set(2, 7.5, 8);
  camera.lookAt(0, 3, -10);
}

btnFree.addEventListener('click', () => startMode('free'));
btnAuto.addEventListener('click', () => startMode('auto'));

// In auto-explore there's no pointer lock to release, so Esc has to be wired
// up explicitly to bring back the menu.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'auto') returnToMenu();
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.resize();
});

const clock = new THREE.Clock();
let frameCount = 0;
let lastStatTime = 0;
let visibleTrees = 0;
let activeTrees = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  // No explorer yet (mode picker is up) → camera stays where it was, but the
  // world still streams + renders so the menu sits on top of a live scene.
  if (explorer) explorer.update(dt, world);

  const counts = world.update(camera);
  visibleTrees = counts.totalVisible;
  activeTrees  = counts.totalActive;

  grass.update(camera);
  grass.setTime(t);
  dust.update(camera, t);
  env.updateSun(camera.position);
  updateWind(t);

  // Update DoF world focus — auto mode focuses 9 m ahead, free mode 6 m.
  if (post.setFocusTarget) post.setFocusTarget(explorer?.isAuto ? 9 : 6);

  post.composer.render();
  frameCount++;

  if (t - lastStatTime > 0.25) {
    const fps = Math.round(frameCount / (t - lastStatTime));
    const modeTag = mode ? mode : '—';
    statsEl.textContent =
      `${modeTag}  ·  fps ${fps}  ·  trees ${visibleTrees}/${activeTrees}  ·  grass ${grass.total}  ·  ` +
      `pos (${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)})  ·  ` +
      `calls ${renderer.info.render.calls}`;
    frameCount = 0;
    lastStatTime = t;
  }
});

renderer.compile(scene, camera);
console.log(
  '[fps-forest] templates:', templates.length,
  'tree pools:', world.pools.length,
  `grass: ${grass.total} blades over ${grass.halfSize.toFixed(1)}m radius`
);
