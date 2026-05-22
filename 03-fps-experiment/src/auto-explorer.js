// Autonomous "ethereal flythrough" — state-machine steering.
//
// Two states: STRAIGHT and TURNING.
//
//   STRAIGHT: heading locked. Each frame cast one ray forward. If a tree
//             clips the corridor within TRIGGER_DIST → switch to TURNING,
//             pick a side based on which side the blocker is on.
//
//   TURNING:  rotate at a fixed gentle rate toward the chosen side. Each
//             frame re-cast the forward ray. When clearance ≥ RELEASE_DIST
//             → back to STRAIGHT. RELEASE_DIST > TRIGGER_DIST is the
//             hysteresis gap that prevents constant flip-flopping.
//
// The yaw rate is low-passed so mode transitions feel like easing, not snaps.
// Speed brakes smoothly when a blocker is close, giving the turn more time.

import * as THREE from 'three';
import { resolveCollisions } from './collision.js';

const PLAYER_RADIUS = 0.45;

// ── Speed ──────────────────────────────────────────────────────────────────
const FLOAT_SPEED  = 2.5;
const SPEED_VARY   = 0.10;
const SPEED_PERIOD = 21;

// ── Avoidance geometry ─────────────────────────────────────────────────────
const LANE_PAD     = 2.0;             // m extra clearance per side
const TRIGGER_DIST = 10;              // m — enter TURNING when clearance < this
const RELEASE_DIST = 16;              // m — exit TURNING when clearance ≥ this
const SCAN_RANGE   = RELEASE_DIST + 2;

// ── Turn ───────────────────────────────────────────────────────────────────
const TURN_RATE = 0.40;               // rad/s constant rate while TURNING (~23°/s)
const YAW_SLEW  = 1.8;               // 1/s — low-pass so transitions ease

// ── Brake ──────────────────────────────────────────────────────────────────
const BRAKE_START = 12;
const BRAKE_MIN   = 0.32;
const BRAKE_SLEW  = 1.5;

// ── Altitude ───────────────────────────────────────────────────────────────
const HEIGHT_BASE     = 3.0;
const HEIGHT_AMP      = 2.6;
const HEIGHT_PERIOD_A = 26;
const HEIGHT_PERIOD_B = 11.7;
const HEIGHT_MIN      = 1.4;

// ── Look wobble ────────────────────────────────────────────────────────────
const LOOK_PROJ         = 12.0;
const LOOK_YAW_AMP      = 0.05;
const LOOK_PITCH_AMP    = 0.035;
const LOOK_YAW_PERIOD   = 22.0;
const LOOK_PITCH_PERIOD = 15.0;

