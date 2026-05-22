// Fluffy infinite grass.
//
// Design (per the Codrops "fluffiest grass" article + standard infinite-tile trick):
//
// • One InstancedMesh of GRID_SIDE² blades per call. Instance matrices are
//   *identity* — the vertex shader computes each blade's world position from
//   gl_InstanceID and a single `uPlayerCell` uniform (the player's position
//   floored to the cell grid).
//
// • Infinite, world-stable trick: each blade is tied to a *world cell*
//   (integer XZ). mod() over instance IDs re-maps which instance covers
//   which world cell as the patch slides.
//
// • Wind in **v03** is the SAME formula as EZ-Tree's leaf shader: a
//   simplex-noise spatial phase offset + a 3-octave sum of sines, all driven
//   by the *shared* `uTime`, `uWindStrength`, `uWindFrequency`, `uWindScale`
//   uniforms. Registering the grass material with `applyWind()` means a
//   gust visible in the leaves rolls through the grass at the same moment.
//   A local `uWindBend` scalar trims the effect so 0.5 m blades aren't
//   blown over by a wind strength tuned for tree leaves.

import * as THREE from 'three';
import { applyWind } from './wind.js';

const DEFAULTS = {
  gridSide:      320,
  cellSize:      0.09,
  bladeHeight:   0.42,
  bladeWidth:    0.018,
  segments:      3,
  edgeFadeStart: 0.78,
  windBend:      0.30,          // local scale on the shared wind strength
  tipColor:      '#c8df8a',
  baseColor:     '#436d28',
  halfSize:      0,             // computed
};

function buildBladeGeometry({ bladeHeight, bladeWidth, segments, gridSide, cellSize }) {
  const verts = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const v = i / segments;
    const w = bladeWidth * (1 - v * 0.95);
    verts.push(-w * 0.5, bladeHeight * v, 0);
    verts.push(+w * 0.5, bladeHeight * v, 0);
    uvs.push(0, v); uvs.push(1, v);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1);
    indices.push(a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), gridSide * cellSize);
  return g;
}

