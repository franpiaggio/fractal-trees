# 12 — Seasons

A fork of **`10-mobile-perf`** that gives the forest four seasons plus live
randomization. Run: `npm install && npm run dev` (port 5184).

## Seasons (`src/seasons.js`)
Pick a season in the pre-start settings (or randomize live). Each one re-tints
the whole scene:

- **Leaves** — recoloured per-leaf in the shader, preserving the texture's
  luminance, with per-instance variation (autumn gold↔red, winter snow-dusted,
  spring light green). Pines stay green (evergreen).
- **Grass / ground / sky / fog / sun / hemisphere** — a palette per season.
- **Falling particles** — world-space (you fall through them, they don't follow
  the camera): autumn **leaves** use a 4×4 atlas of 16 real leaf cutouts
  (background keyed out, each particle picks one and tumbles), winter **snow** and
  spring **petals** are soft dots.

## Live randomize
- The settings panel has a **🎲 Randomizar** that randomizes every value (season,
  species mix, density, groves, giants) + a new seed.
- In-game, a **Randomizar** button re-rolls everything and regenerates the forest
  live (also re-rolls the godray look, which alternates A/B per forest).

## Other
- **Tree pop-in fix** — culling is by the tree's near edge, so trees fade in
  through the fog instead of popping (and Low's fogFar = renderDistance).
- **Hide-UI** — "Ocultar GUI" hides ALL on-screen UI (buttons, lil-gui, stats)
  for a clean render-only view, leaving a small restore square; 'O' toggles it.
- Default forest: summer, ash-biased mix, high density.

## Files touched vs. v10
| File | Change |
| ---- | ------ |
| `src/seasons.js` | **new** — season palettes, per-leaf recolour shader patch, falling-particle system (leaf atlas / snow / petals) |
| `src/assets/leaves-atlas.png` | **new** — 4×4 autumn leaf atlas (background keyed out) |
| `src/environment.js` | `setPalette()` to re-tint sky/fog/sun/hemisphere per season |
| `src/settings.js` | season selector; Randomize-all button; sliders return handles |
| `src/main.js` | apply season + particles; in-game Randomize + hide-UI; godray A/B |
| `src/world.js` | near-edge cull (no pop-in) |
| `src/chunk.js` | default config (summer-ish, ash 2, high density) |
