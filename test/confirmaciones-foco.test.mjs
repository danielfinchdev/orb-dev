import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');

// Serious or externally visible actions must open with Cancel focused, so a stray Enter cannot accept them.
const SERIOUS = [
  ['components/task-approval.jsx', "tasks.approve.ok"], ['views/extensions.jsx', 'ext.activate'], ['views/extensions.jsx', 'ext.apply'],
  ['views/extensions.jsx', 'ext.moveToCore'], ['views/projects.jsx', 'projects.push.ok'], ['views/tasks.jsx', 'tasks.merge.ok'],
  ['views/core-missing.jsx', 'data.core.fresh']
];

test('serious confirmations are marked danger so the focus goes to Cancel', () => {
  for (const [file, key] of SERIOUS) {
    const call = src(file).split('\n').find((l) => l.includes(`ok: t('${key}')`) || l.includes(`ok: tr('${key}')`));
    assert.ok(call && /danger: true/.test(call), `${file} ${key}`);
  }
});

test('the dialog host focuses Cancel for danger and the main button otherwise', () => {
  const d = src('components/dialogs.jsx');
  assert.match(d, /data-autofocus=\{d\.danger \? "" : undefined\}/);
  assert.match(d, /data-autofocus=\{d\.danger && d\.cancel \? undefined : ""\}/);
});
