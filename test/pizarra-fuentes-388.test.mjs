// 3.8.8: the Pizarra draws with Excalidraw's fonts served from the app: no request to esm.sh (the CSP's font-src 'self'
// blocked it and logged an error each time the Pizarra opened).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const board = read('src/ui/components/excalidraw-board.jsx');
const assets = read('src/ui/lib/excalidraw-assets.js');
const vite = read('vite.config.mjs');
const fontsDir = new URL('node_modules/@excalidraw/excalidraw/dist/prod/fonts/', root);

test('the local asset path is set before Excalidraw is imported and ends with a slash', () => {
  assert.match(assets, /window\.EXCALIDRAW_ASSET_PATH = new URL\('\.\/excalidraw\/', document\.baseURI\)\.href/);
  const imports = [...board.matchAll(/^import .*$/gm)].map((m) => m[0]);
  const iAssets = imports.findIndex((l) => l.includes('excalidraw-assets.js'));
  const iLib = imports.findIndex((l) => l.includes("from '@excalidraw/excalidraw'"));
  assert.equal(iAssets, 0);
  assert.ok(iLib > iAssets);
  assert.doesNotMatch(board, /EXCALIDRAW_ASSET_PATH\s*=/, 'a statement after the imports would run too late');
});

test('every Excalidraw font folder (Cascadia included) is copied next to the app', () => {
  assert.match(vite, /readdirSync\(from\)/);
  assert.match(vite, /'excalidraw', 'fonts'/);
  assert.match(vite, /recursive: true/);
  const families = fs.readdirSync(fontsDir);
  assert.ok(families.includes('Cascadia'));
  assert.ok(fs.existsSync(new URL('Cascadia/CascadiaCode-Regular.woff2', fontsDir)));
});

test('Excalidraw\'s esm.sh fallback is rewritten to the local folder and the build fails if it cannot be', () => {
  assert.match(vite, /excalidrawNoCdn\(\)/);
  assert.match(vite, /this\.error\(/);
  assert.match(vite, /new URL\('\.\/excalidraw\/', document\.baseURI\)\.href/);
});

test('no CDN URL for the Pizarra in the app code or in the compiled output', () => {
  const cdn = /esm\.sh|unpkg\.com|cdn\.jsdelivr|cdnjs\.cloudflare|skypack/;
  for (const f of [board, assets, read('src/ui/views/whiteboard.jsx'), read('src/ui/components/wb-controls.jsx')]) assert.doesNotMatch(f, cdn);
  const out = new URL('src/renderer/assets/', root);
  if (!fs.existsSync(out)) return;
  const js = fs.readdirSync(out).filter((n) => n.endsWith('.js'));
  const hits = js.filter((n) => /https:\/\/esm\.sh/.test(fs.readFileSync(path.join(out.pathname.replace(/^\/(\w:)/, '$1'), n), 'utf8')));
  assert.deepEqual(hits, []);
  assert.ok(fs.existsSync(new URL('src/renderer/excalidraw/fonts/Cascadia/CascadiaCode-Regular.woff2', root)));
});