export function buildAutoExplorer(camera) {
  camera.position.set(0, HEIGHT_BASE, 0);

  let elapsed      = 0;
  let heading      = Math.random() * Math.PI * 2;
  let state        = 'STRAIGHT';
  let turnSide     = 0;        // +1 = right, -1 = left
  let yawRateState = 0;
  let brakeState   = 1;
  let bootstrapped = false;

  const phase = {
    yaw:   Math.random() * Math.PI * 2,
    pitch: Math.random() * Math.PI * 2,
    speed: Math.random() * Math.PI * 2,
  };
  const tmpLook = new THREE.Vector3();

  // Distance the player corridor can travel along (dx,dz) before a tree clips it.
  function fwdClearance(trees, dx, dz, limit) {
    let block = limit;
    for (const t of trees) {
      const tx = t.x - camera.position.x;
      const tz = t.z - camera.position.z;
      const along = tx * dx + tz * dz;
      if (along <= 0 || along > limit) continue;
      const lat  = tx * dz - tz * dx;
      const safe = (t.colRadius || 0.3) + PLAYER_RADIUS + LANE_PAD;
      if (Math.abs(lat) >= safe) continue;
      const hit = Math.max(0, along - Math.sqrt(safe * safe - lat * lat));
      if (hit < block) block = hit;
    }
    return block;
  }

  // Nearest blocker lateral sign: positive = tree is to the LEFT.
  function findBlockerSide(trees, dx, dz, limit) {
    let bestLat = 0, bestHit = limit, found = false;
    for (const t of trees) {
      const tx = t.x - camera.position.x;
      const tz = t.z - camera.position.z;
      const along = tx * dx + tz * dz;
      if (along <= 0 || along > limit) continue;
      const lat  = tx * dz - tz * dx;
      const safe = (t.colRadius || 0.3) + PLAYER_RADIUS + LANE_PAD;
      if (Math.abs(lat) >= safe) continue;
      const hit = Math.max(0, along - Math.sqrt(safe * safe - lat * lat));
      if (hit < bestHit) { bestHit = hit; bestLat = lat; found = true; }
    }
    return found ? bestLat : null;
  }

  // One-shot 360° scan: orient toward the roomiest opening.
  function bootstrap(world) {
    const trees = world.getNearbyTrees(camera.position.x, camera.position.z, SCAN_RANGE + 4);
    let bestClear = -1, bestAngle = heading;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const c = fwdClearance(trees, Math.sin(a), Math.cos(a), SCAN_RANGE);
      if (c > bestClear) { bestClear = c; bestAngle = a; }
    }
    heading = bestAngle;
    yawRateState = 0;
  }

  function update(dt, world) {
    elapsed += dt;
    if (!bootstrapped) { bootstrap(world); bootstrapped = true; }

    const fwdX  = Math.sin(heading);
    const fwdZ  = Math.cos(heading);
    const trees = world.getNearbyTrees(camera.position.x, camera.position.z, SCAN_RANGE + 4);
    const clear = fwdClearance(trees, fwdX, fwdZ, SCAN_RANGE);

    // ── State machine ─────────────────────────────────────────────────────
    if (state === 'STRAIGHT') {
      if (clear < TRIGGER_DIST) {
        const lat = findBlockerSide(trees, fwdX, fwdZ, TRIGGER_DIST + 4);
        // Tree on the left (lat > 0) → steer right (+1); tree on right → left (-1).
        turnSide = lat !== null ? (lat >= 0 ? 1 : -1) : (Math.random() < 0.5 ? 1 : -1);
        state = 'TURNING';
      }
    } else {
      // Stay TURNING until forward is comfortably clear.
      if (clear >= RELEASE_DIST) {
        state    = 'STRAIGHT';
        turnSide = 0;
      }
    }

    // ── Yaw rate (low-passed) ─────────────────────────────────────────────
    const kYaw = 1 - Math.exp(-YAW_SLEW * dt);
    yawRateState += (turnSide * TURN_RATE - yawRateState) * kYaw;
    heading += yawRateState * dt;

    // ── Brake (low-passed) ────────────────────────────────────────────────
    let brakeTarget = 1;
    if (clear < BRAKE_START) {
      brakeTarget = BRAKE_MIN + (1 - BRAKE_MIN) * (clear / BRAKE_START);
    }
    const kBrake = 1 - Math.exp(-BRAKE_SLEW * dt);
    brakeState += (brakeTarget - brakeState) * kBrake;

    // ── Velocity ──────────────────────────────────────────────────────────
    const cruise = FLOAT_SPEED *
      (1 + SPEED_VARY * Math.sin(phase.speed + elapsed * (2 * Math.PI / SPEED_PERIOD)));
    const speed = cruise * brakeState;
    const vx = Math.sin(heading) * speed;
    const vz = Math.cos(heading) * speed;

    // ── Move + collision safety net ───────────────────────────────────────
    const nx = camera.position.x + vx * dt;
    const nz = camera.position.z + vz * dt;
    const ct = world.getNearbyTrees(nx, nz, PLAYER_RADIUS + 1);
    const { pos: [rx, rz] } = resolveCollisions(nx, nz, PLAYER_RADIUS, ct);
    camera.position.x = rx;
    camera.position.z = rz;

    // ── Altitude ──────────────────────────────────────────────────────────
    const h = HEIGHT_BASE
      + 0.62 * HEIGHT_AMP * Math.sin(elapsed * (2 * Math.PI / HEIGHT_PERIOD_A))
      + 0.38 * HEIGHT_AMP * Math.sin(elapsed * (2 * Math.PI / HEIGHT_PERIOD_B) + 1.7);
    camera.position.y = Math.max(HEIGHT_MIN, h);

    // ── Look direction ────────────────────────────────────────────────────
    const lookYaw = heading
      + LOOK_YAW_AMP * Math.sin(phase.yaw + elapsed * (2 * Math.PI / LOOK_YAW_PERIOD));
    const lookPitch = LOOK_PITCH_AMP
      * Math.sin(phase.pitch + elapsed * (2 * Math.PI / LOOK_PITCH_PERIOD));
    tmpLook.set(
      camera.position.x + Math.sin(lookYaw) * LOOK_PROJ,
      camera.position.y + Math.tan(lookPitch) * LOOK_PROJ,
      camera.position.z + Math.cos(lookYaw) * LOOK_PROJ,
    );
    camera.lookAt(tmpLook);
  }

  function dispose() {}

  return { controls: null, update, dispose, EYE_HEIGHT: HEIGHT_BASE, PLAYER_RADIUS, isAuto: true };
}
