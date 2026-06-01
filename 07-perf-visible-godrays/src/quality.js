// Graphics tier presets — same shape as v05 but with godrays knobs added,
// and a key constraint: every tier must run shadows because the godrays pass
// raymarches the directional light's shadow map. There is no "godrays without
// shadows". Low tier therefore keeps a small (512²) shadow map and uses cheap
// raymarch settings; medium and high scale up.
//
//   low    — phones / integrated GPUs. Small shadow map, few raymarch steps,
//            no godray blur, no DoF, tiny bloom, light dust.
//   medium — modern mobile / mid-range laptops. 1024² shadow map, moderate
//            raymarch steps with blur, full atmospherics.
//   high   — desktop / gaming. 2048² shadow map, fat raymarch steps with blur,
//            longest view distance.
//
// Godrays color is a warm cream that matches the sun light tint (#fff2dc) so
// the rays don't read as a separate effect bolted on top.

export const TIER_PRESETS = {
  low: {
    label: 'Low',
    sub:   'Phones / integrated GPU',

    // Renderer / composer
    dpr:           0.75,
    halfFloatHDR:  true,             // godrays composite cleaner in HDR
    shadowMapSize: 512,              // forced on for godrays
    smaaPreset:    'LOW',

    // World streaming. viewChunks dropped 3→2 (and 4→2 on med/high): with the
    // new distance cull, chunks beyond renderDistance never contribute, so the
    // old wide load radius only bloated the candidate loop and chunk generation.
    viewChunks:    2,
    renderDistance: 28,              // ≈ fogFar + margin; trees past this are pure fog

    // Grass
    grassGridSide:    640,
    grassCellSize:    0.055,
    grassEdgeFade:    0.86,

    // Trees
    leavesCountMult:  0.55,
    treeCastShadow:   true,          // forced on for godrays
    groundReceiveShadow: false,      // skip ground self-shadow on low tier

    // Atmosphere. Fog pulled back from v06's 22 so there's darker, deeper
    // canopy behind the rays to read against — uniform near fog washed the
    // shafts out completely.
    dustCount:        80,
    fogNear:          6,
    fogFar:           26,

    // Post-processing
    dofEnabled:       false,
    bloomEnabled:     true,
    bloomKernel:      'SMALL',
    bloomIntensity:   0.10,
    bloomThreshold:   0.95,
    bloomSmoothing:   0.15,
    chromAbEnabled:   false,
    grainEnabled:     false,
    vignetteOffset:   0.32,
    vignetteDarkness: 0.42,

    // Godrays. v06 values were far too subtle to ever read: density ~1/180 plus
    // distanceAttenuation 2 killed accumulation over the short fog depth. Bumped
    // density, raised maxDensity, and lowered attenuation so rays actually carry.
    // (edgeStrength/edgeRadius removed — they don't exist in three-good-godrays
    // 0.12 and were silently ignored.)
    godraysEnabled:        true,
    godraysDensity:        0.013,
    godraysMaxDensity:     0.50,
    godraysDistanceAtten:  1.2,
    godraysRaymarchSteps:  28,
    godraysBlur:           false,
    godraysColor:          0xffe6bf,
  },

  medium: {
    label: 'Medium',
    sub:   'Most modern devices',

    dpr:           1.0,
    halfFloatHDR:  true,
    shadowMapSize: 1024,
    smaaPreset:    'MEDIUM',

    viewChunks:    2,
    renderDistance: 34,

    grassGridSide:    832,
    grassCellSize:    0.05,
    grassEdgeFade:    0.90,

    leavesCountMult:  0.75,
    treeCastShadow:   true,
    groundReceiveShadow: true,

    dustCount:        200,
    fogNear:          6,
    fogFar:           32,

    dofEnabled:       true,
    dofBokehScale:    1.8,
    dofResScale:      0.5,
    bloomEnabled:     true,
    bloomKernel:      'MEDIUM',
    bloomIntensity:   0.16,
    bloomThreshold:   0.94,
    bloomSmoothing:   0.15,
    chromAbEnabled:   false,
    grainEnabled:     false,
    vignetteOffset:   0.30,
    vignetteDarkness: 0.50,

    godraysEnabled:        true,
    godraysDensity:        0.016,
    godraysMaxDensity:     0.55,
    godraysDistanceAtten:  1.0,
    godraysRaymarchSteps:  52,
    godraysBlur:           true,
    godraysColor:          0xffe6bf,
  },

  high: {
    label: 'High',
    sub:   'Desktop / gaming GPU',

    dpr:           1.25,
    halfFloatHDR:  true,
    shadowMapSize: 2048,
    smaaPreset:    'HIGH',

    viewChunks:    2,
    renderDistance: 40,

    grassGridSide:    1024,
    grassCellSize:    0.045,
    grassEdgeFade:    0.92,

    leavesCountMult:  1.0,
    treeCastShadow:   true,
    groundReceiveShadow: true,

    dustCount:        320,
    fogNear:          6,
    fogFar:           38,

    dofEnabled:       true,
    dofBokehScale:    2.6,
    dofResScale:      0.5,
    bloomEnabled:     true,
    bloomKernel:      'MEDIUM',
    bloomIntensity:   0.20,
    bloomThreshold:   0.92,
    bloomSmoothing:   0.18,
    chromAbEnabled:   false,
    grainEnabled:     false,
    vignetteOffset:   0.30,
    vignetteDarkness: 0.50,

    godraysEnabled:        true,
    godraysDensity:        0.020,
    godraysMaxDensity:     0.60,
    godraysDistanceAtten:  0.9,
    godraysRaymarchSteps:  72,
    godraysBlur:           true,
    godraysColor:          0xffe6bf,
  },
};

export function detectDefaultTier() {
  if (typeof navigator === 'undefined') return 'medium';

  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (window.matchMedia?.('(pointer: coarse)')?.matches && 'ontouchstart' in window);

  const cores = navigator.hardwareConcurrency ?? 4;
  const mem   = navigator.deviceMemory ?? 4;

  if (cores < 4 || mem < 4) return 'low';
  if (isMobile && (cores < 6 || mem < 6)) return 'low';
  if (isMobile) return 'medium';

  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}

export function getPreset(tier) {
  return TIER_PRESETS[tier] ?? TIER_PRESETS.medium;
}
