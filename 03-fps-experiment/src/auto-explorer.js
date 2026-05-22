// Autonomous "ethereal flythrough" mode — planning-based steering.
//
// Earlier versions used a per-tree repulsion field. That works for one or two
// scattered obstacles but it's *reactive*: the camera only feels a tree once
// it's in the corridor, and the resulting yaw nudge is local — it can't see
// past the first tree to plan around the next. With dense forest that read
// as "constant little corrections", and occasionally still grazed.
//
// This rewrite plans instead of reacts. Each frame:
//
//   1. Cast PROBE_COUNT fan-shaped probes spanning ±PROBE_HALF_FAN around
//      the current heading. For each probe, compute the distance the camera
//      could travel along that ray before any tree's safety cylinder clipped
//      the corridor.  (Closed form: ray-vs-cylinder along + perpendicular.)
//
//   2. Score each probe = clearance − small penalty for deviating from
//      current heading. Pick the best. Result: `bestDelta` (angle offset to
//      steer toward) and `bestClear` (how far the chosen lane is open).
//
//   3. Run `bestDelta` through *two* first-order low-pass filters in series
//      — one on the desired angle, one on the yaw rate — so the camera
//      cannot snap. Combined response time ≈ 0.7 s; with PROBE_RANGE = 28 m
//      and FLOAT_SPEED = 2.5 m/s we have ~11 s of lookahead, so smoothing
//      this hard never lets us hit a tree.
//
//   4. Brake speed when `bestClear` is short (tight passes only).
//
// A one-shot 360° scan at startup sets the initial heading toward the
// roomiest opening — the camera will never charge straight into a trunk on
// first frame.
//
// Existing `resolveCollisions` cylinder solver still acts as a final safety
// net behind everything.

import * as THREE from 'three';
import { resolveCollisions } from './collision.js';

const PLAYER_RADIUS = 0.45;

// ── Forward motion ─────────────────────────────────────────────────────────
const FLOAT_SPEED   = 2.5;          // m/s — calm forward intent (+30 % over original)
const SPEED_VARY    = 0.10;
const SPEED_PERIOD  = 21;

// ── Planning-based avoidance ───────────────────────────────────────────────
// No procedural drift: heading stays locked unless the planner actually sees
// a tree blocking the straight-ahead lane. The "go straight" branch returns
// bestDelta = 0 without even scanning the fan, so deltaState relaxes to 0
// and the camera holds course.
const PROBE_COUNT     = 13;            // odd → straight-ahead always sampled
const PROBE_HALF_FAN  = Math.PI / 2;   // ± 90°  — wide enough to find any escape
const PROBE_RANGE     = 28;            // m — plan ~ 11 s ahead at cruise
const PROBE_LANE_PAD  = 2.2;           // m — required lateral clearance on top of trunk+player
const CLEAR_AHEAD     = 18;            // m — straight clearance ≥ this → hold heading, no scan
const STEER_COST_WT   = 0.08;          // how much to prefer "less turn" when clearance ties
const TURN_GAIN       = 1.3;           // rad/s per rad of bestDelta (before slewing)
const YAW_RATE_CAP    = 0.85;          // rad/s — hard cap (~ 49°/s) — only hit in tight clusters

// ── Brake (only when chosen lane's clearance is short) ─────────────────────
const BRAKE_FREE_DIST = 14;            // m — full speed beyond this
const BRAKE_MIN       = 0.40;          // ratio when at near-zero clearance

// ── Two-stage smoothing — both filters are first-order low-pass ────────────
// Stage A smooths the *target angle* coming out of the probe scorer.
// Stage B smooths the *yaw rate* before it integrates into heading.
// Cascading gives a more rounded response than a single pole — no step at
// any point in the pipeline.
const DELTA_SLEW = 1.5;                // 1/s — τ ≈ 0.67 s
const YAW_SLEW   = 3.0;                // 1/s — τ ≈ 0.33 s
const BRAKE_SLEW = 2.3;                // 1/s — τ ≈ 0.43 s

