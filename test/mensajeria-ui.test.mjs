// 3.6 (messaging): the short time of a chat list's row (src/ui/lib/inbox.js), plus two regression checks of the React
// «insertBefore … not a child of this node» crash (the app went blank after «Guardar»): nothing removes React's own toast
// nodes, and Select never copies its option into the trigger through Radix's portal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import * as M from '../src/ui/lib/inbox.js';

test('la hora de una fila', () => {
  const now = new Date(2026, 10, 4, 18, 0);
  assert.match(M.shortTime(new Date(2026, 10, 4, 9, 5).toISOString(), { now, locale: 'es-ES' }), /^09:05$/);
  assert.equal(M.shortTime(new Date(2026, 10, 3, 9, 5).toISOString(), { now, locale: 'es-ES', yesterday: 'Ayer' }), 'Ayer');
  assert.match(M.shortTime(new Date(2026, 9, 2).toISOString(), { now, locale: 'es-ES' }), /2 oct/);
  assert.equal(M.shortTime('nada'), '');
});

test('regresión insertBefore: ninguna prueba quita a mano los avisos (nodos de React) y Select pinta su opción él mismo', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'test')).filter((x) => x.endsWith('.mjs') && x !== 'mensajeria-ui.test.mjs')) {
    const src = fs.readFileSync(path.join(ROOT, 'test', f), 'utf8');
    assert.doesNotMatch(src, /querySelectorAll\(['\"]\[data-sonner-toast\]['\"]\)[^\n]*\.remove\(\)/, `${f} quita avisos del DOM: React inserta el siguiente antes de uno que ya no está`);
  }
  const overlay = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'components', 'ui', 'overlay.jsx'), 'utf8');
  assert.match(overlay, /<SelectPrimitive\.Value[^>]*>\{chosen \?/, 'el Value de Select con hijos (sin el portal de Radix)');
});
