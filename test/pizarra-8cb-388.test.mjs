// Corrections 8C-b of the Pizarra (07): the PC canvas draws only the approved toolbar and nothing is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const whiteboard = read('src/ui/views/whiteboard.jsx');
const css = read('src/ui/app.css');

test('the PC canvas hides the lock, key numbers, extra tools, main menu, library button and hint with CSS only', () => {
  assert.match(whiteboard, /className="wb-canvas wb-pc relative min-w-0 flex-1" data-testid="whiteboard-canvas"/);
  for (const cls of ['ToolIcon__lock', 'ToolIcon__keybinding', 'App-toolbar__extra-tools-trigger', 'main-menu-trigger', 'default-sidebar-trigger', 'HintViewer']) assert.ok(css.includes(`.wb-pc .excalidraw .${cls}`), cls);
  // the phone and linked-browser canvas keeps Excalidraw's own bars
  assert.equal((whiteboard.match(/wb-pc/g) ?? []).length, 1);
});

test('what the toolbar no longer draws is reached from the canvas menu', () => {
  for (const id of ['whiteboard-menu-lock', 'whiteboard-menu-library', 'whiteboard-menu-frame', 'whiteboard-menu-embed', 'whiteboard-menu-laser', 'whiteboard-menu-background']) assert.ok(whiteboard.includes(`data-testid="${id}"`), id);
  assert.match(whiteboard, /setActiveTool\(\{ type: tool\.type, locked: !tool\.locked \}\)/);
  assert.match(whiteboard, /toggleSidebar\(\{ name: 'default', tab: 'library' \}\)/);
  for (const k of ['wb.lock', 'wb.library', 'wb.toolFrame', 'wb.toolEmbed', 'wb.toolLaser', 'wb.background']) { assert.ok(es[k], k); assert.ok(en[k], k); }
  // the drawing is still saved the same way
  assert.match(whiteboard, /whiteboard\.save/);
});
