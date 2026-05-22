import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/06/',
  server: { port: 5178, open: true },
  build: { target: 'esnext', outDir: 'dist' },
});
