// 3.8.8 paso 11b (tanda 6), interfaz de la Pizarra: barra de herramientas propia en el orden de la maqueta (con
// setActiveTool), nota general del lienzo, zoom y deshacer con el aspecto de la maqueta, y las fuentes de Excalidraw en local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const view = read('src/ui/views/whiteboard.jsx');
const controls = read('src/ui/components/wb-controls.jsx');
const board = read('src/ui/components/excalidraw-board.jsx');
const css = read('src/ui/app.css');
const vite = read('vite.config.mjs');
const html = read('src/ui/index.html');

test('la barra propia sigue el orden de la maqueta y usa la API pública de Excalidraw', () => {
  const order = [...controls.matchAll(/\['(\w+)', \w+, '[\w]'\]/g)].map((m) => m[1]);
  assert.deepEqual(order, ['selection', 'hand', 'rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'eraser']);
  assert.match(controls, /api\.current\?\.setActiveTool\(\{ type \}\)/);
  assert.match(controls, /role="toolbar"/);
  assert.match(view, /<WbToolbar api=\{api\} tool=\{tool\} \/>/);
  // the active tool is read back from Excalidraw's own state, and the original bar is hidden with CSS only
  assert.match(board, /onTool\?\.\(appState\.activeTool\?\.type\)/);
  assert.match(css, /\.wb-pc \.excalidraw \.App-toolbar-container/);
  for (const type of order) for (const l of [es, en]) assert.ok(l[`wb.tool.${type}`], type);
  for (const k of ['wb.tools', 'wb.shortcuts']) for (const l of [es, en]) assert.ok(l[k], k);
  // what the approved bar does not draw stays in the canvas menu
  for (const id of ['whiteboard-menu-frame', 'whiteboard-menu-embed', 'whiteboard-menu-laser', 'whiteboard-menu-shortcuts']) assert.ok(view.includes(`data-testid="${id}"`), id);
});

test('la nota general del lienzo: botón, guardado al dejar de escribir y estado Guardada', () => {
  assert.match(controls, /data-testid="whiteboard-canvas-note"/);
  assert.match(controls, /data-testid="whiteboard-canvas-note-text"/);
  assert.match(controls, /maxLength=\{NOTE_MAX\}/);
  assert.match(view, /call\('whiteboard\.canvasNote', \{ project, note: value \}\)/);
  assert.match(view, /setTimeout\(flushNote, 1200\)/);
  assert.match(view, /setNoteText\(d\.note \?\? ''\)/);
  // the status badge waits for the note too
  assert.match(view, /noteState === 'saved'/);
  for (const k of ['wb.canvasNote', 'wb.canvasNote.hint', 'wb.canvasNote.ph', 'wb.canvasNote.count']) for (const l of [es, en]) assert.ok(l[k], k);
});

test('zoom y deshacer: son los de Excalidraw (su API pública no tiene deshacer) con el aspecto de la píldora', () => {
  assert.match(css, /\.wb-pc \.excalidraw \.zoom-actions, \.wb-pc \.excalidraw \.undo-redo-buttons \{[^}]*var\(--r-card\)/);
  assert.match(css, /--lg-button-size: var\(--ctl-sm\)/);
  assert.doesNotMatch(css, /\.wb-pc \.excalidraw \.zoom-actions[^{]*\{[^}]*display: none/);
});

test('las fuentes de Excalidraw se sirven desde la app: ruta propia y copia en el build, sin tocar la CSP', () => {
  assert.match(view, /window\.EXCALIDRAW_ASSET_PATH = new URL\('\.\/excalidraw\/', document\.baseURI\)\.href/);
  assert.match(vite, /node_modules\/@excalidraw\/excalidraw\/dist\/prod\/fonts/);
  assert.match(vite, /'excalidraw', 'fonts'/);
  assert.match(html, /font-src 'self';/);
  assert.doesNotMatch(html, /esm\.sh/);
});