// ── Altitude ───────────────────────────────────────────────────────────────
const HEIGHT_BASE      = 3.0;
const HEIGHT_AMP       = 2.6;
const HEIGHT_PERIOD_A  = 26;
const HEIGHT_PERIOD_B  = 11.7;
const HEIGHT_MIN       = 1.4;

// ── Look direction wobble (tiny — the heading itself already drifts) ───────
const LOOK_PROJ         = 12.0;
const LOOK_YAW_AMP      = 0.06;
const LOOK_PITCH_AMP    = 0.04;
const LOOK_YAW_PERIOD   = 19.0;
const LOOK_PITCH_PERIOD = 13.5;

export function buildAutoExplorer(camera) {
  camera.position.set(0, HEIGHT_BASE, 0);

  let elapsed = 0;
  let heading = Math.random() * Math.PI * 2;

  // Filter state — both stages start coherent with their inputs.
  let deltaState   = 0;
  let yawRateState = 0;
  let brakeState   = 1;
  let bootstrapped = false;

  const phase = {
    yaw:   Math.random() * Math.PI * 2,
    pitch: Math.random() * Math.PI * 2,
    speed: Math.random() * Math.PI * 2,
  };
  const tmpLook = new THREE.Vector3();

  // Distance the player corridor can travel along (dx, dz) before clipping a tree.
  // Closed-form ray-vs-cylinder: along-axis distance to the cylinder's first hit.
  function probeClearance(trees, dx, dz) {
    let block = PROBE_RANGE;
    for (const tree of trees) {
      const tx = tree.x - camera.position.x;
      const tz = tree.z - camera.position.z;
      const along   = tx * dx + tz * dz;
      if (along <= 0 || along > PROBE_RANGE) continue;
      const lateral = tx * dz - tz * dx;
      const safe    = (tree.colRadius || 0.3) + PLAYER_RADIUS + PROBE_LANE_PAD;
      const absLat  = Math.abs(lateral);
      if (absLat >= safe) continue;
      // Hit at along − sqrt(safe² − lat²) — back off the half-chord so we
      // don't treat a tree's centre as the impact point.
      const half = Math.sqrt(safe * safe - absLat * absLat);
      const hit  = Math.max(0, along - half);
      if (hit < block) block = hit;
    }
    return block;
  }

  // Score the fan and return the best (delta, clearance) pair.
  // Fast-path: if the straight-ahead lane is already CLEAR_AHEAD-clear, skip
  // the scan and return delta=0. This is the whole point of the rewrite —
  // the camera should hold its heading until something actually requires a
  // turn, not constantly re-pick the marginally-best lane.
  function evaluateProbes(world) {
    const trees = world.getNearbyTrees(camera.position.x, camera.position.z, PROBE_RANGE + 4);
    const straightClear = probeClearance(trees, Math.sin(heading), Math.cos(heading));
    if (straightClear >= CLEAR_AHEAD) {
      return { bestDelta: 0, bestClear: straightClear };
    }
    let bestScore = -Infinity;
    let bestDelta = 0;
    let bestClear = 0;
    for (let i = 0; i < PROBE_COUNT; i++) {
      const t = i / (PROBE_COUNT - 1);
      const delta = -PROBE_HALF_FAN + 2 * PROBE_HALF_FAN * t;
      const a = heading + delta;
      const clear = probeClearance(trees, Math.sin(a), Math.cos(a));
      const score = (clear / PROBE_RANGE) - STEER_COST_WT * Math.abs(delta) / PROBE_HALF_FAN;
      if (score > bestScore) { bestScore = score; bestDelta = delta; bestClear = clear; }
    }
    return { bestDelta, bestClear };
  }

  // Run once: full 360° pick so we never start facing a tree.
  function bootstrapInitialHeading(world) {
    const trees = world.getNearbyTrees(camera.position.x, camera.position.z, PROBE_RANGE + 4);
    const N = 24;
    let bestClear = -1;
    let bestAngle = heading;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const clear = probeClearance(trees, Math.sin(a), Math.cos(a));
      if (clear > bestClear) { bestClear = clear; bestAngle = a; }
    }
    heading = bestAngle;
    deltaState = 0;
    yawRateState = 0;
  }

  function update(dt, world) {
    elapsed += dt;

    if (!bootstrapped) {
      bootstrapInitialHeading(world);
      bootstrapped = true;
    }

    // ── Plan ────────────────────────────────────────────────────────────
    const { bestDelta, bestClear } = evaluateProbes(world);

    // ── Stage A: low-pass the desired angle ────────────────────────────
    const kDelta = 1 - Math.exp(-DELTA_SLEW * dt);
    deltaState += (bestDelta - deltaState) * kDelta;

    // ── Stage B: convert smoothed angle → desired yaw rate, low-pass ──
    // No drift term — when the planner says "go straight" (deltaState → 0)
    // the yaw target is exactly 0 and the heading stays locked.
    let yawTarget = deltaState * TURN_GAIN;
    if (yawTarget >  YAW_RATE_CAP) yawTarget =  YAW_RATE_CAP;
    if (yawTarget < -YAW_RATE_CAP) yawTarget = -YAW_RATE_CAP;
    const kYaw = 1 - Math.exp(-YAW_SLEW * dt);
    yawRateState += (yawTarget - yawRateState) * kYaw;
    heading += yawRateState * dt;

    // ── Brake target from chosen-lane clearance, low-passed ────────────
    let brakeTarget = 1;
    if (bestClear < BRAKE_FREE_DIST) {
      brakeTarget = BRAKE_MIN + (1 - BRAKE_MIN) * (bestClear / BRAKE_FREE_DIST);
    }
    const kBrake = 1 - Math.exp(-BRAKE_SLEW * dt);
    brakeState += (brakeTarget - brakeState) * kBrake;

    // ── Velocity ──────────────────────────────────────────────────────
    const cruise = FLOAT_SPEED * (1 + SPEED_VARY *
                   Math.sin(phase.speed + elapsed * (2 * Math.PI / SPEED_PERIOD)));
    const speed = cruise * brakeState;
    const vx = Math.sin(heading) * speed;
    const vz = Math.cos(heading) * speed;

    // ── Move + collision safety net ───────────────────────────────────
    const nextX = camera.position.x + vx * dt;
    const nextZ = camera.position.z + vz * dt;
    const collTrees = world.getNearbyTrees(nextX, nextZ, PLAYER_RADIUS + 1);
    const [rx, rz] = resolveCollisions(nextX, nextZ, PLAYER_RADIUS, collTrees);
    camera.position.x = rx;
    camera.position.z = rz;

    // ── Altitude ──────────────────────────────────────────────────────
    const h = HEIGHT_BASE
            + 0.62 * HEIGHT_AMP * Math.sin(elapsed * (2 * Math.PI / HEIGHT_PERIOD_A))
            + 0.38 * HEIGHT_AMP * Math.sin(elapsed * (2 * Math.PI / HEIGHT_PERIOD_B) + 1.7);
    camera.position.y = Math.max(HEIGHT_MIN, h);

    // ── Look direction ────────────────────────────────────────────────
    const lookYaw = heading + LOOK_YAW_AMP *
                    Math.sin(phase.yaw + elapsed * (2 * Math.PI / LOOK_YAW_PERIOD));
    const lookPitch = LOOK_PITCH_AMP *
                      Math.sin(phase.pitch + elapsed * (2 * Math.PI / LOOK_PITCH_PERIOD));
    tmpLook.set(
      camera.position.x + Math.sin(lookYaw) * LOOK_PROJ,
      camera.position.y + Math.tan(lookPitch) * LOOK_PROJ,
      camera.position.z + Math.cos(lookYaw) * LOOK_PROJ,
    );
    camera.lookAt(tmpLook);
  }

  function dispose() { /* no listeners to clean up */ }

  return {
    controls: null,
    update,
    dispose,
    EYE_HEIGHT: HEIGHT_BASE,
    PLAYER_RADIUS,
    isAuto: true,
  };
}
