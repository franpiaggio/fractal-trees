# 02 — FPS infinite forest

> A first-person walk through a streamed, instanced forest with collisions,
> a two-stage fluffy grass carpet, atmospheric fog, and head-bob that scales
> with sprint. The world generates around you as you move; nothing is loaded
> ahead of time.

For the universal concepts, performance principles, and attention-to-detail
checklist that apply to every version, see the **[top-level README](../README.md)**.

---

## What's distinct about this version

| | |
| --- | --- |
| **Camera** | First-person `PointerLockControls` at **1.85 m** eye height. Mouse to look, arrow keys also look (yaw + pitch). |
| **Movement** | **WASD** walks at 1.6 m/s. **Shift** sprints at 2.9× (≈ 4.6 m/s) with a smoothly-blended `sprintFactor`. |
| **Head-bob** | Subtle weight-shift sine at the eye level: 0.018 m / 2.4 Hz walking, 0.026 m / 2.83 Hz sprinting. Both amp + freq blend in/out with sprint, so the camera never snaps. |
| **Collisions** | Cylinder-vs-cylinder in XZ; two-pass pushout slides you along trunks instead of stopping. |
| **World generation** | Infinite deterministic 32 m chunk grid. A 9×9 hot square (`VIEW_CHUNKS = 4`) follows the player → **~1 600 trees active**. |
| **Tree draw calls** | **10 total** — one `InstancedMesh` per (template × {branches, leaves}); a per-frame frustum test packs only the visible trees into the buffers. |
| **FOV culling** | Manual: every active tree is tested against the camera frustum each frame; `InstancedMesh.frustumCulled = false` so we own the culling. |
| **Shadows** | Sun follows the player so a tight ±22 m shadow frustum stays useful; the instanced forest doesn't cast shadows (way too many casters) — ground receives only. |
| **Ground** | Procedural canvas texture (multi-octave value noise blending three greens with dirt patches), tiled every 10 m. |
| **Grass** | One `InstancedMesh` of **518 400 blades** at ~100/m². Single draw call; world-stable infinite-tile wrap; smoothstep edge-fade hidden inside fog. |
| **Post-processing** | `RenderPass → Vignette+grade → SMAA → OutputPass`. **No SSAO, no Bloom** — they were the look-up-at-the-sky crash. |
| **DPR cap** | `Math.min(devicePixelRatio, 1.25)` — retina at 2.0 was the dominant fragment cost. |
| **Fog** | Linear `THREE.Fog`, **8–40 m**. Tight on purpose so the grass patch boundary lives in dense fog and is never visible. |

> The two pieces of EZ-Tree integration that are non-obvious live in
> `tree-templates.js`: `tuneLeaves()` swaps to alpha-test + opaque pass, and
> `patchLeafInstancing()` repairs EZ-Tree's leaf shader (see "The leaf
> instancing bug" below — without it, all instanced leaves render at the
> origin).

---

## Quick start

```bash
cd 02-fps-infinite-forest
npm install
npm run dev          # → http://localhost:5174
```

Click the canvas to lock the pointer; press <kbd>Esc</kbd> to release.

| Key | Action |
| --- | --- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Walk |
| <kbd>Shift</kbd> | Sprint (ramps in smoothly) |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> | Look (yaw + pitch) — works even when unlocked |
| Mouse (when locked) | Look |

---

## Project layout

```
02-fps-infinite-forest/
├── index.html             ← canvas, pointer-lock overlay, crosshair, HUD
├── package.json
├── vite.config.js
└── src/
    ├── main.js            ← renderer, scene, render loop, glue
    ├── environment.js     ← sky, sun (player-anchored), procedural ground, fog
    ├── tree-templates.js  ← EZ-Tree presets + leaf-instancing patch
    ├── chunk.js           ← deterministic per-chunk tree placement
    ├── world.js           ← chunk streaming + InstancedMesh pools + FOV cull
    ├── collision.js       ← player-vs-trunk cylinder resolver
    ├── player.js          ← PointerLockControls + WASD + Shift + arrows + collisions + bob
    ├── grass.js           ← infinite-tile fluffy grass (vertex-shader-driven)
    ├── wind.js            ← shared `uTime` driver for all leaf materials
    └── postprocessing.js  ← EffectComposer: Vignette + SMAA
```

---

## Architecture

```
                              main.js
                                 │
   ┌──────────────┬──────────────┼──────────────┬──────────────┐
   │              │              │              │              │
environment.js  postprocessing.js   player.js   grass.js     world.js
 (sun/sky/fog/    (Vignette + SMAA)  (PLC + WASD +  (vertex-       (chunks +
  canvas ground)                      Shift + bob +  shader         InstancedMesh
                                      arrows)        infinite       pools +
                                            │       wrap)           FOV cull)
                                         collision.js                  │
                                                                 chunk.js + tree-templates.js
```

### Streaming model

