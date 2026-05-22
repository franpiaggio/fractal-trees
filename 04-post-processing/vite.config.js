import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/04/',
  server: { port: 5176, open: true },
  build: { target: 'esnext', outDir: 'dist' },
});
