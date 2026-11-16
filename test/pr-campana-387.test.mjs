// A PR card only shows inside its own chat and the request expires; with another view open the bell must say it waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { createT } from '../src/shared/i18n.mjs';

const src = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'app', 'engine-events.js'), 'utf8');

test('engine events: pr:request raises a bell notice unless that chat is already open, and it can open the chat', () => {
  const block = /event === 'pr:request'[\s\S]*?\n      \}\n/.exec(src)?.[0] ?? '';
  assert.match(block, /here\?\.view === 'session'/);
  assert.match(block, /String\(here\.id\) === String\(payload\.session\)/);
  assert.match(block, /always: true/);
  assert.match(block, /go: chat \? \{ view: 'session', id: chat\.id \} : null/);
});

test('the notice has its words in both languages', async () => {
  for (const lang of ['es', 'en']) {
    const t = createT(lang);
    assert.match(t('app.prCardWaiting', { number: 7 }), /#7/, lang);
  }
});
