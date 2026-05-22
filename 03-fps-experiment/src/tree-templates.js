// Pre-generates a small set of EZ-Tree templates once at boot. Each template
// exposes the geometry + material pair we need to feed an InstancedMesh, plus
// a coarse collision radius for the trunk. All instances of a given template
// share these objects → one draw call per (template, branches|leaves).

import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

// Each template: a preset + seed + low-poly tweak + collision radius hint.
// Radii are in *template-local* units (instance scale multiplies them).
const RECIPES = [
  { id: 'oak-a',   preset: 'Oak Medium',   seed: 7,   trunkRadius: 0.55 },
  { id: 'oak-b',   preset: 'Oak Small',    seed: 13,  trunkRadius: 0.40 },
  { id: 'ash',     preset: 'Ash Medium',   seed: 23,  trunkRadius: 0.45 },
  { id: 'aspen',   preset: 'Aspen Medium', seed: 31,  trunkRadius: 0.30 },
  { id: 'pine',    preset: 'Pine Medium',  seed: 41,  trunkRadius: 0.45 },
];

function softenGeometry(tree) {
  // Halve cylinder subdivisions where the option grid allows. Acts as a
  // distance LOD without us having to maintain separate hand-tuned presets.
  const b = tree.options?.branch;
  if (b) {
    if (Array.isArray(b.sections)) {
      for (let i = 0; i < b.sections.length; i++) {
        b.sections[i] = Math.max(2, Math.floor(b.sections[i] * 0.6));
      }
    }
    if (Array.isArray(b.segments)) {
      for (let i = 0; i < b.segments.length; i++) {
        b.segments[i] = Math.max(3, Math.floor(b.segments[i] * 0.6));
      }
    }
  }
  // (Previously we halved leaves.count for canopy-overdraw perf — but that
  // was a workaround for the bug where instanced leaves all rendered at the
  // template origin. With patchLeafInstancing() applied, the canopy renders
  // correctly and we can keep the full leaf count so trees look leafy, not
  // spiky. If FPS later tanks, drop the multiplier back to ~0.7.)
}

function tuneLeaves(mat) {
  // AlphaTest keeps the leaves in the opaque pass (no per-frame depth sort
  // across the entire forest). DoubleSide so quads read full from either face.
  mat.alphaTest = 0.5;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.side = THREE.DoubleSide;
}

// CRITICAL: EZ-Tree's leaf material installs an onBeforeCompile that replaces
// the standard `#include <project_vertex>` chunk — but its replacement drops
// the `#ifdef USE_INSTANCING / mvPosition = instanceMatrix * mvPosition;`
// block. The result: when the leaf material is mounted on an InstancedMesh,
// every leaf instance renders at the template's origin (0,0,0), so only one
// pile of leaves appears in the whole scene.
//
// This wrapper re-injects the instanceMatrix multiply *after* EZ-Tree's
// onBeforeCompile runs. It also reroutes the wind-noise sample through the
// instance-world position so each tree sways with a different phase instead
// of in lockstep.
function patchLeafInstancing(mat) {
  const orig = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof orig === 'function') orig(shader, renderer);

    // 1. Apply instanceMatrix between the wind offset and the modelView mult.
    shader.vertexShader = shader.vertexShader.replace(
      'mvPosition = modelViewMatrix * mvPosition;',
      /* glsl */ `
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelViewMatrix * mvPosition;`
    );

    // 2. Sample the wind noise at the *instance-world* position so each tree
    //    has its own phase. Without this, every tree's canopy sways in unison.
    shader.vertexShader = shader.vertexShader.replace(
      'float windOffset = 2.0 * 3.14 * simplex3(mvPosition.xyz / uWindScale);',
      /* glsl */ `
      vec4 _instWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        _instWorld = instanceMatrix * _instWorld;
      #endif
      float windOffset = 2.0 * 3.14 * simplex3(_instWorld.xyz / uWindScale);`
    );

    mat.userData.shader = shader;
  };
  mat.needsUpdate = true;
}

export function buildTemplates({ lowPoly = true } = {}) {
  const templates = [];
  for (const recipe of RECIPES) {
    const tree = new Tree();
    tree.loadPreset(recipe.preset);
    tree.options.seed = recipe.seed;
    if (lowPoly) softenGeometry(tree);
    tree.generate();

    const branchGeom = tree.branchesMesh.geometry;
    const leafGeom = tree.leavesMesh.geometry;
    const branchMat = tree.branchesMesh.material;
    const leafMat = tree.leavesMesh.material;
    tuneLeaves(leafMat);
    patchLeafInstancing(leafMat);   // ← fixes "leaves only on one tree"

    // Estimate vertical span — used by collision logic & frustum padding.
    branchGeom.computeBoundingBox();
    const bb = branchGeom.boundingBox;
    const height = bb ? bb.max.y - bb.min.y : 6;

    templates.push({
      id: recipe.id,
      branchGeom, branchMat,
      leafGeom,   leafMat,
      trunkRadius: recipe.trunkRadius,
      height,
    });
  }
  return templates;
}
