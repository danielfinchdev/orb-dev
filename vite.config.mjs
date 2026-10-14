// Builds the window's interface (React + Tailwind) from src/ui into src/renderer, which the app serves as orb://app/.
// Two pages: the app (index.html) and the little window that shows the agent's browser (pip.html).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

// 2.7: the Pizarra (Excalidraw) draws with its own fonts: copied next to the app so it works offline. 3.2.1: all of them,
// Xiaolai too (12 MB): it is the fallback font of every family, and without it Excalidraw asked esm.sh for each of its
// pieces, which the window's CSP blocks (about a hundred errors each time the Pizarra opened).
const excalidrawFonts = () => ({
  name: 'orb-excalidraw-fonts',
  writeBundle(options) {
    const from = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');
    const to = path.join(options.dir, 'excalidraw', 'fonts');
    for (const family of fs.readdirSync(from)) fs.cpSync(path.join(from, family), path.join(to, family), { recursive: true });
  }
});

export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [react(), tailwindcss(), excalidrawFonts()],
  resolve: { alias: { '@': path.resolve('src/ui') } },
  build: { rollupOptions: { input: { index: path.resolve('src/ui/index.html'), pip: path.resolve('src/ui/pip.html') } }, outDir: '../renderer', emptyOutDir: true, target: 'chrome140', sourcemap: false, chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 }
});
