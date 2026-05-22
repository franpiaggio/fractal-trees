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
//   (integer XZ). As the player walks, mod() over instance IDs re-maps which
//   instance covers which world cell, so the patch wraps around them. Blades
//   near you stay put; trailing-edge blades teleport to the leading edge.
//
// • Smooth `smoothstep` fade to zero height at the patch boundary so the wrap
//   is never visible.
//
// • Wind is a single low-frequency gust traveling along `uWindDir` — the
//   whole patch waves together with tiny per-blade jitter.
//
// `buildGrass` is parameterised so it can be called twice from main.js to
// stack a dense **near** patch on a sparse **far** patch that extends to the
// fog. The two patches use independent uniforms and shaders.

import * as THREE from 'three';

const DEFAULTS = {
  gridSide:      320,
  cellSize:      0.09,        // metres
  bladeHeight:   0.42,
  bladeWidth:    0.018,
  segments:      3,
  edgeFadeStart: 0.78,        // fraction of patch half-size where fade begins
  windStrength:  0.10,
  windDir:       [0.92, 0.39],
  tipColor:      '#c8df8a',
  baseColor:     '#436d28',
  windFreq:      0.55,
  windSpatial:   0.05,
  // Used by main.js to know how far the patch reaches without re-deriving it.
  // Set automatically below; callers don't pass this.
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
      uniform float uWindStrength;
      uniform vec2  uPlayerCell;
      uniform vec2  uWindDir;
      varying float vBladeY;
      varying float vRandom;
      const float gridSide = ${opts.gridSide.toFixed(1)};
      const float cellSize = ${opts.cellSize.toFixed(4)};
      const float windFreqT = ${opts.windFreq.toFixed(3)};
      const float windFreqX = ${opts.windSpatial.toFixed(3)};

      vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
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

        // Edge fade: blades are at full height across (almost) the entire
        // patch, then smoothstep-scale to zero in a narrow band at the very
        // edge. EDGE_FADE_START is chosen so the fade band lives *inside the
        // fog*, where it can't be seen. Caller's responsibility to pair this
        // with fog so the patch boundary is in heavy fog.
        float patchHalf = gridSide * 0.5;
        float gT = length(gWorldCell - uPlayerCell) / patchHalf;
        float gEdgeFade = 1.0 - smoothstep(${opts.edgeFadeStart.toFixed(3)}, 1.0, gT);
        float gScale = (0.88 + gH2.x * 0.22) * gEdgeFade;

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

        float along = dot(gWorldXZ, uWindDir);
        float gust = sin(along * windFreqX + uTime * windFreqT)
                   + 0.30 * sin(along * windFreqX * 3.6 + uTime * windFreqT * 1.75);
        float jitter = 0.08 * sin(gH1.x * 6.28 + uTime * windFreqT * 2.5);
        float wind = (gust + jitter) * uWindStrength;
        float bend = uv.y * uv.y;
        transformed.x += wind * bend * uWindDir.x;
        transformed.z += wind * bend * uWindDir.y;

        transformed.x += gWorldXZ.x;
        transformed.z += gWorldXZ.y;
        `
      );

    shader.fragmentShader = `
      uniform vec3 uTipColor;
      uniform vec3 uBaseColor;
      varying float vBladeY;
      varying float vRandom;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      /* glsl */ `
      vec3 grassCol = mix(uBaseColor, uTipColor, vBladeY * vBladeY);
      grassCol *= 0.85 + vRandom * 0.30;
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
    uTime:         { value: 0 },
    uWindStrength: { value: opts.windStrength },
    uPlayerCell:   { value: new THREE.Vector2() },
    uWindDir:      { value: new THREE.Vector2(opts.windDir[0], opts.windDir[1]) },
    uTipColor:     { value: new THREE.Color(opts.tipColor) },
    uBaseColor:    { value: new THREE.Color(opts.baseColor) },
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

  function update(camera) {
    uniforms.uPlayerCell.value.set(
      Math.floor(camera.position.x / opts.cellSize),
      Math.floor(camera.position.z / opts.cellSize)
    );
  }

  function setTime(t) {
    uniforms.uTime.value = t;
  }

  return { mesh, update, setTime, total, halfSize: opts.halfSize };
}
