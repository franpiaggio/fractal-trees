import GUI from 'lil-gui';
import { PRESET_NAMES } from './tree.js';
import { setWindStrength, setWindFrequency, getWindSettings } from './wind.js';

export function mountGUI({ hero, env }) {
  const gui = new GUI({ title: 'Fractal Trees', width: 280 });

  const state = {
    preset: 'Oak Medium',
    seed: 42,
    windStrength: 0.5,
    windFrequency: getWindSettings().frequency,
    sunAzimuth: 30,
    regenerate: () => hero.regenerate({ preset: state.preset, seed: state.seed }),
  };

  const tree = gui.addFolder('Tree');
  tree.add(state, 'preset', PRESET_NAMES).onChange(() => hero.regenerate({ preset: state.preset, seed: state.seed }));
  tree.add(state, 'seed', 0, 9999, 1).onFinishChange(() => hero.regenerate({ seed: state.seed }));
  tree.add(state, 'regenerate').name('regenerate');

  const wind = gui.addFolder('Wind');
  wind.add(state, 'windStrength', 0, 2, 0.01).onChange(setWindStrength);
  wind.add(state, 'windFrequency', 0, 3, 0.01).onChange(setWindFrequency);

  const sky = gui.addFolder('Sun');
  sky.add(state, 'sunAzimuth', 0, 360, 1).onChange((v) => env.setSunAzimuth(v));

  return gui;
}
