// Relaxed-pace FPS controller. PointerLockControls owns the mouse-driven yaw/
// pitch; we add arrow-key look on top, plus WASD translation and collisions.
//
// Walk speed is intentionally low (1.6 m/s — about a slow human stroll).
// Head-bob is a very subtle weight shift, not a marching cadence.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { resolveCollisions } from './collision.js';

const WALK_SPEED = 1.6;           // m/s
const SPRINT_MULT = 2.9;          // Shift held → run (≈ 4.6 m/s — light jog)
const ACCEL = 14;                 // 1/s — ramp to target velocity
const FRICTION = 8;               // 1/s — ramp down when no input
const SPRINT_BLEND = 5;           // 1/s — how fast sprint shake ramps in/out
const EYE_HEIGHT = 1.85;          // metres — taller frame, less head-in-grass
const PLAYER_RADIUS = 0.4;
const BOB_FREQ = 2.4;             // Hz at full walking speed (≈ one step pair)
const BOB_AMP = 0.018;            // m — barely visible at walk
const SPRINT_BOB_AMP = 0.026;     // m — gentle weight shift, not a head-bang
const SPRINT_FREQ_BOOST = 1.18;   // tiny step-rate increase, not a 1.6× jolt
const LOOK_YAW_SPEED = 1.7;       // rad/s, arrow ← →
const LOOK_PITCH_SPEED = 1.3;     // rad/s, arrow ↑ ↓
const MAX_PITCH = Math.PI / 2 - 0.04;

