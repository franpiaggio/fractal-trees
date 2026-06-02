# Fractal Trees — a sandbox of approaches

Multiple implementations of the demo from the Codrops article
**[Fractals to Forests: Creating Realistic 3D Trees with Three.js](https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/)**
by Daniel Greenheck.

Each numbered subfolder is a self-contained version with its own `package.json`
and `README.md`. Versions differ in stack, level of hand-crafted code, and
artistic direction. This top-level README captures the **shared knowledge** —
concepts, performance principles, attention-to-detail rules — that applies to
every version.

---

## Versions index

| #     | Folder                       | Approach                                                                                                                                                       | Stack                        |
| ----- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **01** | `01-ez-tree-baseline/`      | Drop-in library: `@dgreenheck/ez-tree` does the procedural work for us. Hero + small instanced background forest, orbit camera.                                | Vite + vanilla JS + Three.js |
| **02** | `02-fps-infinite-forest/`   | First-person walk + sprint through a chunk-streamed, FOV-culled, instanced forest with tree collisions, procedural ground, and a single-`InstancedMesh` fluffy grass carpet (~518k blades) tucked into atmospheric fog.   | Vite + vanilla JS + Three.js |
| **03** | `03-fps-experiment/`        | Verbatim fork of 02 as a base to iterate on. Divergence is tracked in its own README. Runs on port 5175 so it can coexist with 02.                              | Vite + vanilla JS + Three.js |
| **04** | `04-post-processing/`       | HDR post-processing pipeline: Bloom + Depth-of-Field + SMAA in an `EffectComposer`, ACES tone-mapping, leveled horizon, spatial grass color, world-space dust motes, and mobile gyroscope look in auto mode.            | Vite + vanilla JS + Three.js |
| **05** | `05-graphics-tiers/`        | Auto-explore-only build with a Low/Medium/High graphics-tier selector on the splash; the heavy boot runs only after a tier is picked. Grain + chromatic aberration removed, bloom dialed way down.                       | Vite + vanilla JS + Three.js |
| **06** | `06-godrays/`               | Volumetric godrays via `three-good-godrays` raymarching the directional light's shadow map (shadows forced on for every tier). Lacy alpha-tested canopy shadows feed the rays.                                           | Vite + vanilla JS + Three.js |
| **07** | `07-perf-visible-godrays/`  | Fork of 06 that fixes two regressions and restores one feature: godrays you can actually see (low sun, pulled-back fog, denser rays), an honest instance budget (distance-cull at fog range + smaller load radius → ~65× fewer wasted trees), a splash **mode picker** bringing back manual first-person walking (WASD), "fluffy" alpha-clump grass (FluffyGrass technique), and a `lil-gui` live tuning panel for all post-processing. | Vite + vanilla JS + Three.js |
| **08** | `08-experiments/`           | Verbatim fork of 07 kept as a sandbox for new experiments. Divergence tracked in its own README. Runs on port 5180.                                                                                                                              | Vite + vanilla JS + Three.js |
| **09** | `09-forest-variation/`      | Fork of 08 that breaks the uniform forest: coherent-noise **density variation** (clearings ↔ thickets, 4–26 per chunk instead of a rigid 18) and **species groves** (patches dominated by one species). Runs on port 5181.                       | Vite + vanilla JS + Three.js |
| **10** | `10-mobile-perf/`           | Fork of 09 for **low-end phones** (Low tier drops shadows/godrays/bloom/SMAA, curated presets, real geometry reduction) + less fog on High, a **gradient sky dome** (atmosphere), rare **giant trees**, a fixed inspector framing, and an opaque loading screen. Port 5182. | Vite + vanilla JS + Three.js |
| **11** | `11-pixel-art/`             | Fork of 10 with a retro **pixel-art** look: low-res nearest-upscaled rendering, vertex wobble, 4×4 ordered dither + colour quantise, unfiltered textures, no AA. Port 5183.                                                                       | Vite + vanilla JS + Three.js |

To run any version: `cd <folder> && npm install && npm run dev`.

---

