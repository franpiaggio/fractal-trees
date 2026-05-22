import * as THREE from 'three';

const SKY_COLOR = 0xa8c5e6;
const GROUND_COLOR = 0x4a6b3a;
const SUN_COLOR = 0xfff2d1;

export function buildEnvironment(scene) {
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 40, 130);

  const hemi = new THREE.HemisphereLight(SKY_COLOR, 0x3a2a1a, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(SUN_COLOR, 2.4);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const s = 22;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400, 1, 1),
    new THREE.MeshStandardMaterial({
      color: GROUND_COLOR,
      roughness: 1.0,
      metalness: 0.0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return {
    sun,
    hemi,
    ground,
    setSunAzimuth(deg) {
      const rad = (deg * Math.PI) / 180;
      const r = 32;
      sun.position.set(Math.cos(rad) * r, 28, Math.sin(rad) * r);
    },
  };
}
