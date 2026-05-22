import * as THREE from 'three';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';

export const PRESET_NAMES = [
  'Ash Small', 'Ash Medium', 'Ash Large',
  'Aspen Small', 'Aspen Medium', 'Aspen Large',
  'Oak Small', 'Oak Medium', 'Oak Large',
  'Pine Small', 'Pine Medium', 'Pine Large',
];

export async function createHeroTree({ preset = 'Oak Medium', seed = 42 } = {}) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  tree.generate();

  tree.branchesMesh.castShadow = true;
  tree.branchesMesh.receiveShadow = true;
  tree.leavesMesh.castShadow = true;
  tree.leavesMesh.receiveShadow = true;

  if (tree.leavesMesh.material) {
    tree.leavesMesh.material.alphaTest = 0.5;
    tree.leavesMesh.material.transparent = false;
    tree.leavesMesh.material.side = THREE.DoubleSide;
  }

  return {
    group: tree,
    tree,
    branchMaterial: tree.branchesMesh.material,
    leafMaterial: tree.leavesMesh.material,
    regenerate(opts = {}) {
      if (opts.preset) tree.loadPreset(opts.preset);
      if (opts.seed != null) tree.options.seed = opts.seed;
      tree.generate();
    },
  };
}