The world is a flat 2D grid of 32-meter chunks indexed by `(cx, cz)`. Each
chunk is a pure function of `(cx, cz, worldSeed)` — a small `mulberry32` RNG
seeded by a hash of those three numbers produces the same tree list every
time. Walking back to a chunk shows you the same trees.

When the player crosses a chunk boundary, `world.update()` re-runs the
active-set computation: build the (2·VIEW_CHUNKS+1)² square of wanted chunks,
generate any not yet active, drop any no-longer-wanted, flatten the surviving
trees into a `candidates` array. Active tree count stays roughly constant
(~1 600) regardless of how far you walk.

### FOV culling

Every frame:

```js
projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
frustum.setFromProjectionMatrix(projView);

for (const tree of candidates) {
  sphere.center.set(tree.x, height/2, tree.z);
  sphere.radius = height * 0.7;
  if (!frustum.intersectsSphere(sphere)) continue;
  // pack matrix into pool[tree.templateIdx] at the next slot
}
pool.count = visible_count;
pool.instanceMatrix.needsUpdate = true;
```

Result: only trees inside the camera frustum get their vertex shader invoked.
Typically 25–35 % of the candidates → **400–600 trees rendered per frame**.

### Collisions

`world.getNearbyTrees(x, z, radius)` scans only the 3×3 chunks around the
queried point — ~180 trees max, ~20 typical. The resolver in `collision.js`
does two passes of cylinder pushout, which handles the "wedged between two
trunks" edge case cleanly.

### Grass (infinite-tile wrap with hidden boundary)

This is the trickiest piece. We want a dense fluffy carpet that:

