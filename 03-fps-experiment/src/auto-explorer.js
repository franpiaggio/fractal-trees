// Autonomous "ethereal flythrough" mode.
//
// Design goal: never abrupt. The camera floats through the chunked forest at
// a constant walking speed, the heading meanders on a smooth sum-of-sines
// (no discrete repicks, no jumps), altitude drifts up and down so it
// sometimes skims the grass and sometimes lifts over the canopy, and the
// look direction stays nearly forward with only a tiny added wobble.
//
// Tree avoidance is a *forward corridor* scan, not a repulsion field: at
// each frame we look down a narrow cone ahead, find every tree whose lateral
// offset would clip the player's corridor, and add a yaw-rate nudge away
// from each one. Urgency ramps up smoothly as the tree gets closer, so the
// turn always begins early and finishes smoothly — never a swerve. The total
// yaw rate is hard-capped so even a tight cluster of trees can only turn the
// camera ~37°/s in the worst case.
//
// The existing `resolveCollisions` cylinder solver remains as a final
// safety net; in normal play the corridor avoidance keeps us off it.
//
// API parity with `buildPlayer`: returns { controls: null, update, dispose,
// EYE_HEIGHT, PLAYER_RADIUS }.

import * as THREE from 'three';
import { resolveCollisions } from './collision.js';

const PLAYER_RADIUS = 0.45;

// ── Forward motion ─────────────────────────────────────────────────────────
// Nearly constant speed. Variations >~10% read as "the camera is fidgeting".
const FLOAT_SPEED  = 2.5;             // m/s — calm but with a bit of forward intent
const SPEED_VARY   = 0.10;            // ± fraction on a slow sine
const SPEED_PERIOD = 21;              // s

// ── Heading drift ──────────────────────────────────────────────────────────
// Sum of three slow sines → C∞-smooth angular path, no discrete jumps ever.
// Each component's peak yaw-rate contribution is amp × freq (because we use
// the derivative). The sum is bounded by Σ(amp × freq) ≈ 0.077 rad/s,
// i.e. roughly 4.4°/s — a barely-perceptible meander.
const YAW_DRIFT = [
  { amp: 0.55, freq: 0.038, phase: 1.2 },   // ≈ 0.021 rad/s peak
  { amp: 0.40, freq: 0.069, phase: 2.7 },   // ≈ 0.028 rad/s peak
  { amp: 0.25, freq: 0.113, phase: 4.4 },   // ≈ 0.028 rad/s peak
];

// ── Tree avoidance (forward-corridor scan) ─────────────────────────────────
// Numbers here are tuned to **always clear a tree by ≥ CORRIDOR_PAD metres**
// at FLOAT_SPEED. Earlier we had a too-narrow pad + a per-tree urgency that
// faded with forward distance, so the nudge only got strong once the tree
// was already beside the camera — looked like grazing. Now: wider pad,
// stronger per-tree yaw, no distance fade on urgency (forward-distance is
// just an in/out filter), plus a soft brake when threats are tight.
const LOOK_AHEAD       = 14.0;        // m — bumped with speed so reaction-time-in-seconds is constant
const CORRIDOR_PAD     = 2.6;         // m — clearance band on each side beyond player+trunk radii
const AVOID_MAX_YAW    = 0.95;        // rad/s — peak yaw nudge at the trunk skin (per tree)
const YAW_RATE_CAP     = 1.10;        // rad/s — total cap (~63°/s); only reached in tight clusters
const BRAKE_MIN_FRAC   = 0.45;        // speed multiplier when a tree is hugging the corridor

// ── Smoothing (low-pass) ───────────────────────────────────────────────────
// Avoidance and brake both jump when a threat enters or leaves the corridor.
// Slewing the *output* through a first-order filter turns those steps into
// smooth ramps so the camera never snaps — it eases into a turn and eases
// out of it. Drift is already C∞ smooth so the filter is a no-op for it.
const YAW_SLEW   = 3.2;               // 1/s — yaw-rate time constant ≈ 0.31 s
const BRAKE_SLEW = 2.4;               // 1/s — brake time constant ≈ 0.42 s

// ── Altitude ───────────────────────────────────────────────────────────────
// Two long, non-integer-ratio sines. Peak height ~ HEIGHT_BASE + HEIGHT_AMP,
// floor clamped to HEIGHT_MIN so we don't dip into the ground.
const HEIGHT_BASE      = 3.0;
const HEIGHT_AMP       = 2.6;         // total swing ≈ 5.2 m peak-to-peak
const HEIGHT_PERIOD_A  = 26;          // s
const HEIGHT_PERIOD_B  = 11.7;        // s
const HEIGHT_MIN       = 1.4;         // m — never crash into grass

// ── Look direction ─────────────────────────────────────────────────────────
// Camera looks along heading with TINY wobble — heading itself already turns,
// so disagreement between body and eyes should be sub-degree most of the time.
const LOOK_PROJ       = 12.0;         // m — target distance for `lookAt`
const LOOK_YAW_AMP    = 0.06;         // rad (~3.4°)
const LOOK_PITCH_AMP  = 0.04;         // rad (~2.3°)
const LOOK_YAW_PERIOD = 19.0;         // s
const LOOK_PITCH_PERIOD = 13.5;       // s

