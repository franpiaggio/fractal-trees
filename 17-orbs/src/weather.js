// Weather: rain (line streaks), snow (points), and storm with lightning. Both
// precip systems are world-wrapped around the camera (you fall THROUGH them, they
// don't drag along). Storm = heavier slanted rain + darker sky + lightning flashes.
// The PS1 low-res + dither bands it all into a crunchy, period look.

import * as THREE from 'three';

const RAIN_VERT = /* glsl */`
  attribute vec3 aSeed;
  attribute float aEnd;        // 0 = head (bottom), 1 = tail (up the streak)
  uniform float uTime, uFall, uBoxW, uBoxH, uStreak;
  uniform vec3 uCamera, uWindDir;
  varying float vEnd;
  void main() {
    float box = uBoxW * 2.0;
    float px = aSeed.x * box, pz = aSeed.z * box;
    float fall = mod(uTime * uFall + aSeed.y * uBoxH, uBoxH);
    vec3 wp;
    wp.x = px + box * floor((uCamera.x - px) / box + 0.5);
    wp.z = pz + box * floor((uCamera.z - pz) / box + 0.5);
    wp.y = uCamera.y + uBoxH * 0.55 - fall;
    // The tail vertex sits back up the travel direction → a slanted streak.
    wp -= uWindDir * (aEnd * uStreak);
    vEnd = aEnd;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;
const RAIN_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vEnd;
  void main() { gl_FragColor = vec4(uColor, uOpacity * (1.0 - vEnd * 0.65)); }
`;

const SNOW_VERT = /* glsl */`
  attribute vec3 aSeed;
  uniform float uTime, uFall, uSize, uSway, uBoxW, uBoxH;
  uniform vec3 uCamera;
  varying float vR;
  void main() {
    float box = uBoxW * 2.0;
    float px = aSeed.x * box, pz = aSeed.z * box;
    float ph = aSeed.x * 6.2832;
    float fall = mod(uTime * uFall + aSeed.y * uBoxH, uBoxH);
    vec3 wp;
    wp.x = px + box * floor((uCamera.x - px) / box + 0.5) + uSway * sin(uTime * (0.6 + aSeed.z) + ph);
    wp.z = pz + box * floor((uCamera.z - pz) / box + 0.5) + uSway * cos(uTime * 0.5 + ph);
    wp.y = uCamera.y + uBoxH * 0.6 - fall;
    vR = aSeed.z;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (60.0 / max(-mv.z, 1.0));
  }
`;
const SNOW_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vR;
  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    if (length(pc) > 0.5) discard;
    float a = (1.0 - smoothstep(0.2, 0.5, length(pc))) * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;

// PRESETS per weather type.
const W = {
  clear: { rain: 0,    storm: false },
  rain:  { rain: 0.55, fall: 42, streak: 1.6, wind: 0.18, snow: 0, storm: false, cloud: 0.62 },
  storm: { rain: 1.0,  fall: 58, streak: 2.4, wind: 0.5,  snow: 0, storm: true,  cloud: 0.92 },
  snow:  { rain: 0,    snow: 0.8, snowFall: 4.5, storm: false, cloud: 0.7 },
};

