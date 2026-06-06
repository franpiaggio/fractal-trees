import { defineConfig } from 'vite';
export default defineConfig({
  base: '/fractal-trees/17/',
  server: { port: 5189, open: true, host: true, allowedHosts: true },
  build: { target: 'esnext', outDir: 'dist' },
});
