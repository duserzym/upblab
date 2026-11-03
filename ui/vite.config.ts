import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// One build for two deliveries (plan decision 3): bundled into the Tauri app,
// and served by laicpmsdb at /desk/. `base: './'` keeps asset paths relative.
// Port 1420 (Tauri's default) so it never collides with laicpmsdb's Vite on 5173.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  clearScreen: false,
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, target: ['es2022', 'safari16'] },
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
