// Serious confirmations (destructive, irreversible or granting more power) must pass danger:true so the dialog focuses
// Cancel; informative ones must not. Checked by reading the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'src', 'ui');
const read = (f) => readFileSync(join(root, f), 'utf8');
// the text of the confirm( call that mentions `needle`
const callOf = (file, needle) => {
  const src = read(file);
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `${file}: ${needle} not found`);
  const from = src.lastIndexOf('confirm(', at);
  const end = src.indexOf('}', at);
  return src.slice(from, end + 1);
};

const SERIOUS = [
  ['views/settings/devices.jsx', "t('settings.android.forget'), t('settings.android.forgetBody')"],
  ['views/settings/general.jsx', "t('settings.switchTitle')"],
  ['views/extensions.jsx', "t('ext.applyTitle'"],
  ['views/projects.jsx', "t('projects.push.title')"],
  ['views/projects.jsx', "t('projects.delete.title')"],
  ['views/chat.jsx', "t('comp.live.cancelTask'), t('comp.live.cancelBody'"],
  ['views/chat.jsx', "t('chat.freeMode')"],
  ['components/live-tasks.jsx', "t('comp.live.cancelBody'"],
  ['views/tasks.jsx', "tr('tasks.discard')"],
  ['views/tasks.jsx', "tr('tasks.merge'),"],
  ['views/magic-link.jsx', "t('link.revokeTitle'"]
];
for (const [file, needle] of SERIOUS) {
  test(`${file}: ${needle.slice(0, 40)} is a danger confirmation`, () => assert.match(callOf(file, needle), /danger:\s*true/));
}

test('informative confirmations stay without danger', () => {
  assert.doesNotMatch(callOf('views/tasks.jsx', "tr('tasks.pr.created')"), /danger/);
  assert.doesNotMatch(callOf('views/agents.jsx', "t('agents.scanNone'"), /danger/);
});

test('the dialog focuses Cancel when danger is on', () => {
  const src = read('components/dialogs.jsx');
  assert.match(src, /variant="outline" data-autofocus=\{d\.danger \? "" : undefined\}/);
  assert.match(src, /data-autofocus=\{d\.danger && d\.cancel \? undefined : ""\}/);
});
