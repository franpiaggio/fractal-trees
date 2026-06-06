// Collectible orbs. One glowing orb at a time, floating over the terrain. It emits
// a DIRECTIONAL hum (Web Audio PositionalAudio through the camera's listener) so
// you can find it by ear — pan + volume change as you turn and approach. Walk into
// it to collect (a chime plays, the count ticks up, a new orb spawns elsewhere).

import * as THREE from 'three';
import { terrainHeight } from './terrain.js';
import orbPulseUrl from './assets/orb-pulse.mp3';
import orbCollectUrl from './assets/orb-collect.mp3';

function makeGlowTexture(size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(190,245,255,0.85)');
  g.addColorStop(0.6, 'rgba(120,210,255,0.25)');
  g.addColorStop(1.0, 'rgba(120,210,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildOrbs(scene, camera, { collectRadius = 2.6, minDist = 12, maxDist = 26, onCollect = null } = {}) {
  // ── Audio: a listener on the camera + a positional hum on the orb ──
  const listener = new THREE.AudioListener();
  camera.add(listener);
  // The AudioContext needs a user gesture to start; resume on the first real input.
  const tryResume = () => { if (listener.context.state === 'suspended') listener.context.resume().catch(() => {}); };
  window.addEventListener('pointerdown', tryResume);
  window.addEventListener('keydown', tryResume);

  // ── Orb visual: a bright core + an additive glow sprite ──
  const orb = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xd8fbff, fog: false }),
  );
  const glowTex = makeGlowTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false,
  }));
  glow.scale.set(3.2, 3.2, 1);
  orb.add(core); orb.add(glow);
  orb.renderOrder = 5;
  scene.add(orb);

  // Positional beacon: the orb loops a pulse/aura sample, panned + attenuated by
  // the listener so you can home in on it by ear. Loaded async; once the buffer
  // is in we start it (and resume the context if a gesture already happened).
  const sound = new THREE.PositionalAudio(listener);
  sound.setRefDistance(3.5);
  sound.setRolloffFactor(1.3);
  sound.setDistanceModel('exponential');
  sound.setVolume(0.0);
  orb.add(sound);
  new THREE.AudioLoader().load(orbPulseUrl, (buffer) => {
    sound.setBuffer(buffer);
    sound.setLoop(true);
    if (!sound.isPlaying) sound.play();
  });

  // Collect sound: a "whoosh" sample, decoded once and fired from a fresh source
  // node each pickup so rapid collects can overlap.
  let collectBuffer = null;
  new THREE.AudioLoader().load(orbCollectUrl, (buffer) => { collectBuffer = buffer; });
  function chime() {
    if (!collectBuffer) return;
    const ctx = listener.context;
    const src = ctx.createBufferSource();
    src.buffer = collectBuffer;
    const g = ctx.createGain();
    g.gain.value = 0.7;
    src.connect(g).connect(ctx.destination);
    src.start();
  }

  let baseY = 0, count = 0;
  const rand = THREE.MathUtils.randFloat;

  function spawn(near) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(minDist, maxDist);
    const x = near.x + Math.cos(a) * d;
    const z = near.z + Math.sin(a) * d;
    baseY = terrainHeight(x, z) + 1.6;
    orb.position.set(x, baseY, z);
  }

  function update(camera, t) {
    orb.position.y = baseY + Math.sin(t * 1.5) * 0.22;       // bob
    core.rotation.y = t * 1.2;
    if (sound.buffer) sound.setVolume(0.7);  // steady beacon; the sample pulses itself

    const dx = orb.position.x - camera.position.x;
    const dz = orb.position.z - camera.position.z;
    if (dx * dx + dz * dz < collectRadius * collectRadius) {
      count += 1;
      chime();
      onCollect?.(count);
      spawn(camera.position);
    }
  }

  function resumeAudio() { if (listener.context.state === 'suspended') listener.context.resume().catch(() => {}); }

  function dispose() {
    window.removeEventListener('pointerdown', tryResume);
    window.removeEventListener('keydown', tryResume);
    try { if (sound.isPlaying) sound.stop(); } catch (_) { /* ignore */ }
    camera.remove(listener);
    scene.remove(orb);
    core.geometry.dispose(); core.material.dispose();
    glow.material.dispose(); glowTex.dispose();
  }

  return { spawn, update, resumeAudio, dispose, get count() { return count; } };
}
