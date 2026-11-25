// The window asks the master password (every time) before it sends a rail's value; the engine refuses otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FRESH_ACTIONS } from '../src/ui/lib/core-access.js';
import { railValuesChange } from '../src/shared/rails-registry.mjs';
import es from '../src/shared/locales/es/master.mjs';
import en from '../src/shared/locales/en/master.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('rails and ruleSeed ask every time, with a text in Spanish and English', () => {
  for (const a of ['rails', 'ruleSeed']) {
    assert.ok(FRESH_ACTIONS.includes(a), a);
    assert.ok(es[`master.ask.${a}`], `es ${a}`);
    assert.ok(en[`master.ask.${a}`], `en ${a}`);
  }
});

test('Settings save() asks unlockCore(rails) only for a patch that changes a rail value', () => {
  const rows = read('src/ui/views/settings/rows.jsx');
  assert.match(rows, /railValuesChange\(patch, getState\(\)\.app\?\.config\)/);
  assert.match(rows, /unlockCore\('rails'\)/);
  assert.match(rows, /if \(!unlock\) return undefined/);
  const config = { maxParallel: 3, oneAtATime: false, protected: ['a'], budget: { windowHours: 5, stopAt: 0.9, agents: { claude: { maxTasks: 20, maxHeavy: 6 } } } };
  assert.equal(railValuesChange({ maxParallel: 3, budget: { windowHours: 5, agents: { claude: { maxTasks: 20, maxHeavy: 6 } } } }, config), false);
  assert.equal(railValuesChange({ budget: { windowHours: 6 } }, config), true);
  assert.equal(railValuesChange({ protected: [] }, config), true);
  assert.equal(railValuesChange({ ui: { theme: 'dark' } }, config), false);
});

test('Settings puts the controls back when the password is cancelled; protected paths use the rails password', () => {
  const g = read('src/ui/views/settings/general.jsx');
  assert.doesNotMatch(g, /unlockCore\('protected'\)/);
  assert.match(g, /save\(\{ oneAtATime \}\)\.then\(\(r\) => \{ if \(!r\)/);
  assert.match(g, /setProfile\(before\.profile\); setV\(before\.v\)/);
  // advanced fields: a saved value becomes the stored one; a cancelled password or a failure goes back to what was stored
  assert.match(g, /if \(r\) \{ base\.current = sent; return; \}\s*setProfile\(was\);/);
  assert.match(g, /const b = base\.current;\s*setV\(\(cur\) => \(\{ \.\.\.cur, maxParallel: b\.maxParallel/);
});
