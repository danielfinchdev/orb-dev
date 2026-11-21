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

// Excalidraw always appends https://esm.sh/... to the list of places it tries for each font, whatever the asset path is.
// The window's CSP (font-src 'self') blocks that URL and logs an error, so the fallback is rewritten to the same local
// folder and the build fails if the CDN string is still there.
const excalidrawNoCdn = () => ({
  name: 'orb-excalidraw-no-cdn',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('@excalidraw/excalidraw') || !code.includes('esm.sh')) return null;
    const start = code.indexOf('`https://esm.sh/${');
    const endMark = '/dist/prod/`';
    const end = start < 0 ? -1 : code.indexOf(endMark, start);
    if (end < 0) this.error(`Excalidraw's esm.sh fallback was not found in ${id}: update orb-excalidraw-no-cdn`);
    const out = code.slice(0, start) + `new URL('./excalidraw/', document.baseURI).href` + code.slice(end + endMark.length);
    if (out.includes('esm.sh')) this.error(`Excalidraw still points at esm.sh in ${id}`);
    return { code: out, map: null };
  }
});

// 3.5: `vite build --mode android` builds the Android app's page (3.8.1: src/renderer-android, the Tauri app's
// frontendDist, scripts/android-web.mjs): the same pages, but this one may talk to the linked Orb at its own address
// (connect-src http: https:, as src-tauri/tauri.android.conf.json says too) besides Tauri's IPC.
const androidCsp = () => ({
  name: 'orb-android-csp',
  transformIndexHtml: (html) => html.replace("connect-src 'self' ipc: http://ipc.localhost;", "connect-src 'self' ipc: http: https:;")
});

export default defineConfig(({ mode }) => {
  const android = mode === 'android';
  return {
    root: 'src/ui',
    base: './',
    plugins: [react(), tailwindcss(), excalidrawFonts(), excalidrawNoCdn(), ...(android ? [androidCsp()] : [])],
    resolve: { alias: { '@': path.resolve('src/ui') } },
    build: {
      rollupOptions: { input: { index: path.resolve('src/ui/index.html'), pip: path.resolve('src/ui/pip.html') } },
      outDir: android ? path.resolve('src/renderer-android') : '../renderer', emptyOutDir: true, target: 'chrome140', sourcemap: false, chunkSizeWarningLimit: 2000, assetsInlineLimit: 0
    }
  };
});
