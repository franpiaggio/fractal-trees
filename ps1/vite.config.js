import { defineConfig } from 'vite';
export default defineConfig({
  base: '/fractal-trees/ps1/',
  server: { port: 5187, open: true, host: true, allowedHosts: true },
  build: { target: 'esnext', outDir: 'dist' },
});
