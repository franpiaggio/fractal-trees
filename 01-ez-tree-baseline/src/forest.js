import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

const PRESETS = ['Oak Small', 'Aspen Small', 'Pine Small', 'Ash Small'];

function jitteredDisc(count, inner, outer, seed = 1337) {
  const points = [];
  let s = seed;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  let attempts = 0;
  while (points.length < count && attempts < count * 20) {
    attempts++;
    const r = inner + Math.sqrt(rng()) * (outer - inner);
    const theta = rng() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    if (points.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 4)) continue;
    points.push({ x, z });
  }
  return points;
}

export function populateForest(scene, hero, { count = 80, innerRadius = 8, outerRadius = 45 } = {}) {
  const group = new THREE.Group();
  group.name = 'forest';
  scene.add(group);

  const positions = jitteredDisc(count, innerRadius, outerRadius);
  const materials = [];
  const meshes = [];

  // One InstancedMesh per preset/template — share materials with the hero where possible
  // for consistent wind behavior and to keep draw-call count low.
  const perPreset = Math.ceil(count / PRESETS.length);

  let idx = 0;
  for (const presetName of PRESETS) {
    const template = new Tree();
    template.loadPreset(presetName);
    template.options.seed = 1 + idx;
    // Cheaper geometry for background trees
    template.options.branch.sections = template.options.branch.sections?.map?.((v) => Math.max(4, Math.floor(v * 0.6))) ?? template.options.branch.sections;
    template.options.branch.segments = template.options.branch.segments?.map?.((v) => Math.max(4, Math.floor(v * 0.6))) ?? template.options.branch.segments;
    template.generate();

    const branchGeo = template.branchesMesh.geometry;
    const leafGeo = template.leavesMesh.geometry;
    const branchMat = template.branchesMesh.material;
    const leafMat = template.leavesMesh.material;
    if (leafMat) {
      leafMat.alphaTest = 0.5;
      leafMat.transparent = false;
      leafMat.side = THREE.DoubleSide;
    }
    materials.push(branchMat, leafMat);

    const branches = new THREE.InstancedMesh(branchGeo, branchMat, perPreset);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, perPreset);
    branches.castShadow = false;
    branches.receiveShadow = false;
    leaves.castShadow = false;
    leaves.receiveShadow = false;
    branches.frustumCulled = true;
    leaves.frustumCulled = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < perPreset; i++) {
      const p = positions[idx];
      if (!p) {
        // Hide the unused slot far below the camera
        dummy.position.set(0, -10000, 0);
        dummy.scale.setScalar(0.0001);
      } else {
        const s = 0.55 + Math.random() * 0.5;
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.scale.setScalar(s);
        idx++;
      }
      dummy.updateMatrix();
      branches.setMatrixAt(i, dummy.matrix);
      leaves.setMatrixAt(i, dummy.matrix);
    }
    branches.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;

    group.add(branches, leaves);
    meshes.push(branches, leaves);
  }

  return { group, materials, meshes };
}
