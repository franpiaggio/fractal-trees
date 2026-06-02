# 14 — Infinite Forest (two screens)

A consolidation/refactor of **`13-terrain`** into a clean **two-screen** app that
shares one engine, plus a built-in social-clip recorder. Run:
`npm install && npm run dev` (port 5186).

> Also lives as its own standalone repo, deployed to GitHub Pages:
> https://github.com/franpiaggio/infinite-forest · https://franpiaggio.github.io/infinite-forest/
> This folder is the sandbox copy we keep experimenting on.

## Two screens, one engine
- **Explore** (`index.html` / `src/explore.js`) — the splash menu (graphics tier +
  Demo / Walk / Inspect), the live scene, desktop tuning GUI. No recording.
- **Record** (`record.html` / `src/record.js`) — the same scene with the capture
  settings exposed as a **UI form** (format, duration, music start, R-cut mode,
  bitrate) instead of URL params. Records the canvas + audio to a `.webm`.
- A footer link navigates between the two.

`src/scene.js` is the shared engine (everything the old single-page `boot()` did:
renderer, world, grass, post, godrays, controllers, frame loop, `randomizeForest`,
teardown), parameterised with `hud` / `gui` / `onExit` / `audio`. `src/audio.js`
(ambient loop + music + 🔊/🎵 buttons) and `src/recorder.js`
(`canvas.captureStream` + Web Audio → `MediaRecorder`) are shared helpers.

## What it carries from 13
Rolling **terrain** (shared JS+GLSL height field), green-gamut **grass** variation,
winter **snow** ground, the GSAP **Demo** flythrough (biased toward the sun for the
godrays), four **seasons**, and a fully **English** UI.

## Changes on top of 13
- Split into Explore / Record pages sharing `scene.js` (was one `main.js`).
- **Recording form** replaces the `#record` URL params; downloads a webm
  (square / portrait / landscape / native, manual R-to-the-beat or auto cuts).
- **Music autoplays** on the first interaction; the music track was made for this.
- **Sound / music buttons** sit in the desktop top HUD bar; **Randomize** is
  bottom-centre on mobile; the fps/tree **stats HUD is hidden** (it overlapped the
  audio icons on mobile).
- **Autumn leaves** use **persistent canopy anchors** so they finish falling
  instead of popping mid-air as the camera moves.

## Files vs. 13
| File | Change |
| ---- | ------ |
| `src/scene.js` | **new** — shared engine (extracted from `main.js`) |
| `src/explore.js`, `src/record.js` | **new** — the two page controllers |
| `src/audio.js`, `src/styles.css` | **new** — shared audio + shared CSS |
| `index.html`, `record.html` | two entry pages + cross-link |
| `src/recorder.js` | `canvas.captureStream` + Web Audio capture (GC-safe) |
| `src/seasons.js` | persistent leaf-canopy anchors |
| `vite.config.js` | multi-page build (`index` + `record`) |
| `src/main.js` | removed (replaced by `scene.js` + the two entries) |
