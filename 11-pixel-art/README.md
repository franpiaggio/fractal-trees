# 11 — Pixel Art

A fork of **`10-mobile-perf`** that gives the forest a retro, pixel-art look —
chunky low-resolution rendering, vertex wobble, ordered dithering and unfiltered
textures. (The techniques are borrowed from PS1-era rendering, but the result
reads as general pixel-art / retro rather than strictly PS1.)

Run: `npm install && npm run dev` (port 5183).

## The look (`src/pixel.js` + pipeline)

1. **Low internal resolution** — the renderer/composer draw at a fixed 256-px
   height (width by aspect); the canvas is CSS-stretched full-screen with
   `image-rendering: pixelated`, so the whole scene upscales nearest-neighbour
   into chunky pixels. Cheap, and the pixelation IS the perf win.
2. **Vertex wobble** — every scene material's vertex shader snaps clip-space XY
   to a grid (guarded to `w > 0` so behind-camera triangles don't stretch). The
   ground (one giant 2-triangle quad) is excluded — snapping it makes the floor
   swim.
3. **Quantise + 4×4 Bayer dither** — a `PixelEffect` at the end of the composer
   reduces colour to ~22 levels with ordered dithering: the signature retro
   banding/shimmer.
4. **Nearest textures** — no filtering, no mipmaps → hard texels on bark, leaves,
   grass and ground.
5. **No SMAA / no DoF** — sharp, aliased, the retro way. Heavy fog suits it.

Tunable live in the GUI **Pixel** folder: `vertex grid` (wobble amount),
`colour levels`, `dither`. The inspector mode renders sharp (full-res) on purpose.

## Files touched vs. v10
| File | Change |
| ---- | ------ |
| `src/pixel.js` | **new** — vertex-snap patch, nearest helper, `PixelEffect` (quantise + Bayer dither) |
| `src/postprocessing.js` | drop SMAA/DoF, add `PixelEffect` to the chain, size composer to the small buffer |
| `src/main.js` | low internal resolution + nearest/snap on every material; inspector stays full-res |
| `src/grass.js` | nearest filtering on the grass textures |
| `index.html` | `image-rendering: pixelated` on the canvas; title |
| `src/debug-gui.js` | Pixel folder (grid / levels / dither) |
