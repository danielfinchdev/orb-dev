// A raw NUL or tab inside a string literal is invisible in review and lost by shell edits: sources write '\0' and '\t'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? e.name === 'renderer' ? [] : walk(path.join(dir, e.name)) : /\.(mjs|js|jsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));

test('no source has a raw NUL, nor a raw tab inside a one-line quoted string', () => {
  const bad = [];
  for (const file of walk(src)) {
    const text = fs.readFileSync(file, 'latin1');
    if (text.includes('\0')) bad.push(`${file}: NUL`);
    if (/(['"])(?:(?!\1)[^\n\\])*\t(?:(?!\1)[^\n\\])*\1/.test(text)) bad.push(`${file}: tab in a string`);
  }
  assert.deepEqual(bad, []);
});
