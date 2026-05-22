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
import { gsap } from 'gsap';
import { resolveCollisions } from './collision.js';

const PLAYER_RADIUS = 0.45;

// ── Speed ──────────────────────────────────────────────────────────────────
const FLOAT_SPEED  = 2.5;
const SPEED_VARY   = 0.10;
const SPEED_PERIOD = 21;

// ── Avoidance geometry ─────────────────────────────────────────────────────
const LANE_PAD     = 1.0;             // m extra clearance per side
const TRIGGER_DIST = 8;               // m — enter TURNING when this close
const RELEASE_DIST = 15;              // m — exit TURNING once this clear
const SCAN_RANGE   = RELEASE_DIST + 2;
// When picking a turn side, evaluate clearance at this angle offset to choose
// the side with more room (avoids turning into another tree cluster).
const SIDE_PROBE   = 0.4;             // rad — ~23° offset for left/right eval

// ── Turn ───────────────────────────────────────────────────────────────────
const TURN_RATE = 0.45;               // rad/s while TURNING (~26°/s)
const YAW_SLEW  = 3.0;               // 1/s — faster ramp so turn starts immediately

// ── Brake ──────────────────────────────────────────────────────────────────
const BRAKE_START = 8;
const BRAKE_MIN   = 0.32;
const BRAKE_SLEW  = 1.5;

// ── Altitude / roll / look ────────────────────────────────────────────────
// All oscillations driven by GSAP tweens on an `animated` object so the
// easing curves (power2.inOut, sine.inOut) give the motion a weightless,
// floaty quality rather than the mechanical feel of raw sines.
const HEIGHT_BASE = 3.0;
const HEIGHT_MIN  = 1.4;

const LOOK_PROJ         = 12.0;
const LOOK_YAW_AMP      = 0.05;
const LOOK_PITCH_AMP    = 0.03;
const LOOK_YAW_PERIOD   = 22.0;
const LOOK_PITCH_PERIOD = 15.0;

export function buildAutoExplorer(camera, scene) {
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

  // ── GSAP-driven animated values ───────────────────────────────────────────
  // GSAP updates these each RAF tick; the game loop reads them.
  // power2.inOut on height feels like buoyancy — slows at peaks/troughs.
  // sine.inOut on roll gives a gentle "riding a wave" banking.
  // speedBreath is a subtle inhale/exhale in forward speed.
  const animated = { heightOffset: 0, roll: 0, speedBreath: 1.0 };

  const _tweens = [
    gsap.to(animated, {
      heightOffset: 2.4,
      duration: 8,
      ease: 'power2.inOut',
      repeat: -1,
      yoyo: true,
    }),
    gsap.to(animated, {
      roll: 0.022,             // ~1.3° — subtle banking
      duration: 11,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: 2.5,              // offset so roll and height don't peak together
    }),
    gsap.to(animated, {
      speedBreath: 1.10,
      duration: 13,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: 1,
    }),
  ];

  // ── Debug line: red = TURNING (collision ahead), green = STRAIGHT (free) ─
  const _dbgMat = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false, linewidth: 2, visible: false });
  const _dbgPts = new Float32Array(6); // [x0,y0,z0, x1,y1,z1]
  const _dbgGeo = new THREE.BufferGeometry();
  _dbgGeo.setAttribute('position', new THREE.BufferAttribute(_dbgPts, 3));
  const _dbgLine = new THREE.Line(_dbgGeo, _dbgMat);
  _dbgLine.renderOrder = 999;
  _dbgLine.frustumCulled = false;
  const debugGroup = new THREE.Group();
  debugGroup.add(_dbgLine);
  if (scene) scene.add(debugGroup);

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
          // Pick the side with more forward clearance (not just blocker direction).
        const clL = fwdClearance(trees, Math.sin(heading - SIDE_PROBE), Math.cos(heading - SIDE_PROBE), SCAN_RANGE);
        const clR = fwdClearance(trees, Math.sin(heading + SIDE_PROBE), Math.cos(heading + SIDE_PROBE), SCAN_RANGE);
        turnSide = clR >= clL ? 1 : -1;
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
    const speed = FLOAT_SPEED * animated.speedBreath * brakeState;
    const vx = Math.sin(heading) * speed;
    const vz = Math.cos(heading) * speed;

    // ── Move + collision safety net ───────────────────────────────────────
    const nx = camera.position.x + vx * dt;
    const nz = camera.position.z + vz * dt;
    const ct = world.getNearbyTrees(nx, nz, PLAYER_RADIUS + 1);
    const { pos: [rx, rz] } = resolveCollisions(nx, nz, PLAYER_RADIUS, ct);
    camera.position.x = rx;
    camera.position.z = rz;

    // ── Altitude (GSAP-driven) ────────────────────────────────────────────
    camera.position.y = Math.max(HEIGHT_MIN, HEIGHT_BASE + animated.heightOffset);

    // ── Debug bar ─────────────────────────────────────────────────────────
    // A horizontal bar perpendicular to heading at TRIGGER_DIST ahead.
    // Visible from first-person as a horizontal line crossing the view.
    // Green = STRAIGHT (free), Red = TURNING (collision committed).
    {
      const gx = camera.position.x + fwdX * TRIGGER_DIST;
      const gz = camera.position.z + fwdZ * TRIGGER_DIST;
      const px = Math.cos(heading) * 3;   // perpendicular, 3 m each side
      const pz = -Math.sin(heading) * 3;
      _dbgPts[0] = gx - px; _dbgPts[1] = camera.position.y; _dbgPts[2] = gz - pz;
      _dbgPts[3] = gx + px; _dbgPts[4] = camera.position.y; _dbgPts[5] = gz + pz;
    }
    _dbgGeo.attributes.position.needsUpdate = true;
    _dbgMat.color.set(state === 'TURNING' ? 0xff2200 : 0x00ff44);

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
    // Banking roll applied AFTER lookAt so it's in camera local space.
    // Positive roll tilts horizon left (banking right), and vice versa.
    // We add a subtle extra tilt while TURNING so avoidance feels physical.
    const turningLean = turnSide * 0.015;  // lean into the turn
    camera.rotateZ(animated.roll + turningLean);
  }

  function dispose() {
    _tweens.forEach(t => t.kill());
    _dbgGeo.dispose();
    _dbgMat.dispose();
  }

  return { controls: null, update, dispose, debugGroup, EYE_HEIGHT: HEIGHT_BASE, PLAYER_RADIUS, isAuto: true };
}
