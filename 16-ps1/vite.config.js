import { defineConfig } from 'vite';
export default defineConfig({
  base: '/fractal-trees/16/',
  server: { port: 5188, open: true, host: true, allowedHosts: true },
  build: { target: 'esnext', outDir: 'dist' },
});
