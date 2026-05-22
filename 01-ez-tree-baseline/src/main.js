import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildEnvironment } from './environment.js';
import { createHeroTree } from './tree.js';
import { applyWind, updateWind } from './wind.js';
import { populateForest } from './forest.js';
import { mountGUI } from './controls.js';

const container = document.getElementById('app');
const statsEl = document.getElementById('stats');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
);
camera.position.set(12, 9, 16);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 4, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 6;
controls.maxDistance = 80;

const env = buildEnvironment(scene);

const hero = await createHeroTree();
scene.add(hero.group);
applyWind(hero.leafMaterial);
applyWind(hero.branchMaterial);

const forest = populateForest(scene, hero, {
  count: 80,
  innerRadius: 8,
  outerRadius: 45,
});
for (const mat of forest.materials) applyWind(mat);

mountGUI({ hero, forest, env, scene, renderer });

console.log('initial render.calls →', renderer.info.render.calls);

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let frame = 0;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  updateWind(t);
  controls.update();
  renderer.render(scene, camera);

  if (++frame % 30 === 0 && statsEl) {
    statsEl.textContent = `draw calls: ${renderer.info.render.calls} · triangles: ${renderer.info.render.triangles.toLocaleString()}`;
  }
});
