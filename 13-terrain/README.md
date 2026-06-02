# 13 — Terrain

A fork of **`12-seasons`** that gives the forest **rolling terrain**, grass colour
variation, a real winter snow ground, a smooth **Demo** flythrough, in-page audio,
a clean menu-return, and a safe Randomize. Run: `npm install && npm run dev`
(port 5185).

## Terrain relief (`src/terrain.js`)
One **shared height field** lives in both JS and GLSL (the exact same sine-octave
formula), so every system sits on the same hills:
- **Ground** — a camera-following grid mesh, displaced in the vertex shader, with
  finite-difference normals; its texture is world-anchored so it doesn't swim.
- **Trees / grass / player** — placed/raised by `terrainHeight(x, z)` in JS so they
  follow the relief (the camera walks and the demo flies over the hills).

## Grass
- **Colour variation** — a low-frequency noise drifts the green within its own
  gamut (warm yellow-green ↔ cooler deep green) so the field isn't one flat tone.
- **Bigger field** — the grass patch now reaches into the fog (no visible
  bare-ground ring beyond it).

## Winter snow
Winter swaps the green/dirt ground for a procedural **snow** texture (cool white,
soft drifts, faint sparkle), mixed in the ground shader via a `uSnow` uniform; the
snow-grass tint is neutralised so it doesn't go yellow.

## Demo mode (`src/demo.js`, renamed from auto-explore)
A hands-off **demoscene** camera: no collisions, GSAP-driven smooth motion
(meandering heading, breathing speed, buoyant height with occasional crane-up
reveals, an independently-panning gaze). Travel is biased into a cone aimed at the
sun so the **godrays stay in frame**.

## Audio
- **Ambient forest loop** — starts (with a fade-in) on the first mode pick; 🔊 mutes.
- **Music track** ("Pine Drift") — OFF by default; 🎵 plays it from the top.

## Falling leaves
Autumn leaves now shed only from the **canopies of nearby trees** (anchored to
their trunks in the particle shader), not the open sky, and at ~10% the old count
— just a few, drifting down.

## Other
- **Exit returns to the menu without reloading** — the session is torn down
  (render loop, WebGL context, DOM, listeners) and the splash re-shows.
- **Randomize** (button or **R** key) re-rolls forest + season + godrays + a *safe*
  set of post-processing knobs (no scene-breaking extremes; the season owns colour,
  the seed owns generation) and **logs the current graphics config** to the console
  so good looks can be saved.
- **English UI**; the GUI panel is titled **Settings**.

## Files touched vs. v12
| File | Change |
| ---- | ------ |
| `src/terrain.js` | **new** — shared JS + GLSL height field and normal |
| `src/demo.js` | **new** — GSAP demoscene camera (replaces `auto-explorer.js`) |
| `src/assets/forest.mp3`, `src/assets/pine-drift.mp3` | **new** — ambient + music |
| `src/environment.js` | terrain grid ground (shader displacement), camera-follow recenter, snow texture + `uSnow` mix, exported `SUN_DIR` |
| `src/grass.js` | sit on terrain, green-gamut variation, `uTintVar` (neutral in winter) |
| `src/world.js` | trees placed at `terrainHeight` |
| `src/player.js`, `src/mobile-controls.js` | eye height follows terrain |
| `src/seasons.js` | leaves shed from nearby tree canopies, ~10% the count; winter snow flag |
| `src/quality.js` | larger grass field (reaches the fog) |
| `src/main.js` | demo wiring, audio + music buttons, menu-return teardown, R-to-randomize, graphics randomize, aligned HUD buttons |
| `src/debug-gui.js` | title "Settings", **safe** graphics randomize + config logging |
| `src/settings.js`, `index.html`, others | full English translation, "Demo" naming |