1. Stays under the player no matter how far they walk
2. Never visibly "appears" in front of them as they advance
3. Has world-stable blade positions (so a blade you see doesn't drift)

The solution is the **wrap trick**: one `InstancedMesh` of `GRID_SIDE²` blades
with *identity* matrices. The vertex shader computes each blade's world
position from `gl_InstanceID` + a `uPlayerCell` uniform (the player's position
floored to the cell grid), with a modulo so instances re-map to new world
cells as the patch slides:

```glsl
vec2 playerCell  = uPlayerCell;
vec2 patchMod    = mod(playerCell, gridSide);
vec2 wrap        = mod(vec2(gIx, gIz) - patchMod + gridSide, gridSide);
vec2 gWorldCell  = playerCell - gridSide * 0.5 + wrap;
```

`gWorldCell` is *integer* and *world-stable* for a given instance position
relative to the patch. Per-cell hash seeds rotation, scale, and position
jitter — so each world cell always has the same blade.

**Hiding the boundary**: a `smoothstep` scale-fade scales blades to zero in
the outer 12 % of the patch radius (`edgeFadeStart = 0.88`). That band sits
at 31.7–36 m where fog opacity is already 74 % → 100 %, so the fade is
literally invisible. Players never see blades pop in.

**Wind**: a single low-frequency gust signal travels along `uWindDir`; tiny
per-blade jitter keeps it organic but the whole field waves *together* — no
"tentacle" motion.

### Post-processing

| Pass | Role | Cost |
| --- | --- | --- |
| **RenderPass** | The scene itself, into the composer target | full |
| **Vignette + grade** | Custom `ShaderPass`: shadow lift, contrast, saturation, warm tint, soft vignette | trivial |
| **SMAA** | Edge AA at full resolution | low |
| **OutputPass** | Tone-mapping + colorspace conversion (terminates the chain) | trivial |

`SSAOPass` and `UnrealBloomPass` are intentionally commented out in
`postprocessing.js`. They were the dominant cost at retina DPR and bloom
on the sun-direction HDR fragments was visibly burning the sky. The current
pipeline is light enough that "looking up at the canopy" no longer stutters.

---

## The leaf instancing bug (and the fix)

EZ-Tree's leaf material installs an `onBeforeCompile` that replaces the
standard `#include <project_vertex>` shader chunk. That replacement **drops
the `#ifdef USE_INSTANCING / mvPosition = instanceMatrix * mvPosition;`
block**. The result: when EZ-Tree's leaf material is mounted on an
`InstancedMesh`, every leaf instance renders at the template's origin (0,0,0)
— so the whole forest's worth of leaves piles up at a single point. From a
walking player's POV: "leaves only show on one tree, the rest look like
spiky bare branches."

The fix lives in `tree-templates.js → patchLeafInstancing(mat)`. After
EZ-Tree's `onBeforeCompile` runs, we patch the shader with:

```glsl
// Inject the missing instanceMatrix multiply before the modelView transform:
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
```

We also reroute the wind-noise simplex sample through the instance-world
position so different trees sway with different phases instead of in unison.

This is the single most important non-obvious bit of integration code in
this version. Without it, the "FPS forest" experience is broken — and it
took several iterations to track down (the symptom looks like a material/
visibility bug, not a transform bug).

---

## Performance specifics for this version

(Generic principles are in the [parent README](../README.md#performance-principles-apply-to-every-version);
items below are unique to this implementation.)

- **Tree pool capped at 10 draw calls.** No matter how far you walk, this number doesn't grow.
- **Matrix buffer is `DynamicDrawUsage`** so the per-frame instance-matrix upload is cheap.
- **No allocations in the per-frame hot loop.** All vectors, matrices, frustum, and bounding sphere are workspace fields.
- **Sun follows the player.** A 2048² shadow map with a tight ±22 m frustum stays crisp at any walked distance.
- **Instanced forest doesn't cast shadows.** Drawing 400+ trees a second time into the shadow buffer would dominate the frame.
- **Grass is a *single* `InstancedMesh`.** Identity matrices, all per-vertex math GPU-side; CPU per-frame cost is two uniform writes.
- **DPR capped at 1.25.** Retina at 2.0 was the main reason "looking up" stuttered.
- **SSAO and Bloom intentionally removed** — they were the dominant cost in this pipeline and SSAO's contribution wasn't worth it without a more substantial geometry depth complexity.

---

## Tuning knobs

| File | Field | Default | Effect |
| --- | --- | --- | --- |
| `chunk.js` | `CHUNK_SIZE` | 32 | Smaller → finer streaming, more chunk overhead. |
| `chunk.js` | `TARGET_PER_CHUNK` | 20 | Forest density. |
| `chunk.js` | `MIN_SPACING` | 1.6 | Trunk-to-trunk minimum (dart-throw rejection). |
| `world.js` | `VIEW_CHUNKS` | 4 | View distance in chunks. 5 ≈ 160 m, 3 ≈ 96 m. |
| `world.js` | `MAX_INSTANCES_PER_TEMPLATE` | 500 | Upper bound per pool — bump if you raise density. |
| `player.js` | `WALK_SPEED` | 1.6 | m/s |
| `player.js` | `SPRINT_MULT` | 2.9 | Multiplier when Shift held |
| `player.js` | `EYE_HEIGHT` | 1.85 | m |
| `player.js` | `BOB_AMP` / `BOB_FREQ` | 0.018 / 2.4 | Walking head-bob |
| `player.js` | `SPRINT_BOB_AMP` / `SPRINT_FREQ_BOOST` | 0.026 / 1.18 | Sprint head-bob |
| `grass.js` | `GRID_SIDE` (via opts) | 720 | √(instance count). 720 → 518k blades. |
| `grass.js` | `CELL_SIZE` (via opts) | 0.10 | Blade-to-blade spacing. Density = 1/CELL_SIZE². |
| `grass.js` | `edgeFadeStart` | 0.88 | Where the smoothstep fade starts (fraction of radius). |
| `environment.js` | `FOG_NEAR` / `FOG_FAR` | 8 / 40 | Linear fog range. Must contain the grass fade band. |
| `main.js` | `setPixelRatio` cap | 1.25 | Drop to 1.0 on integrated GPUs. |

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Pointer lock doesn't engage | Browser blocks it from non-user gesture — click the canvas (not the address bar). |
| Leaves only show on one tree | `patchLeafInstancing()` not applied. Without it, EZ-Tree's leaf shader skips the `instanceMatrix` multiply and every leaf renders at the origin. |
| Grass "sphere" follows you | `edgeFadeStart` too low / fog too loose. The fade band must sit inside ≥70 % fog opacity. |
| Grass appears in front of you while walking | Same — the patch boundary is outside the fog. Tighten `FOG_FAR` or push `edgeFadeStart` closer to 1.0. |
| Trees disappear at edge of view | `VIEW_CHUNKS × CHUNK_SIZE < FOG_FAR`. Widen `VIEW_CHUNKS` or pull `FOG_FAR` closer. |
| Sliding into trunks | `playerRadius + t.colRadius` is too small. Bump `PLAYER_RADIUS` in `player.js`. |
| FPS dips when looking up | Re-enabled SSAO/Bloom? Their fragment cost on canopy + sky is the worst case. |
| Sky/scene burning out | Bloom threshold too low against HDR sun-direction surfaces. Raise threshold to ≥ 1.5 or remove the pass. |
| Wind frozen | `updateWind(t)` not called in the loop, or no leaf material has been registered with `applyWind()` yet. |
| Shadows look pixellated | Sun didn't follow the player — verify `env.updateSun(camera.position)` is in the loop. |

---

## What's intentionally missing

Per-version README pattern: this isn't the place to bolt on every feature.
Follow-ups that fit the architecture:

- **Footstep audio** — fade between two stochastic step samples on input, pitch with sprint.
- **Rocks** — per-chunk `InstancedMesh`, same pattern as trees.
- **Day/night cycle** — animate `SUN_DIR` and re-tint the sky/fog colors in lock-step.
- **Distant LOD** — a second template per preset with 30 % of the geometry, used outside an inner radius.
- **God rays** — a god-ray pass placed before the vignette (light-shafts via radial blur from the sun's screen position).
- **Reintroducing SSAO/Bloom** under a quality toggle (default off; user opts in).

None of these require restructuring the streaming, culling, or grass layer.
