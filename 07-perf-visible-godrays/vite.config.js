import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/07/',
  server: { port: 5179, open: true },
  build: { target: 'esnext', outDir: 'dist' },
});
