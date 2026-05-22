import { defineConfig } from 'vite';

// Repo-pages base. Pages serves this app at https://franpiaggio.github.io/fractal-trees/
// so every asset URL needs the `/fractal-trees/` prefix in production. Local
// `vite dev` ignores `base` for the entry HTML, so dev still works as `/`.
export default defineConfig({
  base: '/fractal-trees/',
  server: { port: 5175, open: true },
  build: { target: 'esnext' },
});
