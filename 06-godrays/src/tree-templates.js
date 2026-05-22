// Pre-generates the EZ-Tree templates once at boot, with tier-aware
// leaf density (huge perf lever — leaves dominate the vertex budget when
// looking up through the canopy).

import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

const RECIPES = [
  { id: 'oak-a',   preset: 'Oak Medium',   seed: 7,   trunkRadius: 0.55 },
  { id: 'oak-b',   preset: 'Oak Small',    seed: 13,  trunkRadius: 0.40 },
  { id: 'ash',     preset: 'Ash Medium',   seed: 23,  trunkRadius: 0.45 },
  { id: 'aspen',   preset: 'Aspen Medium', seed: 31,  trunkRadius: 0.30 },
  { id: 'pine',    preset: 'Pine Medium',  seed: 41,  trunkRadius: 0.45 },
];

function softenGeometry(tree, leavesCountMult) {
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
  // Leaf count is the single biggest perf lever once trees stream in.
  const lv = tree.options?.leaves;
  if (lv && leavesCountMult < 1.0) {
    if (typeof lv.count === 'number') {
      lv.count = Math.max(4, Math.floor(lv.count * leavesCountMult));
    } else if (Array.isArray(lv.count)) {
      for (let i = 0; i < lv.count.length; i++) {
        lv.count[i] = Math.max(4, Math.floor(lv.count[i] * leavesCountMult));
      }
    }
  }
}

function tuneLeaves(mat) {
  mat.alphaTest = 0.5;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.side = THREE.DoubleSide;
}

// CRITICAL: EZ-Tree's leaf material installs an onBeforeCompile that replaces
// the standard `#include <project_vertex>` chunk — but its replacement drops
// the `#ifdef USE_INSTANCING / mvPosition = instanceMatrix * mvPosition;`
// block. Without re-injecting it, every leaf instance renders at origin.
function patchLeafInstancing(mat) {
  const orig = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof orig === 'function') orig(shader, renderer);

    shader.vertexShader = shader.vertexShader.replace(
      'mvPosition = modelViewMatrix * mvPosition;',
      /* glsl */ `
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelViewMatrix * mvPosition;`
    );

    // Per-tree wind phase: sample at instance-world XYZ so each canopy has its
    // own beat instead of swaying in unison.
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

export function buildTemplates({ lowPoly = true, leavesCountMult = 1.0 } = {}) {
  const templates = [];
  for (const recipe of RECIPES) {
    const tree = new Tree();
    tree.loadPreset(recipe.preset);
    tree.options.seed = recipe.seed;
    if (lowPoly) softenGeometry(tree, leavesCountMult);
    tree.generate();

    const branchGeom = tree.branchesMesh.geometry;
    const leafGeom = tree.leavesMesh.geometry;
    const branchMat = tree.branchesMesh.material;
    const leafMat = tree.leavesMesh.material;
    tuneLeaves(leafMat);
    patchLeafInstancing(leafMat);

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