## What we're rebuilding

The Codrops demo combines several ideas into one scene:

- A **procedurally-generated tree**: a trunk that recursively splits into
  branches, each branch into smaller branches, terminating in leaves modeled
  as textured quads (often two crossed quads to look full from any angle).
- A small **forest** of similar trees surrounding the hero, contributing
  density and atmosphere.
- A **wind animation** driven entirely in the vertex shader (layered sine
  waves + 3D noise displacement, scaled by `uv.y` so trunks stay still and
  leaf tips move most).
- A simple **environment**: sky-tinted background, distance fog, directional
  sun, shadowed ground.

Every version in this sandbox reproduces the same scene; what changes is how
much of the tree logic we write by hand vs. delegate to a library, and how we
style the result.

---

## Concepts shared across versions

These are the building blocks. Each version implements them differently, but
all of them rely on the same vocabulary.

### Procedural generation
> "Creating something from a set of mathematical rules."

A trunk is a sequence of cylindrical sections; each section can spawn child
branches; each child is itself a tree of the same form. The recursion is
parameterized by per-level numbers (children per node, angle, length, radius,
taper, twist, gnarliness).

### Fractals & L-systems
The shape is fractal in spirit — self-similar across scales. Some
implementations use **L-systems** (string-rewriting rules expanded recursively)
to drive the topology; others run a queued breadth-first generation
(`branchQueue.shift() → generateBranch()`).

### Branch geometry
For each section along the branch:

1. A unit circle is transformed by section radius and Euler orientation.
2. The transformed ring is offset by the section origin.
3. Triangles connect consecutive rings → cylinder.
4. Normals and UVs are written so lighting and texturing behave.

The result is one `BufferGeometry` per tree (or one per branch level, depending
on the implementation), built from `verts`, `indices`, `normals`, `uvs`.

### Gnarliness, growth force, taper, twist
- **Gnarliness** — random Euler-angle deviation accumulated per section.
  Inversely proportional to section radius, so thin branches curl more.
- **Growth force** — a target direction that branches rotate toward via
  quaternion slerp. Models phototropism (sun-seeking) or gravity sag.
- **Taper** — radius reduction along branch length.
- **Twist** — rotational spiral around the branch axis.

### Leaves
Two crossed textured quads (or one billboarded quad) placed at the tip of
final-level branches. Alpha-test against the leaf-cutout alpha. Counted per
branch endpoint, sized with per-leaf variance.

### Wind shader (the shared kernel)
Three octaves of sine, sampled with simplex noise as a per-vertex phase offset:

```glsl
float windOffset = 2.0 * 3.14 * simplex3(position / uWindScale);
vec3 sway = uv.y * uWindStrength * (
  0.5 * sin(uTime * uWindFrequency + windOffset) +
  0.3 * sin(2.0 * uTime * uWindFrequency + 1.3 * windOffset) +
  0.2 * sin(5.0 * uTime * uWindFrequency + 1.5 * windOffset)
);
```

Multiplying by `uv.y` keeps the trunk still and amplifies the tips. Multiple
octaves at non-integer ratios prevent the motion from looking like a metronome.

### Instancing for the background
`THREE.InstancedMesh` is non-negotiable for the surrounding forest. Each
unique tree variant is one geometry; positions, rotations, and scales are
per-instance matrices. The same vertex shader animates every instance because
they share one material.

---

## Performance principles (apply to every version)

In rough order of pay-off:

1. **`InstancedMesh` for repeated geometry.** A background forest of 100 trees
   should be ~4–8 draw calls total, not 100. Inspect via
   `renderer.info.render.calls` after one frame.
2. **GPU wind only.** Never mutate vertex positions in JS per frame. Animate
   via `uniform float uTime` and a vertex shader.
3. **Cap pixel ratio.** `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`.
   Retina/4K otherwise renders at 9× cost.
4. **AlphaTest, not transparency, for leaves.** `material.alphaTest = 0.5;`,
   `transparent = false;`. Keeps leaves in the opaque pass — no per-frame depth
   sort across thousands of quads.