function buildGrassMaterial(uniforms, opts) {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      uniform float uTime;
      uniform vec3  uWindStrength;
      uniform float uWindFrequency;
      uniform float uWindScale;
      uniform float uWindBend;
      uniform vec2  uPlayerCell;
      varying float vBladeY;
      varying float vRandom;
      varying float vPatchDry;   // 0=lush, 1=dry — spatial color zone
      varying float vPatchDark;  // 0=bright, 1=shadowed patch
      const float gridSide = ${opts.gridSide.toFixed(1)};
      const float cellSize = ${opts.cellSize.toFixed(4)};

      vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i,                vec2(127.1, 311.7))) * 43758.5453);
        float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
        float gInstance = float(gl_InstanceID);
        float gIx = mod(gInstance, gridSide);
        float gIz = floor(gInstance / gridSide);

        vec2 patchMod = mod(uPlayerCell, gridSide);
        vec2 wrap = mod(vec2(gIx, gIz) - patchMod + gridSide, gridSide);
        vec2 gWorldCell = uPlayerCell - vec2(gridSide * 0.5) + wrap;

        vec2 gH1 = hash22(gWorldCell);
        vec2 gH2 = hash22(gWorldCell + vec2(17.3, 91.7));
        float gRotY = gH1.x * 6.28318;
        vec2 gWorldXZ = gWorldCell * cellSize + (gH1 - 0.5) * cellSize * 0.95;
        float gCos = cos(gRotY), gSin = sin(gRotY);

        float patchHalf = gridSide * 0.5;
        float gT = length(gWorldCell - uPlayerCell) / patchHalf;
        float gEdgeFade = 1.0 - smoothstep(${opts.edgeFadeStart.toFixed(3)}, 1.0, gT);

        // Spatial color patches: two overlapping low-frequency noise layers.
        // patchDry  — slow ~18m cycle: yellow-brown dry streaks.
        // patchDark — slightly faster ~11m cycle: dim shadowed hollows.
        float patchDryRaw  = vnoise(gWorldXZ * 0.056);
        float patchDarkRaw = vnoise(gWorldXZ * 0.091 + vec2(42.3, 17.7));
        vPatchDry  = smoothstep(0.42, 0.68, patchDryRaw);
        vPatchDark = smoothstep(0.50, 0.75, patchDarkRaw) * 0.55;

        // Height modulation: dry patches shorter, lush patches taller.
        float heightMod = 1.0 - vPatchDry * 0.25;
        float gScale = (0.88 + gH2.x * 0.22) * gEdgeFade * heightMod;

        vec3 _on = objectNormal;
        objectNormal.x = gCos * _on.x - gSin * _on.z;
        objectNormal.z = gSin * _on.x + gCos * _on.z;
        vRandom = gH2.y;
        `
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vBladeY = uv.y;
        transformed.y *= gScale;
        float _tx = gCos * transformed.x - gSin * transformed.z;
        float _tz = gSin * transformed.x + gCos * transformed.z;
        transformed.x = _tx;
        transformed.z = _tz;

        float windOffset = 2.0 * 3.14159265 *
                           (vnoise(gWorldXZ / uWindScale) * 2.0 - 1.0);
        float windPhase = uTime * uWindFrequency;
        float windSum = 0.5 * sin(      windPhase + windOffset       )
                      + 0.3 * sin(2.0 * windPhase + 1.3 * windOffset )
                      + 0.2 * sin(5.0 * windPhase + 1.5 * windOffset );
        float bend = uv.y * uv.y * uWindBend;
        transformed.x += windSum * bend * uWindStrength.x;
        transformed.z += windSum * bend * uWindStrength.z;

        transformed.x += gWorldXZ.x;
        transformed.z += gWorldXZ.y;
        `
      );

    shader.fragmentShader = `
      uniform vec3 uTipColor;
      uniform vec3 uBaseColor;
      varying float vBladeY;
      varying float vRandom;
      varying float vPatchDry;
      varying float vPatchDark;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      /* glsl */ `
      // Dry patch: yellowish tips, brownish base
      vec3 dryTip  = vec3(0.76, 0.72, 0.30);
      vec3 dryBase = vec3(0.40, 0.30, 0.12);
      vec3 tip  = mix(uTipColor,  dryTip,  vPatchDry * 0.65);
      vec3 base = mix(uBaseColor, dryBase, vPatchDry * 0.55);

      float t = vBladeY * vBladeY;
      vec3 grassCol = mix(base, tip, t);

      // Per-blade brightness jitter + shadow-hollow darkening
      float brightness = 0.80 + vRandom * 0.32 - vPatchDark * 0.28;
      grassCol *= brightness;

      vec4 diffuseColor = vec4(grassCol, opacity);`
    );

    mat.userData.shader = shader;
  };
  return mat;
}

export function buildGrass(scene, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  opts.halfSize = opts.gridSide * opts.cellSize * 0.5;

  const geom = buildBladeGeometry(opts);

  // Uniforms named the same way as the leaf shader so wind.js's updateWind()
  // drives them in lockstep. The grass-local `uWindBend` is the *only* knob
  // that isn't shared with the trees.
  const uniforms = {
    uTime:          { value: 0 },
    uWindStrength:  { value: new THREE.Vector3(0.45, 0, 0.45) }, // updateWind() overwrites every frame
    uWindFrequency: { value: 0.45 },                              // ditto
    uWindScale:     { value: 70 },                                // ditto
    uWindBend:      { value: opts.windBend },                     // grass-only
    uPlayerCell:    { value: new THREE.Vector2() },
    uTipColor:      { value: new THREE.Color(opts.tipColor) },
    uBaseColor:     { value: new THREE.Color(opts.baseColor) },
  };

  const mat = buildGrassMaterial(uniforms, opts);
  const total = opts.gridSide * opts.gridSide;
  const mesh = new THREE.InstancedMesh(geom, mat, total);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = total;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const id = new THREE.Matrix4();
  for (let i = 0; i < total; i++) mesh.setMatrixAt(i, id);
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  // Register so wind.js's updateWind(t) drives uTime/uWindStrength/Frequency/Scale
  // on this material the *same way* it drives every tree's leaf material.
  applyWind(mat);

  function update(camera) {
    uniforms.uPlayerCell.value.set(
      Math.floor(camera.position.x / opts.cellSize),
      Math.floor(camera.position.z / opts.cellSize)
    );
  }

  // Kept for API parity with v02; the actual time update now flows through
  // applyWind / updateWind so trees and grass tick on the same clock.
  function setTime(_t) {}

  return { mesh, update, setTime, total, halfSize: opts.halfSize };
}
