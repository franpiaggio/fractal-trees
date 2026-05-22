// Chunk-streamed, FOV-culled forest. The world is an infinite grid of 32-meter
// chunks; we keep an (11×11)-chunk square hot around the player. Each frame we
// frustum-test every active tree and write only the visible ones into 10 global
// InstancedMeshes (one per template × {branches, leaves}). Net result: ~10
// draw calls for the entire forest, and only on-screen trees pay vertex cost.

import * as THREE from 'three';
import { CHUNK_SIZE, chunkKey, generateChunk } from './chunk.js';
import { applyWind } from './wind.js';

// View-distance in chunks (each direction). 4 → 81 chunks active.
// (Was 5 / 121 chunks — dropped because the leaf canopy overdraw when looking
// up was crashing FPS. 81 × 20 ≈ 1 620 active trees feels just as dense.)
const VIEW_CHUNKS = 4;
// Per-template instance cap. With ~20 trees/chunk × 81 chunks ÷ 5 templates
// ≈ 320 trees per pool; 500 leaves room for density bumps.
const MAX_INSTANCES_PER_TEMPLATE = 500;

const AXIS_Y = new THREE.Vector3(0, 1, 0);

export function buildWorld(scene, templates, { worldSeed = 1337 } = {}) {
  // One InstancedMesh per (template, kind). Pools persist for the whole
  // session; their `count` is what shrinks/grows with FOV culling.
  const pools = templates.map(tpl => {
    const branches = new THREE.InstancedMesh(tpl.branchGeom, tpl.branchMat, MAX_INSTANCES_PER_TEMPLATE);
    const leaves   = new THREE.InstancedMesh(tpl.leafGeom,   tpl.leafMat,   MAX_INSTANCES_PER_TEMPLATE);
    for (const m of [branches, leaves]) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false; // we cull per-instance ourselves
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    applyWind(tpl.leafMat); // EZ-Tree injects the wind shader on the leaf mat
    return { branches, leaves };
  });

  // Map<key, { cx, cz, trees: [...] }>
  const activeChunks = new Map();
  // Flattened, ordered for the hot loop.
  const candidates = [];
  let lastCenterCX = Number.NaN, lastCenterCZ = Number.NaN;

  function rebuildCandidates() {
    candidates.length = 0;
    for (const chunk of activeChunks.values()) {
      for (const t of chunk.trees) candidates.push(t);
    }
  }

  function updateActive(cx, cz) {
    const wanted = new Set();
    for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
      for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
        const k = chunkKey(cx + dx, cz + dz);
        wanted.add(k);
        if (!activeChunks.has(k)) {
          activeChunks.set(k, generateChunk(cx + dx, cz + dz, worldSeed, templates));
        }
      }
    }
    for (const k of activeChunks.keys()) {
      if (!wanted.has(k)) activeChunks.delete(k);
    }
    rebuildCandidates();
  }

  // Reusable workspace — no allocations in the per-frame hot loop.
  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere();

  function update(camera) {
    const cx = Math.floor(camera.position.x / CHUNK_SIZE);
    const cz = Math.floor(camera.position.z / CHUNK_SIZE);
    if (cx !== lastCenterCX || cz !== lastCenterCZ) {
      updateActive(cx, cz);
      lastCenterCX = cx;
      lastCenterCZ = cz;
    }

    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);

    // Per-template write counter. We pack visible instances densely into the
    // front of each pool's buffer and set `.count` to that.
    const writeIdx = new Array(pools.length).fill(0);

    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      const tpl = templates[t.templateIdx];
      const h = tpl.height * t.scale;

      // Tree-shaped bounding sphere. Center at trunk midpoint; radius slightly
      // larger than half-height to include the canopy.
      sphere.center.set(t.x, h * 0.5, t.z);
      sphere.radius = h * 0.7;
      if (!frustum.intersectsSphere(sphere)) continue;

      const slot = writeIdx[t.templateIdx];
      if (slot >= MAX_INSTANCES_PER_TEMPLATE) continue;

      tmpPos.set(t.x, 0, t.z);
      tmpQuat.setFromAxisAngle(AXIS_Y, t.rotY);
      tmpScale.setScalar(t.scale);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      pools[t.templateIdx].branches.setMatrixAt(slot, tmpMatrix);
      pools[t.templateIdx].leaves.setMatrixAt(slot, tmpMatrix);
      writeIdx[t.templateIdx] = slot + 1;
    }

    let totalVisible = 0;
    for (let i = 0; i < pools.length; i++) {
      const n = writeIdx[i];
      pools[i].branches.count = n;
      pools[i].leaves.count = n;
      pools[i].branches.instanceMatrix.needsUpdate = true;
      pools[i].leaves.instanceMatrix.needsUpdate = true;
      totalVisible += n;
    }
    return { totalActive: candidates.length, totalVisible };
  }

  function getNearbyTrees(x, z, radius) {
    // Cheap: only scan the 3×3 chunks around (x, z). At chunk-size 32 this
    // covers any radius up to 32 + buffer, which is far beyond what we use.
    const out = [];
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const rPad = radius + 1; // include trees just outside the radius
    const r2 = rPad * rPad;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = activeChunks.get(chunkKey(cx + dx, cz + dz));
        if (!chunk) continue;
        for (const t of chunk.trees) {
          const ddx = t.x - x, ddz = t.z - z;
          if (ddx * ddx + ddz * ddz <= r2) out.push(t);
        }
      }
    }
    return out;
  }

  return { update, getNearbyTrees, pools };
}
