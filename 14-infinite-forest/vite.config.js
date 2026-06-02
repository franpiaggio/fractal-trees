import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/fractal-trees/14/',
  server: {
    port: 5186,
    open: true,
    host: true,
    // Allow cloudflared tunnel hosts (Vite 5.4+ blocks unknown hosts).
    allowedHosts: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        record: resolve(__dirname, 'record.html'),
      },
    },
  },
});
