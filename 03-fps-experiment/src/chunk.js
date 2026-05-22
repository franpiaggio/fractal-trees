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

// Density: ~20 trees per 32x32 chunk = one tree every ~7 m² → walkable forest.
const TARGET_PER_CHUNK = 20;
// Minimum spacing so we never spawn two trees occupying the same trunk.
const MIN_SPACING = 1.6;

export function generateChunk(cx, cz, worldSeed, templates) {
  const rng = mulberry32(hashCoords(cx, cz, worldSeed));
  const trees = [];
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const tries = TARGET_PER_CHUNK * 4;
  for (let i = 0; i < tries && trees.length < TARGET_PER_CHUNK; i++) {
    const x = baseX + rng() * CHUNK_SIZE;
    const z = baseZ + rng() * CHUNK_SIZE;

    // Dart-throw: reject if too close to one we already kept.
    let ok = true;
    for (const t of trees) {
      const dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz < MIN_SPACING * MIN_SPACING) { ok = false; break; }
    }
    if (!ok) continue;

    const templateIdx = Math.floor(rng() * templates.length);
    const tpl = templates[templateIdx];
    const scale = 0.7 + rng() * 0.6;       // 0.7 – 1.3
    const rotY = rng() * Math.PI * 2;
    trees.push({
      x, z,
      templateIdx,
      scale,
      rotY,
      // Collision radius in *world* units: trunk radius × instance scale,
      // plus a small skin so the player doesn't graze.
      colRadius: tpl.trunkRadius * scale + 0.15,
    });
  }
  return { cx, cz, trees };
}
