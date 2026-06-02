import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/10/',
  server: {
    port: 5182,
    open: true,
    host: true,
    // Allow the cloudflared tunnel host (Vite 5.4+ blocks unknown hosts).
    allowedHosts: true,
  },
  build: { target: 'esnext', outDir: 'dist' },
});