export function buildAutoExplorer(camera) {
  camera.position.set(0, HEIGHT_BASE, 0);

  let elapsed = 0;
  // Random per-session offsets so two reloads don't trace the same path.
  const t0 = Math.random() * 1000;
  let heading = Math.random() * Math.PI * 2;
  // Low-passed state: what we apply to the camera each frame. Updated by a
  // first-order filter chasing the per-frame `target` values from avoidance.
  let yawRateState = 0;
  let brakeState   = 1;

  const phase = {
    yaw:   Math.random() * Math.PI * 2,
    pitch: Math.random() * Math.PI * 2,
    speed: Math.random() * Math.PI * 2,
  };

  const tmpLook = new THREE.Vector3();

  // d/dt of Σ amp·sin(freq·t + phase)  =  Σ amp·freq·cos(freq·t + phase).
  // Returns a continuous, slowly-varying yaw-rate in rad/s.
  function smoothDriftRate(time) {
    let r = 0;
    for (const c of YAW_DRIFT) {
      r += c.amp * c.freq * Math.cos(c.freq * time + c.phase);
    }
    return r;
  }

  // Sample trees inside a forward corridor; each contributes a yaw nudge
  // away from itself, weighted by **lateral closeness only** (not by forward
  // distance). Returns { yawRate, brake } — `brake` ∈ [BRAKE_MIN_FRAC, 1] is a
  // speed multiplier that drops as the tightest tree in the corridor gets
  // closer to the corridor centerline.
  function avoidanceField(world) {
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    const trees = world.getNearbyTrees(
      camera.position.x + fwdX * (LOOK_AHEAD * 0.5),
      camera.position.z + fwdZ * (LOOK_AHEAD * 0.5),
      LOOK_AHEAD * 0.7 + 2,
    );
    let yawRate = 0;
    let tightest = 1;                                   // 0 = trunk skin, 1 = no threat
    for (const t of trees) {
      const dx = t.x - camera.position.x;
      const dz = t.z - camera.position.z;
      const along = dx * fwdX + dz * fwdZ;
      // Include trees just behind too — they still threaten our flank as we
      // exit, and a touch of nudge keeps us from clipping on the way past.
      if (along < -PLAYER_RADIUS || along > LOOK_AHEAD) continue;
      const lateral = dx * fwdZ - dz * fwdX;
      const safe    = (t.colRadius || 0.3) + PLAYER_RADIUS + CORRIDOR_PAD;
      const absLat  = Math.abs(lateral);
      if (absLat > safe) continue;

      const lateralFrac = absLat / safe;                // 0 = trunk skin, 1 = corridor edge
      if (lateralFrac < tightest) tightest = lateralFrac;

      // Yaw nudge: only trees AHEAD turn the camera (turning toward a
      // behind-flank tree would steer back into it). Strength is purely a
      // function of how close the tree is to our centerline.
      if (along > 0) {
        const lateralU = 1 - lateralFrac;
        const side = lateral === 0 ? 1 : Math.sign(lateral);
        yawRate += -side * lateralU * AVOID_MAX_YAW;
      }
    }
    // Lerp brake from BRAKE_MIN_FRAC (tightest=0) up to 1 (tightest=1).
    const brake = BRAKE_MIN_FRAC + (1 - BRAKE_MIN_FRAC) * tightest;
    return { yawRate, brake };
  }

  function update(dt, world) {
    elapsed += dt;

    // Heading: continuous drift + corridor avoidance, low-passed, integrated.
    // The slewing turns step-changes in `avoidRate` into smooth ramps so the
    // camera eases into and out of every correction — no snap.
    const driftRate = smoothDriftRate(elapsed + t0);
    const { yawRate: avoidRate, brake } = avoidanceField(world);
    let yawRateTarget = driftRate + avoidRate;
    if (yawRateTarget >  YAW_RATE_CAP) yawRateTarget =  YAW_RATE_CAP;
    if (yawRateTarget < -YAW_RATE_CAP) yawRateTarget = -YAW_RATE_CAP;
    const kYaw = 1 - Math.exp(-YAW_SLEW * dt);
    yawRateState += (yawRateTarget - yawRateState) * kYaw;
    heading += yawRateState * dt;

    // Velocity (heading × nearly-constant speed × low-passed brake). Avoidance
    // only changes heading; the brake only changes magnitude — both smoothed,
    // both slow to step.
    const kBrake = 1 - Math.exp(-BRAKE_SLEW * dt);
    brakeState += (brake - brakeState) * kBrake;
    const cruise = FLOAT_SPEED * (1 + SPEED_VARY *
                   Math.sin(phase.speed + elapsed * (2 * Math.PI / SPEED_PERIOD)));
    const speed = cruise * brakeState;
    const vx = Math.sin(heading) * speed;
    const vz = Math.cos(heading) * speed;

    // Move + collision safety net (should rarely fire — avoidance turns early).
    const nextX = camera.position.x + vx * dt;
    const nextZ = camera.position.z + vz * dt;
    const collTrees = world.getNearbyTrees(nextX, nextZ, PLAYER_RADIUS + 1);
    const [rx, rz] = resolveCollisions(nextX, nextZ, PLAYER_RADIUS, collTrees);
    camera.position.x = rx;
    camera.position.z = rz;

    // Altitude — long non-integer periods so the rise/fall feels natural.
    const h = HEIGHT_BASE
            + 0.62 * HEIGHT_AMP * Math.sin(elapsed * (2 * Math.PI / HEIGHT_PERIOD_A))
            + 0.38 * HEIGHT_AMP * Math.sin(elapsed * (2 * Math.PI / HEIGHT_PERIOD_B) + 1.7);
    camera.position.y = Math.max(HEIGHT_MIN, h);

    // Look direction: nearly the heading, plus a tiny wobble. The heading is
    // already drifting, so layering big amplitudes on top would feel busy.
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
