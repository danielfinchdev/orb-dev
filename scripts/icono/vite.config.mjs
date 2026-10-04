import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({ root: 'scripts/icono', base: './', logLevel: 'warn', plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.resolve('src/ui') } }, build: { outDir: path.resolve('node_modules/.cache/orb-icono'), emptyOutDir: true } });
