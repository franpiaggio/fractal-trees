import { defineConfig } from 'vite';
export default defineConfig({
  base: '/fractal-trees/15/',
  server: { port: 5187, open: true, host: true, allowedHosts: true },
  build: { target: 'esnext', outDir: 'dist' },
});
