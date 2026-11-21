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
  // up to the end of that statement's line (the options object closes on it) or the next confirm(
  const next = src.indexOf('confirm(', from + 8);
  const eol = src.indexOf('\n', at);
  return src.slice(from, next > 0 && next < eol ? next : eol);
};

const SERIOUS = [
  ['views/settings/devices.jsx', "t('settings.android.forget'), t('settings.android.forgetBody')"],
  ['views/settings/general.jsx', "t('settings.switchTitle')"],
  ['views/extensions.jsx', "t('ext.applyTitle'"],
  ['components/project-flows.jsx', "t('projects.push.title')"],
  ['components/project-flows.jsx', "t('projects.delete.title')"],
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
