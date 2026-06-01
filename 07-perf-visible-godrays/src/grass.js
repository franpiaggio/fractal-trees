// Fluffy infinite grass — tier-aware density.
//
// Same core trick as v04: one InstancedMesh, blade XZ derived in the vertex
// shader from gl_InstanceID + uPlayerCell, wrap mod() to keep an infinite
// stable field. Wind shares uniforms with the leaf shader via applyWind().
//
// Optimization vs v04: only ONE vnoise call per blade (the wind noise).
// v04 added two extra patch-color noise calls for spatial variation; in 05
// we get most of that variation back via a single noise sampled at lower
// frequency and reused for both color zones — same look, ~33% less vertex
// math across a 1M-blade field.

import * as THREE from 'three';
import { applyWind } from './wind.js';

const DEFAULTS = {
  gridSide:      832,
  cellSize:      0.05,
  bladeHeight:   0.42,
  bladeWidth:    0.018,
  segments:      3,
  edgeFadeStart: 0.90,
  windBend:      0.30,
  tipColor:      '#c8df8a',
  baseColor:     '#436d28',
  halfSize:      0,
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
      varying float vPatch;    // single spatial noise driving both dry and dark
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

        // ONE noise lookup, reused later for both dry color and shadow hollows.
        vPatch = vnoise(gWorldXZ * 0.07);

        // Slight height reduction in "dry" patches (vPatch > 0.55).
        float heightMod = 1.0 - smoothstep(0.55, 0.85, vPatch) * 0.22;
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

        // Wind, matched to the leaf shader's formula (1 vnoise call).
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
      varying float vPatch;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      /* glsl */ `
      // Reuse the same noise for two zones with different thresholds.
      float dryness = smoothstep(0.50, 0.80, vPatch);
      float shadow  = smoothstep(0.30, 0.05, vPatch) * 0.55;

      vec3 dryTip  = vec3(0.76, 0.72, 0.30);
      vec3 dryBase = vec3(0.40, 0.30, 0.12);
      vec3 tip  = mix(uTipColor,  dryTip,  dryness * 0.60);
      vec3 base = mix(uBaseColor, dryBase, dryness * 0.50);

      vec3 grassCol = mix(base, tip, vBladeY * vBladeY);
      float brightness = 0.80 + vRandom * 0.32 - shadow * 0.25;
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

  const uniforms = {
    uTime:          { value: 0 },
    uWindStrength:  { value: new THREE.Vector3(0.45, 0, 0.45) },
    uWindFrequency: { value: 0.45 },
    uWindScale:     { value: 70 },
    uWindBend:      { value: opts.windBend },
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

  applyWind(mat);

  function update(camera) {
    uniforms.uPlayerCell.value.set(
      Math.floor(camera.position.x / opts.cellSize),
      Math.floor(camera.position.z / opts.cellSize)
    );
  }

  function setTime(_t) {}

  return { mesh, update, setTime, total, halfSize: opts.halfSize };
}
