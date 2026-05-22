# 03 — FPS experiment

> **Fork point.** This version was cloned verbatim from
> [`02-fps-infinite-forest/`](../02-fps-infinite-forest/) as a working base
> to iterate on. The intent is to make changes here that diverge from 02
> without disturbing the baseline.

For the universal concepts, performance principles, and attention-to-detail
checklist that apply to every version, see the **[top-level README](../README.md)**.

The full architecture, file layout, tuning knobs, troubleshooting, and the
EZ-Tree leaf-instancing patch are all documented in **02's
[README](../02-fps-infinite-forest/README.md)**. Refer there for any of the
foundational concepts — they apply unchanged until/unless this version
explicitly diverges below.

---

## Quick start

```bash
cd 03-fps-experiment
npm install
npm run dev          # → http://localhost:5175
```

(Port 5175 so it can run alongside `02-fps-infinite-forest` on 5174.)

Controls: same as 02.

| Key | Action |
| --- | --- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Walk |
| <kbd>Shift</kbd> | Sprint |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> | Look (yaw + pitch) |
| Mouse (when locked) | Look |

---

## Divergence from 02

| Area | 02 baseline | 03 here | Why |
| --- | --- | --- | --- |
| Grass `gridSide` | 720 | **1024** | Target the Codrops "fluffiest grass" reference density. |
| Grass `cellSize` | 0.10 m | **0.045 m** | Tighter spacing → blades overlap into a true carpet. |
| Grass density | ~100 / m² | **~494 / m²** (≈ 5×) | Match the reference image's lush look. |
| Grass count | 518 400 | **1 048 576** | One draw call still; vertex shader does all the placement. |
| Blade height | 0.42 m | **0.50 m** | Thicker lawn read. |
| Blade width | 0.016 m | **0.025 m** | At this density, wider blades reinforce the overlap. |
| Patch half-size | 36 m | **23 m** | Density × area tradeoff — patch shrinks so the blade count stays under ~1 M. |
| `edgeFadeStart` | 0.88 | **0.92** | Narrower fade band fits the smaller patch radius. |
| `FOG_NEAR` / `FOG_FAR` | 8 m / 40 m | **5 m / 24 m** | Tighter fog so the smaller patch's outer fade (21.2–23 m) lives in 84 %+ opacity. |
| Clear vision range | ~25 m | **~14 m** | Cost of the much denser grass — closer horizon for a thicker lawn. |
| Grass wind formula | Single sine along `uWindDir` + per-blade jitter | **3-octave sine sum + value-noise spatial offset** | Match the leaves' wind shape — same gust formula on both. |
| Grass wind uniforms | Local `uWindStrength` (float) + `uWindDir` (vec2) | **Shared `uWindStrength` (vec3), `uWindFrequency`, `uWindScale`** | Couple the grass to the same wind driver as the trees so a gust hits leaves and blades together. New grass-local `uWindBend` scalar (0.30) trims magnitude for short blades. |
| Grass wind registration | Local `setTime(t)` | **`applyWind(mat)`** | Grass material now joins the same `wind.js` tracked set as the leaves. Whatever moves the canopy moves the lawn. |

### Why the patch had to shrink

Blade count = density × patch area. The 02 patch was 518 400 blades over a
36 m radius; matching the Codrops density (~494 / m²) over that same area
would have been ≈ 2 M blades. At 8 verts each that's 16 M vertex-shader
invocations per frame — workable on a discrete GPU, painful on integrated.

So this version pays for the density by shrinking the patch from 36 m to
23 m radius. The fog had to follow (FOG_FAR: 40 → 24 m) to keep the boundary
hidden. Net effect: shorter visible range, much fluffier ground. If the
direction we want is "open vistas with dense grass", the patch needs an LOD
strategy (e.g. swap to a coarser-cell shader past 25 m) — not in scope for
this iteration.

---

## Rename suggestion

Once the direction of this version is clear, rename the folder to follow
the sandbox naming convention `0X-<approach>-<flavor>` — e.g.
`03-fps-night-scene`, `03-fps-handmade-trees`, `03-fps-shader-stylized`,
etc. Also update:

- this folder name
- `package.json → name`
- `index.html → <title>`
- the row in the parent `[README.md](../README.md)` versions index
