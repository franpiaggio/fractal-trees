# 07 — Performance + visible godrays

A fork of **`06-godrays`** that fixes the two things v06 got wrong and brings
back a feature the early versions had:

1. **The godrays were never actually visible.**
2. **It rendered far more trees than the fog ever shows**, so it crawled on
   modest hardware.
3. **Manual walking is back** — v05/v06 were auto-explore-only; v07 again lets
   you choose to walk the forest yourself.

Same stack (Vite + vanilla JS + Three.js + `postprocessing` +
`three-good-godrays`), same auto-explore-only build with Low/Medium/High tiers.
Everything below is **what differs from v06** and why.

Run: `npm install && npm run dev` (port 5179).

---

## 1. Honest instance budget (the perf fix)

v06 streamed chunks out to `viewChunks = 4` (an 81-chunk, ~1620-tree candidate
set) and culled them only against the camera frustum — whose far plane is `250`.
But `THREE.Fog` reaches full opacity at `fogFar` (~22 m in v06), so **every tree
between ~22 m and the ~128 m chunk-load edge was fully rendered _and casting a
shadow_ while being completely invisible.**

Measured candidate vs. genuinely-visible tree counts around the player:

| viewChunks | chunks | candidate trees | within fog (≤22 m) | waste |
| ---------- | ------ | --------------- | ------------------ | ----- |
| 4 (v06 med/high) | 81 | **1620** | 25 | **65×** |
| 3 (v06 low)      | 49 |  980     | 25 | 39× |

### What v07 changes

- **A squared-distance cull in `world.js`, run _before_ the frustum test.**
  Any tree past `renderDistance` (≈ `fogFar` + margin) is skipped — it can't
  contribute a single non-fog pixel, and it no longer bloats the shadow pass
  either. This is the single biggest win on weak GPUs.
- **`viewChunks` dropped to 2 on every tier.** With the distance cull, a wide
  load radius only lengthened the per-frame candidate loop and the chunk-
  generation cost for nothing. 2 still covers ±64 m — comfortably more than any
  tier's `renderDistance` (28 / 34 / 40 m).
- **New HUD readout:** `trees drawn / in-range / total-loaded`. The gap between
  the last two columns is exactly what v06 was burning.

Net: the candidate loop shrinks 1620 → 500, and only ~15–50 trees are actually
drawn (and shadow-cast) instead of ~150–250.

> Note the distance cull also helps the godrays: the shadow map now contains
> only the **near** occluders, which are the ones that form the visible shafts
> anyway.

---

## 2. Making the godrays read (the visibility fix)

The `GodraysPass` was always rendering (depth wiring is fine —
`needsDepthTexture = true`). It was invisible because of a stack of tuning
problems, fixed here:

- **The sun was at ~43° elevation — nearly overhead.** Godray shafts are
  strongly forward-scattering: you only see them looking *toward* a *low* light.
  The auto-explorer keeps the camera level with the horizon, so v06 almost never
  pointed at the sun. v07 drops `SUN_DIR` to **~21° elevation** so the shafts
  rake horizontally between the trunks where the camera actually looks.
- **Near, bright fog washed out all contrast.** Shafts need darker depth behind
  them to read. `fogFar` is pulled back (26 / 32 / 38 vs. v06's 22–24), giving
  the rays shadowed canopy to stand against. The sky stays deliberately *cool*
  so the warm cream rays pop.
- **The rays were too thin to accumulate.** `density` roughly doubled, `maxDensity`
  raised, and `distanceAttenuation` lowered from `2` to ~`1.0` so the scattering
  actually carries down the shaft.
- **Warmer, slightly stronger sun** (`0xffe2b8`, intensity 1.7) to sell the
  low-sun, late-afternoon read.
- **Removed dead params.** `edgeStrength` / `edgeRadius` don't exist in
  `three-good-godrays@0.12` — they were silently ignored.

### If they're still too subtle on your machine

The knobs all live in `src/quality.js` per tier. Look toward the sun while the
explorer drifts; if you want them stronger, raise `godraysDensity` and
`godraysMaxDensity`, or lower the sun further via `SUN_DIR` in
`src/environment.js`.

---

## 3. Manual walk is back

v02–v04 let you either walk first-person (WASD + mouse) **or** hand it to the
auto-explorer. v05 dropped the picker and went auto-only, and v06 inherited
that. v07 restores the choice on the splash, next to the graphics tier:

- **Caminar** — `buildPlayer` (ported from v04's `player.js`, minus its debug
  collision lines): PointerLock mouse-look, **WASD** to move, **Shift** to run,
  **arrow keys** to look without the mouse, cylinder collisions against trunks,
  and a subtle head-bob. **Esc** pops back to the menu.
- **Auto-explorar** — the existing hands-off drift, unchanged.

Both controllers expose the same `{ update(dt, world), isAuto }` shape, so the
frame loop doesn't care which is active; it only switches the DoF focus
(6 m walking vs. 9 m auto). On mobile the **Caminar** button is disabled —
there's no pointer-lock or keyboard — and everyone lands in the gyro auto mode.

## Files touched vs. v06

| File | Change |
| ---- | ------ |
| `src/world.js`        | distance cull before frustum test; `renderDistance` param; `totalInRange` in stats |
| `src/quality.js`      | `viewChunks` 2 everywhere; `renderDistance` per tier; pulled-back fog; retuned godrays; dead params removed |
| `src/environment.js`  | lowered + warmed sun |
| `src/postprocessing.js` | dropped non-existent `edgeStrength`/`edgeRadius` options |
| `src/player.js`       | **new** — manual walk controller, ported from v04 (debug lines removed) |
| `src/main.js`         | mode picker (walk / auto) on the splash; passes `renderDistance`; mode-aware DoF focus; new `drawn/in-range/loaded` HUD; `[07]` boot log |
| `index.html`          | two mode buttons + styles replacing the single Start button; title 07 |
| `vite.config.js` / `package.json` | version/port bumped to 07 |
