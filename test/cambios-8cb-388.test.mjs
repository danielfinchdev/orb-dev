// Corrections 8C-b of the Cambios tab (03): line numbers, unified/split, before/after and the open-in-editor button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchRows, beforeRows, splitPairs, lineAt } from '../src/ui/lib/patch-rows.js';
import es from '../src/shared/locales/es.mjs';
import en from '../src/shared/locales/en.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NL = '\n';
const PATCH = ['diff --git a/s.ts b/s.ts', 'index 1..2 100644', '--- a/s.ts', '+++ b/s.ts', '@@ -1,4 +1,5 @@', ' one', '-two', '+TWO', '+two and a half', ' three', ' four', '@@ -20,2 +21,2 @@', '-old', '+new', ' end', ''].join(NL);

test('patchRows numbers both sides and leaves out what comes before the first hunk', () => {
  const rows = patchRows(PATCH);
  assert.equal(rows[0].kind, 'hunk');
  assert.deepEqual(rows.filter((r) => r.kind === 'ctx').map((r) => [r.oldNo, r.newNo]), [[1, 1], [3, 4], [4, 5], [21, 22]]);
  const del = rows.find((r) => r.kind === 'del');
  assert.deepEqual([del.oldNo, del.newNo, del.body, del.sign], [2, undefined, 'two', '-']);
  assert.deepEqual(rows.filter((r) => r.kind === 'add').map((r) => r.newNo), [2, 3, 21]);
  assert.equal(rows.at(-1).body, 'end');
  assert.deepEqual(patchRows(''), []);
});

test('beforeRows is the old file; splitPairs puts removed left and added right row by row', () => {
  const rows = patchRows(PATCH);
  assert.ok(beforeRows(rows).every((r) => r.kind !== 'add'));
  const pairs = splitPairs(rows);
  const first = pairs.find((p) => p.left?.kind === 'del');
  assert.equal(first.left.body, 'two');
  assert.equal(first.right.body, 'TWO');
  // two added lines against one removed: the second has an empty left
  const second = pairs[pairs.indexOf(first) + 1];
  assert.equal(second.left, null);
  assert.equal(second.right.body, 'two and a half');
  assert.ok(pairs.some((p) => p.full?.kind === 'hunk'));
  assert.ok(pairs.some((p) => p.left && p.left === p.right));
});

test('lineAt files a removed line under the old side and anything else under the new one', () => {
  const rows = patchRows(PATCH);
  assert.deepEqual(lineAt(rows.find((r) => r.kind === 'del'), 'new'), { line: 2, side: 'old' });
  assert.deepEqual(lineAt(rows.find((r) => r.kind === 'add'), 'new'), { line: 2, side: 'new' });
  assert.deepEqual(lineAt(rows.find((r) => r.kind === 'ctx'), 'old'), { line: 1, side: 'old' });
});

test('the Cambios tab draws the patch with PatchView, the layout controls and the editor button', () => {
  const c = read('src/ui/components/task-changes.jsx');
  assert.match(c, /<PatchView text=\{f\.patch\}/);
  assert.match(c, /tasks\.changes\.unified/);
  assert.match(c, /tasks\.changes\.before/);
  assert.match(c, /<OpenInMenu project=\{project\}/);
  assert.match(c, /flex h-9 w-full/, 'file rows are 36 px');
  // the chat panel still uses the shared viewer, and the comments keep their library
  assert.match(c, /<DiffLines text=\{f\.patch\} headers=\{false\} \/>/);
  assert.match(c, /addComment\(sessionId/);
  const v = read('src/ui/components/patch-view.jsx');
  assert.match(v, /MAX_HIGHLIGHT = 8000/);
  assert.match(v, /data-testid="diff-comment-add"/);
  for (const k of ['layout', 'unified', 'split', 'version', 'after', 'before']) { assert.ok(es[`tasks.changes.${k}`], k); assert.ok(en[`tasks.changes.${k}`], k); }
});
