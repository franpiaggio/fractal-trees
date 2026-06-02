# 09 — Forest Variation

A fork of **`08-experiments`** focused on making the forest read as a *place*
instead of a uniform field. Same stack and modes (auto / walk / inspector,
graphics tiers, mobile touch controls, godrays, FluffyGrass, GUI).

Run: `npm install && npm run dev` (port 5181).

## What changed vs. v08

v08 placed **exactly 18 objects in every chunk** and picked each one's species
from a single global weighted roll — so density was perfectly uniform everywhere
and every species was evenly mixed. v09 adds two independent coherent-noise
fields in `chunk.js`:

### 1. Density variation (clearings ↔ thickets)
A low-frequency value-noise (`DENSITY_ZONE ≈ 105 m`) drives the per-chunk target
between `MIN_SPAWNS = 4` (open clearings / meadows) and `MAX_SPAWNS = 26` (dense
thickets). Measured over 1600 chunks: count now spans **4–26 (avg ~15)** instead
of a rigid 18 — real clearings (great for godrays and sky) and thickets, with
natural paths between them.

### 2. Species groves
A second noise field (`SPECIES_ZONE ≈ 72 m`) assigns a **dominant species per
patch**, so you walk from an oak stand into a pine grove into aspens — instead of
all four species sprinkled evenly. `OFFSPECIES_CHANCE = 0.22` keeps the grove
edges soft; bushes (`BUSH_CHANCE`) and the rare trellis are scattered on top.

Both fields are deterministic (seeded by `worldSeed`), so the world is still
reproducible — refresh gives the same forest.

## Files touched vs. v08
| File | Change |
| ---- | ------ |
| `src/chunk.js` | coherent `valueNoise`; per-chunk density target; species-grove selection; bush/trellis split |
| `index.html` / `vite.config.js` / `package.json` | version/port (5181) / base bumped to 09 |
