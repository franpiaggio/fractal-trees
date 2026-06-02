// PlayStation-1 look toolkit.
//
//   • Vertex snap  — PS1 had no sub-pixel vertex precision, so vertices jumped to
//     a low-res grid → the classic "wobble" as things move. We snap clip-space
//     XY to a grid in every patched material's vertex shader.
//   • Nearest textures — no bilinear filtering → chunky texels.
//   • Quantise + ordered dither — 15-bit-ish colour with a 4×4 Bayer dither,
//     the signature PS1 banding/shimmer. Runs as a postprocessing Effect.
//
// Low internal resolution (the pixelation) is handled in main.js by sizing the
// renderer/composer small and letting CSS upscale nearest-neighbour.

import * as THREE from 'three';
import { Effect } from 'postprocessing';

// Shared uniforms so one GUI slider drives every patched material at once.
export const pixelUniforms = {
  uSnap: { value: 110 },   // grid resolution in NDC; lower = chunkier wobble
};

// Wrap a material's onBeforeCompile to snap gl_Position to the grid. Chains any
// existing onBeforeCompile (wind, instancing, …). Call BEFORE the first compile.
export function applyVertexSnap(material) {
  if (!material || material.userData?.__ps1) return;
  material.userData = material.userData || {};
  material.userData.__ps1 = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    shader.uniforms.uSnap = pixelUniforms.uSnap;
    if (!shader.vertexShader.includes('uniform float uSnap;')) {
      shader.vertexShader = 'uniform float uSnap;\n' + shader.vertexShader;
    }
    const SNAP = /* glsl */`$&
      // Only snap in front of the camera. For vertices at/behind the near plane
      // (w <= 0) the perspective divide explodes and stretches triangles across
      // the screen — the classic naive-snap artifact.
      if (gl_Position.w > 0.0) {
        vec4 _ps1 = gl_Position;
        _ps1.xyz /= _ps1.w;                       // → NDC
        _ps1.xy = floor(_ps1.xy * uSnap) / uSnap; // snap to the grid
        _ps1.xyz *= _ps1.w;                       // → clip
        gl_Position = _ps1;
      }`;
    // Most materials still have the include here; ez-tree's leaf material has
    // already EXPANDED project_vertex, so fall back to the gl_Position line.
    let v = shader.vertexShader;
    if (v.includes('#include <project_vertex>')) {
      v = v.replace('#include <project_vertex>', SNAP);
    } else if (v.includes('gl_Position = projectionMatrix * mvPosition;')) {
      v = v.replace('gl_Position = projectionMatrix * mvPosition;', SNAP);
    }
    shader.vertexShader = v;
    material.userData.shader = shader;   // keep wind's reference valid
  };
  material.needsUpdate = true;
}

// No filtering / no mipmaps → hard pixel texels.
export function makeNearest(tex) {
  if (!tex) return tex;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ── Quantise + 4×4 Bayer ordered dither (postprocessing Effect) ──────────────
const PS1_FRAG = /* glsl */`
uniform float uLevels;
uniform float uDither;

// Compact 4×4 Bayer, returns 0..1.
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float d = (bayer4(gl_FragCoord.xy) - 0.5) * uDither;
  vec3 c = floor(inputColor.rgb * uLevels + 0.5 + d) / uLevels;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}`;

export class PixelEffect extends Effect {
  constructor({ levels = 22, dither = 1.0 } = {}) {
    super('PixelEffect', PS1_FRAG, {
      uniforms: new Map([
        ['uLevels', new THREE.Uniform(levels)],
        ['uDither', new THREE.Uniform(dither)],
      ]),
    });
  }
  get levels() { return this.uniforms.get('uLevels').value; }
  set levels(v) { this.uniforms.get('uLevels').value = v; }
  get dither() { return this.uniforms.get('uDither').value; }
  set dither(v) { this.uniforms.get('uDither').value = v; }
}
