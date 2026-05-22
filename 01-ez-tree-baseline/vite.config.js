import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fractal-trees/01/',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'esnext',
  },
});
