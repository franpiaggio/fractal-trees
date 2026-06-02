// A chunk is a deterministic patch of forest at integer coords (cx, cz).
// Given (cx, cz, worldSeed), we always produce the same set of trees —
// regenerating after the player loops back is free.

export const CHUNK_SIZE = 32;

// Tiny seeded RNG (mulberry32) — deterministic, no state shared between chunks.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCoords(cx, cz, worldSeed) {
  // Cantor-pair-ish mix so adjacent chunks decorrelate.
  let h = worldSeed | 0;
  h = (h * 374761393 + (cx | 0)) | 0;
  h = (h * 668265263 + (cz | 0)) | 0;
  h ^= h >>> 13;
  return h >>> 0;
}

export function chunkKey(cx, cz) {
  return `${cx}|${cz}`;
}

// Density: spawns attempted per 32x32 chunk. Lowered from 26 — the forest was
// reading as a wall of glued trunks.
const TARGET_PER_CHUNK = 18;

// Per-object "personal space" radius (metres). Two objects can't be placed
// closer than the SUM of their clearances, so big trees keep real breathing
// room (~4 m apart) while bushes can still cluster as undergrowth. This replaces
// the old single 1.6 m MIN_SPACING that let huge trunks overlap.
function clearanceFor(tpl) {
  if (tpl.category === 'bush')    return 0.5;
  if (tpl.category === 'trellis') return 0.9;
  if (tpl.id.endsWith('-l'))      return 2.3;   // Large trees
  if (tpl.id.endsWith('-s'))      return 1.4;   // Small trees
  return 1.8;                                    // Medium trees
}

// Weighted template pick — favours common trees, scatters bushes, makes Large
// trees and the trellis rare. Weight lives on each template (from RECIPES).
function pickTemplate(rng, templates) {
  let total = 0;
  for (const t of templates) total += t.weight ?? 1;
  let r = rng() * total;
  for (let i = 0; i < templates.length; i++) {
    r -= templates[i].weight ?? 1;
    if (r <= 0) return i;
  }
  return templates.length - 1;
}

export function generateChunk(cx, cz, worldSeed, templates) {
  const rng = mulberry32(hashCoords(cx, cz, worldSeed));
  const trees = [];
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  // More tries than before — bigger clearances reject more positions, so we need
  // extra attempts to still reach a natural-looking count.
  const tries = TARGET_PER_CHUNK * 10;
  for (let i = 0; i < tries && trees.length < TARGET_PER_CHUNK; i++) {
    // Pick the template FIRST so its clearance gates the position.
    const templateIdx = pickTemplate(rng, templates);
    const tpl = templates[templateIdx];
    const clearance = clearanceFor(tpl);

    const x = baseX + rng() * CHUNK_SIZE;
    const z = baseZ + rng() * CHUNK_SIZE;

    // Dart-throw: reject if the two clearance circles would overlap.
    let ok = true;
    for (const t of trees) {
      const dx = t.x - x, dz = t.z - z;
      const minD = clearance + t.clearance;
      if (dx * dx + dz * dz < minD * minD) { ok = false; break; }
    }
    if (!ok) continue;

    const sMin = tpl.scaleMin ?? 0.7, sMax = tpl.scaleMax ?? 1.3;
    const scale = sMin + rng() * (sMax - sMin);
    const rotY = rng() * Math.PI * 2;
    trees.push({
      x, z,
      templateIdx,
      scale,
      rotY,
      clearance,
      // Collision radius in *world* units: trunk radius × instance scale,
      // plus a small skin so the player doesn't graze.
      colRadius: tpl.trunkRadius * scale + 0.15,
    });
  }
  return { cx, cz, trees };
}
