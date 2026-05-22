// Atmospheric dust motes — world-space particles drifting in the air.
//
// Particles live in world space (NOT camera-locked). They drift slowly,
// and any particle that wanders too far from the camera gets respawned
// at the FAR EDGE of the cloud — exactly where the alpha fade starts at 0,
// so they always ramp up from invisible. No pop-in.
//
// Particles only render where they overlap a soft world-space spherical
// shell around the camera (faded in from FADE_FAR to FADE_NEAR).

import * as THREE from 'three';

const COUNT       = 320;   // ↓ from 700 — less visual noise
const FADE_NEAR   = 4.0;   // fully visible inside this distance
const FADE_FAR    = 11.0;  // fully invisible at and beyond this distance
const DESPAWN_R   = 16.0;  // respawn when particle drifts this far from camera
const DRIFT_AMP   = 0.55;
const RESPAWN_PER_FRAME = 3;

const vert = /* glsl */ `
  attribute vec2 aSeed;
  uniform float uTime;
  uniform float uSize;
  uniform vec3  uCamera;
  varying float vOpacity;

  void main() {
    vec3 drift = vec3(
      ${DRIFT_AMP.toFixed(2)} * sin(uTime * 0.22 + aSeed.x * 6.2832),
      ${(DRIFT_AMP * 0.55).toFixed(2)} * cos(uTime * 0.17 + aSeed.y * 6.2832),
      ${DRIFT_AMP.toFixed(2)} * cos(uTime * 0.19 + (aSeed.x + aSeed.y) * 3.1416)
    );
    vec3 worldPos = position + drift;

    // Spherical fade around the camera in world space.
    float d = distance(worldPos, uCamera);
    vOpacity = 1.0 - smoothstep(${FADE_NEAR.toFixed(2)}, ${FADE_FAR.toFixed(2)}, d);

    vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Tiny screen size, gently attenuated. At 1 m → 30 px, at 5 m → 6 px.
    float dist = -mvPos.z;
    gl_PointSize = uSize * (30.0 / max(dist, 0.8));
  }
`;

const frag = /* glsl */ `
  uniform float uOpacity;
  varying float vOpacity;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.15, 0.5, d)) * vOpacity * uOpacity;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(1.0, 0.97, 0.86, alpha);
  }
`;

// Spawn a particle on a spherical shell around (cx, cy, cz) at `radius`.
// Used both for initial fill and for respawn — always at the far edge so
// the shader's smoothstep fade puts opacity = 0 at spawn time → no pop.
function spawnOnShell(positions, i, cx, cy, cz, radius) {
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  positions[i * 3]     = cx + radius * Math.sin(phi) * Math.cos(theta);
  positions[i * 3 + 1] = cy + radius * Math.sin(phi) * Math.sin(theta) - 0.3;
  positions[i * 3 + 2] = cz + radius * Math.cos(phi);
}

export function buildDust(scene) {
  const positions = new Float32Array(COUNT * 3);
  const seeds     = new Float32Array(COUNT * 2);

  // Initial fill — spread uniformly *inside* the cloud (not just on the shell)
  // so the first frames already show motes near the camera, but at varied
  // distances so they're at varied opacities (no jarring uniform front).
  for (let i = 0; i < COUNT; i++) {
    const r = Math.cbrt(Math.random()) * FADE_FAR;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) + 1.2;
    positions[i * 3 + 2] = r * Math.cos(phi);
    seeds[i * 2]     = Math.random() * 100;
    seeds[i * 2 + 1] = Math.random() * 100;
  }

  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  geom.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 2));

  const mat = new THREE.ShaderMaterial({
    vertexShader:   vert,
    fragmentShader: frag,
    uniforms: {
      uTime:    { value: 0 },
      uSize:    { value: 0.9 },
      uOpacity: { value: 0.22 },
      uCamera:  { value: new THREE.Vector3() },
    },
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  scene.add(points);

  let scanCursor = 0;

  function update(camera, t) {
    mat.uniforms.uTime.value = t;
    mat.uniforms.uCamera.value.copy(camera.position);

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const despawnSq = DESPAWN_R * DESPAWN_R;

    let respawned = 0;
    const stride = Math.ceil(COUNT / 90);
    for (let k = 0; k < stride && respawned < RESPAWN_PER_FRAME; k++) {
      const i = scanCursor;
      scanCursor = (scanCursor + 1) % COUNT;
      const dx = positions[i * 3]     - cx;
      const dy = positions[i * 3 + 1] - cy;
      const dz = positions[i * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz > despawnSq) {
        // Respawn at the FADE_FAR shell exactly — alpha is 0 there, so the
        // particle fades in as it drifts inward instead of popping into view.
        spawnOnShell(positions, i, cx, cy, cz, FADE_FAR);
        respawned++;
      }
    }
    if (respawned > 0) posAttr.needsUpdate = true;
  }

  return { update };
}
