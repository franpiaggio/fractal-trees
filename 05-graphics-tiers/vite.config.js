import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/05/',
  server: { port: 5177, open: true },
  build: { target: 'esnext', outDir: 'dist' },
});
