import * as THREE from 'three';

import { buildEnvironment }   from './environment.js';
import { buildTemplates }     from './tree-templates.js';
import { buildWorld }         from './world.js';
import { buildPlayer }        from './player.js';
import { buildGrass }         from './grass.js';
import { buildPipeline }      from './postprocessing.js';
import { updateWind }         from './wind.js';

const appEl = document.getElementById('app');
const overlay = document.getElementById('overlay');
const statsEl = document.getElementById('stats');

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
// Cap DPR at 1.25. Retina (DPR 2) was burning the fragment budget; SSAO and
// Bloom have been removed entirely (see postprocessing.js), so 1.25 + SMAA
// produces a clean image without the look-up-at-the-sky crash.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 250);

const env = buildEnvironment(scene, renderer);
const templates = buildTemplates({ lowPoly: true });
const world = buildWorld(scene, templates, { worldSeed: 1337 });

// ONE big grass patch. The previous two-patch system had a visible boundary
// at the near-patch edge no matter how we faded it, because the boundary sat
// inside *clear* vision and the player was always centered on it. The fix:
// make a single large patch and put the boundary *deep inside the fog*. Fade
// happens only in the last 12 % of the radius (~31.5 m → 35.8 m) where fog
// opacity is already 73 %+ — the transition is literally invisible.
//
// Patch dimensions are matched to fog: gridSide × cellSize / 2 = 35.8 m,
// FOG_FAR = 40 m, so the outer edge is fully fogged.
const grass = buildGrass(scene, {
  gridSide:    720,
  cellSize:    0.10,          // half-size ≈ 36.0 m, density ≈ 100 / m² (≈ 2× prior)
  bladeHeight: 0.42,
  bladeWidth:  0.016,         // slightly thinner — keeps the doubled density from reading as a mat
  segments:    3,
  windStrength: 0.10,
  tipColor:    '#c8df8a',
  baseColor:   '#436d28',
  edgeFadeStart: 0.88,        // fade band: 31.7–36 m, all inside heavy fog
});

const player = buildPlayer(camera, renderer.domElement);
const post = buildPipeline(renderer, scene, camera);

overlay.addEventListener('click', () => player.controls.lock());
player.controls.addEventListener('lock',   () => overlay.classList.add('hidden'));
player.controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

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

  // Always run player.update so arrow-key look works whether or not the
  // pointer is locked. The function internally skips walk + bob when unlocked.
  player.update(dt, world);

  const counts = world.update(camera);
  visibleTrees = counts.totalVisible;
  activeTrees  = counts.totalActive;

  grass.update(camera);
  grass.setTime(t);
  env.updateSun(camera.position);
  updateWind(t);

  post.composer.render();
  frameCount++;

  if (t - lastStatTime > 0.25) {
    const fps = Math.round(frameCount / (t - lastStatTime));
    statsEl.textContent =
      `fps ${fps}  ·  trees ${visibleTrees}/${activeTrees}  ·  grass ${grass.total}  ·  ` +
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
