# 01 — EZ-Tree baseline

> The fast lane. Lets the [`@dgreenheck/ez-tree`](https://github.com/dgreenheck/ez-tree)
> library handle procedural generation so we can focus on assembling the
> scene around it. This is the version to clone when you want a working tree
> in 30 seconds.

For the universal concepts, performance principles, and attention-to-detail
checklist that apply to every version, see the **[top-level README](../README.md)**.

---

## What's distinct about this version

- **EZ-Tree carries the algorithm.** We don't write recursive branch
  generation, gnarliness math, or leaf placement. The library exposes a
  parameterized `Tree` class that extends `THREE.Group`.
- **Wind shader is pre-injected** by EZ-Tree onto `leavesMesh.material`. We
  just drive its `uTime` uniform every frame.
- **No custom shaders, no GLSL files.** Everything is JS.
- **Pure ESM, vanilla JS, no TypeScript, no React.**
- **Instancing strategy:** one `InstancedMesh` per preset for the background
  forest (4 presets × 20 instances ≈ 8 draw calls total).

If you want to see the *guts* of the procedural-tree algorithm, this is **not**
the version. Wait for `02-handmade-*` (or write it yourself with this as a
visual reference).

---

## Quick start

```bash
cd 01-ez-tree-baseline
npm install
npm run dev          # → http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview
```

---

## Tech stack

| Choice                          | Why                                                                  |
| ------------------------------- | -------------------------------------------------------------------- |
| **Vite 5**                      | Zero-config dev server, HMR, ESM-native.                             |
| **Three.js ≥0.170**             | Pinned by EZ-Tree's peer dep (`three >=0.167`).                      |
| **@dgreenheck/ez-tree 1.1.0**   | The library the article is built on.                                 |
| **lil-gui**                     | Minimal parameter panel.                                             |

---

## Project layout

```
01-ez-tree-baseline/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.js          ← renderer, camera, scene, render loop
    ├── tree.js          ← thin wrapper around EZ-Tree
    ├── environment.js   ← sun, hemisphere fill, ground, fog
    ├── wind.js          ← shared uTime driver for tracked shaders
    ├── forest.js        ← InstancedMesh background trees (4 presets)
    └── controls.js      ← optional lil-gui panel
```

Total source: ~10 KB across the six modules.

---

## Step-by-step rebuild

### 0. Scaffold

```bash
npm create vite@latest 01-ez-tree-baseline -- --template vanilla
cd 01-ez-tree-baseline
npm i three @dgreenheck/ez-tree lil-gui
```

### 1. Boot the scene (`src/main.js`)

```js
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

`PerspectiveCamera(50, aspect, 0.1, 500)` at `(12, 9, 16)`. `OrbitControls`
with damping. The loop is one line per frame: `updateWind(t)` →
`controls.update()` → `renderer.render(scene, camera)`.

### 2. The hero tree (`src/tree.js`)

EZ-Tree's `Tree` class extends `THREE.Group`. After `generate()`, two
children appear: `tree.branchesMesh` and `tree.leavesMesh`, both
`MeshPhongMaterial`.

```js
const tree = new Tree();
tree.loadPreset('Oak Medium');
tree.options.seed = 42;
tree.generate();
tree.branchesMesh.castShadow = tree.leavesMesh.castShadow = true;
tree.leavesMesh.material.alphaTest = 0.5;
tree.leavesMesh.material.transparent = false;
tree.leavesMesh.material.side = THREE.DoubleSide;
scene.add(tree);
```

Presets available in v1.1.0: `Ash {Small, Medium, Large}`, `Aspen {…}`,
`Oak {…}`, `Pine {…}`.

`tree.options` is the full parameter tree (general, bark, branch, leaves).
Mutate it, then call `tree.generate()` to rebuild geometry.

### 3. Environment (`src/environment.js`)

- `HemisphereLight(skyBlue, groundBrown, 0.55)` — cheap ambient fill.
- One `DirectionalLight` as sun, **tight shadow frustum** (`±22`),
  `mapSize 2048`, `bias -0.0004`, `normalBias 0.02`.
- `THREE.Fog(skyColor, 40, 130)` — hides forest edge for free.
- Ground: `PlaneGeometry(400, 400)` with tinted `MeshStandardMaterial`.

### 4. Wind (`src/wind.js`)

**EZ-Tree already injects the wind shader on the leaf material.** Uniforms
live at `leavesMesh.material.userData.shader.uniforms`:

| Uniform          | Type      | Meaning                            |
| ---------------- | --------- | ---------------------------------- |
| `uTime`          | `float`   | Seconds since boot                 |
| `uWindStrength`  | `Vector3` | Per-axis amplitude                 |
| `uWindFrequency` | `float`   | Oscillation speed multiplier       |
| `uWindScale`     | `float`   | Noise sample scale (default 70)    |

`applyWind(material)` registers an existing shader in a `Set` (or installs
one via `onBeforeCompile` if missing). `updateWind(t)` writes `t` into every
tracked `uTime` once per frame.

> Pitfall: a Three.js material compiles **on first render**. The shader
> object only appears in `userData.shader` after that. The current code is
> tolerant of both orderings — it checks `userData.shader` then falls back to
> `onBeforeCompile`.

### 5. Background forest (`src/forest.js`)

For ~80 small trees, four presets, instanced:

1. Generate one template `Tree` per preset, lowering `sections`/`segments`
   for cheaper geometry.
2. `new THREE.InstancedMesh(template.branchesMesh.geometry, template.branchesMesh.material, count)`
   — same for leaves.
3. Jittered-disc scatter (Poisson-light) inside an outer radius, avoiding
   the hero's inner radius.
4. Random Y rotation, random scale `0.55–1.05`, written via `setMatrixAt`.
5. `instanceMatrix.needsUpdate = true`.
6. `castShadow = false` on background instances.

The leaf materials of the forest get registered with `applyWind()` so wind
animates the entire scene from one `uTime`.

### 6. GUI (`src/controls.js`)

`lil-gui` panel exposing preset, seed, wind strength/frequency, sun azimuth.
On preset/seed change, calls `hero.regenerate()`, which calls `tree.generate()`
again.

> **Gotcha:** `tree.generate()` disposes and rebuilds materials. The wind
> uniforms vanish with the old material. After regenerate, re-call
> `applyWind(hero.leafMaterial)` if you change the architecture.

---

## Performance specifics for this version

(Generic principles are in the [parent README](../README.md#performance-principles-apply-to-every-version);
these are the items unique to this implementation.)

- **InstancedMesh works with `MeshPhongMaterial` automatically.** EZ-Tree's
  built-in wind shader sees `instanceMatrix` because Three.js injects the
  per-instance transform before the material's vertex shader runs.
- **Background trees use halved `sections`/`segments`** (see `forest.js`).
  Roughly halves triangle count per template.
- **Leaf material is shared across hero and forest instances of the same
  preset**, so a single `uTime` updates everything. Don't `.clone()` the
  material unless you mean to break this.
- **EZ-Tree's leaf material has `transparent: true` by default** in some
  paths. We force `alphaTest = 0.5; transparent = false;` in `tree.js` and
  `forest.js` to keep leaves in the opaque pass.

---

## Troubleshooting

| Symptom                                  | Likely cause                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tree appears black / very dark           | `outputColorSpace` not set, or texture loaded without `SRGBColorSpace` on albedo.                         |
| Leaves invisible from one side           | Forgot `material.side = THREE.DoubleSide`.                                                                |
| Wind doesn't animate                     | Forgot to call `updateWind(t)` in the render loop; or registered the material *before* its first render.  |
| Hard pixelated shadows                   | `shadowMap.type = PCFSoftShadowMap` not set, or `shadow.mapSize` too small for the frustum.               |
| Shadow acne (stripes on lit surfaces)    | Bias too small. Try `shadow.bias = -0.0005`, `shadow.normalBias = 0.02`.                                  |
| FPS tanks on regenerate                  | `tree.generate()` called in the render loop instead of on parameter change.                               |
| Background trees don't sway              | Their leaf materials weren't passed to `applyWind()`. Iterate `forest.materials`.                         |
| Wind freezes after a regenerate          | The new leaf material isn't registered. Re-call `applyWind(hero.leafMaterial)` after `tree.generate()`.   |
| `npm install` peer-dep error             | Bump `three` to `^0.170.0` — EZ-Tree requires `>=0.167`.                                                  |

---

## What's intentionally missing

The Codrops article shows a fuller scene with grass, rocks, clouds, mossy
ground blends, and a custom sky. To stay readable, this baseline skips them.
Adding them is straightforward:

- **Grass** — `InstancedMesh` of crossed quads, ~5–10k instances on a 40m
  disc, share the wind shader.
- **Rocks** — ~20 low-poly meshes, baked AO, no shadow cast.
- **Clouds** — one elevated quad with a tiled noise texture, scrolled in a
  fragment shader.
- **Sky** — replace `scene.background` with `three/examples/jsm/objects/Sky.js`;
  sync sun position with the directional light's `position`.
- **Ground blend** — replace ground material with a `ShaderMaterial` that
  mixes two albedo textures by world-XZ simplex noise.

These are slated for later versions in this sandbox — by then we may have
diverged enough from this baseline to need them as separate features.