export function buildWeather(scene, { boxW = 22, boxH = 28 } = {}) {
  // ── Rain (line segments) ──
  const RAIN_MAX = 1800;
  const rSeeds = new Float32Array(RAIN_MAX * 2 * 3);
  const rEnds = new Float32Array(RAIN_MAX * 2);
  for (let d = 0; d < RAIN_MAX; d++) {
    const sx = Math.random(), sy = Math.random(), sz = Math.random();
    for (let k = 0; k < 2; k++) {
      const i = (d * 2 + k) * 3;
      rSeeds[i] = sx; rSeeds[i + 1] = sy; rSeeds[i + 2] = sz;
      rEnds[d * 2 + k] = k;
    }
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_MAX * 2 * 3), 3));
  rGeo.setAttribute('aSeed', new THREE.BufferAttribute(rSeeds, 3));
  rGeo.setAttribute('aEnd', new THREE.BufferAttribute(rEnds, 1));
  const windDir = new THREE.Vector3(0.18, -1, 0.0).normalize();
  const rainMat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uFall: { value: 42 }, uBoxW: { value: boxW }, uBoxH: { value: boxH },
      uStreak: { value: 1.6 }, uCamera: { value: new THREE.Vector3() }, uWindDir: { value: windDir.clone() },
      uColor: { value: new THREE.Color('#bcd2e6') }, uOpacity: { value: 0.5 },
    },
  });
  const rain = new THREE.LineSegments(rGeo, rainMat);
  rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 4;
  scene.add(rain);

  // ── Snow (points) ──
  const SNOW_MAX = 1000;
  const sSeeds = new Float32Array(SNOW_MAX * 3);
  for (let i = 0; i < sSeeds.length; i++) sSeeds[i] = Math.random();
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_MAX * 3), 3));
  sGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeeds, 3));
  const snowMat = new THREE.ShaderMaterial({
    vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uFall: { value: 4.5 }, uSize: { value: 2.4 }, uSway: { value: 0.7 },
      uBoxW: { value: boxW }, uBoxH: { value: boxH }, uCamera: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color('#eef4fa') }, uOpacity: { value: 0.85 },
    },
  });
  const snow = new THREE.Points(sGeo, snowMat);
  snow.frustumCulled = false; snow.visible = false; snow.renderOrder = 4;
  scene.add(snow);

  // ── Lightning (an ambient flash, season-independent) ──
  const flash = new THREE.AmbientLight(0xe7f0ff, 0);
  scene.add(flash);
  let flashV = 0, stormy = false, nextBolt = 3, lastT = 0;

  let cloudBase = 0.5;
  let type = 'clear';
  function setWeather(t, env) {
    type = (t in W) ? t : 'clear';
    const c = W[type];
    stormy = !!c.storm;
    rain.visible = (c.rain ?? 0) > 0;
    snow.visible = (c.snow ?? 0) > 0;
    if (rain.visible) {
      rGeo.setDrawRange(0, Math.floor(RAIN_MAX * c.rain) * 2);
      rainMat.uniforms.uFall.value = c.fall;
      rainMat.uniforms.uStreak.value = c.streak;
      rainMat.uniforms.uOpacity.value = stormy ? 0.6 : 0.45;
      windDir.set(c.wind, -1, 0).normalize();
      rainMat.uniforms.uWindDir.value.copy(windDir);
    }
    if (snow.visible) {
      sGeo.setDrawRange(0, Math.floor(SNOW_MAX * c.snow));
      snowMat.uniforms.uFall.value = c.snowFall ?? 4.5;
    }
    if (env?.setCloud) env.setCloud(c.cloud ?? cloudBase);
  }

  function update(camera, t, env) {
    const dt = Math.min(0.05, Math.max(0, t - lastT)); lastT = t;
    rainMat.uniforms.uTime.value = t; rainMat.uniforms.uCamera.value.copy(camera.position);
    snowMat.uniforms.uTime.value = t; snowMat.uniforms.uCamera.value.copy(camera.position);

    // Lightning: random bolts during a storm. A quick bright flash that decays.
    if (stormy) {
      nextBolt -= dt;
      if (nextBolt <= 0) { flashV = 1.6 + Math.random() * 1.2; nextBolt = 3 + Math.random() * 7; }
      flashV = Math.max(0, flashV - dt * 7.0);   // fast decay
    } else if (flashV > 0) {
      flashV = Math.max(0, flashV - dt * 7.0);
    }
    flash.intensity = flashV;
  }

  function dispose() {
    scene.remove(rain); scene.remove(snow); scene.remove(flash);
    rGeo.dispose(); rainMat.dispose(); sGeo.dispose(); snowMat.dispose();
  }

  return { setWeather, update, dispose, get type() { return type; } };
}
