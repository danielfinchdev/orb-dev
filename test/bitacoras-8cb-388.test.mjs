// Corrections 8C-b of Bitácoras (09): the entry cards as rows, the activity chips and the rails without a switch in the row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEntries, splitParts } from '../src/ui/lib/logbook.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const src = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
const NL = '\n';

test('splitParts: the labelled lines of an entry become rows, the rest stays as it was', () => {
  const body = ['- Pedido por Alex: tarea creada por usuario.', '- Hecho: cambió `src/a.js`', '  - un detalle', '  - otro', '- Cómo revertir: botón «Deshacer»', '- Estado / pendiente: Completada.'].join(NL);
  const { lead, parts } = splitParts(body);
  assert.equal(lead, '');
  assert.deepEqual(parts.map((p) => p.key), ['request', 'done', 'revert', 'pending']);
  assert.equal(parts[0].text, 'tarea creada por usuario.');
  assert.equal(parts[1].text, ['cambió `src/a.js`', '- un detalle', '- otro'].join(NL));
  assert.equal(parts[3].label, 'Estado / pendiente');
  // text before the first label is kept; «Pedido de Dani» is the request too
  const mixed = splitParts(['Intro', '- Pedido de Dani: algo', '- Hecho: listo'].join(NL));
  assert.equal(mixed.lead, 'Intro');
  assert.equal(mixed.parts[0].key, 'request');
  // no labelled line: nothing for the grid, the card keeps the Markdown
  assert.deepEqual(splitParts(['- uno', '- dos'].join(NL)).parts, []);
  assert.deepEqual(splitParts('- Nota: otra cosa').parts, []);
  const { entries } = parseEntries(`### 2026-11-11 10:12 — Orb — Tema${NL}- Hecho: x`);
  assert.equal(entries[0].parts[0].text, 'x');
  assert.equal(entries[0].body, '- Hecho: x');
  const plain = parseEntries(`### sin forma${NL}cuerpo`).entries[0];
  assert.deepEqual(plain.parts, []);
});

test('an entry card draws its parts in an 80 px label grid and keeps the Markdown for any other shape', () => {
  const l = src('views/logs.jsx');
  assert.match(l, /grid-cols-\[80px_minmax\(0,1fr\)\]/);
  assert.match(l, /e\.parts\?\.length/);
  assert.match(l, /<Markdown>\{p\.text\}<\/Markdown>/);
  assert.match(l, /<Markdown>\{e\.body\}<\/Markdown>/);
  for (const k of ['request', 'done', 'revert', 'pending']) { assert.ok(es[`logbooks.part.${k}`], k); assert.ok(en[`logbooks.part.${k}`], k); }
  assert.match(es['logbooks.privateAt'], /\{dir\}/);
  assert.match(en['logbooks.privateAt'], /\{dir\}/);
});

test('Actividad: text chips for the sources and three level chips over the same threshold, no invented totals', () => {
  const a = src('views/activity.jsx');
  assert.match(a, /aria-pressed=\{sourceOn\(s\)\}/);
  assert.match(a, /activity-level-\$\{l\}/);
  assert.match(a, /const nextLevel =/);
  assert.match(a, /font-mono/);
  assert.doesNotMatch(a, /<Check\b|<Segmented/);
  // the engine gives no total per source or level, so no chip carries a number
  assert.doesNotMatch(a, /\bcount\b/);
});

test('Normas: no switch or edit icon in the rows; pausing and resuming a rail stay in «⋯» on the same path', () => {
  const c = src('views/rules-cards.jsx');
  assert.doesNotMatch(c, /<Switch\b/);
  assert.doesNotMatch(c, /<Pencil\b/);
  assert.match(c, /onSelect=\{\(\) => onSwitch\(rail, !on\)\} data-testid=\{`rail-switch-\$\{rail\.id\}`\}/);
  const r = src('views/rules.jsx');
  assert.match(r, /confirmResumeRail\(rail\) : confirmPauseRail\(rail\)/);
  assert.match(r, /changeRail\(rail\.id, \{ enabled: next \}/);
});
