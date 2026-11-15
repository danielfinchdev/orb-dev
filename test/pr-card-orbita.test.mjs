// Órbita PR card: answers name the request, PR text is never HTML, the safe button gets the focus when merging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const card = fs.readFileSync(new URL('../src/ui/components/pr-card.jsx', import.meta.url), 'utf8');

test('both buttons answer with refOf(r)', () => {
  assert.ok(card.includes("call('prConfirm.answer', refOf(r))"));
  assert.ok(card.includes("call('prConfirm.decline', refOf(r))"));
});
test('no HTML injection', () => assert.doesNotMatch(card, /dangerouslySetInnerHTML|innerHTML/));
test('focusCancel puts autoFocus on decline and defaults follow danger', () => {
  assert.match(card, /ref=\{declineRef\}.*data-testid="pr-decline"/);
  assert.match(card, /isContentEditable/); // never steals the focus from a text field
  assert.doesNotMatch(card, /autoFocus/);
  assert.ok(card.includes("r.danger ?? !comment"));
  assert.ok(card.includes("r.focusCancel ?? danger"));
});
test('group role and labelled', () => assert.match(card, /role="group" aria-label=\{t\('prcard\.group'/));
test('check cap and disabled while answering', () => {
  assert.ok(card.includes('slice(0, 30)'));
  assert.ok((card.match(/disabled=\{busy\}/g) ?? []).length >= 2);
});
