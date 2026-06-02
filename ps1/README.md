# 15 — PS1

A fork of **`13-terrain`** chasing a **tasteful PlayStation-1 vibe** — close to the
real thing without being crude or exaggerated. Run: `npm install && npm run dev`
(port 5187).

## The look (`src/ps1.js`)
- **Vertex jitter / snap** — clip-space XY snapped to the LOW-RES buffer's pixel
  grid (PS1 had no sub-pixel vertex precision → the classic wobble). Tied to the
  render resolution, with a `jitter` scale. Applied to trunks, ground and grass;
  **leaves and bushes opt out** (snapping dense/thin alpha geometry just flickers).
- **Low internal resolution** — the scene renders into a small buffer (~300 px tall)
  that CSS upscales nearest-neighbour.
- **Nearest + mipmapped textures** — chunky texels up close, mipmaps for distance
  so alpha foliage doesn't shimmer (true PS1 had no mipmaps, but our hi-res source
  aliases worse — this reads as PS1, not "buggy").
- **15-bit colour + 4×4 Bayer dither** — 5 bits/channel (32 levels) quantise with a
  gentle ordered dither (the PS1 grain), as a final post Effect.
- **No modern post** — godrays / bloom / DoF / SMAA stripped (all un-PS1). LINEAR
  tone-mapping (PS1 had no filmic curve) with the lights pulled down so the clamp
  doesn't blow highlights out. Fog kept (hides draw distance, very PS1).

## Live PS1 controls (desktop "Settings" → **PS1** folder)
`internal height` (resolution), `vertex jitter`, `colour levels`, `dither`.

## Notes
- **Affine texture mapping** (the warping/swim) is intentionally left out: it's the
  most "burdo" PS1 artifact and WebGL1 can't do true non-perspective varyings
  cleanly. The jitter + low-res + nearest already give a tasteful texture swim.
- Falling-particle size is scaled by the buffer height so leaves aren't giant in
  the small PS1 buffer.

## Files vs. 13
| File | Change |
| ---- | ------ |
| `src/ps1.js` | **new** — vertex snap, nearest+mipmap, 15-bit dither Effect |
| `src/postprocessing.js` | PS1 Effect last; LINEAR tone-map; godrays/bloom/DoF/SMAA off |
| `src/main.js` | low-res buffer + CSS upscale, apply snap/nearest, lower exposure, PS1 GUI wiring |
| `src/debug-gui.js` | PS1 folder (resolution / jitter / levels / dither) |
| `src/seasons.js` | falling-particle size scaled by buffer height |

Researched from the Codrops PS1 jitter shader article, David Colson's PS1 renderer,
Pikuma's PS1 graphics write-up and the godot-psx-style-demo.