export function buildPlayer(camera, domElement, scene) {
  const controls = new PointerLockControls(camera, domElement);
  camera.position.set(0, EYE_HEIGHT, 0);

  const keys = new Set();
  const velocity = new THREE.Vector3();
  const tmpForward = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let bobPhase = 0;
  let sprintFactor = 0;            // exponentially blends 0..1 between walk and sprint feel

  const kdown = e => keys.add(e.code);
  const kup   = e => keys.delete(e.code);
  window.addEventListener('keydown', kdown);
  window.addEventListener('keyup', kup);

  // ── Debug visuals for collisions ──
  const debugGroup = new THREE.Group();
  if (scene) scene.add(debugGroup);

  const _tmpV0 = new THREE.Vector3();
  const _tmpV1 = new THREE.Vector3();

  function clearDebugLines() {
    while (debugGroup.children.length) {
      const child = debugGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      debugGroup.remove(child);
    }
  }

  function showDebugCollisions(fromX, fromZ, toX, toZ, collisions) {
    clearDebugLines();
    if (!collisions.length) return;

    // Red line: intended position -> resolved position (total push vector)
    const pushGeo = new THREE.BufferGeometry().setFromPoints([
      _tmpV0.set(fromX, 0.05, fromZ),
      _tmpV1.set(toX,   0.05, toZ),
    ]);
    const pushMat = new THREE.LineBasicMaterial({
      color: 0xff3333,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const pushLine = new THREE.Line(pushGeo, pushMat);
    pushLine.renderOrder = 999;
    debugGroup.add(pushLine);

    // Yellow lines: player -> each colliding tree trunk
    for (const c of collisions) {
      const treeGeo = new THREE.BufferGeometry().setFromPoints([
        _tmpV0.set(c.playerX, 0.05, c.playerZ),
        _tmpV1.set(c.treeX,   0.05, c.treeZ),
      ]);
      const treeMat = new THREE.LineBasicMaterial({
        color: 0xffaa00,
        depthTest: false,
        transparent: true,
        opacity: 0.6,
      });
      const treeLine = new THREE.Line(treeGeo, treeMat);
      treeLine.renderOrder = 999;
      debugGroup.add(treeLine);
    }
  }

  function update(dt, world) {
    // Arrow-key look runs whether or not the pointer is locked — lets you
    // peek before clicking, and gives mouse-less users full camera control.
    const yawInput   = (keys.has('ArrowLeft')  ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    const pitchInput = (keys.has('ArrowUp')    ? 1 : 0) - (keys.has('ArrowDown')  ? 1 : 0);
    if (yawInput || pitchInput) {
      tmpEuler.setFromQuaternion(camera.quaternion);
      tmpEuler.y += yawInput   * LOOK_YAW_SPEED   * dt;
      tmpEuler.x += pitchInput * LOOK_PITCH_SPEED * dt;
      if (tmpEuler.x >  MAX_PITCH) tmpEuler.x =  MAX_PITCH;
      if (tmpEuler.x < -MAX_PITCH) tmpEuler.x = -MAX_PITCH;
      camera.quaternion.setFromEuler(tmpEuler);
    }

    if (!controls.isLocked) {
      // Bleed velocity to 0 when not in control of the body.
      velocity.multiplyScalar(Math.exp(-FRICTION * dt));
      return;
    }

    // WASD only. Arrows don't translate (they look).
    const fwdIn   = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const rightIn = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sprintingNow = keys.has('ShiftLeft') || keys.has('ShiftRight');

    // Smoothly blend sprint factor so neither speed nor bob snap on key press.
    const sprintTarget = sprintingNow ? 1 : 0;
    sprintFactor += (sprintTarget - sprintFactor) * (1 - Math.exp(-SPRINT_BLEND * dt));

    const moveSpeed = WALK_SPEED * (1 + sprintFactor * (SPRINT_MULT - 1));

    camera.getWorldDirection(tmpForward);
    tmpForward.y = 0;
    if (tmpForward.lengthSq() < 1e-6) tmpForward.set(0, 0, -1);
    tmpForward.normalize();
    tmpRight.crossVectors(tmpForward, camera.up).normalize();

    const targetVx = (tmpForward.x * fwdIn + tmpRight.x * rightIn) * moveSpeed;
    const targetVz = (tmpForward.z * fwdIn + tmpRight.z * rightIn) * moveSpeed;

    const inputMag = Math.hypot(fwdIn, rightIn);
    const ramp = inputMag > 0 ? ACCEL : FRICTION;
    const k = 1 - Math.exp(-ramp * dt);
    velocity.x += (targetVx - velocity.x) * k;
    velocity.z += (targetVz - velocity.z) * k;

    const nextX = camera.position.x + velocity.x * dt;
    const nextZ = camera.position.z + velocity.z * dt;
    const trees = world.getNearbyTrees(nextX, nextZ, PLAYER_RADIUS + 1);
    const result = resolveCollisions(nextX, nextZ, PLAYER_RADIUS, trees);
    const [resolvedX, resolvedZ] = result.pos;
    camera.position.x = resolvedX;
    camera.position.z = resolvedZ;

    showDebugCollisions(nextX, nextZ, resolvedX, resolvedZ, result.collisions);

    // Bob amplitude and frequency blend with sprintFactor so the shake eases
    // in/out instead of snapping. Amplitude stays small even at full sprint —
    // the goal is "weight shift", not "running with a camera on your head".
    const speed = Math.hypot(velocity.x, velocity.z);
    const speedNorm = Math.min(1, speed / (moveSpeed || 1));
    const bobAmp  = BOB_AMP  + (SPRINT_BOB_AMP - BOB_AMP) * sprintFactor;
    const bobFreq = BOB_FREQ * (1 + (SPRINT_FREQ_BOOST - 1) * sprintFactor);
    bobPhase += dt * bobFreq * Math.PI * 2 * speedNorm;
    camera.position.y = EYE_HEIGHT + Math.sin(bobPhase) * bobAmp * speedNorm;
  }

  function dispose() {
    window.removeEventListener('keydown', kdown);
    window.removeEventListener('keyup', kup);
    clearDebugLines();
    if (scene) scene.remove(debugGroup);
  }

  return { controls, update, dispose, EYE_HEIGHT, PLAYER_RADIUS, debugGroup };
}
