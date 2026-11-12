// The permission selector is one combobox with a listbox; values and test ids stay as the callers and e2e use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'components', 'autonomy-switch.jsx'), 'utf8');

test('one combobox labelled «Permisos» opens a listbox of options', () => {
  assert.match(src, /role="combobox"/);
  assert.match(src, /aria-label=\{t\('session\.permissions'\)\}/);
  assert.match(src, /role="listbox"/);
  assert.match(src, /role="option" aria-selected=\{on\}/);
});

test('keeps the test ids and the current mode', () => {
  assert.match(src, /data-testid=\{testid\} data-mode=\{value\}/);
  assert.match(src, /data-testid=\{`\$\{testid\}-\$\{o\.value\}`\}/);
  assert.match(src, /\$\{testid\}-more/);
});

test('lists every level with an icon and a description', () => {
  for (const level of ['auto', 'editar', 'leer', 'probar', 'preguntar', 'total']) assert.ok(src.includes(`  ${level}: { Icon:`), level);
});

test('the callers keep the phone rule and the full-access flow', () => {
  const session = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'views', 'session.jsx'), 'utf8');
  assert.match(session, /disabled=\{bridge\.mobile && s\.permission === 'total'\}/);
  assert.match(session, /\(!bridge\.mobile \|\| o\.value !== 'total'\)/);
  assert.match(session, /unlockCore\('fullAccess'\)/);
});
