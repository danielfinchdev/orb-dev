// Builds the window's interface (React + Tailwind) from src/ui into src/renderer, which the app serves as orb://app/.
// Two pages: the app (index.html) and the little window that shows the agent's browser (pip.html).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve('src/ui') } },
  build: { rollupOptions: { input: { index: path.resolve('src/ui/index.html'), pip: path.resolve('src/ui/pip.html') } }, outDir: '../renderer', emptyOutDir: true, target: 'chrome140', sourcemap: false, chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 }
});
