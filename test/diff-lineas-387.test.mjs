// The per-turn changes panel numbers each diff line from its hunk header; a header that did not parse made every
// number one short, so the first line of a hunk could not be commented and the rest were off by one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hunkStart } from '../src/ui/lib/diff-hunk.js';

test('hunkStart reads the first old and new line of a hunk, with or without counts', () => {
  assert.deepEqual(hunkStart('@@ -3,5 +7,6 @@ function x()'), [3, 7]);
  assert.deepEqual(hunkStart('@@ -0,0 +1 @@'), [0, 1]);
  assert.deepEqual(hunkStart('@@ -12 +12,2 @@'), [12, 12]);
  assert.deepEqual(hunkStart('not a header'), [0, 0]);
});
