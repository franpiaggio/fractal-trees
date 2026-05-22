import { defineConfig } from 'vite';

// Repo-pages base. Pages serves this app at https://franpiaggio.github.io/fractal-trees/03/
// (each version lives under its own subpath). Local `vite dev` ignores `base`
// for the entry HTML, so dev still works as `/`.
export default defineConfig({
  base: '/fractal-trees/03/',
  server: { port: 5175, open: true },
  build: { target: 'esnext' },
});