5. **Tight directional-shadow frustum.** Shrink `shadow.camera.{left,right,
   top,bottom}` to the visible area. Default is too generous and wastes
   shadow-map resolution.
6. **`shadow.mapSize = 2048`** is enough at this scene scale. 4096 doubles
   VRAM cost for no perceptible gain.
7. **Skip shadows on background trees.** Only the hero casts and receives.
   Background `castShadow = false`.
8. **Lower geometry detail with distance.** Halve `sections`/`segments` on
   background trees.
9. **Fog hides distance for free.** `scene.fog` color === `scene.background`
   color; the disc edge dissolves naturally.
10. **`renderer.setAnimationLoop`** (not manual rAF) so the loop pauses when
    the tab is hidden.
11. **Don't regenerate the tree per frame.** Only on parameter change.
12. **Shadow acne fix:** `shadow.bias = -0.0004`, `shadow.normalBias = 0.02`.
13. **Color-space pipeline:** `outputColorSpace = SRGBColorSpace` on the
    renderer; albedo textures `colorSpace = SRGBColorSpace`; normal /
    roughness / AO textures **stay linear**.
14. **Triangle budget per tree:** hero ≈ 5–15k triangles, background ≈
    1–3k each. Use the `renderer.info.render.triangles` counter to verify.

---

## Attention-to-detail checklist

The difference between "Three.js demo" and "looks like a place":

- [ ] **Tone mapping**: `ACESFilmicToneMapping`, exposure ~1.0–1.2.
- [ ] **Hemisphere light tint differs top vs. bottom** (sky-blue up, ground-
      brown down) so leaves catch warm bounce from below.
- [ ] **Sun direction === shadow direction.** Drive both from one `Vector3`.
- [ ] **Fog color === sky color.** No horizon seam.
- [ ] **Camera near/far tight.** Wider wastes depth-buffer precision.
- [ ] **`OrbitControls.maxPolarAngle ≈ 0.49π`** to forbid the camera dipping
      below the ground.
- [ ] **Wind ramps with `uv.y`.** Trunks are still even at high strength.
- [ ] **Multi-octave wind, non-integer frequency ratios.** A pure sine looks
      mechanical.
- [ ] **Leaves are `DoubleSide`.** Otherwise half of every quad is invisible.
- [ ] **`updateWind(time)` runs BEFORE `renderer.render`.** Otherwise the
      first frame is still.
- [ ] **`renderer.info.render.calls` is logged once.** A scene with a forest
      should show single-digit calls; if it scales linearly with instance
      count, instancing isn't applied.
- [ ] **After regenerating the tree**, re-register the new leaf material with
      the wind driver — old materials are disposed and the uniforms went with
      them.
- [ ] **Background fog and sky animate together** if you add a day/night cycle
      — they must move in lock-step.

---

## How to add a new version

1. `mkdir 0X-short-descriptive-name`
2. Inside, `npm create vite@latest . -- --template vanilla` (or whichever
   template fits this version's stack).
3. Add a `README.md` that fills the slot in the index above and documents
   what makes this version distinct.
4. Reuse the universal principles from this top-level README; the version
   README should focus on **what differs** — stack choices, the specific
   approach to the tree, code paths.
5. Add the row to the **Versions index** table at the top of this file.

Naming convention: `0X-<approach>-<flavor>` — for example
`02-handmade-fractal`, `03-shader-stylized`, `04-r3f-react`,
`05-instanced-l-system`, `06-night-scene`.

---

## References

- Codrops article: <https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/>
- EZ-Tree library (MIT, v1.1.0): <https://github.com/dgreenheck/ez-tree>
- Live web app of EZ-Tree: <https://eztree.dev/>
- Three.js docs: <https://threejs.org/docs/>
- `InstancedMesh`: <https://threejs.org/docs/#api/en/objects/InstancedMesh>
- `onBeforeCompile`: <https://threejs.org/docs/#api/en/materials/Material.onBeforeCompile>
- L-systems primer: <https://en.wikipedia.org/wiki/L-system>
