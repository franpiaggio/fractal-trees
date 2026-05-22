// Graphics tier presets. Three flavors of "how aggressive can we go":
//
//   low    — budget mobile / integrated GPUs. Drops HDR, shadows, DoF, bloom.
//            Halves grass density, halves dust, trims leaves, view dist −1.
//   medium — modern mobile / mid-range laptops. HDR on, small shadows, small
//            bloom kernel, no chromatic aberration. Slight grass/dust trim.
//   high   — desktop / gaming hardware. Everything on, full kernels, full
//            grass and dust, biggest view distance.
//
// Each preset is a flat record consumed by main.js, which threads the relevant
// fields into every module. Adding a new knob = add a field here + read it
// where it matters. No global state.

export const TIER_PRESETS = {
  low: {
    label: 'Low',
    sub:   'Phones / integrated GPU',

    // Renderer / composer
    dpr:           0.75,
    halfFloatHDR:  false,            // UnsignedByte composer → less bandwidth
    shadowMapSize: 0,                // 0 ⇒ disable shadows entirely
    smaaPreset:    'LOW',

    // World streaming
    viewChunks:    3,                // 7×7 = 49 chunks active (vs 81 default)

    // Grass
    grassGridSide:    640,           // 640² = 409 600 blades (vs 1024² = 1M)
    grassCellSize:    0.055,
    grassEdgeFade:    0.86,

    // Trees
    leavesCountMult:  0.55,
    treeCastShadow:   false,

    // Atmosphere
    dustCount:        80,
    fogNear:          5,
    fogFar:           22,

    // Post-processing
    dofEnabled:       false,
    bloomEnabled:     true,
    bloomKernel:      'SMALL',
    bloomIntensity:   0.30,
    chromAbEnabled:   false,
    grainEnabled:     false,
    vignetteOffset:   0.32,
    vignetteDarkness: 0.42,
  },

  medium: {
    label: 'Medium',
    sub:   'Most modern devices',

    dpr:           1.0,
    halfFloatHDR:  true,
    shadowMapSize: 512,
    smaaPreset:    'MEDIUM',

    viewChunks:    4,

    grassGridSide:    832,           // 832² ≈ 692k blades
    grassCellSize:    0.05,
    grassEdgeFade:    0.90,

    leavesCountMult:  0.75,
    treeCastShadow:   false,

    dustCount:        200,
    fogNear:          5,
    fogFar:           23,

    dofEnabled:       true,
    dofBokehScale:    2.0,
    dofResScale:      0.5,
    bloomEnabled:     true,
    bloomKernel:      'MEDIUM',
    bloomIntensity:   0.45,
    chromAbEnabled:   false,
    grainEnabled:     true,
    grainOpacity:     0.035,
    vignetteOffset:   0.30,
    vignetteDarkness: 0.50,
  },

  high: {
    label: 'High',
    sub:   'Desktop / gaming GPU',

    dpr:           1.25,
    halfFloatHDR:  true,
    shadowMapSize: 1024,
    smaaPreset:    'HIGH',

    viewChunks:    4,

    grassGridSide:    1024,
    grassCellSize:    0.045,
    grassEdgeFade:    0.92,

    leavesCountMult:  1.0,
    treeCastShadow:   false,         // Even high keeps trees out of shadow pass

    dustCount:        320,
    fogNear:          5,
    fogFar:           24,

    dofEnabled:       true,
    dofBokehScale:    3.0,
    dofResScale:      0.5,
    bloomEnabled:     true,
    bloomKernel:      'MEDIUM',
    bloomIntensity:   0.55,
    chromAbEnabled:   true,
    chromAbOffset:    [0.0006, 0.0003],
    grainEnabled:     true,
    grainOpacity:     0.045,
    vignetteOffset:   0.30,
    vignetteDarkness: 0.50,
  },
};

// Heuristic: best-guess starting tier based on what the platform reports.
// Conservative — defaults Medium, only bumps to High on a real desktop or
// drops to Low on something that smells underpowered.
export function detectDefaultTier() {
  if (typeof navigator === 'undefined') return 'medium';

  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (window.matchMedia?.('(pointer: coarse)')?.matches && 'ontouchstart' in window);

  const cores = navigator.hardwareConcurrency ?? 4;
  const mem   = navigator.deviceMemory ?? 4;   // GB; undefined on iOS/Safari

  // Strong signal for low: < 4 cores OR < 4 GB RAM OR known weak mobile UA.
  if (cores < 4 || mem < 4) return 'low';
  if (isMobile && (cores < 6 || mem < 6)) return 'low';
  if (isMobile) return 'medium';

  // Desktop: more cores / RAM ⇒ high.
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

export function getPreset(tier) {
  return TIER_PRESETS[tier] ?? TIER_PRESETS.medium;
}
