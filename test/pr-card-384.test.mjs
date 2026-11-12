// The PR confirmation card: mounted in the session view, plain-text rendering and es/en key parity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import es from '../src/shared/locales/es/herramientas.mjs';
import en from '../src/shared/locales/en/herramientas.mjs';

const card = fs.readFileSync(new URL('../src/ui/components/pr-card.jsx', import.meta.url), 'utf8');
const session = fs.readFileSync(new URL('../src/ui/views/session.jsx', import.meta.url), 'utf8');

test('session view mounts PrCards next to SecretCards', () => {
  assert.match(session, /<PrCards sessionId=\{s\.id\} \/>/);
});
test('the card never renders PR text as HTML and uses only pc-only methods', () => {
  assert.doesNotMatch(card, /dangerouslySetInnerHTML|Markdown/);
  for (const m of ['prConfirm.pending', 'prConfirm.answer', 'prConfirm.decline']) assert.ok(card.includes(m));
});
test('the card sends session, number and head commit, wraps PR text in bdi and clears the list on chat change', () => {
  assert.ok(card.includes('refOf(r)'));
  assert.ok(card.includes('session: r.session, number: r.number, headRefOid'));
  for (const field of ['r.title', 'r.headRefName', 'r.baseRefName', 'c.name', 'r.project']) assert.ok(card.includes('<bdi>{' + field + '}</bdi>'), field);
  assert.ok(card.includes('<code title={r.headRefOid'));
  assert.ok(card.includes('setList([]);'));
});
test('prcard.* keys exist in es and en', () => {
  const keys = (m) => Object.keys(m.default ?? m).filter((k) => k.startsWith('prcard.')).sort();
  const a = keys(es); assert.ok(a.length >= 7); assert.deepEqual(a, keys(en));
});
