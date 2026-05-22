import * as THREE from 'three';

const SKY = new THREE.Color(0xc3d6ef);             // brighter, cleaner blue
// Fog matched to the *much denser* grass patch (half ≈ 23 m, fade band
// 21.2–23 m). Tighter than 02 because the patch is smaller, but the player
// still gets ~14 m of clear vision before the haze kicks in.
//   5  m → fog just begins
//   15 m → 53 % opacity (light haze)
//   21 m → 84 % opacity (patch fade starts — invisible)
//   23 m → 95 % opacity (patch outer edge — invisible)
//   24 m → 100 % (fully fogged out)
const FOG_NEAR = 5;
const FOG_FAR = 24;
const SUN_DIR = new THREE.Vector3(0.45, 0.9, 0.3).normalize();

// Procedural ground texture: multi-octave value noise blending dark/mid/light
// greens with occasional dirt patches. Built once, tiled across the plane.
// Cheaper and zero-asset compared to loading a PBR texture set.
function makeGroundTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Value-noise grid (low-res), then blow up smoothly via bilinear sampling.
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
      // Two noise lookups: one for green level, one for dirt mask.
      const greenN = fbm(u, v);
      const dirtN  = fbm(u + 53.3, v + 17.7);

      // Blend three greens by `greenN`, then mix-in dirt by `dirtN`.
      // Colors in linear-ish sRGB (the canvas texture is decoded as sRGB).
      let r, g, b;
      if (greenN < 0.42)      { r =  58; g =  92; b =  40; }   // shadow grass
      else if (greenN < 0.65) { r =  85; g = 125; b =  56; }   // mid grass
      else                    { r = 118; g = 158; b =  74; }   // sunlit grass

      if (dirtN > 0.78) {
        // Dirt patch
        const t = (dirtN - 0.78) / 0.22;
        r = lerp(r, 116, t);
        g = lerp(g,  92, t);
        b = lerp(b,  62, t);
      }
      // Tiny per-pixel jitter so the tiling isn't perfectly smooth.
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

export function buildEnvironment(scene, renderer) {
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);

  // Stronger ambient fill — was too crushed in shadow before.
  const hemi = new THREE.HemisphereLight(0xd2e5ff, 0x3a2a18, 0.95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 1.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const c = sun.shadow.camera;
  c.left = -22; c.right = 22; c.top = 22; c.bottom = -22;
  c.near = 1; c.far = 90;
  sun.target = new THREE.Object3D();
  scene.add(sun);
  scene.add(sun.target);

  const groundMap = makeGroundTexture(512);
  // 2000m plane, tile every 10m → repeat = 200.
  groundMap.repeat.set(200, 200);
  if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
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
  ground.receiveShadow = true;
  scene.add(ground);

  function updateSun(playerPos) {
    const offset = SUN_DIR.clone().multiplyScalar(40);
    sun.position.copy(playerPos).add(offset);
    sun.target.position.copy(playerPos);
    sun.target.updateMatrixWorld();
  }

  return { sun, hemi, ground, updateSun, skyColor: SKY };
}
