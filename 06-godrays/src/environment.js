import * as THREE from 'three';

const SKY = new THREE.Color(0xc3d6ef);
// Sun direction tuned lower than v05 so the rays have more lateral reach
// through the canopy — high noon kills the godrays look.
const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.35).normalize();

function makeGroundTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gridN = 16;
  const grid = new Float32Array(gridN * gridN);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  const sample = (gx, gy) => {
    const x = ((gx % gridN) + gridN) % gridN;
    const y = ((gy % gridN) + gridN) % gridN;
    return grid[y * gridN + x];
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = t => t * t * (3 - 2 * t);
  const fbm = (u, v) => {
    let amp = 0.55, sum = 0, freq = 1;
    for (let oct = 0; oct < 4; oct++) {
      const x = u * freq, y = v * freq;
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const a = sample(xi, yi),     b = sample(xi + 1, yi);
      const c = sample(xi, yi + 1), d = sample(xi + 1, yi + 1);
      const sx = fade(xf), sy = fade(yf);
      sum += amp * lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  };

  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * gridN;
      const v = (y / size) * gridN;
      const greenN = fbm(u, v);
      const dirtN  = fbm(u + 53.3, v + 17.7);
      let r, g, b;
      if (greenN < 0.42)      { r =  58; g =  92; b =  40; }
      else if (greenN < 0.65) { r =  85; g = 125; b =  56; }
      else                    { r = 118; g = 158; b =  74; }
      if (dirtN > 0.78) {
        const t = (dirtN - 0.78) / 0.22;
        r = lerp(r, 116, t);
        g = lerp(g,  92, t);
        b = lerp(b,  62, t);
      }
      const j = (Math.random() - 0.5) * 18;
      const i = (y * size + x) * 4;
      d[i]     = Math.max(0, Math.min(255, r + j));
      d[i + 1] = Math.max(0, Math.min(255, g + j));
      d[i + 2] = Math.max(0, Math.min(255, b + j));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// In v06 the sun ALWAYS casts shadow because the godrays pass raymarches the
// shadow map. Disabling shadows would disable the godrays entirely. Tier only
// scales the map size and whether the ground receives shadow on its surface.
export function buildEnvironment(scene, renderer, preset) {
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, preset.fogNear, preset.fogFar);

  // Slightly cooler / dimmer ambient so the warm directional light + godrays
  // read as the dominant illumination source.
  const hemi = new THREE.HemisphereLight(0xd2e5ff, 0x3a2a18, 0.78);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 1.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  // Ortho frustum covers the camera's visible area + a margin so trees just
  // outside the frame still occlude rays.
  const c = sun.shadow.camera;
  c.left = -28; c.right = 28; c.top = 28; c.bottom = -28;
  c.near = 1; c.far = 90;
  c.updateProjectionMatrix();
  sun.target = new THREE.Object3D();
  scene.add(sun);
  scene.add(sun.target);

  const groundMap = makeGroundTexture(512);
  groundMap.repeat.set(200, 200);
  if (renderer?.capabilities?.getMaxAnisotropy) {
    groundMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  const groundMat = new THREE.MeshStandardMaterial({
    map: groundMap,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = !!preset.groundReceiveShadow;
  ground.castShadow = false;
  scene.add(ground);

  function updateSun(playerPos) {
    const offset = SUN_DIR.clone().multiplyScalar(40);
    sun.position.copy(playerPos).add(offset);
    sun.target.position.copy(playerPos);
    sun.target.updateMatrixWorld();
  }

  return { sun, hemi, ground, updateSun, skyColor: SKY, sunDir: SUN_DIR };
}
