import * as THREE from 'three';

const trackedShaders = new Set();

const settings = {
  strength: new THREE.Vector3(0.5, 0, 0.5),
  frequency: 0.5,
  scale: 70,
};

export function applyWind(material) {
  if (!material) return;

  if (material.userData?.shader?.uniforms?.uTime) {
    trackedShaders.add(material.userData.shader);
    return;
  }

  const prevOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prevOnBeforeCompile) prevOnBeforeCompile(shader);
    if (shader.uniforms.uTime) {
      trackedShaders.add(shader);
      return;
    }
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindStrength = { value: settings.strength.clone() };
    shader.uniforms.uWindFrequency = { value: settings.frequency };
    shader.uniforms.uWindScale = { value: settings.scale };
    material.userData.shader = shader;
    trackedShaders.add(shader);
  };
  material.needsUpdate = true;
}

export function updateWind(time) {
  for (const shader of trackedShaders) {
    if (shader.uniforms.uTime) shader.uniforms.uTime.value = time;
    if (shader.uniforms.uWindStrength) shader.uniforms.uWindStrength.value.copy(settings.strength);
    if (shader.uniforms.uWindFrequency) shader.uniforms.uWindFrequency.value = settings.frequency;
    if (shader.uniforms.uWindScale) shader.uniforms.uWindScale.value = settings.scale;
  }
}

export function setWindStrength(scalar) {
  settings.strength.set(scalar, 0, scalar);
}

export function setWindFrequency(f) {
  settings.frequency = f;
}

export function getWindSettings() {
  return settings;
}
