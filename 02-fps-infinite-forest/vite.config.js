import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/02/',
  server: { port: 5174, open: true },
  build: { target: 'esnext' },
});
